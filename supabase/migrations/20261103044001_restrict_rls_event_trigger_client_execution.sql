BEGIN;
-- Development only: ordinary API clients do not invoke this DDL event trigger.
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.rls_auto_enable()')
   AND prorettype='event_trigger'::regtype AND prosecdef AND pg_get_userbyid(proowner)='postgres')
 THEN RAISE EXCEPTION 'Unexpected RLS event-trigger function; no changes applied'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtfoid=to_regprocedure('public.rls_auto_enable()')
   AND evtname='ensure_rls' AND evtenabled='O' AND pg_get_userbyid(evtowner)='postgres')
 THEN RAISE EXCEPTION 'Expected automatic RLS trigger is not enabled; no changes applied'; END IF;
END $$;
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC,anon,authenticated;
-- Verify future public-table creation still enables RLS. The empty probe is
-- created in a subtransaction and intentionally rolled back, never dropped.
DO $$
DECLARE probe_name text:='vale_rls_probe_'||replace(gen_random_uuid()::text,'-','');
BEGIN
 BEGIN
  EXECUTE format('CREATE TABLE public.%I (id integer)',probe_name);
  IF (SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass(format('public.%I',probe_name))) IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'Automatic RLS probe failed'; END IF;
  RAISE EXCEPTION USING ERRCODE='P0002',MESSAGE='rollback_verified_probe';
 EXCEPTION WHEN no_data_found THEN NULL;
 END;
 IF to_regclass(format('public.%I',probe_name)) IS NOT NULL THEN RAISE EXCEPTION 'Probe was not rolled back'; END IF;
END $$;
COMMIT;
