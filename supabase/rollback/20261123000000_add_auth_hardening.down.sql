-- Rollback of 20261123000000_add_auth_hardening.sql. Removes the functions and the daily job; KEEPS the lists, logs and statistics tables
-- (they hold history and the reviewed block list). The optional cleanup file removes them in a separate, approved step.
-- BEFORE running this: switch the "Before User Created" hook OFF in the Supabase dashboard (Authentication > Hooks). If the hook is
-- still registered when its function is dropped, Supabase Auth would fail every new sign-up.
BEGIN;
DO $$
BEGIN
 IF to_regclass('cron.job') IS NOT NULL THEN
  EXECUTE $c$SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'vale-auth-daily-stats'$c$;
 END IF;
END $$;
DROP FUNCTION IF EXISTS public.admin_auth_overview();
DROP FUNCTION IF EXISTS public.unconfirmed_purge_candidates(integer, integer, uuid);
DROP FUNCTION IF EXISTS public.record_purge_run(text, integer, integer, integer);
DROP FUNCTION IF EXISTS vale_private.record_auth_stats();
DROP FUNCTION IF EXISTS vale_private.auth_stats_now();
DROP FUNCTION IF EXISTS vale_private.before_user_created(jsonb);
DROP FUNCTION IF EXISTS vale_private.email_domain_blocked(text);
REVOKE USAGE ON SCHEMA vale_private FROM supabase_auth_admin;
COMMIT;
