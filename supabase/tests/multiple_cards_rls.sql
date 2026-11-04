BEGIN;
SELECT set_config('vale.multi_a',gen_random_uuid()::text,true);
SELECT set_config('vale.multi_b',gen_random_uuid()::text,true);
INSERT INTO auth.users(id,email) VALUES
(current_setting('vale.multi_a')::uuid,'multi-a-'||current_setting('vale.multi_a')||'@example.invalid'),
(current_setting('vale.multi_b')::uuid,'multi-b-'||current_setting('vale.multi_b')||'@example.invalid');
INSERT INTO public.memberships(user_id,plan_code) VALUES(current_setting('vale.multi_a')::uuid,'plus');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.multi_a'),'role','authenticated')::text,true);
INSERT INTO public.public_cards(owner_id,slug,display_name,card_label)
VALUES
(current_setting('vale.multi_a')::uuid,'brandworks-'||current_setting('vale.multi_a'),'Synthetic A','VALE Brandworks'),
(current_setting('vale.multi_a')::uuid,'connect-'||current_setting('vale.multi_a'),'Synthetic A','VALE Connect');
DO $$ BEGIN
 IF (SELECT count(*) FROM public.public_cards WHERE owner_id=current_setting('vale.multi_a')::uuid)<>2 THEN RAISE EXCEPTION 'Multiple cards failed'; END IF;
 IF (SELECT count(DISTINCT id) FROM public.public_cards WHERE owner_id=current_setting('vale.multi_a')::uuid)<>2 THEN RAISE EXCEPTION 'Card IDs not distinct'; END IF;
 IF EXISTS(SELECT 1 FROM public.public_cards WHERE owner_id=current_setting('vale.multi_a')::uuid AND published) THEN RAISE EXCEPTION 'New card published automatically'; END IF;
 UPDATE public.public_cards SET published=true,revision=1 WHERE slug='connect-'||current_setting('vale.multi_a') AND revision=0;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner publish failed'; END IF;
 UPDATE public.public_cards SET display_name='Stale overwrite',revision=1 WHERE slug='connect-'||current_setting('vale.multi_a') AND revision=0;
 IF FOUND THEN RAISE EXCEPTION 'Stale revision overwritten'; END IF;
 BEGIN
 UPDATE public.public_cards SET owner_id=current_setting('vale.multi_b')::uuid WHERE slug='connect-'||current_setting('vale.multi_a');
 RAISE EXCEPTION 'Owner transfer incorrectly allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.multi_b'),'role','authenticated')::text,true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.public_cards WHERE slug='brandworks-'||current_setting('vale.multi_a')) THEN RAISE EXCEPTION 'Private card leaked'; END IF;
 UPDATE public.public_cards SET display_name='Unauthorized' WHERE owner_id=current_setting('vale.multi_a')::uuid;
 IF FOUND THEN RAISE EXCEPTION 'Cross-account update allowed'; END IF; DELETE FROM public.public_cards WHERE owner_id=current_setting('vale.multi_a')::uuid; IF FOUND THEN RAISE EXCEPTION 'Cross-account delete allowed'; END IF;
 BEGIN
 INSERT INTO public.public_cards(owner_id,slug,display_name) VALUES(current_setting('vale.multi_a')::uuid,'blocked-'||current_setting('vale.multi_b'),'Blocked');
 RAISE EXCEPTION 'Cross-account insert allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.get_public_card('brandworks-'||current_setting('vale.multi_a'))) THEN RAISE EXCEPTION 'Anonymous draft leak'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.get_public_card('connect-'||current_setting('vale.multi_a')) WHERE display_name='Synthetic A') THEN RAISE EXCEPTION 'Published card missing'; END IF;
 IF has_table_privilege('anon','public.public_cards','TRUNCATE') OR has_table_privilege('authenticated','public.public_cards','TRUNCATE') THEN RAISE EXCEPTION 'Unexpected truncate permission'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.multi_a'),'role','authenticated')::text,true);
UPDATE public.public_cards SET published=false,revision=2 WHERE slug='connect-'||current_setting('vale.multi_a') AND revision=1;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM public.get_public_card('connect-'||current_setting('vale.multi_a'))) THEN RAISE EXCEPTION 'Unpublished card still visible'; END IF; END $$;
RESET ROLE;
SELECT 'PASS: two private cards per owner, stable distinct IDs, owner publish/unpublish, anonymous published-only reads, account isolation and stale-revision guard; all fixtures rolled back.' AS result;
ROLLBACK;