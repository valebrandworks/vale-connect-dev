-- Transaction-only test of card images, appearance and cleanup rules. All fixtures roll back.
-- Never run against production. On a real project, deleting storage rows by SQL is blocked by Supabase,
-- so the parts that delete files run only where that protection is absent (the in-memory test database).
BEGIN;
SELECT set_config('vale.img_a',gen_random_uuid()::text,true);
SELECT set_config('vale.img_b',gen_random_uuid()::text,true);
SELECT set_config('vale.card_a1',gen_random_uuid()::text,true);
SELECT set_config('vale.card_a2',gen_random_uuid()::text,true);
SELECT set_config('vale.card_b1',gen_random_uuid()::text,true);
INSERT INTO auth.users(id,email) VALUES
(current_setting('vale.img_a')::uuid,'img-a-'||current_setting('vale.img_a')||'@example.invalid'),
(current_setting('vale.img_b')::uuid,'img-b-'||current_setting('vale.img_b')||'@example.invalid');
-- Free allows one card; give account A room for two so card deletion can be tested.
INSERT INTO public.memberships(user_id,plan_code) VALUES(current_setting('vale.img_a')::uuid,'plus');
INSERT INTO public.public_cards(id,owner_id,slug,display_name) VALUES
(current_setting('vale.card_a1')::uuid,current_setting('vale.img_a')::uuid,'img-a1-'||left(current_setting('vale.card_a1'),8),'Synthetic A1'),
(current_setting('vale.card_a2')::uuid,current_setting('vale.img_a')::uuid,'img-a2-'||left(current_setting('vale.card_a2'),8),'Synthetic A2'),
(current_setting('vale.card_b1')::uuid,current_setting('vale.img_b')::uuid,'img-b1-'||left(current_setting('vale.card_b1'),8),'Synthetic B1');
SELECT set_config('vale.photo_a1',current_setting('vale.card_a1')||'/photo-aaaaaaaaaaaaaaaa1.webp',true);
SELECT set_config('vale.logo_a1',current_setting('vale.card_a1')||'/logo-bbbbbbbbbbbbbbbb1.png',true);
SELECT set_config('vale.photo_b1',current_setting('vale.card_b1')||'/photo-cccccccccccccccc1.webp',true);
INSERT INTO storage.objects(bucket_id,name) VALUES('card-images',current_setting('vale.photo_b1'));
-- B's card is published with its photo, so other accounts can see that file, and must still be unable to change it.
UPDATE public.public_cards SET photo_path=current_setting('vale.photo_b1'),published=true WHERE id=current_setting('vale.card_b1')::uuid;

-- Account A: uploads, limits and card fields.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.img_a'),'role','authenticated','amr',json_build_array(json_build_object('method','password','timestamp',extract(epoch FROM now())::bigint)))::text,true);
DO $$ BEGIN
 INSERT INTO storage.objects(bucket_id,name) VALUES('card-images',current_setting('vale.photo_a1')),('card-images',current_setting('vale.logo_a1'));
 BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('card-images',current_setting('vale.card_b1')||'/photo-dddddddddddddddd1.webp'); RAISE EXCEPTION 'CHECK: uploaded into another account''s card';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('card-images',current_setting('vale.card_a1')||'/evil.svg'); RAISE EXCEPTION 'CHECK: unexpected file name accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('card-images',gen_random_uuid()::text||'/photo-eeeeeeeeeeeeeeee1.webp'); RAISE EXCEPTION 'CHECK: uploaded into a card that doesn''t exist';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 INSERT INTO storage.objects(bucket_id,name) VALUES('card-images',current_setting('vale.card_a1')||'/photo-ffffffffffffffff1.webp'),('card-images',current_setting('vale.card_a1')||'/logo-ffffffffffffffff2.webp');
 BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('card-images',current_setting('vale.card_a1')||'/photo-ffffffffffffffff3.webp'); RAISE EXCEPTION 'CHECK: fifth file for one card accepted';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT count(*) FROM storage.objects WHERE name LIKE current_setting('vale.card_a1')||'/%')<>4 THEN RAISE EXCEPTION 'Owner can''t see exactly their own 4 files'; END IF;
 IF (SELECT count(*) FROM storage.objects WHERE name=current_setting('vale.photo_b1'))<>1 THEN RAISE EXCEPTION 'Published image of another card not readable'; END IF;
 UPDATE public.public_cards SET photo_path=current_setting('vale.photo_a1'),logo_path=current_setting('vale.logo_a1'),appearance='ivory' WHERE id=current_setting('vale.card_a1')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner could not attach images'; END IF;
 BEGIN UPDATE public.public_cards SET photo_path=current_setting('vale.photo_b1') WHERE id=current_setting('vale.card_a1')::uuid; RAISE EXCEPTION 'CHECK: attached another card''s image';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.public_cards SET logo_path=current_setting('vale.photo_a1') WHERE id=current_setting('vale.card_a1')::uuid; RAISE EXCEPTION 'CHECK: photo used as logo';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.public_cards SET appearance='neon' WHERE id=current_setting('vale.card_a1')::uuid; RAISE EXCEPTION 'CHECK: unknown appearance accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- Visitors: nothing while the card is a draft.
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM storage.objects WHERE name LIKE current_setting('vale.card_a1')||'/%')<>0 THEN RAISE EXCEPTION 'Visitor can read a draft card''s images'; END IF;
END $$;
-- Account B: can't see A's draft images.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.img_b'),'role','authenticated')::text,true);
DO $$ BEGIN
 IF (SELECT count(*) FROM storage.objects WHERE name LIKE current_setting('vale.card_a1')||'/%')<>0 THEN RAISE EXCEPTION 'Another account can read draft images'; END IF;
 IF (SELECT count(*) FROM storage.objects WHERE name=current_setting('vale.photo_b1'))<>1 THEN RAISE EXCEPTION 'Owner B can''t read own image'; END IF;
END $$;

-- Publish: only the attached photo and logo become readable, and the lookup returns them.
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.img_a'),'role','authenticated')::text,true);
UPDATE public.public_cards SET published=true WHERE id=current_setting('vale.card_a1')::uuid;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','',true);
DO $$
DECLARE r record;
BEGIN
 IF (SELECT array_agg(name ORDER BY name) FROM storage.objects WHERE name LIKE current_setting('vale.card_a1')||'/%') IS DISTINCT FROM ARRAY[current_setting('vale.logo_a1'),current_setting('vale.photo_a1')] THEN RAISE EXCEPTION 'Visitor sees the wrong images of a published card'; END IF;
 SELECT * INTO r FROM public.get_public_card((SELECT 'img-a1-'||left(current_setting('vale.card_a1'),8)));
 IF r.appearance<>'ivory' OR r.photo_path<>current_setting('vale.photo_a1') OR r.logo_path<>current_setting('vale.logo_a1') THEN RAISE EXCEPTION 'Lookup missing appearance or images'; END IF;
 BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('card-images',current_setting('vale.card_a1')||'/photo-gggggggggggggggg1.webp'); RAISE EXCEPTION 'CHECK: visitor uploaded a file';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
-- Unpublish: public access ends at once.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.img_a'),'role','authenticated')::text,true);
UPDATE public.public_cards SET published=false WHERE id=current_setting('vale.card_a1')::uuid;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','',true);
DO $$ BEGIN
 IF (SELECT count(*) FROM storage.objects WHERE name LIKE current_setting('vale.card_a1')||'/%')<>0 THEN RAISE EXCEPTION 'Visitor can still read images after unpublishing'; END IF;
END $$;

-- Cleanup rules: a card or account with images can't be deleted; a card without images can.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.img_a'),'role','authenticated','amr',json_build_array(json_build_object('method','password','timestamp',extract(epoch FROM now())::bigint)))::text,true);
DO $$ BEGIN
 BEGIN DELETE FROM public.public_cards WHERE id=current_setting('vale.card_a1')::uuid; RAISE EXCEPTION 'CHECK: card with images deleted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 IF NOT EXISTS (SELECT 1 FROM public.public_cards WHERE id=current_setting('vale.card_a1')::uuid) THEN RAISE EXCEPTION 'Card with images is gone'; END IF;
 DELETE FROM public.public_cards WHERE id=current_setting('vale.card_a2')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Card without images could not be deleted'; END IF;
 BEGIN PERFORM public.delete_my_account(current_setting('vale.img_a')::text||'x'); RAISE EXCEPTION 'CHECK: wrong email accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.delete_my_account('img-a-'||current_setting('vale.img_a')||'@example.invalid'); RAISE EXCEPTION 'CHECK: account with images deleted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM NOT LIKE '%images couldn''t be removed%' THEN RAISE; END IF; END;
 -- Where storage rows can be deleted by SQL (the in-memory test database), removing the files allows both deletions.
 IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname='protect_objects_delete') THEN
  DELETE FROM storage.objects WHERE name LIKE current_setting('vale.card_b1')||'/%';
  IF FOUND THEN RAISE EXCEPTION 'Another account deleted an image'; END IF;
  DELETE FROM storage.objects WHERE name LIKE current_setting('vale.card_a1')||'/%';
  IF NOT FOUND THEN RAISE EXCEPTION 'Owner could not delete their images'; END IF;
  UPDATE storage.objects SET name=current_setting('vale.card_a1')||'/photo-hhhhhhhhhhhhhhhh1.webp' WHERE name=current_setting('vale.photo_b1');
  IF FOUND THEN RAISE EXCEPTION 'A file was moved or overwritten'; END IF;
  PERFORM public.delete_my_account('img-a-'||current_setting('vale.img_a')||'@example.invalid');
  IF EXISTS (SELECT 1 FROM public.public_cards WHERE owner_id=current_setting('vale.img_a')::uuid) THEN RAISE EXCEPTION 'Cards left after account deletion'; END IF;
 END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname='protect_objects_delete') AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id=current_setting('vale.img_a')::uuid) THEN RAISE EXCEPTION 'Account with images is gone'; END IF;
 IF (SELECT public FROM storage.buckets WHERE id='card-images') IS DISTINCT FROM false THEN RAISE EXCEPTION 'Image bucket is public'; END IF;
END $$;
SELECT 'PASS: card images private until published, readable only while attached to a published card, hidden again on unpublish; uploads only into your own card with safe names and at most 4 files; images can''t be attached across cards; appearance limited to presets; cards and accounts with images can''t be deleted until files are removed. All fixtures rolled back.' AS result;
ROLLBACK;
