-- Rate-limit records keep a keyed hash of the sharer's email or phone instead of the readable value.
-- share_attempts.contact_key was 'email:<address>' or 'phone:<digits>' for 48 hours. It becomes
-- 'h1:' + HMAC-SHA256 of that same normalised value (email in lower case, phone digits only), with a random key
-- made here and kept in a private table no client role can read. Equal contacts still give equal keys, so the
-- "two shares per day from one email or phone to one card" limit works exactly as before.
-- Unchanged: the owner's connections and share records keep the readable details the person chose to share.
-- Existing rows are not touched here; how to handle them is a separate, reported decision. The new check applies
-- to new rows only (NOT VALID).
-- Reverse: supabase/rollback/20261110000000_hash_share_contact_keys.down.sql
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 1. The key. Private: no client role, and not the server key role either, can read it.
CREATE TABLE vale_private.share_keys (
 name text PRIMARY KEY,
 key bytea NOT NULL CHECK (octet_length(key) >= 32),
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE vale_private.share_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vale_private.share_keys FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO vale_private.share_keys(name, key) VALUES ('contact', extensions.gen_random_bytes(32));

-- 2. The hash. Refuses to work without the key, so a missing key can never mean "no limit".
CREATE FUNCTION vale_private.share_contact_key(p_contact text) RETURNS text
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE k bytea;
BEGIN
 IF p_contact IS NULL OR p_contact = '' THEN RETURN NULL; END IF;
 SELECT key INTO k FROM vale_private.share_keys WHERE name = 'contact';
 IF k IS NULL THEN RAISE EXCEPTION 'Sharing is not configured.'; END IF;
 RETURN 'h1:' || encode(extensions.hmac(convert_to(p_contact, 'UTF8'), k, 'sha256'), 'hex');
END $$;
REVOKE ALL ON FUNCTION vale_private.share_contact_key(text) FROM PUBLIC, anon, authenticated, service_role;

-- 3. New rate-limit records must hold a hash (or nothing). Existing rows are left as they are for now.
ALTER TABLE public.share_attempts ADD CONSTRAINT share_attempts_contact_key_hashed
 CHECK (contact_key IS NULL OR contact_key ~ '^h1:[0-9a-f]{64}$') NOT VALID;

-- 4. record_share, unchanged except that it stores and compares the hashed contact key.
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
 PERFORM pg_advisory_xact_lock(hashtextextended('share:' || card.id::text, 0));
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

 -- Rate limits, from share_limits. Every valid attempt is recorded, then counted.
 PERFORM public.purge_share_history(NULL);
 INSERT INTO public.share_attempts(card_id, network_hash, contact_key, sharer_user_id)
  VALUES (card.id, nullif(p_network_hash, ''), v_contact_key, p_sharer_user_id) RETURNING id INTO attempt_id;
 FOR lim IN SELECT * FROM public.share_limits LOOP
  SELECT count(*) INTO used FROM public.share_attempts a WHERE a.created_at > now() - make_interval(secs => lim.window_seconds) AND CASE lim.name
   WHEN 'network_card' THEN p_network_hash IS NOT NULL AND a.network_hash = p_network_hash AND a.card_id = card.id
   WHEN 'network_all' THEN p_network_hash IS NOT NULL AND a.network_hash = p_network_hash
   WHEN 'card_all' THEN a.card_id = card.id
   WHEN 'contact_card' THEN a.contact_key = v_contact_key AND a.card_id = card.id
   WHEN 'member_all' THEN p_sharer_user_id IS NOT NULL AND a.sharer_user_id = p_sharer_user_id
   ELSE false END;
  IF used > lim.max_count THEN RETURN 'rate_limited'; END IF;
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
  SELECT count(*) INTO active FROM public.connections c WHERE c.owner_id = card.owner_id AND c.archived_at IS NULL;
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

COMMIT;
