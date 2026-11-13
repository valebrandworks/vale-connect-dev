-- Reverses 20261114000000_add_card_reports.sql. Development only; take a verified backup first.
-- Removes reports, the moderation log, blocks, admin list and the cleanup job. Cards hidden by moderation are left
-- unpublished (their owners can publish them again); "card hidden/restored" notices are removed. Cards and
-- connections are otherwise untouched.
BEGIN;
DO $$
BEGIN
 IF to_regnamespace('cron') IS NOT NULL THEN
  EXECUTE $c$SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'vale-report-cleanup'$c$;
  -- Remove the scheduler only if nothing else uses it.
  IF NOT EXISTS (SELECT 1 FROM cron.job) THEN EXECUTE 'DROP EXTENSION IF EXISTS pg_cron'; END IF;
 END IF;
END $$;

DROP FUNCTION public.admin_list_reports(text, integer, integer), public.admin_report_history(uuid),
 public.admin_set_report_status(uuid, text, text), public.admin_add_note(uuid, text), public.admin_hide_card(uuid, text, text),
 public.admin_restore_card(uuid, text), public.admin_set_legal_hold(uuid, boolean, text), public.admin_block_reporter(uuid, boolean, text),
 public.get_my_card_holds(), public.claim_report_alert(), public.submit_card_report(text, uuid, text, text, text, boolean, text);
DROP TRIGGER public_cards_holds ON public.public_cards;
DROP FUNCTION public.protect_card_holds();
DROP FUNCTION vale_private.clean_note(text, boolean), vale_private.purge_reports(), vale_private.require_admin(), vale_private.card_is_held(uuid);

DELETE FROM public.notifications WHERE kind IN ('card_hidden', 'card_restored');
ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN ('share_added', 'share_duplicate', 'share_limit', 'mutual'));
DROP INDEX public.notifications_card_idx;
ALTER TABLE public.notifications DROP COLUMN card_id;

DROP TABLE vale_private.report_alerts, vale_private.moderation_actions, vale_private.card_holds, vale_private.blocked_reporters,
 vale_private.report_attempts, vale_private.card_reports, vale_private.platform_admins, vale_private.report_settings;
COMMIT;
