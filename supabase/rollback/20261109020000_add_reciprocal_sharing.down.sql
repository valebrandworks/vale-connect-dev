-- Reverses 20261109020000_add_reciprocal_sharing. Use only if reciprocal sharing must be withdrawn.
-- Removes all sharing history and notifications. Connections created from shares are KEPT (they're the owners'
-- contacts); only their source, mutual and share fields are removed.
BEGIN;
DROP FUNCTION public.get_public_card(text);
CREATE FUNCTION public.get_public_card(card_slug text)
 RETURNS TABLE (id uuid, display_name text, job_title text, business_name text, introduction text, public_email text, public_phone text, website text, social_links text, appearance text, photo_path text, logo_path text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' ROWS 1 AS $$
 SELECT c.id, c.display_name, c.job_title, c.business_name, c.introduction, c.public_email, c.public_phone, c.website, c.social_links, c.appearance, c.photo_path, c.logo_path
 FROM public.public_cards c WHERE c.slug = card_slug AND c.published
$$;
REVOKE ALL ON FUNCTION public.get_public_card(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_card(text) TO anon, authenticated;

DROP FUNCTION public.mark_notifications_read(uuid[]);
DROP FUNCTION public.add_shared_as_connection(uuid);
DROP FUNCTION public.record_share(text, uuid, boolean, text, jsonb, text[], uuid, uuid, text, text);
DROP FUNCTION public.purge_share_history(uuid);
DROP TRIGGER connections_sharing_fields ON public.connections;
DROP FUNCTION public.protect_connection_sharing_fields();

ALTER TABLE public.connections DROP CONSTRAINT connections_share_id_fkey;
DROP TABLE public.notifications;
DROP TABLE public.card_shares;
DROP TABLE public.share_attempts;
DROP TABLE public.share_limits;
DROP TABLE public.share_retention;
ALTER TABLE public.connections DROP CONSTRAINT connections_source_check, DROP COLUMN source, DROP COLUMN mutual, DROP COLUMN share_id;
ALTER TABLE public.public_cards DROP COLUMN accept_shares;
COMMIT;
