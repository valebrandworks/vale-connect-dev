// Checks database access rules in a temporary in-memory Postgres (PGlite).
// Nothing here connects to Supabase or any other remote database.
// Limit: Supabase roles and auth are imitated, so this does not replace a test on a real project.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { rebuild } from './db-rebuild.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const sql = rel => fs.readFileSync(path.join(repo, rel), 'utf8');
const TESTS = ['connections_rls', 'profiles_rls', 'public_cards_rls', 'multiple_cards_rls', 'rls_event_trigger_permissions', 'card_and_limit_rules', 'deletion_and_usage', 'relationship_details', 'plan_features', 'card_images', 'reciprocal_sharing', 'sharing_indexes', 'share_back_settings', 'share_contact_keys', 'unlimited_connections', 'card_reports'].map(name => `supabase/tests/${name}.sql`);
const [CONNECTIONS, PROFILES, CARDS, MULTI, , RULES, DELETION, , FEATURES, IMAGES, SHARING, SHARING_INDEXES, SHARE_BACK, CONTACT_KEYS, UNLIMITED, REPORTS] = TESTS;

let failures = 0;
const report = (ok, label) => { console.log((ok ? 'pass  ' : 'FAIL  ') + label); if (!ok) failures++; };
const count = async (db, table) => (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

// Access tests pass on the rebuilt database and leave nothing behind.
const db = await rebuild(repo);
for (const file of TESTS) {
  try { await db.exec(sql(file)); report(true, path.basename(file)); }
  catch (error) { report(false, `${path.basename(file)}: ${error.message}`); }
}
for (const table of ['public.connections', 'public.profiles', 'public.public_cards', 'auth.users']) report(await count(db, table) === 0, `fixtures rolled back from ${table}`);

// Every column the app uses exists.
const columns = {};
for (const { table_name: table, column_name: column } of (await db.query(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'`)).rows) (columns[table] ||= new Set()).add(column);
const expectColumns = (table, list, label) => { const missing = list.filter(column => !columns[table]?.has(column)); report(!missing.length, `app columns exist: ${label}${missing.length ? ' (missing ' + missing.join(', ') + ')' : ''}`); };
const cardTools = require(path.join(repo, 'cards-core.js')), cloud = require(path.join(repo, 'cloud-connections-core.js')), exporter = require(path.join(repo, 'connections-export.js'));
expectColumns('public_cards', [...Object.values(cardTools.fields), 'id', 'owner_id', 'slug', 'card_label', 'published', 'revision', 'updated_at'], 'card editor');
const lookup = (await db.query(`SELECT pg_get_function_result('public.get_public_card(text)'::regprocedure) AS r`)).rows[0].r;
const missingFromLookup = ['id', ...Object.values(cardTools.fields)].filter(column => !new RegExp(`\\b${column}\\b`).test(lookup));
report(!missingFromLookup.length, `public card lookup returns what the page needs${missingFromLookup.length ? ' (missing ' + missingFromLookup.join(', ') + ')' : ''}`);
report(!/owner_id|card_label|revision|published|updated_at/.test(lookup), 'public card lookup returns no private fields');
expectColumns('profiles', ['id', ...sql('import-local.js').match(/from\('profiles'\)\.select\('([^']+)'/)[1].split(','), 'created_at'], 'earlier profile import');
expectColumns('connections', [...Object.keys(cloud.payload({ cname: 'Synthetic' })), 'id', 'owner_id', 'source_identity', 'source_url', 'revision'], 'cloud connections');
expectColumns('connections', exporter.columns, 'cloud backup');
await db.close();

// Each deliberately broken rule must make its access test fail.
// The card rules function with only its drafts-first check removed.
const cardRules = sql('supabase/migrations/20261104074759_harden_cards_and_add_membership_limits.sql').replace(/\r\n/g, '\n');
const rulesStart = cardRules.indexOf('CREATE FUNCTION public.enforce_card_rules()'), rulesEnd = cardRules.indexOf('\nEND $$;', rulesStart) + 8;
const draftsLine = "  IF NEW.published THEN RAISE EXCEPTION 'New cards start as private drafts. Save it first, then publish.'; END IF;\n";
if (rulesStart < 0 || rulesEnd < 8 || !cardRules.slice(rulesStart, rulesEnd).includes(draftsLine)) throw new Error('Card rules function not found for the drafts-first check');
const draftsOff = cardRules.slice(rulesStart, rulesEnd).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION').replace(draftsLine, '');
// record_share with one rule removed, to prove the sharing tests notice.
// Taken from the newest migration that defines it, so a sabotaged copy never quietly undoes a later fix.
const shareFile = fs.readdirSync(path.join(repo, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort().reverse()
  .find(f => /CREATE (OR REPLACE )?FUNCTION public\.record_share\(/.test(sql('supabase/migrations/' + f)));
const sharingSql = sql('supabase/migrations/' + shareFile).replace(/\r\n/g, '\n');
const shareStart = sharingSql.search(/CREATE (OR REPLACE )?FUNCTION public\.record_share\(/), shareEnd = sharingSql.indexOf('\nEND $$;', shareStart) + 8;
if (shareStart < 0 || shareEnd < 8) throw new Error('record_share not found for the sharing checks');
const recordShare = sharingSql.slice(shareStart, shareEnd).replace(/^CREATE FUNCTION/, 'CREATE OR REPLACE FUNCTION');
const withoutRule = (find, replace = '') => { if (!recordShare.includes(find)) throw new Error('Sharing rule not found: ' + find); return recordShare.replace(find, replace); };
// Report functions with one rule changed, taken from the reports migration.
const REPORTS_SQL = 'supabase/migrations/20261114000000_add_card_reports.sql', REPORTS_DOWN = 'supabase/rollback/20261114000000_add_card_reports.down.sql';
const reportsSql = sql(REPORTS_SQL).replace(/\r\n/g, '\n');
const reportFn = (name, find, replace = '') => {
  const start = reportsSql.indexOf(`CREATE FUNCTION ${name}(`), end = reportsSql.indexOf('\nEND $$;', start) + 8;
  if (start < 0 || end < 8) throw new Error('Report function not found: ' + name);
  const body = reportsSql.slice(start, end).replace('CREATE FUNCTION', 'CREATE OR REPLACE FUNCTION');
  if (!body.includes(find)) throw new Error(`Report rule not found in ${name}: ${find}`);
  return body.replace(find, replace);
};
const brokenRules = [
  ['reports: visitors can submit directly', REPORTS, 'GRANT EXECUTE ON FUNCTION public.submit_card_report(text, uuid, text, text, text, boolean, text) TO anon'],
  ['reports: accounts can read reports', REPORTS, 'GRANT SELECT ON vale_private.card_reports TO authenticated'],
  ['reports: server role can read reports', REPORTS, 'GRANT USAGE ON SCHEMA vale_private TO service_role; GRANT SELECT ON vale_private.card_reports TO service_role'],
  ['reports: admin without two-step sign-in', REPORTS, reportFn('vale_private.require_admin', "coalesce(auth.jwt()->>'aal', '') <> 'aal2'", 'false')],
  ['reports: any signed-in account is an admin', REPORTS, reportFn('vale_private.require_admin', 'OR NOT EXISTS (SELECT 1 FROM vale_private.platform_admins a WHERE a.user_id = uid)')],
  ['reports: drafts can be reported', REPORTS, reportFn('public.submit_card_report', 'IF NOT FOUND OR NOT card.published THEN', 'IF NOT FOUND THEN')],
  ['reports: no accuracy confirmation needed', REPORTS, reportFn('public.submit_card_report', 'IF p_attested IS NOT TRUE OR p_submission_id IS NULL', 'IF p_submission_id IS NULL')],
  ['reports: raw addresses accepted as the network', REPORTS, reportFn('public.submit_card_report', "OR coalesce(p_network_hash, '') !~ '^[0-9a-f]{64}$'", "OR coalesce(p_network_hash, '') = ''") + '; ALTER TABLE vale_private.card_reports DROP CONSTRAINT card_reports_network_hash_check'],
  ['reports: no rate limits', REPORTS, "UPDATE vale_private.report_settings SET value = 100000 WHERE name LIKE '%per_day'"],
  ['reports: identical repeats stored again', REPORTS, reportFn('public.submit_card_report', 'IF existing IS NOT NULL THEN', 'IF false THEN')],
  ['reports: blocked networks still stored', REPORTS, reportFn('public.submit_card_report', "IF EXISTS (SELECT 1 FROM vale_private.blocked_reporters b WHERE b.network_hash = p_network_hash) THEN RETURN 'blocked'; END IF;")],
  ['reports: snapshot copies private card fields', REPORTS, reportFn('public.submit_card_report', "jsonb_strip_nulls(jsonb_build_object('display_name', card.display_name,", "to_jsonb(card) || jsonb_strip_nulls(jsonb_build_object('display_name', card.display_name,")],
  ['reports: alerts not throttled', REPORTS, "CREATE OR REPLACE FUNCTION public.claim_report_alert() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS 'SELECT true'"],
  ['reports: closing a report keeps the email', REPORTS, reportFn('public.admin_set_report_status', 'reporter_email = CASE WHEN closing THEN NULL ELSE reporter_email END', 'reporter_email = reporter_email') + '; ALTER TABLE vale_private.card_reports DROP CONSTRAINT card_reports_email_removed_when_closed'],
  ['reports: decisions without a note', REPORTS, "CREATE OR REPLACE FUNCTION vale_private.clean_note(p_note text, p_required boolean) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS 'SELECT coalesce(p_note, '''')'"],
  ['reports: hiding leaves the card public', REPORTS, reportFn('public.admin_hide_card', ' UPDATE public.public_cards SET published = false WHERE id = rep.card_id;\n')],
  ['reports: hiding without telling the owner', REPORTS, reportFn('public.admin_hide_card', " INSERT INTO public.notifications(owner_id, kind, card_id) VALUES (v_owner, 'card_hidden', rep.card_id);\n")],
  ['reports: hiding not logged', REPORTS, reportFn('public.admin_hide_card', " INSERT INTO vale_private.moderation_actions(admin_id, action, report_id, card_id, note) VALUES (uid, 'hide_card', rep.id, rep.card_id, v_note);\n")],
  ['reports: owners can republish hidden cards', REPORTS, 'DROP TRIGGER public_cards_holds ON public.public_cards'],
  ['reports: owners see who reported', REPORTS, "DROP FUNCTION public.get_my_card_holds(); CREATE FUNCTION public.get_my_card_holds() RETURNS TABLE (card_id uuid, hidden_at timestamptz, category text, owner_message text, reporter text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS 'SELECT h.card_id, h.hidden_at, h.category, h.owner_message, r.network_hash FROM vale_private.card_holds h JOIN public.public_cards c ON c.id = h.card_id LEFT JOIN vale_private.card_reports r ON r.id = h.report_id WHERE c.owner_id = (SELECT auth.uid())'; GRANT EXECUTE ON FUNCTION public.get_my_card_holds() TO authenticated"],
  ['reports: restoring leaves the card hidden', REPORTS, reportFn('public.admin_restore_card', ' UPDATE public.public_cards SET published = true WHERE id = p_card_id;\n')],
  ['reports: cleanup keeps everything', REPORTS, "CREATE OR REPLACE FUNCTION vale_private.purge_reports() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS 'SELECT'"],
  ['reports: cleanup ignores legal holds', REPORTS, reportFn('vale_private.purge_reports', 'DELETE FROM vale_private.card_reports r WHERE NOT r.legal_hold', 'DELETE FROM vale_private.card_reports r WHERE true')],
  ['reports: deleting an account deletes reports about it', REPORTS, 'ALTER TABLE vale_private.card_reports DROP CONSTRAINT card_reports_card_owner_id_fkey, ADD CONSTRAINT card_reports_card_owner_id_fkey FOREIGN KEY (card_owner_id) REFERENCES auth.users(id) ON DELETE CASCADE'],
  ['unlimited: Free capped again', UNLIMITED, "UPDATE public.membership_plans SET max_active_connections = 1000 WHERE code = 'free'"],
  ['unlimited: no rate limit on new connections', UNLIMITED, 'DELETE FROM public.connection_limits'],
  ['unlimited: members can change the rate limits', UNLIMITED, 'GRANT SELECT, UPDATE ON public.connection_limits TO authenticated; CREATE POLICY open_limits ON public.connection_limits FOR ALL TO authenticated USING (true) WITH CHECK (true)'],
  ['contact keys: readable contact stored', CONTACT_KEYS, "ALTER TABLE public.share_attempts DROP CONSTRAINT share_attempts_contact_key_hashed; CREATE OR REPLACE FUNCTION vale_private.share_contact_key(p_contact text) RETURNS text LANGUAGE sql AS 'SELECT p_contact'"],
  ['contact keys: hash without a key', CONTACT_KEYS, "CREATE OR REPLACE FUNCTION vale_private.share_contact_key(p_contact text) RETURNS text LANGUAGE sql AS $f$ SELECT 'h1:' || encode(sha256(convert_to(p_contact, 'UTF8')), 'hex') $f$"],
  ['contact keys: email not normalised before hashing', CONTACT_KEYS, withoutRule("v_email := lower(v->>'email');", "v_email := v->>'email';")],
  ['contact keys: limit compares the readable value', CONTACT_KEYS, withoutRule('a.contact_key = v_contact_key', 'a.contact_key = v_contact')],
  ['contact keys: hashing key readable by the server role', CONTACT_KEYS, 'GRANT SELECT ON vale_private.share_keys TO service_role'],
  ['contact keys: missing key skips the limit', CONTACT_KEYS, "CREATE OR REPLACE FUNCTION vale_private.share_contact_key(p_contact text) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $f$ SELECT 'h1:' || encode(extensions.hmac(convert_to(p_contact, 'UTF8'), (SELECT key FROM vale_private.share_keys WHERE name = 'contact'), 'sha256'), 'hex') $f$"],
  ['share back: visitors can change the switch', SHARE_BACK, 'GRANT SELECT, UPDATE ON public.public_cards TO anon; CREATE POLICY anon_read ON public.public_cards FOR SELECT TO anon USING (true); CREATE POLICY anon_update ON public.public_cards FOR UPDATE TO anon USING (true) WITH CHECK (true)'],
  ['share back: any account can change the switch', SHARE_BACK, 'DROP POLICY public_cards_select_own ON public.public_cards; CREATE POLICY s ON public.public_cards FOR SELECT TO authenticated USING (true); DROP POLICY "Users can update their own cards" ON public.public_cards; CREATE POLICY open_update ON public.public_cards FOR UPDATE TO authenticated USING (true) WITH CHECK (true)'],
  ['share back: off by default', SHARE_BACK, 'ALTER TABLE public.public_cards ALTER COLUMN accept_shares SET DEFAULT false'],
  ['indexes: a sharing link loses its index', SHARING_INDEXES, 'DROP INDEX public.notifications_connection_idx'],
  ['indexes: a new unindexed link is added', SHARING_INDEXES, 'CREATE TABLE public.demo_link (id uuid PRIMARY KEY, card_id uuid REFERENCES public.public_cards(id) ON DELETE CASCADE)'],
  ['sharing: visitors can record shares directly', SHARING, 'GRANT EXECUTE ON FUNCTION public.record_share(text, uuid, boolean, text, jsonb, text[], uuid, uuid, text, text) TO anon'],
  ['sharing: any account can read every share', SHARING, 'DROP POLICY card_shares_select_own ON public.card_shares; CREATE POLICY open_read ON public.card_shares FOR SELECT TO authenticated USING (true)'],
  ['sharing: any account can read every notification', SHARING, 'DROP POLICY notifications_select_own ON public.notifications; CREATE POLICY open_read ON public.notifications FOR SELECT TO authenticated USING (true)'],
  ['sharing: accounts can mark connections shared or mutual', SHARING, 'DROP TRIGGER connections_sharing_fields ON public.connections'],
  ['sharing: no rate limits', SHARING, 'DELETE FROM public.share_limits'],
  ['sharing: saved without consent', SHARING, withoutRule('p_consented IS NOT TRUE OR ')],
  ['sharing: members can share fields they did not tick', SHARING, withoutRule("'email' = ANY (p_member_fields) THEN nullif(btrim(sharer_card.public_email), '')", "true THEN nullif(btrim(sharer_card.public_email), '')").replace("'phone' = ANY (p_member_fields) THEN", 'true THEN')],
  ['sharing: email duplicates not detected', SHARING, withoutRule('AND lower(btrim(c.email)) = v_email', 'AND false')],
  ['sharing: mutual after one side only', SHARING, withoutRule('WHERE s.owner_id = p_sharer_user_id AND s.sharer_user_id = card.owner_id AND s.connection_id IS NOT NULL', 'WHERE s.owner_id = card.owner_id AND s.connection_id IS NOT NULL')],
  ['sharing: owner limit ignored', SHARING, withoutRule("WHEN max_active IS NOT NULL AND active >= max_active THEN 'limit_reached'", "WHEN false THEN 'limit_reached'")],
  ['sharing: a deleted member stays linked to shares', SHARING, 'ALTER TABLE public.card_shares DROP CONSTRAINT card_shares_sharer_user_id_fkey'],
  ['sharing: duplicate history grows without limit', SHARING, "UPDATE public.share_retention SET value = 1000 WHERE name = 'duplicates_per_connection'"],
  ['images: bucket made public', IMAGES, "UPDATE storage.buckets SET public = true WHERE id = 'card-images'"],
  ['images: anyone can read every image', IMAGES, "DROP POLICY card_images_published_read ON storage.objects; CREATE POLICY open_read ON storage.objects FOR SELECT TO anon, authenticated USING (bucket_id = 'card-images')"],
  ['images: draft images treated as published', IMAGES, "CREATE OR REPLACE FUNCTION vale_private.card_image_is_published(object_name text) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS 'SELECT true'"],
  ['images: upload into any card', IMAGES, "DROP POLICY card_images_owner_upload ON storage.objects; CREATE POLICY open_upload ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'card-images')"],
  ['images: files can be overwritten or moved', IMAGES, "CREATE POLICY open_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'card-images') WITH CHECK (bucket_id = 'card-images')"],
  ['images: any account can delete images', IMAGES, "DROP POLICY card_images_owner_delete ON storage.objects; CREATE POLICY open_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'card-images')"],
  ['images: cards with images can be deleted', IMAGES, 'DROP TRIGGER public_cards_image_cleanup ON public.public_cards'],
  ['images: account deletion ignores remaining images', IMAGES, "CREATE OR REPLACE FUNCTION vale_private.account_image_count(account_id uuid) RETURNS bigint LANGUAGE sql STABLE AS 'SELECT 0::bigint'"],
  ['images: any appearance accepted', IMAGES, 'ALTER TABLE public.public_cards DROP CONSTRAINT public_cards_appearance_check'],
  ['images: another card\'s image can be attached', IMAGES, 'ALTER TABLE public.public_cards DROP CONSTRAINT public_cards_photo_path_check'],
  ['cards: new cards can be published immediately', RULES, draftsOff],
  ['connections: RLS off', CONNECTIONS, 'ALTER TABLE public.connections DISABLE ROW LEVEL SECURITY'],
  ['connections: anonymous read granted', CONNECTIONS, 'GRANT SELECT ON public.connections TO anon'],
  ['connections: client truncate granted', CONNECTIONS, 'GRANT TRUNCATE ON public.connections TO authenticated'],
  ['deletion: visitors can call account deletion', DELETION, 'GRANT EXECUTE ON FUNCTION public.delete_my_account(text) TO anon'],
  ['deletion: cascade removed from connections', DELETION, 'ALTER TABLE public.connections DROP CONSTRAINT connections_owner_id_fkey'],
  ['usage: counts every account', DELETION, "CREATE OR REPLACE FUNCTION public.get_my_usage() RETURNS TABLE (plan_code text, plan_name text, max_cards integer, max_active_connections integer, card_count bigint, active_connection_count bigint, archived_connection_count bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS 'SELECT p.code, p.name, p.max_cards, p.max_active_connections, (SELECT count(*) FROM public.public_cards), (SELECT count(*) FROM public.connections), 0::bigint FROM public.membership_plans p WHERE p.code = ''free'''"],
  ['connections: everyone can read', CONNECTIONS, 'DROP POLICY connections_select_own ON public.connections; CREATE POLICY open_read ON public.connections FOR SELECT TO authenticated USING (true)'],
  // Postgres also applies the SELECT policy to an update's new row, so both must be weakened.
  ['connections: ownership transfer possible', CONNECTIONS, 'DROP POLICY connections_update_own ON public.connections; CREATE POLICY u ON public.connections FOR UPDATE TO authenticated USING (owner_id=(SELECT auth.uid())) WITH CHECK (true); DROP POLICY connections_select_own ON public.connections; CREATE POLICY s ON public.connections FOR SELECT TO authenticated USING (true)'],
  ['connections: source uniqueness removed', CONNECTIONS, 'ALTER TABLE public.connections DROP CONSTRAINT connections_owner_source_key'],
  ['profiles: RLS off', PROFILES, 'ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY'],
  ['profiles: anonymous read granted', PROFILES, 'GRANT SELECT ON public.profiles TO anon'],
  ['profiles: client delete granted', PROFILES, 'GRANT DELETE ON public.profiles TO authenticated'],
  ['profiles: transfer possible', PROFILES, 'DROP POLICY profiles_update_own ON public.profiles; CREATE POLICY u ON public.profiles FOR UPDATE TO authenticated USING (id=(SELECT auth.uid())) WITH CHECK (true); DROP POLICY profiles_select_own ON public.profiles; CREATE POLICY s ON public.profiles FOR SELECT TO authenticated USING (true)'],
  ['cards: RLS off', CARDS, 'ALTER TABLE public.public_cards DISABLE ROW LEVEL SECURITY'],
  ['cards: drafts readable by everyone', RULES, 'DROP POLICY public_cards_select_own ON public.public_cards; CREATE POLICY open_read ON public.public_cards FOR SELECT TO authenticated USING (true)'],
  ['cards: anonymous table read restored', RULES, 'GRANT SELECT ON public.public_cards TO anon'],
  ['cards: lookup returns drafts', MULTI, "CREATE OR REPLACE FUNCTION public.get_public_card(card_slug text) RETURNS TABLE (id uuid, display_name text, job_title text, business_name text, introduction text, public_email text, public_phone text, website text, social_links text, appearance text, photo_path text, logo_path text, accept_shares boolean) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS 'SELECT c.id, c.display_name, c.job_title, c.business_name, c.introduction, c.public_email, c.public_phone, c.website, c.social_links, c.appearance, c.photo_path, c.logo_path, c.accept_shares FROM public.public_cards c WHERE c.slug = card_slug'"],
  ['features: Free given dated history', FEATURES, "UPDATE public.membership_plans SET features = '{dated_history}' WHERE code = 'free'"],
  ['features: Free given meeting details', FEATURES, "UPDATE public.membership_plans SET features = '{meeting_details}' WHERE code = 'free'"],
  ['features: clients can change plans', FEATURES, 'GRANT UPDATE ON public.membership_plans TO authenticated; CREATE POLICY open_update ON public.membership_plans FOR UPDATE TO authenticated USING (true) WITH CHECK (true)'],
  ['features: connection rules removed', FEATURES, 'DROP TRIGGER connections_rules ON public.connections'],
  ['rules: card trigger removed', RULES, 'DROP TRIGGER public_cards_rules ON public.public_cards'],
  ['rules: connection trigger removed', RULES, 'DROP TRIGGER connections_rules ON public.connections'],
  ['rules: field limits removed', RULES, 'ALTER TABLE public.public_cards DROP CONSTRAINT public_cards_field_lengths'],
  ['rules: clients can change memberships', RULES, 'GRANT INSERT ON public.memberships TO authenticated; CREATE POLICY open_insert ON public.memberships FOR INSERT TO authenticated WITH CHECK (true)'],
  ['cards: anonymous insert granted', CARDS, 'GRANT INSERT ON public.public_cards TO anon; CREATE POLICY anon_insert ON public.public_cards FOR INSERT TO anon WITH CHECK (true)'],
  ['cards: any account can edit a published card', MULTI, 'DROP POLICY public_cards_select_own ON public.public_cards; CREATE POLICY s ON public.public_cards FOR SELECT TO authenticated USING (published OR owner_id=(SELECT auth.uid())); DROP POLICY "Users can update their own cards" ON public.public_cards; CREATE POLICY open_update ON public.public_cards FOR UPDATE TO authenticated USING (true) WITH CHECK (true)'],
  ['cards: any account can delete a published card', MULTI, 'DROP POLICY public_cards_select_own ON public.public_cards; CREATE POLICY s ON public.public_cards FOR SELECT TO authenticated USING (published OR owner_id=(SELECT auth.uid())); DROP POLICY "Users can delete their own cards" ON public.public_cards; CREATE POLICY open_delete ON public.public_cards FOR DELETE TO authenticated USING (true)'],
];
for (const [label, file, sabotage] of brokenRules) {
  const broken = await rebuild(repo);
  await broken.exec(sabotage);
  let caught = false;
  try { await broken.exec(sql(file)); } catch { caught = true; }
  report(caught, `detects broken rule: ${label}`);
  await broken.close();
}

// The sharing indexes: each is used for its lookup, and the rollback removes exactly them and can be re-applied.
const SHARING_INDEX_SQL = 'supabase/migrations/20261109030000_add_sharing_indexes.sql', SHARING_INDEX_DOWN = 'supabase/rollback/20261109030000_add_sharing_indexes.down.sql';
const SHARING_INDEX_NAMES = ['card_shares_sharer_card_idx', 'connections_share_idx', 'notifications_share_idx', 'notifications_connection_idx'];
const snapshotOf = async database => JSON.parse((await database.query(sql('supabase/inspection/structure_snapshot.sql'))).rows[0].vale_structure_snapshot);
const withIndexes = await rebuild(repo);
await withIndexes.exec('SET enable_seqscan = off');
for (const [table, column, index] of [['card_shares', 'sharer_card_id', 'card_shares_sharer_card_idx'], ['connections', 'share_id', 'connections_share_idx'], ['notifications', 'share_id', 'notifications_share_idx'], ['notifications', 'connection_id', 'notifications_connection_idx']]) {
  const plan = (await withIndexes.query(`EXPLAIN SELECT 1 FROM public.${table} WHERE ${column} = gen_random_uuid()`)).rows.map(row => Object.values(row)[0]).join(' ');
  report(plan.includes(index), `indexes: lookups on ${table}.${column} use ${index}`);
}
await withIndexes.exec('RESET enable_seqscan');
const before = await snapshotOf(withIndexes);
await withIndexes.exec(sql(SHARING_INDEX_DOWN));
const afterDown = await snapshotOf(withIndexes);
const strip = snap => JSON.stringify({ ...snap, indexes: snap.indexes.filter(i => !SHARING_INDEX_NAMES.includes(i.name)) });
report(SHARING_INDEX_NAMES.every(name => !afterDown.indexes.some(i => i.name === name)), 'indexes rollback: removes all four indexes');
report(strip(before) === JSON.stringify(afterDown), 'indexes rollback: changes nothing else');
let flagged = false;
try { await withIndexes.exec(sql(SHARING_INDEXES)); } catch { flagged = true; await withIndexes.exec('ROLLBACK'); }
report(flagged, 'indexes rollback: the index test notices they are gone');
await withIndexes.exec(sql(SHARING_INDEX_SQL));
report(JSON.stringify(await snapshotOf(withIndexes)) === JSON.stringify(before), 'indexes: re-applying after rollback restores the same structure');
await withIndexes.close();

// The contact-key change reverses cleanly and re-applies to the same structure.
const CK_UP = 'supabase/migrations/20261110000000_hash_share_contact_keys.sql', CK_DOWN = 'supabase/rollback/20261110000000_hash_share_contact_keys.down.sql';
const ckDb = await rebuild(repo);
const ckBefore = await snapshotOf(ckDb);
await ckDb.exec(sql(CK_DOWN));
const ckDown = await snapshotOf(ckDb);
report(!ckDown.functions.some(f => f.signature.includes('share_contact_key')) && !ckDown.constraints.some(c => c.name === 'share_attempts_contact_key_hashed'), 'contact keys rollback: removes the hash function and the check');
let ckOld = false;
try { await ckDb.exec(sql(CONTACT_KEYS)); } catch { ckOld = true; await ckDb.exec('ROLLBACK'); }
report(ckOld, 'contact keys rollback: the privacy test notices readable keys are back');
await ckDb.exec(sql(CK_UP));
await ckDb.exec(sql('supabase/migrations/20261110000100_validate_share_contact_keys.sql'));
await ckDb.exec(recordShare);   // later migrations redefine record_share; bring back its newest version
report(JSON.stringify(await snapshotOf(ckDb)) === JSON.stringify(ckBefore), 'contact keys: re-applying after rollback restores the same structure');
await ckDb.close();

// Unlimited Free connections: the rollback restores the 1,000 limit exactly, and re-applying restores the same structure.
const UC_UP = 'supabase/migrations/20261112000000_unlimited_free_connections.sql', UC_DOWN = 'supabase/rollback/20261112000000_unlimited_free_connections.down.sql';
const ucDb = await rebuild(repo);
const ucBefore = await snapshotOf(ucDb);
await ucDb.exec(sql(UC_DOWN));
const ucDown = await snapshotOf(ucDb);
report((await ucDb.query(`SELECT max_active_connections AS m FROM public.membership_plans WHERE code = 'free'`)).rows[0].m === 1000, 'unlimited rollback: Free returns to 1,000');
report(!ucDown.tables.some(t => t.name === 'connection_limits') && !ucDown.indexes.some(i => i.name === 'connections_owner_created_idx'), 'unlimited rollback: removes the rate-limit table and its index');
let ucOld = false;
try { await ucDb.exec(sql(UNLIMITED)); } catch { ucOld = true; await ucDb.exec('ROLLBACK'); }
report(ucOld, 'unlimited rollback: the unlimited test notices the limit is back');
await ucDb.exec(sql(UC_UP));
report(JSON.stringify(await snapshotOf(ucDb)) === JSON.stringify(ucBefore), 'unlimited: re-applying after rollback restores the same structure');
await ucDb.close();

// Reports: the rollback removes the feature (leaving cards and notifications as they were), and re-applying restores the same structure.
const crDb = await rebuild(repo);
const crBefore = await snapshotOf(crDb);
await crDb.exec(sql(REPORTS_DOWN));
const crDown = await snapshotOf(crDb);
report(!crDown.tables.some(t => t.name.startsWith('vale_private.') && t.name !== 'vale_private.share_keys') && !crDown.functions.some(f => /report|admin_|card_hold|card_is_held|require_admin/.test(f.signature)) && !crDown.triggers.some(t => t.name === 'public_cards_holds') && !crDown.columns.some(c => c.table === 'notifications' && c.column === 'card_id'), 'reports rollback: removes the tables, functions, trigger and notice column');
let crOld = false;
try { await crDb.exec(sql(REPORTS)); } catch { crOld = true; await crDb.exec('ROLLBACK'); }
report(crOld, 'reports rollback: the reports test notices the feature is gone');
await crDb.exec(sql(REPORTS_SQL));
const crAgain = await snapshotOf(crDb);
// Re-adding the notice column gives it a new position; everything else must match exactly.
const noPosition = s => JSON.stringify({ ...s, columns: s.columns.map(({ position, ...c }) => c) });
report(noPosition(crAgain) === noPosition(crBefore), 'reports: re-applying after rollback restores the same structure');
await crDb.close();

// The launch gate passes on the finished design and fails if a protection is missing.
const gateRows = async database => (await database.query(sql('supabase/inspection/launch_gate.sql'))).rows;
const finished = await rebuild(repo);
const passing = await gateRows(finished);
report(passing.length >= 10 && passing.every(row => row.result === 'pass'), `launch gate: all ${passing.length} checks pass on the finished design`);
await finished.exec(`GRANT SELECT ON public.public_cards TO anon; CREATE POLICY old_read ON public.public_cards FOR SELECT TO anon, authenticated USING (published = true OR owner_id = (SELECT auth.uid()))`);
report((await gateRows(finished)).filter(row => row.result === 'FAIL').length === 3, 'launch gate: fails when public cards can be listed');
await finished.close();

// The structure snapshot returns structure only and changes nothing.
const seeded = await rebuild(repo);
await seeded.exec(`CREATE FUNCTION public.demo_fn() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
 CREATE TRIGGER demo BEFORE UPDATE ON public.connections FOR EACH ROW EXECUTE FUNCTION public.demo_fn();
 INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111','SENTINEL-EMAIL@example.invalid');
 INSERT INTO public.connections(owner_id,full_name,notes,email) VALUES ('11111111-1111-4111-8111-111111111111','SENTINEL-NAME','SENTINEL-NOTE','SENTINEL-CONTACT@example.invalid');
 INSERT INTO public.profiles(id,full_name) VALUES ('11111111-1111-4111-8111-111111111111','SENTINEL-PROFILE');`);
const rows = (await seeded.query(sql('supabase/inspection/structure_snapshot.sql'))).rows;
const text = rows[0].vale_structure_snapshot, snapshot = JSON.parse(text);
report(rows.length === 1 && Object.keys(rows[0]).length === 1, 'snapshot: one row, one cell');
report(!/SENTINEL|11111111-1111/.test(text), 'snapshot: contains no table row data');
report(await count(seeded, 'public.connections') === 1 && await count(seeded, 'public.profiles') === 1, 'snapshot: stored rows unchanged');
report(snapshot.tables.some(t => t.name === 'connections' && t.rls_enabled), 'snapshot: tables and RLS flags');
report(snapshot.columns.some(c => c.table === 'connections' && c.column === 'owner_id'), 'snapshot: columns');
report(snapshot.constraints.some(c => c.name === 'connections_owner_source_key'), 'snapshot: constraints');
report(snapshot.indexes.some(i => i.name === 'connections_owner_updated_idx'), 'snapshot: indexes');
report(snapshot.policies.some(p => p.name === 'connections_select_own'), 'snapshot: policies');
report(snapshot.functions.some(f => f.signature.includes('demo_fn')), 'snapshot: functions');
report(snapshot.triggers.some(t => t.name === 'demo'), 'snapshot: triggers');
report(snapshot.default_privileges.length > 0, 'snapshot: default privileges');
await seeded.close();

console.log(failures ? `\n${failures} database check(s) failed.` : '\nAll database checks passed.');
process.exitCode = failures ? 1 : 0;
