// Checks database access rules in a temporary in-memory Postgres (PGlite).
// Nothing here connects to Supabase or any other remote database.
// Limits: Supabase roles and auth are imitated by SUPABASE_STUB, and public_cards
// is not covered because the migrations do not create that table.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sql = rel => fs.readFileSync(path.join(repo, rel), 'utf8');
const SUPABASE_STUB = `
 CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true)::json->>'sub','')::uuid $$;
 GRANT USAGE ON SCHEMA public, auth TO anon, authenticated;
 GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;`;
const MIGRATIONS = ['20261102224721_restore_private_profile_sync.sql', '20261103025723_add_private_cloud_connections.sql'].map(file => 'supabase/migrations/' + file);
const CONNECTIONS = 'supabase/tests/connections_rls.sql', PROFILES = 'supabase/tests/profiles_rls.sql';

let failures = 0;
const report = (ok, label) => { console.log((ok ? 'pass  ' : 'FAIL  ') + label); if (!ok) failures++; };

async function freshDatabase() {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const migration of MIGRATIONS) await db.exec(sql(migration));
  return db;
}
const count = async (db, table) => (await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

// Access tests pass on the real migrations and leave nothing behind.
const db = await freshDatabase();
for (const file of [CONNECTIONS, PROFILES]) {
  try { await db.exec(sql(file)); report(true, path.basename(file)); }
  catch (error) { report(false, `${path.basename(file)}: ${error.message}`); }
}
for (const table of ['public.connections', 'public.profiles', 'auth.users']) report(await count(db, table) === 0, `fixtures rolled back from ${table}`);
await db.close();

// Each deliberately broken rule must make its access test fail.
const brokenRules = [
  ['connections: RLS off', CONNECTIONS, 'ALTER TABLE public.connections DISABLE ROW LEVEL SECURITY'],
  ['connections: anonymous read granted', CONNECTIONS, 'GRANT SELECT ON public.connections TO anon'],
  ['connections: client delete granted', CONNECTIONS, 'GRANT DELETE ON public.connections TO authenticated'],
  ['connections: everyone can read', CONNECTIONS, 'DROP POLICY connections_select_own ON public.connections; CREATE POLICY open_read ON public.connections FOR SELECT TO authenticated USING (true)'],
  // Postgres also applies the SELECT policy to an update's new row, so both must be weakened.
  ['connections: ownership transfer possible', CONNECTIONS, 'DROP POLICY connections_update_own ON public.connections; CREATE POLICY u ON public.connections FOR UPDATE TO authenticated USING (owner_id=(SELECT auth.uid())) WITH CHECK (true); DROP POLICY connections_select_own ON public.connections; CREATE POLICY s ON public.connections FOR SELECT TO authenticated USING (true)'],
  ['connections: source uniqueness removed', CONNECTIONS, 'ALTER TABLE public.connections DROP CONSTRAINT connections_owner_source_key'],
  ['profiles: RLS off', PROFILES, 'ALTER TABLE public.profiles DISABLE ROW LEVEL SECURITY'],
  ['profiles: anonymous read granted', PROFILES, 'GRANT SELECT ON public.profiles TO anon'],
  ['profiles: client delete granted', PROFILES, 'GRANT DELETE ON public.profiles TO authenticated'],
  ['profiles: transfer possible', PROFILES, 'DROP POLICY profiles_update_own ON public.profiles; CREATE POLICY u ON public.profiles FOR UPDATE TO authenticated USING (id=(SELECT auth.uid())) WITH CHECK (true); DROP POLICY profiles_select_own ON public.profiles; CREATE POLICY s ON public.profiles FOR SELECT TO authenticated USING (true)'],
];
for (const [label, file, sabotage] of brokenRules) {
  const broken = await freshDatabase();
  await broken.exec(sabotage);
  let caught = false;
  try { await broken.exec(sql(file)); } catch { caught = true; }
  report(caught, `detects broken rule: ${label}`);
  await broken.close();
}

// The structure snapshot returns structure only and changes nothing.
const seeded = await freshDatabase();
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
