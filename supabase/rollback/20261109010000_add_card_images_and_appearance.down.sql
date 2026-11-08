-- Reverses 20261109010000_add_card_images_and_appearance. Use only if that change must be withdrawn.
-- Refuses while any card image is stored: remove images through the Storage API first, because deleting
-- storage rows by SQL would orphan the files.
BEGIN;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'card-images') THEN
  RAISE EXCEPTION 'Card images are still stored. Remove them through the Storage API first. Nothing was changed.';
 END IF;
END $$;
DROP POLICY card_images_owner_read ON storage.objects;
DROP POLICY card_images_published_read ON storage.objects;
DROP POLICY card_images_owner_upload ON storage.objects;
DROP POLICY card_images_owner_delete ON storage.objects;
DROP TRIGGER public_cards_image_cleanup ON public.public_cards;
DROP FUNCTION public.enforce_card_image_cleanup();

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
 DELETE FROM auth.users u WHERE u.id = account_id;
END $$;
REVOKE ALL ON FUNCTION public.delete_my_account(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account(text) TO authenticated;

DROP FUNCTION public.get_public_card(text);
CREATE FUNCTION public.get_public_card(card_slug text)
 RETURNS TABLE (id uuid, display_name text, job_title text, business_name text, introduction text, public_email text, public_phone text, website text, social_links text)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' ROWS 1 AS $$
 SELECT c.id, c.display_name, c.job_title, c.business_name, c.introduction, c.public_email, c.public_phone, c.website, c.social_links
 FROM public.public_cards c WHERE c.slug = card_slug AND c.published
$$;
REVOKE ALL ON FUNCTION public.get_public_card(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_card(text) TO anon, authenticated;

DROP FUNCTION vale_private.card_image_is_published(text);
DROP FUNCTION vale_private.card_image_count(text);
DROP FUNCTION vale_private.account_image_count(uuid);
DROP SCHEMA vale_private;
-- Supabase blocks deleting buckets by SQL. The empty private bucket stays; with its rules removed, no client
-- can read or write it. Delete it from the dashboard (Storage → card-images → Delete bucket) if wanted.
DROP INDEX public.public_cards_photo_path_idx;
DROP INDEX public.public_cards_logo_path_idx;
ALTER TABLE public.public_cards DROP COLUMN appearance, DROP COLUMN photo_path, DROP COLUMN logo_path;
COMMIT;
