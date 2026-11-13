-- Report This Card, stage A: database and security.
-- Anyone can report a public card through the report-card server function (service role only). Reports, rate-limit
-- records, blocks, hidden cards and the moderation log live in vale_private, which the API doesn't expose, and no
-- browser role has any grant on them. Platform admins act only through the admin_* functions below, which require
-- an admin account signed in with two-step verification (aal2). Reports never hide a card on their own: only an
-- admin decision does. Card owners never see reports or who made them.
BEGIN;

-- 1. Adjustable rules: rate limits, merging and how long things are kept.
CREATE TABLE vale_private.report_settings (name text PRIMARY KEY, value integer NOT NULL CHECK (value > 0));
INSERT INTO vale_private.report_settings VALUES
 ('network_all_per_day', 5),       -- reports from one network, any cards
 ('network_card_per_day', 3),      -- reports from one network about one card (distinct ones; identical repeats merge)
 ('card_all_per_day', 50),         -- reports about one card from everyone; extras are counted, not stored
 ('merge_window_days', 30),        -- an identical open report from the same network is merged, not stored again
 ('attempt_days', 30),             -- rate-limit records (network hashes)
 ('dismissed_days', 90),           -- dismissed reports, after closing
 ('actioned_days', 365),           -- reports where action was taken, after closing
 ('action_log_days', 365),         -- moderation log entries
 ('block_days', 365),              -- how long a blocked network stays blocked
 ('alert_interval_minutes', 60);   -- at most one email alert per this many minutes

-- 2. Platform admins. Added and removed only with SQL by the database owner; no function changes this list.
CREATE TABLE vale_private.platform_admins (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 note text NOT NULL DEFAULT '' CHECK (length(note) <= 200),
 added_at timestamptz NOT NULL DEFAULT now()
);

-- 3. Reports. The card's public details are copied when first reported, so evidence survives edits and deletion.
CREATE TABLE vale_private.card_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 submission_id uuid NOT NULL UNIQUE,                       -- one per tap of "Send report": retries can't double up
 card_id uuid REFERENCES public.public_cards(id) ON DELETE SET NULL,
 card_owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 card_slug text NOT NULL,
 card_snapshot jsonb NOT NULL,
 category text NOT NULL CHECK (category IN ('impersonation', 'scam', 'spam', 'harassment', 'sexual_violent', 'personal_info', 'ip', 'other')),
 details text NOT NULL DEFAULT '' CHECK (length(details) <= 1000),
 reporter_email text CHECK (reporter_email IS NULL OR (length(reporter_email) <= 254 AND reporter_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')),
 network_hash text NOT NULL CHECK (network_hash ~ '^[0-9a-f]{64}$'),   -- salted hash from the server function, never an address
 dedupe_key text NOT NULL,
 status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'action_taken', 'dismissed')),
 repeat_count integer NOT NULL DEFAULT 1 CHECK (repeat_count >= 1),
 legal_hold boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_reported_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 closed_at timestamptz,
 CONSTRAINT card_reports_closed CHECK ((status IN ('action_taken', 'dismissed')) = (closed_at IS NOT NULL)),
 CONSTRAINT card_reports_email_removed_when_closed CHECK (closed_at IS NULL OR reporter_email IS NULL),
 CONSTRAINT card_reports_snapshot_size CHECK (octet_length(card_snapshot::text) <= 16000)
);
CREATE INDEX card_reports_queue_idx ON vale_private.card_reports (status, created_at);
CREATE INDEX card_reports_card_idx ON vale_private.card_reports (card_id, network_hash, dedupe_key);
CREATE INDEX card_reports_owner_idx ON vale_private.card_reports (card_owner_id);
CREATE INDEX card_reports_network_idx ON vale_private.card_reports (network_hash);
CREATE INDEX card_reports_closed_idx ON vale_private.card_reports (closed_at) WHERE closed_at IS NOT NULL;

-- 4. Short-lived rate-limit records (salted network hash only).
CREATE TABLE vale_private.report_attempts (
 id bigserial PRIMARY KEY,
 card_id uuid NOT NULL REFERENCES public.public_cards(id) ON DELETE CASCADE,
 network_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_attempts_network_idx ON vale_private.report_attempts (network_hash, created_at);
CREATE INDEX report_attempts_card_idx ON vale_private.report_attempts (card_id, created_at);
CREATE INDEX report_attempts_created_idx ON vale_private.report_attempts (created_at);

-- 5. Networks an admin blocked from reporting (after repeated false reports). Their reports are quietly not stored.
CREATE TABLE vale_private.blocked_reporters (
 network_hash text PRIMARY KEY,
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
 blocked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 blocked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX blocked_reporters_by_idx ON vale_private.blocked_reporters (blocked_by);

-- 6. Cards hidden by an admin. While a card is here it stays unpublished and its owner can't publish it.
CREATE TABLE vale_private.card_holds (
 card_id uuid PRIMARY KEY REFERENCES public.public_cards(id) ON DELETE CASCADE,
 report_id uuid REFERENCES vale_private.card_reports(id) ON DELETE SET NULL,
 category text NOT NULL,
 owner_message text NOT NULL CHECK (length(btrim(owner_message)) BETWEEN 1 AND 500),
 hidden_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 hidden_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX card_holds_report_idx ON vale_private.card_holds (report_id);
CREATE INDEX card_holds_by_idx ON vale_private.card_holds (hidden_by);

-- 7. The moderation log: every admin action, who did it, when and why.
CREATE TABLE vale_private.moderation_actions (
 id bigserial PRIMARY KEY,
 admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 action text NOT NULL CHECK (action IN ('status', 'note', 'hide_card', 'restore_card', 'legal_hold', 'release_hold', 'block_reporter', 'unblock_reporter')),
 report_id uuid REFERENCES vale_private.card_reports(id) ON DELETE SET NULL,
 card_id uuid REFERENCES public.public_cards(id) ON DELETE SET NULL,
 from_status text,
 to_status text,
 note text NOT NULL DEFAULT '' CHECK (length(note) <= 2000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX moderation_actions_report_idx ON vale_private.moderation_actions (report_id, created_at);
CREATE INDEX moderation_actions_card_idx ON vale_private.moderation_actions (card_id);
CREATE INDEX moderation_actions_admin_idx ON vale_private.moderation_actions (admin_id);
CREATE INDEX moderation_actions_created_idx ON vale_private.moderation_actions (created_at);

-- 8. When the last email alert went out (one row).
CREATE TABLE vale_private.report_alerts (id boolean PRIMARY KEY DEFAULT true CHECK (id), last_sent_at timestamptz);
INSERT INTO vale_private.report_alerts VALUES (true, NULL);

-- 9. Nothing here is open to browsers or the server role; only the functions below (running as the owner) use it.
ALTER TABLE vale_private.report_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE vale_private.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE vale_private.card_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE vale_private.report_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vale_private.blocked_reporters ENABLE ROW LEVEL SECURITY;
ALTER TABLE vale_private.card_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE vale_private.moderation_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE vale_private.report_alerts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vale_private.report_settings, vale_private.platform_admins, vale_private.card_reports, vale_private.report_attempts,
 vale_private.blocked_reporters, vale_private.card_holds, vale_private.moderation_actions, vale_private.report_alerts
 FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE vale_private.report_attempts_id_seq, vale_private.moderation_actions_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- 10. Card owners are told in the app when a card is hidden or restored.
ALTER TABLE public.notifications ADD COLUMN card_id uuid REFERENCES public.public_cards(id) ON DELETE CASCADE;
CREATE INDEX notifications_card_idx ON public.notifications (card_id);
ALTER TABLE public.notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_kind_check
 CHECK (kind IN ('share_added', 'share_duplicate', 'share_limit', 'mutual', 'card_hidden', 'card_restored'));

-- 11. A hidden card can't be published again by its owner (or any browser). Admin functions run as the owner, so they can.
CREATE FUNCTION vale_private.card_is_held(p_card uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS (SELECT 1 FROM vale_private.card_holds h WHERE h.card_id = p_card)
$$;
REVOKE ALL ON FUNCTION vale_private.card_is_held(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vale_private.card_is_held(uuid) TO anon, authenticated;
CREATE FUNCTION public.protect_card_holds() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF current_user IN ('anon', 'authenticated') AND NEW.published AND NOT OLD.published AND vale_private.card_is_held(NEW.id) THEN
  RAISE EXCEPTION USING ERRCODE = 'P0001', HINT = 'card_hidden',
   MESSAGE = 'This card was hidden after a review, so it can''t be published. To appeal, email support@valebrandworks.com.';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER public_cards_holds BEFORE UPDATE ON public.public_cards
 FOR EACH ROW EXECUTE FUNCTION public.protect_card_holds();
REVOKE ALL ON FUNCTION public.protect_card_holds() FROM PUBLIC, anon, authenticated;

-- 12. Admin check, used by every admin function: a listed admin, signed in with two-step verification.
CREATE FUNCTION vale_private.require_admin() RETURNS uuid
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE uid uuid := auth.uid();
BEGIN
 IF uid IS NULL OR NOT EXISTS (SELECT 1 FROM vale_private.platform_admins a WHERE a.user_id = uid) THEN
  RAISE EXCEPTION 'Not authorized.' USING ERRCODE = '42501';
 END IF;
 IF coalesce(auth.jwt()->>'aal', '') <> 'aal2' THEN
  RAISE EXCEPTION 'Moderation needs two-step sign-in. Sign in with your authenticator code and try again.' USING ERRCODE = '42501', HINT = 'mfa_required';
 END IF;
 RETURN uid;
END $$;
REVOKE ALL ON FUNCTION vale_private.require_admin() FROM PUBLIC, anon, authenticated, service_role;

-- 13. Housekeeping, following report_settings. Runs daily (section 19), and on each report and admin list.
CREATE FUNCTION vale_private.purge_reports() RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE s jsonb := (SELECT jsonb_object_agg(name, value) FROM vale_private.report_settings);
BEGIN
 DELETE FROM vale_private.report_attempts WHERE created_at < now() - make_interval(days => (s->>'attempt_days')::int);
 -- Closed reports go after their period, unless on legal hold or still the reason a card is hidden.
 DELETE FROM vale_private.card_reports r WHERE NOT r.legal_hold
  AND ((r.status = 'dismissed' AND r.closed_at < now() - make_interval(days => (s->>'dismissed_days')::int))
    OR (r.status = 'action_taken' AND r.closed_at < now() - make_interval(days => (s->>'actioned_days')::int)))
  AND NOT EXISTS (SELECT 1 FROM vale_private.card_holds h WHERE h.report_id = r.id);
 -- Log entries go after their period, unless they concern a report on legal hold or a card that is still hidden.
 DELETE FROM vale_private.moderation_actions m WHERE m.created_at < now() - make_interval(days => (s->>'action_log_days')::int)
  AND NOT EXISTS (SELECT 1 FROM vale_private.card_reports r WHERE r.id = m.report_id AND r.legal_hold)
  AND NOT EXISTS (SELECT 1 FROM vale_private.card_holds h WHERE h.card_id = m.card_id);
 DELETE FROM vale_private.blocked_reporters WHERE blocked_at < now() - make_interval(days => (s->>'block_days')::int);
END $$;
REVOKE ALL ON FUNCTION vale_private.purge_reports() FROM PUBLIC, anon, authenticated, service_role;

-- 14. Record a report. Called only by the report-card server function (service role), after Turnstile.
-- Returns what happened, for tests and logs; the visitor always sees the same reply whatever it is.
CREATE FUNCTION public.submit_card_report(p_card_slug text, p_submission_id uuid, p_category text, p_details text,
 p_reporter_email text, p_attested boolean, p_network_hash text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 s jsonb := (SELECT jsonb_object_agg(name, value) FROM vale_private.report_settings);
 card public.public_cards%ROWTYPE;
 v_details text := btrim(regexp_replace(coalesce(p_details, ''), '[[:cntrl:]]', ' ', 'g'));
 v_email text := nullif(lower(btrim(coalesce(p_reporter_email, ''))), '');
 v_key text;
 used integer;
 existing uuid;
BEGIN
 -- Request shape.
 IF p_attested IS NOT TRUE OR p_submission_id IS NULL
    OR coalesce(p_category, '') NOT IN ('impersonation', 'scam', 'spam', 'harassment', 'sexual_violent', 'personal_info', 'ip', 'other')
    OR length(v_details) > 1000
    OR (v_email IS NOT NULL AND (length(v_email) > 254 OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'))
    OR coalesce(p_network_hash, '') !~ '^[0-9a-f]{64}$' THEN
  RETURN 'invalid';
 END IF;
 -- Only cards that are public right now can be reported. Nothing about the card is returned.
 SELECT * INTO card FROM public.public_cards c WHERE c.slug = p_card_slug;
 IF NOT FOUND OR NOT card.published THEN RETURN 'unavailable'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('report:' || card.id::text, 0));
 IF EXISTS (SELECT 1 FROM vale_private.card_reports r WHERE r.submission_id = p_submission_id) THEN RETURN 'repeat_submission'; END IF;
 PERFORM vale_private.purge_reports();
 IF EXISTS (SELECT 1 FROM vale_private.blocked_reporters b WHERE b.network_hash = p_network_hash) THEN RETURN 'blocked'; END IF;

 -- Rate limits. Every valid attempt is recorded, then counted.
 INSERT INTO vale_private.report_attempts(card_id, network_hash) VALUES (card.id, p_network_hash);
 SELECT count(*) INTO used FROM vale_private.report_attempts a WHERE a.network_hash = p_network_hash AND a.created_at > now() - interval '1 day';
 IF used > (s->>'network_all_per_day')::int THEN RETURN 'limited'; END IF;
 SELECT count(*) INTO used FROM vale_private.report_attempts a WHERE a.network_hash = p_network_hash AND a.card_id = card.id AND a.created_at > now() - interval '1 day';
 IF used > (s->>'network_card_per_day')::int THEN RETURN 'limited'; END IF;
 SELECT count(*) INTO used FROM vale_private.report_attempts a WHERE a.card_id = card.id AND a.created_at > now() - interval '1 day';
 IF used > (s->>'card_all_per_day')::int THEN RETURN 'limited'; END IF;

 -- The same report again from the same network, while still open: counted on the existing report, not stored twice.
 v_key := encode(sha256(convert_to(p_category || '|' || lower(regexp_replace(v_details, '\s+', ' ', 'g')), 'UTF8')), 'hex');
 SELECT r.id INTO existing FROM vale_private.card_reports r
  WHERE r.card_id = card.id AND r.network_hash = p_network_hash AND r.dedupe_key = v_key AND r.status IN ('new', 'reviewing')
    AND r.last_reported_at > now() - make_interval(days => (s->>'merge_window_days')::int)
  ORDER BY r.last_reported_at DESC LIMIT 1;
 IF existing IS NOT NULL THEN
  UPDATE vale_private.card_reports SET repeat_count = repeat_count + 1, last_reported_at = now(), updated_at = now(),
   reporter_email = coalesce(reporter_email, v_email) WHERE id = existing;
  RETURN 'merged';
 END IF;

 INSERT INTO vale_private.card_reports(submission_id, card_id, card_owner_id, card_slug, card_snapshot, category, details, reporter_email, network_hash, dedupe_key)
 VALUES (p_submission_id, card.id, card.owner_id, card.slug,
  jsonb_strip_nulls(jsonb_build_object('display_name', card.display_name, 'job_title', card.job_title, 'business_name', card.business_name,
   'introduction', card.introduction, 'public_email', card.public_email, 'public_phone', card.public_phone, 'website', card.website,
   'social_links', card.social_links, 'appearance', card.appearance, 'has_photo', card.photo_path IS NOT NULL, 'has_logo', card.logo_path IS NOT NULL)),
  p_category, v_details, v_email, p_network_hash, v_key);
 RETURN 'stored';
END $$;
REVOKE ALL ON FUNCTION public.submit_card_report(text, uuid, text, text, text, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_card_report(text, uuid, text, text, text, boolean, text) TO service_role;

-- 15. Email alerts: true at most once per alert_interval_minutes, and only when a new report has arrived since the
-- last alert. The server function sends a plain "a report is waiting" email only when this returns true.
CREATE FUNCTION public.claim_report_alert() RETURNS boolean
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 last_sent timestamptz;
 gap integer := (SELECT value FROM vale_private.report_settings WHERE name = 'alert_interval_minutes');
BEGIN
 SELECT a.last_sent_at INTO last_sent FROM vale_private.report_alerts a FOR UPDATE;
 IF last_sent IS NOT NULL AND last_sent > now() - make_interval(mins => gap) THEN RETURN false; END IF;
 IF NOT EXISTS (SELECT 1 FROM vale_private.card_reports r WHERE r.status = 'new' AND (last_sent IS NULL OR r.last_reported_at > last_sent)) THEN RETURN false; END IF;
 UPDATE vale_private.report_alerts SET last_sent_at = now() WHERE id;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.claim_report_alert() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_report_alert() TO service_role;

-- 16. Card owners: which of their own cards are hidden, the category and the explanation. Never who reported it.
CREATE FUNCTION public.get_my_card_holds()
 RETURNS TABLE (card_id uuid, hidden_at timestamptz, category text, owner_message text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT h.card_id, h.hidden_at, h.category, h.owner_message
 FROM vale_private.card_holds h JOIN public.public_cards c ON c.id = h.card_id
 WHERE c.owner_id = (SELECT auth.uid())
$$;
REVOKE ALL ON FUNCTION public.get_my_card_holds() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_card_holds() TO authenticated;

-- 17. Admin: review. Newest decisions last; open reports first, oldest first.
CREATE FUNCTION public.admin_list_reports(p_status text DEFAULT NULL, p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE (id uuid, card_id uuid, card_slug text, card_snapshot jsonb, card_current jsonb, card_published boolean, card_hidden boolean,
  category text, details text, reporter_email text, status text, repeat_count integer, legal_hold boolean,
  created_at timestamptz, last_reported_at timestamptz, closed_at timestamptz,
  reports_on_card bigint, reporter_dismissed bigint, reporter_blocked boolean)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 PERFORM vale_private.require_admin();
 PERFORM vale_private.purge_reports();
 RETURN QUERY
 SELECT r.id, r.card_id, r.card_slug, r.card_snapshot,
  CASE WHEN c.id IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object('display_name', c.display_name, 'job_title', c.job_title,
   'business_name', c.business_name, 'introduction', c.introduction, 'public_email', c.public_email, 'public_phone', c.public_phone,
   'website', c.website, 'social_links', c.social_links, 'appearance', c.appearance, 'has_photo', c.photo_path IS NOT NULL, 'has_logo', c.logo_path IS NOT NULL)) END,
  c.published, h.card_id IS NOT NULL,
  r.category, r.details, r.reporter_email, r.status, r.repeat_count, r.legal_hold, r.created_at, r.last_reported_at, r.closed_at,
  (SELECT count(*) FROM vale_private.card_reports o WHERE o.card_id = r.card_id),
  (SELECT count(*) FROM vale_private.card_reports o WHERE o.network_hash = r.network_hash AND o.status = 'dismissed'),
  EXISTS (SELECT 1 FROM vale_private.blocked_reporters b WHERE b.network_hash = r.network_hash)
 FROM vale_private.card_reports r
 LEFT JOIN public.public_cards c ON c.id = r.card_id
 LEFT JOIN vale_private.card_holds h ON h.card_id = r.card_id
 WHERE p_status IS NULL OR r.status = p_status
 ORDER BY (r.status IN ('new', 'reviewing')) DESC, r.created_at ASC
 LIMIT least(greatest(coalesce(p_limit, 50), 1), 200) OFFSET greatest(coalesce(p_offset, 0), 0);
END $$;

CREATE FUNCTION public.admin_report_history(p_report_id uuid)
 RETURNS TABLE (created_at timestamptz, action text, from_status text, to_status text, note text, admin_email text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 PERFORM vale_private.require_admin();
 RETURN QUERY
 SELECT m.created_at, m.action, m.from_status, m.to_status, m.note, u.email::text
 FROM vale_private.moderation_actions m LEFT JOIN auth.users u ON u.id = m.admin_id
 WHERE m.report_id = p_report_id OR m.card_id = (SELECT r.card_id FROM vale_private.card_reports r WHERE r.id = p_report_id)
 ORDER BY m.created_at, m.id;
END $$;

-- 18. Admin: decisions. Each one is logged with a note.
CREATE FUNCTION vale_private.clean_note(p_note text, p_required boolean) RETURNS text
 LANGUAGE plpgsql IMMUTABLE SET search_path TO '' AS $$
DECLARE v text := btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g'));
BEGIN
 IF length(v) > 2000 THEN RAISE EXCEPTION 'Keep the note under 2,000 characters.'; END IF;
 IF p_required AND v = '' THEN RAISE EXCEPTION 'Add a short note explaining the decision.'; END IF;
 RETURN v;
END $$;
REVOKE ALL ON FUNCTION vale_private.clean_note(text, boolean) FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.admin_set_report_status(p_report_id uuid, p_status text, p_note text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 uid uuid := vale_private.require_admin();
 rep vale_private.card_reports%ROWTYPE;
 closing boolean := p_status IN ('action_taken', 'dismissed');
 v_note text := vale_private.clean_note(p_note, p_status IN ('action_taken', 'dismissed'));
BEGIN
 IF coalesce(p_status, '') NOT IN ('new', 'reviewing', 'action_taken', 'dismissed') THEN RAISE EXCEPTION 'Unknown status.'; END IF;
 SELECT * INTO rep FROM vale_private.card_reports r WHERE r.id = p_report_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Report not found.'; END IF;
 IF rep.status = p_status THEN RAISE EXCEPTION 'The report already has that status.'; END IF;
 UPDATE vale_private.card_reports SET status = p_status, updated_at = now(),
  closed_at = CASE WHEN closing THEN now() END,
  reporter_email = CASE WHEN closing THEN NULL ELSE reporter_email END   -- the reporter's email isn't kept once a report is closed
  WHERE id = rep.id;
 INSERT INTO vale_private.moderation_actions(admin_id, action, report_id, card_id, from_status, to_status, note)
  VALUES (uid, 'status', rep.id, rep.card_id, rep.status, p_status, v_note);
END $$;

CREATE FUNCTION public.admin_add_note(p_report_id uuid, p_note text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE uid uuid := vale_private.require_admin(); rep vale_private.card_reports%ROWTYPE; v_note text := vale_private.clean_note(p_note, true);
BEGIN
 SELECT * INTO rep FROM vale_private.card_reports r WHERE r.id = p_report_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Report not found.'; END IF;
 INSERT INTO vale_private.moderation_actions(admin_id, action, report_id, card_id, note) VALUES (uid, 'note', rep.id, rep.card_id, v_note);
END $$;

-- Hide the reported card: unpublished at once, its owner can't republish it, they're told why and how to appeal,
-- and the report is closed as action taken.
CREATE FUNCTION public.admin_hide_card(p_report_id uuid, p_owner_message text, p_note text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 uid uuid := vale_private.require_admin();
 rep vale_private.card_reports%ROWTYPE;
 v_owner uuid;
 msg text := btrim(regexp_replace(coalesce(p_owner_message, ''), '[[:cntrl:]]', ' ', 'g'));
 v_note text := vale_private.clean_note(p_note, true);
BEGIN
 IF length(msg) NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Write a short explanation for the card owner (up to 500 characters).'; END IF;
 SELECT * INTO rep FROM vale_private.card_reports r WHERE r.id = p_report_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Report not found.'; END IF;
 SELECT c.owner_id INTO v_owner FROM public.public_cards c WHERE c.id = rep.card_id FOR UPDATE;
 IF v_owner IS NULL THEN RAISE EXCEPTION 'That card no longer exists.'; END IF;
 IF vale_private.card_is_held(rep.card_id) THEN RAISE EXCEPTION 'That card is already hidden.'; END IF;
 INSERT INTO vale_private.card_holds(card_id, report_id, category, owner_message, hidden_by) VALUES (rep.card_id, rep.id, rep.category, msg, uid);
 UPDATE public.public_cards SET published = false WHERE id = rep.card_id;
 INSERT INTO public.notifications(owner_id, kind, card_id) VALUES (v_owner, 'card_hidden', rep.card_id);
 INSERT INTO vale_private.moderation_actions(admin_id, action, report_id, card_id, note) VALUES (uid, 'hide_card', rep.id, rep.card_id, v_note);
 IF rep.status NOT IN ('action_taken', 'dismissed') THEN
  UPDATE vale_private.card_reports SET status = 'action_taken', closed_at = now(), reporter_email = NULL, updated_at = now() WHERE id = rep.id;
  INSERT INTO vale_private.moderation_actions(admin_id, action, report_id, card_id, from_status, to_status, note)
   VALUES (uid, 'status', rep.id, rep.card_id, rep.status, 'action_taken', 'Card hidden.');
 END IF;
END $$;

-- Restore a hidden card: public again, and its owner is told.
CREATE FUNCTION public.admin_restore_card(p_card_id uuid, p_note text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 uid uuid := vale_private.require_admin();
 hold vale_private.card_holds%ROWTYPE;
 v_owner uuid;
 v_note text := vale_private.clean_note(p_note, true);
BEGIN
 SELECT * INTO hold FROM vale_private.card_holds h WHERE h.card_id = p_card_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'That card isn''t hidden.'; END IF;
 SELECT c.owner_id INTO v_owner FROM public.public_cards c WHERE c.id = p_card_id FOR UPDATE;
 DELETE FROM vale_private.card_holds WHERE card_id = p_card_id;
 UPDATE public.public_cards SET published = true WHERE id = p_card_id;
 INSERT INTO public.notifications(owner_id, kind, card_id) VALUES (v_owner, 'card_restored', p_card_id);
 INSERT INTO vale_private.moderation_actions(admin_id, action, report_id, card_id, note) VALUES (uid, 'restore_card', hold.report_id, p_card_id, v_note);
END $$;

-- Keep a report (and its log) past its deletion date, for legal reasons; or release it.
CREATE FUNCTION public.admin_set_legal_hold(p_report_id uuid, p_hold boolean, p_note text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE uid uuid := vale_private.require_admin(); rep vale_private.card_reports%ROWTYPE; v_note text := vale_private.clean_note(p_note, true);
BEGIN
 SELECT * INTO rep FROM vale_private.card_reports r WHERE r.id = p_report_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Report not found.'; END IF;
 IF rep.legal_hold = coalesce(p_hold, false) THEN RAISE EXCEPTION 'Nothing to change.'; END IF;
 UPDATE vale_private.card_reports SET legal_hold = coalesce(p_hold, false), updated_at = now() WHERE id = rep.id;
 INSERT INTO vale_private.moderation_actions(admin_id, action, report_id, card_id, note)
  VALUES (uid, CASE WHEN p_hold THEN 'legal_hold' ELSE 'release_hold' END, rep.id, rep.card_id, v_note);
END $$;

-- Block (or unblock) the network a report came from, after false or malicious reports. The admin never sees the network.
CREATE FUNCTION public.admin_block_reporter(p_report_id uuid, p_block boolean, p_note text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE uid uuid := vale_private.require_admin(); rep vale_private.card_reports%ROWTYPE; v_note text := vale_private.clean_note(p_note, true);
BEGIN
 SELECT * INTO rep FROM vale_private.card_reports r WHERE r.id = p_report_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Report not found.'; END IF;
 IF coalesce(p_block, false) THEN
  INSERT INTO vale_private.blocked_reporters(network_hash, reason, blocked_by) VALUES (rep.network_hash, v_note, uid)
   ON CONFLICT (network_hash) DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'That reporter is already blocked.'; END IF;
 ELSE
  DELETE FROM vale_private.blocked_reporters WHERE network_hash = rep.network_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'That reporter isn''t blocked.'; END IF;
 END IF;
 INSERT INTO vale_private.moderation_actions(admin_id, action, report_id, card_id, note)
  VALUES (uid, CASE WHEN p_block THEN 'block_reporter' ELSE 'unblock_reporter' END, rep.id, rep.card_id, v_note);
END $$;

REVOKE ALL ON FUNCTION public.admin_list_reports(text, integer, integer), public.admin_report_history(uuid),
 public.admin_set_report_status(uuid, text, text), public.admin_add_note(uuid, text), public.admin_hide_card(uuid, text, text),
 public.admin_restore_card(uuid, text), public.admin_set_legal_hold(uuid, boolean, text), public.admin_block_reporter(uuid, boolean, text)
 FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_list_reports(text, integer, integer), public.admin_report_history(uuid),
 public.admin_set_report_status(uuid, text, text), public.admin_add_note(uuid, text), public.admin_hide_card(uuid, text, text),
 public.admin_restore_card(uuid, text), public.admin_set_legal_hold(uuid, boolean, text), public.admin_block_reporter(uuid, boolean, text)
 TO authenticated;

-- 19. Daily cleanup with Supabase's built-in scheduler (pg_cron, free), where available. Local test databases skip this.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog';
  EXECUTE $c$SELECT cron.schedule('vale-report-cleanup', '23 4 * * *', 'SELECT vale_private.purge_reports()')$c$;
 END IF;
END $$;

COMMIT;
