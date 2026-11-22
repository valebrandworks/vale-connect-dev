-- OPTIONAL, run only after 20261122010000_add_global_rate_limits.down.sql and a separate decision: removes the leftovers the rollback
-- keeps on purpose. Drops the 'refused' flags (the record of which attempts were refused is lost), the created_at index and the
-- global settings rows. Attempt rows themselves are never deleted here. Take a verified backup first.
BEGIN;
DROP INDEX IF EXISTS public.share_attempts_created_idx;
ALTER TABLE public.share_attempts DROP COLUMN IF EXISTS refused;
ALTER TABLE vale_private.report_attempts DROP COLUMN IF EXISTS refused;
DELETE FROM public.share_limits WHERE name IN ('global_visitor', 'global_visitor_day', 'global_member', 'global_member_day');
DELETE FROM vale_private.report_settings WHERE name IN ('global_all_per_hour', 'global_all_per_day');
COMMIT;
