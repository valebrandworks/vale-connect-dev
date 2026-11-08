-- Card appearance presets, profile photos and business logos.
-- Images live in a PRIVATE bucket. Anyone can read an image only while it belongs to a published card;
-- owners can always read their own. Unpublishing a card ends public access at once (browser caches aside).
-- Files are removed through the Storage API by the app; the database refuses to delete a card or an
-- account while its images remain, so nothing is left behind.
BEGIN;

-- 1. Card fields. An image path must sit in that card's own folder: <card id>/<photo|logo>-<random>.<webp|png|jpg>
--    Paths contain no account ID, because published paths are visible to visitors.
ALTER TABLE public.public_cards
 ADD COLUMN appearance text NOT NULL DEFAULT 'charcoal',
 ADD COLUMN photo_path text,
 ADD COLUMN logo_path text,
 ADD CONSTRAINT public_cards_appearance_check CHECK (appearance IN ('charcoal', 'ivory', 'midnight', 'slate')),
 ADD CONSTRAINT public_cards_photo_path_check CHECK (photo_path IS NULL OR photo_path ~ ('^' || id::text || '/photo-[a-z0-9]{16,40}\.(webp|png|jpg)$')),
 ADD CONSTRAINT public_cards_logo_path_check CHECK (logo_path IS NULL OR logo_path ~ ('^' || id::text || '/logo-[a-z0-9]{16,40}\.(webp|png|jpg)$'));
CREATE INDEX public_cards_photo_path_idx ON public.public_cards (photo_path) WHERE photo_path IS NOT NULL;
CREATE INDEX public_cards_logo_path_idx ON public.public_cards (logo_path) WHERE logo_path IS NOT NULL;

-- 2. Private bucket: 1 MB per file (the app uploads about 50–200 KB), images only.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('card-images', 'card-images', false, 1048576, ARRAY['image/webp', 'image/png', 'image/jpeg']);

-- 3. Helpers in a schema the API doesn't expose, so they can't be called directly over the internet.
CREATE SCHEMA vale_private;
REVOKE ALL ON SCHEMA vale_private FROM PUBLIC;
GRANT USAGE ON SCHEMA vale_private TO anon, authenticated;
-- True only for an image currently attached to a published card. Returns nothing else.
CREATE FUNCTION vale_private.card_image_is_published(object_name text) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS (SELECT 1 FROM public.public_cards c WHERE c.published AND (c.photo_path = object_name OR c.logo_path = object_name))
$$;
-- Number of image files stored for one card.
CREATE FUNCTION vale_private.card_image_count(card_id text) RETURNS bigint
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT count(*) FROM storage.objects o WHERE o.bucket_id = 'card-images' AND left(o.name, length(card_id) + 1) = card_id || '/'
$$;
-- Number of image files stored for all of one account's cards.
CREATE FUNCTION vale_private.account_image_count(account_id uuid) RETURNS bigint
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT count(*) FROM storage.objects o JOIN public.public_cards c ON left(o.name, 37) = c.id::text || '/'
 WHERE o.bucket_id = 'card-images' AND c.owner_id = account_id
$$;
REVOKE ALL ON FUNCTION vale_private.card_image_is_published(text), vale_private.card_image_count(text), vale_private.account_image_count(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vale_private.card_image_is_published(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION vale_private.card_image_count(text) TO authenticated;

-- 4. Storage rules for this bucket. Ownership is checked through the card. There is no UPDATE rule,
--    so files can't be overwritten or moved.
CREATE POLICY card_images_owner_read ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id = 'card-images' AND EXISTS (SELECT 1 FROM public.public_cards c WHERE c.id::text = (storage.foldername(name))[1] AND c.owner_id = (SELECT auth.uid())));
CREATE POLICY card_images_published_read ON storage.objects FOR SELECT TO anon, authenticated
 USING (bucket_id = 'card-images' AND vale_private.card_image_is_published(name));
-- Upload only into your own card's folder, with the expected name, and at most 4 files per card at a time
-- (a photo and a logo, plus room to replace each before the old file is removed).
CREATE POLICY card_images_owner_upload ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (
  bucket_id = 'card-images'
  AND name ~ '^[0-9a-f-]{36}/(photo|logo)-[a-z0-9]{16,40}\.(webp|png|jpg)$'
  AND EXISTS (SELECT 1 FROM public.public_cards c WHERE c.id::text = (storage.foldername(name))[1] AND c.owner_id = (SELECT auth.uid()))
  AND vale_private.card_image_count((storage.foldername(name))[1]) < 4
 );
CREATE POLICY card_images_owner_delete ON storage.objects FOR DELETE TO authenticated
 USING (bucket_id = 'card-images' AND EXISTS (SELECT 1 FROM public.public_cards c WHERE c.id::text = (storage.foldername(name))[1] AND c.owner_id = (SELECT auth.uid())));

-- 5. The app can't delete a card while its images remain, so no file is ever left without its card.
CREATE FUNCTION public.enforce_card_image_cleanup() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF coalesce(current_setting('role', true), '') IN ('anon', 'authenticated')
    AND vale_private.card_image_count(OLD.id::text) > 0 THEN
  RAISE EXCEPTION 'Remove this card''s photo and logo first. Nothing was deleted.';
 END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.enforce_card_image_cleanup() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER public_cards_image_cleanup BEFORE DELETE ON public.public_cards
 FOR EACH ROW EXECUTE FUNCTION public.enforce_card_image_cleanup();

-- 6. Account deletion: unchanged, except it now refuses while any of the account's images remain.
CREATE OR REPLACE FUNCTION public.delete_my_account(confirm_email text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 account_id uuid := auth.uid();
 account_email text;
 last_sign_in bigint;
BEGIN
 IF account_id IS NULL THEN RAISE EXCEPTION 'Sign in to delete your account.'; END IF;
 SELECT u.email INTO account_email FROM auth.users u WHERE u.id = account_id;
 IF account_email IS NULL OR lower(btrim(confirm_email)) IS DISTINCT FROM lower(account_email) THEN
  RAISE EXCEPTION 'That email doesn''t match this account. Nothing was deleted.';
 END IF;
 SELECT max((entry->>'timestamp')::bigint) INTO last_sign_in
  FROM jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) AS entry;
 IF last_sign_in IS NULL OR last_sign_in < extract(epoch FROM now())::bigint - 600 THEN
  RAISE EXCEPTION 'Please sign in again to confirm it''s you. Nothing was deleted.';
 END IF;
 IF vale_private.account_image_count(account_id) > 0 THEN
  RAISE EXCEPTION 'Your card images couldn''t be removed yet. Try again. Nothing was deleted.';
 END IF;
 -- Cards are removed with the account; their images are already gone, so the card image check allows it.
 DELETE FROM auth.users u WHERE u.id = account_id;
END $$;
REVOKE ALL ON FUNCTION public.delete_my_account(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account(text) TO authenticated;

-- 7. The public lookup also returns the appearance and image paths of a published card.
DROP FUNCTION public.get_public_card(text);
CREATE FUNCTION public.get_public_card(card_slug text)
 RETURNS TABLE (id uuid, display_name text, job_title text, business_name text, introduction text, public_email text, public_phone text, website text, social_links text, appearance text, photo_path text, logo_path text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' ROWS 1 AS $$
 SELECT c.id, c.display_name, c.job_title, c.business_name, c.introduction, c.public_email, c.public_phone, c.website, c.social_links, c.appearance, c.photo_path, c.logo_path
 FROM public.public_cards c WHERE c.slug = card_slug AND c.published
$$;
REVOKE ALL ON FUNCTION public.get_public_card(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_card(text) TO anon, authenticated;

COMMIT;
