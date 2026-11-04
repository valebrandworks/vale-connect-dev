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
const TESTS = ['connections_rls', 'profiles_rls', 'public_cards_rls', 'multiple_cards_rls', 'rls_event_trigger_permissions', 'card_and_limit_rules', 'deletion_and_usage', 'relationship_details', 'plan_features'].map(name => `supabase/tests/${name}.sql`);
const [CONNECTIONS, PROFILES, CARDS, MULTI, , RULES, DELETION, , FEATURES] = TESTS;

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
expectColumns('profiles', ['id', ...sql('cloud-auth.js').match(/COLUMNS='([^']+)'/)[1].split(','), 'created_at'], 'My Card sync');
expectColumns('connections', [...Object.keys(cloud.payload({ cname: 'Synthetic' })), 'id', 'owner_id', 'source_identity', 'source_url', 'revision'], 'cloud connections');
expectColumns('connections', exporter.columns, 'cloud backup');
await db.close();

// Each deliberately broken rule must make its access test fail.
const brokenRules = [
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
  ['cards: lookup returns drafts', MULTI, "CREATE OR REPLACE FUNCTION public.get_public_card(card_slug text) RETURNS TABLE (id uuid, display_name text, job_title text, business_name text, introduction text, public_email text, public_phone text, website text, social_links text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS 'SELECT c.id, c.display_name, c.job_title, c.business_name, c.introduction, c.public_email, c.public_phone, c.website, c.social_links FROM public.public_cards c WHERE c.slug = card_slug'"],
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
