-- Free membership: raise the active-connection ceiling from 5 to a fair-use limit of 1,000.
-- The value stays configurable in membership_plans; the connections_rules trigger reads it on every insert
-- and un-archive. Archived connections don't count. No other plan, table or permission changes.
BEGIN;
UPDATE public.membership_plans SET max_active_connections = 1000 WHERE code = 'free' AND max_active_connections = 5;
DO $$ BEGIN
 IF (SELECT max_active_connections FROM public.membership_plans WHERE code = 'free') IS DISTINCT FROM 1000 THEN
  RAISE EXCEPTION 'Free plan limit was not 5 before this change; nothing was changed';
 END IF;
END $$;
COMMIT;
