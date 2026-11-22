-- Production-wide (global) rate limits for sharing and reporting, with exact counting under concurrent requests.
--
-- 1. New limits, in the existing settings tables (adjustable with an UPDATE, no deploy): shares, visitor and member kept apart
--    (1,500/hour and 6,000/day; 600/hour and 3,000/day) and reports (40/hour, 200/day). Existing per-network, per-card, per-contact
--    and per-member limits are unchanged and still checked first.
-- 2. The global limits count only attempts that no narrower limit refused (new 'refused' flag on the attempt rows), so a single
--    blocked network cannot use up everyone's budget. Narrow limits keep counting every attempt, exactly as before.
-- 3. Cross-card counts (network, member) and the global counts run under advisory locks taken in a fixed order, so concurrent
--    requests cannot slip past a limit. Locks wait at most 3 seconds (vale_private.try_lock); on timeout the request is refused with
--    the usual 'rate_limited' / 'limited' reply before anything is written, so nothing partial is kept and no error is raised.
-- 4. No table is dropped or rewritten: two boolean columns with a default, one index, a few settings rows.
-- The share-card and report-card server functions are unchanged (same replies); only these two database functions change.
BEGIN;

ALTER TABLE public.share_attempts ADD COLUMN IF NOT EXISTS refused boolean NOT NULL DEFAULT false;
ALTER TABLE vale_private.report_attempts ADD COLUMN IF NOT EXISTS refused boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS share_attempts_created_idx ON public.share_attempts (created_at);

INSERT INTO public.share_limits (name, max_count, window_seconds) VALUES
 ('global_visitor', 1500, 3600), ('global_visitor_day', 6000, 86400),
 ('global_member', 600, 3600), ('global_member_day', 3000, 86400)
 ON CONFLICT (name) DO NOTHING;
INSERT INTO vale_private.report_settings (name, value) VALUES ('global_all_per_hour', 40), ('global_all_per_day', 200)
 ON CONFLICT (name) DO NOTHING;

-- Takes a transaction-level advisory lock, waiting at most 3 seconds. Returns false (without raising) when it cannot, so the
-- caller can refuse the request cleanly. Only the owner's functions below call it.
CREATE FUNCTION vale_private.try_lock(p_key text) RETURNS boolean
 LANGUAGE plpgsql SET search_path TO '' SET lock_timeout TO '3s' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_key, 0));
 RETURN true;
EXCEPTION WHEN lock_not_available THEN
 RETURN false;
END $$;
REVOKE ALL ON FUNCTION vale_private.try_lock(text) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.record_share(
 p_card_slug text, p_submission_id uuid, p_consented boolean, p_consent_version text,
 p_fields jsonb, p_member_fields text[], p_sharer_user_id uuid, p_sharer_card_id uuid,
 p_network_hash text, p_note text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 card public.public_cards%ROWTYPE;
 sharer_card public.public_cards%ROWTYPE;
 allowed_visitor text[] := ARRAY['full_name', 'job_title', 'business_name', 'email', 'phone', 'website'];
 allowed_member text[] := ARRAY['full_name', 'job_title', 'business_name', 'email', 'phone', 'website', 'social_links'];
 v jsonb := '{}'::jsonb;
 v_fields text[];
 f text;
 val text;
 v_note text := btrim(regexp_replace(coalesce(p_note, ''), '[[:cntrl:]]', ' ', 'g'));
 v_email text; v_phone text; v_contact text; v_contact_key text; v_dedupe text; lim record; used integer; attempt_id bigint;
 match_id uuid; repeat_id uuid; v_share_id uuid; conn_id uuid; reverse public.card_shares%ROWTYPE;
 max_active integer; active integer; v_outcome text;
BEGIN
 -- Consent and request shape.
 IF p_consented IS NOT TRUE OR btrim(coalesce(p_consent_version, '')) = '' OR p_submission_id IS NULL OR length(v_note) > 300 THEN RETURN 'invalid'; END IF;
 IF EXISTS (SELECT 1 FROM public.card_shares s WHERE s.submission_id = p_submission_id) THEN RETURN 'shared'; END IF;
 SELECT * INTO card FROM public.public_cards c WHERE c.slug = p_card_slug;
 IF NOT FOUND OR NOT card.published OR NOT card.accept_shares THEN RETURN 'unavailable'; END IF;
 IF NOT vale_private.try_lock('share:' || card.id::text) THEN RETURN 'rate_limited'; END IF;
 IF p_sharer_user_id IS NOT NULL AND p_sharer_user_id = card.owner_id THEN RETURN 'invalid'; END IF;

 -- The shared details: only allowed fields, cleaned and size-checked.
 IF p_sharer_user_id IS NOT NULL THEN
  SELECT * INTO sharer_card FROM public.public_cards c WHERE c.id = p_sharer_card_id AND c.owner_id = p_sharer_user_id;
  IF NOT FOUND OR p_member_fields IS NULL OR NOT (p_member_fields <@ allowed_member) OR NOT ('full_name' = ANY (p_member_fields)) THEN RETURN 'invalid'; END IF;
  v := jsonb_strip_nulls(jsonb_build_object(
   'full_name', CASE WHEN 'full_name' = ANY (p_member_fields) THEN nullif(btrim(sharer_card.display_name), '') END,
   'job_title', CASE WHEN 'job_title' = ANY (p_member_fields) THEN nullif(btrim(sharer_card.job_title), '') END,
   'business_name', CASE WHEN 'business_name' = ANY (p_member_fields) THEN nullif(btrim(sharer_card.business_name), '') END,
   'email', CASE WHEN 'email' = ANY (p_member_fields) THEN nullif(btrim(sharer_card.public_email), '') END,
   'phone', CASE WHEN 'phone' = ANY (p_member_fields) THEN nullif(btrim(sharer_card.public_phone), '') END,
   'website', CASE WHEN 'website' = ANY (p_member_fields) THEN nullif(btrim(sharer_card.website), '') END,
   'social_links', CASE WHEN 'social_links' = ANY (p_member_fields) THEN nullif(btrim(sharer_card.social_links), '') END));
 ELSE
  IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'object' THEN RETURN 'invalid'; END IF;
  FOREACH f IN ARRAY allowed_visitor LOOP
   IF p_fields ? f THEN
    IF jsonb_typeof(p_fields->f) <> 'string' THEN RETURN 'invalid'; END IF;
    val := btrim(regexp_replace(p_fields->>f, '[[:cntrl:]]', ' ', 'g'));
    IF val <> '' THEN v := v || jsonb_build_object(f, val); END IF;
   END IF;
  END LOOP;
 END IF;
 IF length(coalesce(v->>'full_name', '')) NOT BETWEEN 1 AND 90 OR length(coalesce(v->>'job_title', '')) > 80 OR length(coalesce(v->>'business_name', '')) > 90
    OR length(coalesce(v->>'email', '')) > 120 OR length(coalesce(v->>'phone', '')) > 40 OR length(coalesce(v->>'website', '')) > 300 OR length(coalesce(v->>'social_links', '')) > 3000 THEN RETURN 'invalid'; END IF;
 v_email := lower(v->>'email');
 v_phone := regexp_replace(coalesce(v->>'phone', ''), '[^0-9]', '', 'g');
 IF v_email IS NOT NULL AND v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN RETURN 'invalid'; END IF;
 IF v ? 'phone' AND (length(v_phone) < 7 OR (v->>'phone') !~ '^[0-9+(). -]+$') THEN RETURN 'invalid'; END IF;
 IF v_email IS NULL AND NOT v ? 'phone' THEN RETURN 'invalid'; END IF;   -- a name plus an email or phone
 v_fields := ARRAY(SELECT jsonb_object_keys(v));
 v_contact := coalesce('email:' || v_email, 'phone:' || v_phone);
 -- Rate-limit records keep only a keyed hash of the normalised email (lower case) or phone (digits only).
 v_contact_key := vale_private.share_contact_key(v_contact);
 v_dedupe := CASE WHEN p_sharer_user_id IS NOT NULL THEN 'member:' || p_sharer_user_id::text ELSE v_contact END;

 -- Counting spans cards (network, member) and everyone (global), so those counts are taken under their own locks, always in this
 -- order: card (above), network, member, global. Each request then sees every earlier request's attempt, so limits are exact under
 -- concurrency, and the fixed order rules out deadlocks. A request that cannot get a lock within 3 seconds is refused as
 -- rate_limited, and nothing has been written yet (these are the first statements that can wait, before any write).
 IF nullif(p_network_hash, '') IS NOT NULL AND NOT vale_private.try_lock('share-net:' || p_network_hash) THEN RETURN 'rate_limited'; END IF;
 IF p_sharer_user_id IS NOT NULL AND NOT vale_private.try_lock('share-member:' || p_sharer_user_id::text) THEN RETURN 'rate_limited'; END IF;
 IF NOT vale_private.try_lock('share:global') THEN RETURN 'rate_limited'; END IF;

 -- Rate limits, from share_limits. Every valid attempt is recorded, then counted. Narrow limits count every attempt; the global
 -- limits (checked last) count only attempts that no narrower limit refused, so one blocked network cannot use up the global budget.
 PERFORM public.purge_share_history(NULL);
 INSERT INTO public.share_attempts(card_id, network_hash, contact_key, sharer_user_id)
  VALUES (card.id, nullif(p_network_hash, ''), v_contact_key, p_sharer_user_id) RETURNING id INTO attempt_id;
 FOR lim IN SELECT * FROM public.share_limits ORDER BY (name LIKE 'global\_%'), name LOOP
  CONTINUE WHEN (lim.name LIKE 'global\_visitor%' AND p_sharer_user_id IS NOT NULL) OR (lim.name LIKE 'global\_member%' AND p_sharer_user_id IS NULL);
  SELECT count(*) INTO used FROM public.share_attempts a WHERE a.created_at > now() - make_interval(secs => lim.window_seconds) AND CASE lim.name
   WHEN 'network_card' THEN p_network_hash IS NOT NULL AND a.network_hash = p_network_hash AND a.card_id = card.id
   WHEN 'network_all' THEN p_network_hash IS NOT NULL AND a.network_hash = p_network_hash
   WHEN 'card_all' THEN a.card_id = card.id
   WHEN 'contact_card' THEN a.contact_key = v_contact_key AND a.card_id = card.id
   WHEN 'member_all' THEN p_sharer_user_id IS NOT NULL AND a.sharer_user_id = p_sharer_user_id
   WHEN 'global_visitor' THEN a.sharer_user_id IS NULL AND NOT a.refused
   WHEN 'global_visitor_day' THEN a.sharer_user_id IS NULL AND NOT a.refused
   WHEN 'global_member' THEN a.sharer_user_id IS NOT NULL AND NOT a.refused
   WHEN 'global_member_day' THEN a.sharer_user_id IS NOT NULL AND NOT a.refused
   ELSE false END;
  IF used > lim.max_count THEN UPDATE public.share_attempts SET refused = true WHERE id = attempt_id; RETURN 'rate_limited'; END IF;
 END LOOP;

 -- The same person sharing exactly the same thing again: counted, not stored again.
 SELECT s.id INTO repeat_id FROM public.card_shares s
  WHERE s.card_id = card.id AND s.dedupe_key = v_dedupe AND s.shared = v AND s.note = v_note
    AND s.last_shared_at > now() - make_interval(days => (SELECT value FROM public.share_retention WHERE name = 'repeat_window_days'))
  ORDER BY s.last_shared_at DESC LIMIT 1;
 IF repeat_id IS NOT NULL THEN
  UPDATE public.card_shares SET repeat_count = repeat_count + 1, last_shared_at = now() WHERE id = repeat_id;
  RETURN 'shared';
 END IF;

 -- Already in the owner's connections? Same rules as the app: this member's card, email, phone, then name and company.
 SELECT c.id INTO match_id FROM public.connections c WHERE c.owner_id = card.owner_id AND (
   (p_sharer_user_id IS NOT NULL AND p_sharer_card_id IS NOT NULL AND c.source_identity = 'card:' || p_sharer_card_id::text))
  LIMIT 1;
 IF match_id IS NULL AND v_email IS NOT NULL THEN
  SELECT c.id INTO match_id FROM public.connections c WHERE c.owner_id = card.owner_id AND lower(btrim(c.email)) = v_email LIMIT 1;
 END IF;
 IF match_id IS NULL AND length(v_phone) >= 7 THEN
  SELECT c.id INTO match_id FROM public.connections c WHERE c.owner_id = card.owner_id AND regexp_replace(c.phone, '[^0-9]', '', 'g') = v_phone LIMIT 1;
 END IF;
 IF match_id IS NULL AND v ? 'business_name' THEN
  SELECT c.id INTO match_id FROM public.connections c WHERE c.owner_id = card.owner_id
   AND lower(regexp_replace(btrim(c.full_name), '\s+', ' ', 'g')) = lower(regexp_replace(v->>'full_name', '\s+', ' ', 'g'))
   AND lower(regexp_replace(btrim(c.business_name), '\s+', ' ', 'g')) = lower(regexp_replace(v->>'business_name', '\s+', ' ', 'g')) LIMIT 1;
 END IF;

 IF match_id IS NOT NULL THEN
  v_outcome := 'duplicate';
 ELSE
  SELECT p.max_active_connections INTO max_active FROM public.membership_plans p
   WHERE p.code = coalesce((SELECT m.plan_code FROM public.memberships m WHERE m.user_id = card.owner_id), 'free');
  -- Counted only when the owner's plan has a limit; unlimited plans skip the count.
  IF max_active IS NOT NULL THEN
   SELECT count(*) INTO active FROM public.connections c WHERE c.owner_id = card.owner_id AND c.archived_at IS NULL;
  END IF;
  v_outcome := CASE WHEN max_active IS NOT NULL AND active >= max_active THEN 'limit_reached' ELSE 'added' END;
 END IF;

 INSERT INTO public.card_shares(submission_id, card_id, owner_id, sharer_user_id, sharer_card_id, shared_fields, shared, note, consent_version, consented_at, dedupe_key, outcome, connection_id)
  VALUES (p_submission_id, card.id, card.owner_id, p_sharer_user_id, CASE WHEN p_sharer_user_id IS NOT NULL THEN p_sharer_card_id END, v_fields, v, v_note, btrim(p_consent_version), now(), v_dedupe, v_outcome, match_id)
  RETURNING id INTO v_share_id;

 IF v_outcome = 'added' THEN
  INSERT INTO public.connections(owner_id, full_name, business_name, email, phone, job_title, website, social_links, notes, category, next_step, history, source_identity, source_url, source, share_id)
   VALUES (card.owner_id, v->>'full_name', coalesce(v->>'business_name', ''), coalesce(v->>'email', ''), coalesce(v->>'phone', ''), coalesce(v->>'job_title', ''),
    coalesce(v->>'website', ''), coalesce(v->>'social_links', ''), CASE WHEN v_note <> '' THEN 'Their note: ' || v_note ELSE '' END, 'Other', 'Follow up', '[]'::jsonb,
    CASE WHEN p_sharer_user_id IS NOT NULL THEN 'card:' || p_sharer_card_id::text END, '', 'shared_back', v_share_id)
   RETURNING id INTO conn_id;
  UPDATE public.card_shares SET connection_id = conn_id WHERE id = v_share_id;
 ELSE
  conn_id := match_id;
 END IF;
 INSERT INTO public.notifications(owner_id, kind, share_id, connection_id)
  VALUES (card.owner_id, CASE v_outcome WHEN 'added' THEN 'share_added' WHEN 'duplicate' THEN 'share_duplicate' ELSE 'share_limit' END, v_share_id, conn_id);

 -- Mutual: only when both people have each shared their own card with the other.
 IF p_sharer_user_id IS NOT NULL AND conn_id IS NOT NULL THEN
  SELECT * INTO reverse FROM public.card_shares s
   WHERE s.owner_id = p_sharer_user_id AND s.sharer_user_id = card.owner_id AND s.connection_id IS NOT NULL
   ORDER BY s.created_at DESC LIMIT 1;
  IF FOUND THEN
   UPDATE public.connections SET mutual = true WHERE id IN (conn_id, reverse.connection_id) AND NOT mutual;
   INSERT INTO public.notifications(owner_id, kind, share_id, connection_id) VALUES
    (card.owner_id, 'mutual', v_share_id, conn_id), (p_sharer_user_id, 'mutual', reverse.id, reverse.connection_id);
  END IF;
 END IF;

 PERFORM public.purge_share_history(card.owner_id);
 RETURN 'shared';
END $$;
REVOKE ALL ON FUNCTION public.record_share(text, uuid, boolean, text, jsonb, text[], uuid, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_share(text, uuid, boolean, text, jsonb, text[], uuid, uuid, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_card_report(p_card_slug text, p_submission_id uuid, p_category text, p_details text,
 p_reporter_email text, p_attested boolean, p_network_hash text)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 s jsonb := (SELECT jsonb_object_agg(name, value) FROM vale_private.report_settings);
 card public.public_cards%ROWTYPE;
 v_details text := btrim(regexp_replace(coalesce(p_details, ''), '[[:cntrl:]]', ' ', 'g'));
 v_email text := nullif(lower(btrim(coalesce(p_reporter_email, ''))), '');
 v_key text;
 used integer;
 attempt_id bigint;
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
 IF NOT vale_private.try_lock('report:' || card.id::text) THEN RETURN 'limited'; END IF;
 -- Network and global counts are taken under their own locks, in this fixed order (card, network, global), before anything is
 -- written; a request that cannot get a lock within 3 seconds is refused ('limited') and stores nothing.
 IF NOT vale_private.try_lock('report-net:' || p_network_hash) THEN RETURN 'limited'; END IF;
 IF NOT vale_private.try_lock('report:global') THEN RETURN 'limited'; END IF;
 IF EXISTS (SELECT 1 FROM vale_private.card_reports r WHERE r.submission_id = p_submission_id) THEN RETURN 'repeat_submission'; END IF;
 PERFORM vale_private.purge_reports();
 IF EXISTS (SELECT 1 FROM vale_private.blocked_reporters b WHERE b.network_hash = p_network_hash) THEN RETURN 'blocked'; END IF;

 -- Rate limits. Every valid attempt is recorded, then counted.
 INSERT INTO vale_private.report_attempts(card_id, network_hash) VALUES (card.id, p_network_hash) RETURNING id INTO attempt_id;
 SELECT count(*) INTO used FROM vale_private.report_attempts a WHERE a.network_hash = p_network_hash AND a.created_at > now() - interval '1 day';
 IF used > (s->>'network_all_per_day')::int THEN UPDATE vale_private.report_attempts SET refused = true WHERE id = attempt_id; RETURN 'limited'; END IF;
 SELECT count(*) INTO used FROM vale_private.report_attempts a WHERE a.network_hash = p_network_hash AND a.card_id = card.id AND a.created_at > now() - interval '1 day';
 IF used > (s->>'network_card_per_day')::int THEN UPDATE vale_private.report_attempts SET refused = true WHERE id = attempt_id; RETURN 'limited'; END IF;
 SELECT count(*) INTO used FROM vale_private.report_attempts a WHERE a.card_id = card.id AND a.created_at > now() - interval '1 day';
 IF used > (s->>'card_all_per_day')::int THEN UPDATE vale_private.report_attempts SET refused = true WHERE id = attempt_id; RETURN 'limited'; END IF;
 -- Global limits, last: they count only attempts that no narrower limit refused.
 SELECT count(*) INTO used FROM vale_private.report_attempts a WHERE NOT a.refused AND a.created_at > now() - interval '1 hour';
 IF used > (s->>'global_all_per_hour')::int THEN UPDATE vale_private.report_attempts SET refused = true WHERE id = attempt_id; RETURN 'limited'; END IF;
 SELECT count(*) INTO used FROM vale_private.report_attempts a WHERE NOT a.refused AND a.created_at > now() - interval '1 day';
 IF used > (s->>'global_all_per_day')::int THEN UPDATE vale_private.report_attempts SET refused = true WHERE id = attempt_id; RETURN 'limited'; END IF;

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

COMMIT;
