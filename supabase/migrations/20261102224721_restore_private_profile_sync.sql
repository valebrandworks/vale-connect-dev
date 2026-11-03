BEGIN;
CREATE TABLE public.profiles (
 id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 full_name text, business_name text, email text, phone text,
 website text, job_title text, bio text,
 social_links text NOT NULL DEFAULT '',
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.profiles TO authenticated;
CREATE POLICY profiles_select_own ON public.profiles
 FOR SELECT TO authenticated USING (id = (SELECT auth.uid()));
CREATE POLICY profiles_insert_own ON public.profiles
 FOR INSERT TO authenticated WITH CHECK (id = (SELECT auth.uid()));
CREATE POLICY profiles_update_own ON public.profiles
 FOR UPDATE TO authenticated USING (id = (SELECT auth.uid()))
 WITH CHECK (id = (SELECT auth.uid()));
COMMIT;