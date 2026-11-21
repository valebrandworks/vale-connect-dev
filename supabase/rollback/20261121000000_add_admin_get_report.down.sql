-- Reverses 20261121000000_add_admin_get_report.sql. Development only. Removes one read-only function; no data changes.
-- Roll this back before 20261114000000_add_card_reports.down.sql.
BEGIN;
DROP FUNCTION public.admin_get_report(uuid);
COMMIT;
