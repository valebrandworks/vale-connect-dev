-- Read-only launch gate. Every row must say pass before public registration opens on an environment.
-- One SELECT over system catalogs and the plan table; it returns no personal data.
SELECT check_name, CASE WHEN ok THEN 'pass' ELSE 'FAIL' END AS result FROM (VALUES
 ('Visitors cannot read the cards table directly', NOT has_table_privilege('anon', 'public.public_cards', 'SELECT')),
 ('No card read rule applies to visitors', NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'public_cards' AND cmd = 'SELECT' AND roles && ARRAY['anon', 'public']::name[])),
 ('Signed-in accounts can read only their own cards', NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'public_cards' AND cmd = 'SELECT' AND coalesce(qual, '') ILIKE '%published%')),
 ('Public card lookup available to visitors', to_regprocedure('public.get_public_card(text)') IS NOT NULL AND has_function_privilege('anon', to_regprocedure('public.get_public_card(text)'), 'EXECUTE')),
 ('Card rules active', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'public_cards_rules' AND tgrelid = to_regclass('public.public_cards') AND tgenabled = 'O')),
 ('Connection rules active', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'connections_rules' AND tgrelid = to_regclass('public.connections') AND tgenabled = 'O')),
 ('Free plan limits defined', to_regclass('public.membership_plans') IS NOT NULL),
 ('Row security on for every public table', NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity)),
 ('Clients cannot change plans', NOT has_table_privilege('authenticated', 'public.memberships', 'INSERT') AND NOT has_table_privilege('authenticated', 'public.memberships', 'UPDATE') AND NOT has_table_privilege('authenticated', 'public.membership_plans', 'UPDATE')),
 ('Account deletion available', to_regprocedure('public.delete_my_account(text)') IS NOT NULL AND has_function_privilege('authenticated', to_regprocedure('public.delete_my_account(text)'), 'EXECUTE') AND NOT has_function_privilege('anon', to_regprocedure('public.delete_my_account(text)'), 'EXECUTE'))
) AS checks(check_name, ok);
