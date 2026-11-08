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
 ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
 CREATE SCHEMA storage;
 CREATE TABLE storage.buckets(id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false, file_size_limit bigint, allowed_mime_types text[]);
 CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id), name text NOT NULL, owner uuid, created_at timestamptz DEFAULT now(), UNIQUE (bucket_id, name));
 ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
 CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE plpgsql IMMUTABLE AS $$ DECLARE _parts text[]; BEGIN SELECT string_to_array(name, '/') INTO _parts; RETURN _parts[1 : array_length(_parts, 1) - 1]; END $$;
 GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
 GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO anon, authenticated;
 GRANT EXECUTE ON FUNCTION storage.foldername(text) TO anon, authenticated;`;

export async function rebuild(repo) {
  const db = new PGlite();
  await db.exec(SUPABASE_STUB);
  await db.exec(fs.readFileSync(path.join(repo, 'supabase/baseline/00_objects_before_migrations.sql'), 'utf8'));
  const dir = path.join(repo, 'supabase/migrations');
  for (const file of fs.readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) await db.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
  return db;
}
