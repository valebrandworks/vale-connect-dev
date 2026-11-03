BEGIN;
DO $$
BEGIN
 IF has_function_privilege('anon','public.rls_auto_enable()','EXECUTE')
 OR has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE')
 THEN RAISE EXCEPTION 'Unnecessary client function execution is still permitted'; END IF;
 IF NOT has_function_privilege('postgres','public.rls_auto_enable()','EXECUTE')
 THEN RAISE EXCEPTION 'Function owner lost execution permission'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname='ensure_rls'
   AND evtfoid=to_regprocedure('public.rls_auto_enable()') AND evtenabled='O')
 THEN RAISE EXCEPTION 'Automatic RLS trigger is not enabled'; END IF;
 IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname IN ('profiles','public_cards','connections') AND NOT c.relrowsecurity)
 THEN RAISE EXCEPTION 'An application table has RLS disabled'; END IF;
END $$;
SELECT 'PASS: client execution denied, owner execution retained, automatic RLS trigger enabled, application RLS retained' AS test;
ROLLBACK;
