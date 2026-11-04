// Builds the database from the repository in a temporary in-memory Postgres (PGlite).
// Nothing here connects to Supabase or any other remote database.
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';

// Imitates the parts of a Supabase project the database files rely on, including its
// default privileges on new public tables, as recorded in the structure snapshot.
const SUPABASE_STUB = `
 CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
 CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, email text);
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claims',true)::json->>'sub','')::uuid $$;
 CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
 GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
 GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt() TO anon, authenticated, service_role;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon, authenticated, service_role;
 ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;`;

export async function rebuild(repo) {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(fs.readFileSync(path.join(repo, 'supabase/baseline/00_objects_before_migrations.sql'), 'utf8'));
  const dir = path.join(repo, 'supabase/migrations');
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) await db.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
  return db;
}
