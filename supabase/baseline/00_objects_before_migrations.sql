-- Objects that existed before supabase/migrations began. Reconstructed from a read-only
-- structure snapshot of the development project, taken 2026-11-03.
-- For NEW, EMPTY databases only: run this first, then each migration in order.
-- Never run this on an existing project. It is kept outside supabase/migrations on purpose.
BEGIN;
CREATE TABLE public.public_cards (
 owner_id uuid NOT NULL,
 slug text NOT NULL,
 display_name text NOT NULL,
 job_title text NOT NULL DEFAULT '',
 business_name text NOT NULL DEFAULT '',
 introduction text NOT NULL DEFAULT '',
 public_email text NOT NULL DEFAULT '',
 public_phone text NOT NULL DEFAULT '',
 website text NOT NULL DEFAULT '',
 social_links text NOT NULL DEFAULT '',
 published boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT public_cards_pkey PRIMARY KEY (owner_id),
 CONSTRAINT public_cards_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id) ON DELETE CASCADE,
 CONSTRAINT public_cards_slug_key UNIQUE (slug),
 CONSTRAINT public_cards_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) BETWEEN 3 AND 60)
);
ALTER TABLE public.public_cards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public can view published cards" ON public.public_cards
 FOR SELECT TO anon, authenticated USING (published = true OR owner_id = (SELECT auth.uid()));
CREATE POLICY "Users can create their own cards" ON public.public_cards
 FOR INSERT TO authenticated WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY "Users can update their own cards" ON public.public_cards
 FOR UPDATE TO authenticated USING (owner_id = (SELECT auth.uid())) WITH CHECK (owner_id = (SELECT auth.uid()));
CREATE POLICY "Users can delete their own cards" ON public.public_cards
 FOR DELETE TO authenticated USING (owner_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
  tbl name;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        SELECT c.relname INTO tbl FROM pg_catalog.pg_class c WHERE c.oid = cmd.objid;
        EXECUTE format('alter table if exists %I.%I enable row level security', cmd.schema_name, tbl);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;
CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
 WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
 EXECUTE FUNCTION public.rls_auto_enable();
COMMIT;
