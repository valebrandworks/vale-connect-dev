BEGIN;
CREATE TABLE public.connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 full_name text NOT NULL CHECK (length(btrim(full_name)) > 0),
 business_name text NOT NULL DEFAULT '', email text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '',
 job_title text NOT NULL DEFAULT '', website text NOT NULL DEFAULT '', social_links text NOT NULL DEFAULT '',
 notes text NOT NULL DEFAULT '',
 category text NOT NULL DEFAULT 'Other' CHECK (category IN ('Prospect','Customer','Supplier','Partner','Personal','Other')),
 next_step text NOT NULL DEFAULT 'Follow up' CHECK (next_step IN ('Follow up','Send a quote','Schedule a meeting','Stay in touch','Completed')),
 follow_up_on date,
 history jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(history)='array'),
 source_identity text, source_url text NOT NULL DEFAULT '',
 revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT connections_owner_source_key UNIQUE (owner_id,source_identity)
);
CREATE INDEX connections_owner_updated_idx ON public.connections(owner_id,updated_at DESC);
ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.connections FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON TABLE public.connections TO authenticated;
CREATE POLICY connections_select_own ON public.connections FOR SELECT TO authenticated
 USING (owner_id=(SELECT auth.uid()));
CREATE POLICY connections_insert_own ON public.connections FOR INSERT TO authenticated
 WITH CHECK (owner_id=(SELECT auth.uid()));
CREATE POLICY connections_update_own ON public.connections FOR UPDATE TO authenticated
 USING (owner_id=(SELECT auth.uid())) WITH CHECK (owner_id=(SELECT auth.uid()));
COMMIT;
