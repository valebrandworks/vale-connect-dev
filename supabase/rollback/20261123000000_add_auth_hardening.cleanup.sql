-- Optional, separately approved step AFTER the .down.sql: removes the block/allow lists, hook log, maintenance log and daily statistics.
-- Loses that history. Never touches accounts, cards, attempts or any other data.
BEGIN;
DROP TABLE IF EXISTS vale_private.auth_daily_stats;
DROP TABLE IF EXISTS vale_private.auth_maintenance_log;
DROP TABLE IF EXISTS vale_private.auth_hook_log;
DROP TABLE IF EXISTS vale_private.allowed_email_domains;
DROP TABLE IF EXISTS vale_private.blocked_email_domains;
COMMIT;
