BEGIN;
SELECT set_config('vale.test_user_a',gen_random_uuid()::text,true);
SELECT set_config('vale.test_user_b',gen_random_uuid()::text,true);
INSERT INTO auth.users(id,email) VALUES
(current_setting('vale.test_user_a')::uuid,'vale-repair-a-'||current_setting('vale.test_user_a')||'@example.invalid'),
(current_setting('vale.test_user_b')::uuid,'vale-repair-b-'||current_setting('vale.test_user_b')||'@example.invalid');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.test_user_a'),'role','authenticated')::text,true);
INSERT INTO public.public_cards(owner_id,slug,display_name,published)
VALUES(current_setting('vale.test_user_a')::uuid,'repair-'||current_setting('vale.test_user_a'),'Synthetic A',false);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.public_cards WHERE owner_id=current_setting('vale.test_user_a')::uuid) THEN RAISE EXCEPTION 'Owner cannot read draft'; END IF;
 BEGIN
 INSERT INTO public.public_cards(owner_id,slug,display_name) VALUES(current_setting('vale.test_user_b')::uuid,'repair-'||current_setting('vale.test_user_b'),'Unauthorized');
 RAISE EXCEPTION 'Cross-account insert allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
 UPDATE public.public_cards SET owner_id=current_setting('vale.test_user_b')::uuid WHERE owner_id=current_setting('vale.test_user_a')::uuid;
 RAISE EXCEPTION 'Owner transfer allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.test_user_b'),'role','authenticated')::text,true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.public_cards WHERE owner_id=current_setting('vale.test_user_a')::uuid) THEN RAISE EXCEPTION 'Draft leaked'; END IF;
 UPDATE public.public_cards SET display_name='Unauthorized' WHERE owner_id=current_setting('vale.test_user_a')::uuid;
 IF FOUND THEN RAISE EXCEPTION 'Cross-account update allowed'; END IF;
 DELETE FROM public.public_cards WHERE owner_id=current_setting('vale.test_user_a')::uuid;
 IF FOUND THEN RAISE EXCEPTION 'Cross-account delete allowed'; END IF;
END $$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.public_cards WHERE owner_id=current_setting('vale.test_user_a')::uuid) THEN RAISE EXCEPTION 'Anonymous draft read allowed'; END IF;
 BEGIN
 INSERT INTO public.public_cards(owner_id,slug,display_name) VALUES(current_setting('vale.test_user_b')::uuid,'repair-'||current_setting('vale.test_user_b'),'Unauthorized');
 RAISE EXCEPTION 'Anonymous insert allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.test_user_a'),'role','authenticated')::text,true);
UPDATE public.public_cards SET published=true WHERE owner_id=current_setting('vale.test_user_a')::uuid;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.public_cards WHERE owner_id=current_setting('vale.test_user_a')::uuid AND published) THEN RAISE EXCEPTION 'Published card unreadable'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.test_user_a'),'role','authenticated')::text,true);
DO $$ BEGIN
 DELETE FROM public.public_cards WHERE owner_id=current_setting('vale.test_user_a')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner delete failed'; END IF;
END $$;
RESET ROLE;
SELECT 'PASS: owner card CRUD; draft isolation; public published read; cross-owner and anonymous write rejection. All fixtures rolled back.' AS result;
ROLLBACK;