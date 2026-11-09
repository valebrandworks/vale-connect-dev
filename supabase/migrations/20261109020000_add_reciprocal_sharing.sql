-- Reciprocal sharing ("Share your info back").
-- Visitors and members share their details with a card's owner. Everything is decided here, on the server:
-- consent, which fields, validation, rate limits, duplicate detection, the owner's connection limit and mutual
-- connections. Browsers can't write shares, notifications or sharing fields directly; only the server function
-- (service role) can record a share. Responses never reveal whether the owner already has the sender.
BEGIN;

-- 1. A card setting: let people share their details back (on by default).
ALTER TABLE public.public_cards ADD COLUMN accept_shares boolean NOT NULL DEFAULT true;

-- 2. Where a connection came from, whether it's mutual, and the share that created it.
ALTER TABLE public.connections
 ADD COLUMN source text NOT NULL DEFAULT 'manual',
 ADD COLUMN mutual boolean NOT NULL DEFAULT false,
 ADD COLUMN share_id uuid,
 ADD CONSTRAINT connections_source_check CHECK (source IN ('manual', 'saved_card', 'shared_back', 'import', 'restore'));
UPDATE public.connections SET source = 'saved_card' WHERE source_identity LIKE 'card:%';

-- 3. Every share, as consented. Values are only the fields the person chose to share.
CREATE TABLE public.card_shares (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 submission_id uuid NOT NULL UNIQUE,                       -- one per tap of "Share": repeats can't double up
 card_id uuid REFERENCES public.public_cards(id) ON DELETE SET NULL,
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 sharer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 sharer_card_id uuid REFERENCES public.public_cards(id) ON DELETE SET NULL,
 shared_fields text[] NOT NULL,
 shared jsonb NOT NULL,
 note text NOT NULL DEFAULT '',
 consent_version text NOT NULL,
 consented_at timestamptz NOT NULL,
 dedupe_key text NOT NULL,                                 -- who sent it, for collapsing identical repeats
 outcome text NOT NULL,
 connection_id uuid REFERENCES public.connections(id) ON DELETE CASCADE,
 repeat_count integer NOT NULL DEFAULT 1,
 last_shared_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT card_shares_outcome_check CHECK (outcome IN ('added', 'duplicate', 'limit_reached', 'owner_added')),
 CONSTRAINT card_shares_sizes CHECK (length(note) <= 300 AND octet_length(shared::text) <= 8000 AND cardinality(shared_fields) BETWEEN 1 AND 8 AND repeat_count >= 1)
);
CREATE INDEX card_shares_owner_idx ON public.card_shares (owner_id, created_at DESC);
CREATE INDEX card_shares_connection_idx ON public.card_shares (connection_id);
CREATE INDEX card_shares_repeat_idx ON public.card_shares (card_id, dedupe_key, last_shared_at DESC);
CREATE INDEX card_shares_sharer_idx ON public.card_shares (sharer_user_id, owner_id);
ALTER TABLE public.connections ADD CONSTRAINT connections_share_id_fkey FOREIGN KEY (share_id) REFERENCES public.card_shares(id) ON DELETE SET NULL;

-- 4. In-app notifications for card owners.
CREATE TABLE public.notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('share_added', 'share_duplicate', 'share_limit', 'mutual')),
 share_id uuid REFERENCES public.card_shares(id) ON DELETE CASCADE,
 connection_id uuid REFERENCES public.connections(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz
);
CREATE INDEX notifications_owner_idx ON public.notifications (owner_id, created_at DESC);

-- 5. Short-lived rate-limit records. The network value is a salted hash made by the server function; kept 48 hours.
CREATE TABLE public.share_attempts (
 id bigserial PRIMARY KEY,
 card_id uuid NOT NULL REFERENCES public.public_cards(id) ON DELETE CASCADE,
 network_hash text,
 contact_key text,
 sharer_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX share_attempts_card_idx ON public.share_attempts (card_id, created_at);
CREATE INDEX share_attempts_network_idx ON public.share_attempts (network_hash, created_at);
CREATE INDEX share_attempts_member_idx ON public.share_attempts (sharer_user_id, created_at);

-- 6. Adjustable rules: rate limits and how long sharing history is kept.
CREATE TABLE public.share_limits (name text PRIMARY KEY, max_count integer NOT NULL CHECK (max_count > 0), window_seconds integer NOT NULL CHECK (window_seconds > 0));
INSERT INTO public.share_limits VALUES
 ('network_card', 5, 3600),   -- same network, same card: shared conference Wi-Fi isn't blocked across different cards
 ('network_all', 50, 3600),   -- same network, any cards: a high ceiling against floods
 ('card_all', 30, 3600),      -- any senders, same card
 ('contact_card', 2, 86400),  -- same email or phone, same card
 ('member_all', 10, 3600);    -- one member, any cards
CREATE TABLE public.share_retention (name text PRIMARY KEY, value integer NOT NULL CHECK (value > 0));
INSERT INTO public.share_retention VALUES
 ('attempt_hours', 48),                  -- rate-limit records, including network hashes
 ('repeat_window_days', 30),             -- an identical share from the same person within this is counted, not stored again
 ('duplicate_days', 180),                -- shares that matched an existing connection
 ('duplicates_per_connection', 10),      -- at most this many kept per connection (newest kept)
 ('limit_reached_days', 90),             -- shares that arrived while the owner was at their limit
 ('read_notification_days', 90),
 ('unread_notification_days', 365);
-- Shares that created a connection are kept for as long as that connection exists.

-- 7. Access. Owners read their own shares and notifications; nothing else is open to browsers.
ALTER TABLE public.card_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.share_retention ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.card_shares, public.notifications, public.share_attempts, public.share_limits, public.share_retention FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.share_attempts_id_seq FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.card_shares, public.notifications TO authenticated;
CREATE POLICY card_shares_select_own ON public.card_shares FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
CREATE POLICY notifications_select_own ON public.notifications FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));

-- 8. Browsers can't mark connections as shared or mutual. Trusted functions run as their owner, so they can.
CREATE FUNCTION public.protect_connection_sharing_fields() RETURNS trigger
 LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF current_user IN ('anon', 'authenticated') THEN
  IF TG_OP = 'INSERT' THEN
   IF NEW.mutual OR NEW.share_id IS NOT NULL OR NEW.source = 'shared_back' THEN
    RAISE EXCEPTION 'Only VALE Connect can mark a connection as shared or mutual.';
   END IF;
  ELSIF NEW.mutual IS DISTINCT FROM OLD.mutual OR NEW.share_id IS DISTINCT FROM OLD.share_id OR NEW.source IS DISTINCT FROM OLD.source THEN
   RAISE EXCEPTION 'Only VALE Connect can change how a connection was shared.';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER connections_sharing_fields BEFORE INSERT OR UPDATE ON public.connections
 FOR EACH ROW EXECUTE FUNCTION public.protect_connection_sharing_fields();
REVOKE ALL ON FUNCTION public.protect_connection_sharing_fields() FROM PUBLIC, anon, authenticated;

-- 9. Housekeeping for one owner's sharing history, following share_retention.
CREATE FUNCTION public.purge_share_history(p_owner uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 r jsonb := (SELECT jsonb_object_agg(name, value) FROM public.share_retention);
BEGIN
 DELETE FROM public.share_attempts WHERE created_at < now() - make_interval(hours => (r->>'attempt_hours')::int);
 IF p_owner IS NULL THEN RETURN; END IF;
 DELETE FROM public.card_shares s WHERE s.owner_id = p_owner AND s.outcome = 'duplicate' AND s.last_shared_at < now() - make_interval(days => (r->>'duplicate_days')::int);
 DELETE FROM public.card_shares s WHERE s.owner_id = p_owner AND s.outcome = 'limit_reached' AND s.last_shared_at < now() - make_interval(days => (r->>'limit_reached_days')::int);
 DELETE FROM public.card_shares s WHERE s.id IN (
  SELECT id FROM (SELECT id, row_number() OVER (PARTITION BY connection_id ORDER BY last_shared_at DESC) AS n
   FROM public.card_shares WHERE owner_id = p_owner AND outcome = 'duplicate') ranked
  WHERE n > (r->>'duplicates_per_connection')::int);
 DELETE FROM public.notifications n WHERE n.owner_id = p_owner AND (
  (n.read_at IS NOT NULL AND n.read_at < now() - make_interval(days => (r->>'read_notification_days')::int))
  OR n.created_at < now() - make_interval(days => (r->>'unread_notification_days')::int));
END $$;
REVOKE ALL ON FUNCTION public.purge_share_history(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_share_history(uuid) TO service_role;

-- 10. Record a share. Server only. Returns 'shared', 'invalid', 'rate_limited' or 'unavailable', never more:
--     a duplicate, or an owner at their limit, still returns 'shared'.
--     Visitors: p_fields holds the values they typed. Members: p_member_fields names the fields they ticked,
--     and the values are read here from their own card, so a browser can't add anything else.
CREATE FUNCTION public.record_share(
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
 v_email text; v_phone text; v_contact text; v_dedupe text; lim record; used integer; attempt_id bigint;
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
 v_dedupe := CASE WHEN p_sharer_user_id IS NOT NULL THEN 'member:' || p_sharer_user_id::text ELSE v_contact END;

 -- Rate limits, from share_limits. Every valid attempt is recorded, then counted.
 PERFORM public.purge_share_history(NULL);
 INSERT INTO public.share_attempts(card_id, network_hash, contact_key, sharer_user_id)
  VALUES (card.id, nullif(p_network_hash, ''), v_contact, p_sharer_user_id) RETURNING id INTO attempt_id;
 FOR lim IN SELECT * FROM public.share_limits LOOP
  SELECT count(*) INTO used FROM public.share_attempts a WHERE a.created_at > now() - make_interval(secs => lim.window_seconds) AND CASE lim.name
   WHEN 'network_card' THEN p_network_hash IS NOT NULL AND a.network_hash = p_network_hash AND a.card_id = card.id
   WHEN 'network_all' THEN p_network_hash IS NOT NULL AND a.network_hash = p_network_hash
   WHEN 'card_all' THEN a.card_id = card.id
   WHEN 'contact_card' THEN a.contact_key = v_contact AND a.card_id = card.id
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

-- 11. The owner adds a reviewed share (a duplicate, or one that arrived at their limit) as a separate connection.
--     Runs with the owner's own limits; never changes the existing connection.
CREATE FUNCTION public.add_shared_as_connection(p_share_id uuid) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE s public.card_shares%ROWTYPE; conn_id uuid;
BEGIN
 SELECT * INTO s FROM public.card_shares WHERE id = p_share_id AND owner_id = (SELECT auth.uid()) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'That share isn''t available.'; END IF;
 IF s.outcome NOT IN ('duplicate', 'limit_reached') THEN RAISE EXCEPTION 'That share is already in your connections.'; END IF;
 INSERT INTO public.connections(owner_id, full_name, business_name, email, phone, job_title, website, social_links, notes, category, next_step, history, source_identity, source_url, source, share_id)
  VALUES (s.owner_id, s.shared->>'full_name', coalesce(s.shared->>'business_name', ''), coalesce(s.shared->>'email', ''), coalesce(s.shared->>'phone', ''), coalesce(s.shared->>'job_title', ''),
   coalesce(s.shared->>'website', ''), coalesce(s.shared->>'social_links', ''), CASE WHEN s.note <> '' THEN 'Their note: ' || s.note ELSE '' END, 'Other', 'Follow up', '[]'::jsonb, NULL, '', 'shared_back', s.id)
  RETURNING id INTO conn_id;
 UPDATE public.card_shares SET outcome = 'owner_added', connection_id = conn_id, reviewed_at = now() WHERE id = s.id;
 RETURN conn_id;
END $$;
REVOKE ALL ON FUNCTION public.add_shared_as_connection(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_shared_as_connection(uuid) TO authenticated;

-- 12. The owner marks notifications read (all, or the given ones). Also tidies their old history.
CREATE FUNCTION public.mark_notifications_read(p_ids uuid[] DEFAULT NULL) RETURNS integer
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE changed integer;
BEGIN
 IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Sign in first.'; END IF;
 UPDATE public.notifications SET read_at = now()
  WHERE owner_id = (SELECT auth.uid()) AND read_at IS NULL AND (p_ids IS NULL OR id = ANY (p_ids));
 GET DIAGNOSTICS changed = ROW_COUNT;
 PERFORM public.purge_share_history((SELECT auth.uid()));
 RETURN changed;
END $$;
REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[]) TO authenticated;

-- 13. The public lookup also says whether the card accepts shares.
DROP FUNCTION public.get_public_card(text);
CREATE FUNCTION public.get_public_card(card_slug text)
 RETURNS TABLE (id uuid, display_name text, job_title text, business_name text, introduction text, public_email text, public_phone text, website text, social_links text, appearance text, photo_path text, logo_path text, accept_shares boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' ROWS 1 AS $$
 SELECT c.id, c.display_name, c.job_title, c.business_name, c.introduction, c.public_email, c.public_phone, c.website, c.social_links, c.appearance, c.photo_path, c.logo_path, c.accept_shares
 FROM public.public_cards c WHERE c.slug = card_slug AND c.published
$$;
REVOKE ALL ON FUNCTION public.get_public_card(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_card(text) TO anon, authenticated;

COMMIT;
