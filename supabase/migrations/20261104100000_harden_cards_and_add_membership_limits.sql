-- Additive: existing app versions keep working. Field limits match the app's form limits.
BEGIN;
ALTER TABLE public.public_cards ADD CONSTRAINT public_cards_field_lengths CHECK (
 length(btrim(display_name)) BETWEEN 1 AND 80 AND length(job_title) <= 80 AND length(business_name) <= 90
 AND length(introduction) <= 300 AND length(public_email) <= 120 AND length(public_phone) <= 35
 AND length(website) <= 300 AND length(social_links) <= 3000);
ALTER TABLE public.connections ADD CONSTRAINT connections_field_lengths CHECK (
 length(full_name) <= 90 AND length(business_name) <= 90 AND length(email) <= 120 AND length(phone) <= 40
 AND length(job_title) <= 80 AND length(website) <= 300 AND length(social_links) <= 3000 AND length(notes) <= 10000
 AND length(source_url) <= 8192 AND coalesce(length(source_identity), 0) <= 4096
 AND jsonb_array_length(history) <= 1000 AND octet_length(history::text) <= 1500000);
ALTER TABLE public.profiles ADD CONSTRAINT profiles_field_lengths CHECK (
 coalesce(length(full_name), 0) <= 80 AND coalesce(length(business_name), 0) <= 90 AND coalesce(length(email), 0) <= 120
 AND coalesce(length(phone), 0) <= 35 AND coalesce(length(website), 0) <= 300 AND coalesce(length(job_title), 0) <= 80
 AND coalesce(length(bio), 0) <= 300 AND length(social_links) <= 3000);

ALTER TABLE public.connections ADD COLUMN archived_at timestamptz;

-- A missing membership row means the Free plan. NULL limit means unlimited.
CREATE TABLE public.membership_plans (
 code text PRIMARY KEY,
 name text NOT NULL,
 max_cards integer CHECK (max_cards >= 0),
 max_active_connections integer CHECK (max_active_connections >= 0)
);
INSERT INTO public.membership_plans(code, name, max_cards, max_active_connections) VALUES
 ('free', 'Free', 1, 5),
 ('plus', 'Plus', 3, NULL);
CREATE TABLE public.memberships (
 user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 plan_code text NOT NULL DEFAULT 'free' REFERENCES public.membership_plans(code),
 updated_at timestamptz NOT NULL DEFAULT now()
);
-- Retired link names can't be claimed again, so an old QR code never shows someone else's card.
CREATE TABLE public.retired_card_slugs (
 slug text PRIMARY KEY,
 retired_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.membership_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retired_card_slugs ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.membership_plans, public.memberships, public.retired_card_slugs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.membership_plans, public.memberships TO authenticated;
GRANT SELECT ON TABLE public.membership_plans TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.memberships TO service_role;
CREATE POLICY membership_plans_read ON public.membership_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY memberships_select_own ON public.memberships FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

-- Rules apply to app clients. Maintenance and restores by trusted database roles are exempt.
CREATE FUNCTION public.enforce_card_rules() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 is_client boolean := coalesce(current_setting('role', true), '') IN ('anon', 'authenticated');
 card_limit integer;
 card_count integer;
 plan_name text;
BEGIN
 IF TG_OP = 'DELETE' THEN
  INSERT INTO public.retired_card_slugs(slug) VALUES (OLD.slug) ON CONFLICT (slug) DO NOTHING;
  RETURN OLD;
 END IF;
 IF NOT is_client THEN RETURN NEW; END IF;
 IF TG_OP = 'INSERT' THEN
  IF NEW.published THEN RAISE EXCEPTION 'New cards start as private drafts. Save it first, then publish.'; END IF;
  IF EXISTS (SELECT 1 FROM public.retired_card_slugs r WHERE r.slug = NEW.slug) THEN
   RAISE EXCEPTION 'That public link name is no longer available.' USING ERRCODE = 'unique_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('cards:' || NEW.owner_id::text, 0));
  SELECT p.max_cards, p.name INTO card_limit, plan_name FROM public.membership_plans p
   WHERE p.code = coalesce((SELECT m.plan_code FROM public.memberships m WHERE m.user_id = NEW.owner_id), 'free');
  SELECT count(*) INTO card_count FROM public.public_cards c WHERE c.owner_id = NEW.owner_id;
  IF card_limit IS NOT NULL AND card_count >= card_limit THEN
   RAISE EXCEPTION 'Your % plan includes % card(s). Upgrade to add more.', plan_name, card_limit;
  END IF;
  NEW.revision := 0;
  NEW.updated_at := now();
  RETURN NEW;
 END IF;
 IF NEW.slug IS DISTINCT FROM OLD.slug THEN RAISE EXCEPTION 'A public link name can''t be changed, so printed QR codes keep working.'; END IF;
 IF NEW.id IS DISTINCT FROM OLD.id THEN RAISE EXCEPTION 'A card''s ID can''t be changed.'; END IF;
 NEW.revision := OLD.revision + 1;
 NEW.updated_at := now();
 RETURN NEW;
END $$;
CREATE TRIGGER public_cards_rules BEFORE INSERT OR UPDATE OR DELETE ON public.public_cards
 FOR EACH ROW EXECUTE FUNCTION public.enforce_card_rules();

CREATE FUNCTION public.enforce_connection_rules() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 connection_limit integer;
 active_count integer;
 plan_name text;
BEGIN
 IF coalesce(current_setting('role', true), '') NOT IN ('anon', 'authenticated') THEN RETURN NEW; END IF;
 IF NEW.archived_at IS NULL AND (TG_OP = 'INSERT' OR OLD.archived_at IS NOT NULL) THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('connections:' || NEW.owner_id::text, 0));
  SELECT p.max_active_connections, p.name INTO connection_limit, plan_name FROM public.membership_plans p
   WHERE p.code = coalesce((SELECT m.plan_code FROM public.memberships m WHERE m.user_id = NEW.owner_id), 'free');
  SELECT count(*) INTO active_count FROM public.connections c WHERE c.owner_id = NEW.owner_id AND c.archived_at IS NULL;
  IF connection_limit IS NOT NULL AND active_count >= connection_limit THEN
   RAISE EXCEPTION 'Your % plan includes % active connections. Archive one or upgrade to add more.', plan_name, connection_limit;
  END IF;
 END IF;
 IF TG_OP = 'INSERT' THEN
  NEW.revision := 0;
  NEW.created_at := now();
 ELSE
  NEW.revision := OLD.revision + 1;
  NEW.created_at := OLD.created_at;
 END IF;
 NEW.updated_at := now();
 RETURN NEW;
END $$;
CREATE TRIGGER connections_rules BEFORE INSERT OR UPDATE ON public.connections
 FOR EACH ROW EXECUTE FUNCTION public.enforce_connection_rules();
REVOKE ALL ON FUNCTION public.enforce_card_rules(), public.enforce_connection_rules() FROM PUBLIC, anon, authenticated;

-- Public card page lookup: one published card, by its link name, public fields only.
CREATE FUNCTION public.get_public_card(card_slug text)
 RETURNS TABLE (id uuid, display_name text, job_title text, business_name text, introduction text, public_email text, public_phone text, website text, social_links text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' ROWS 1 AS $$
 SELECT c.id, c.display_name, c.job_title, c.business_name, c.introduction, c.public_email, c.public_phone, c.website, c.social_links
 FROM public.public_cards c WHERE c.slug = card_slug AND c.published
$$;
REVOKE ALL ON FUNCTION public.get_public_card(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_card(text) TO anon, authenticated;
COMMIT;
