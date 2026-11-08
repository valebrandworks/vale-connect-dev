-- Transaction-only access test for public.profiles. All fixtures roll back.
-- Never run against production.
BEGIN;
SELECT set_config('vale.prof_a',gen_random_uuid()::text,true);
SELECT set_config('vale.prof_b',gen_random_uuid()::text,true);
INSERT INTO auth.users(id,email) VALUES
(current_setting('vale.prof_a')::uuid,'prof-a-'||current_setting('vale.prof_a')||'@example.invalid'),
(current_setting('vale.prof_b')::uuid,'prof-b-'||current_setting('vale.prof_b')||'@example.invalid');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.prof_a'),'role','authenticated')::text,true);
INSERT INTO public.profiles(id,full_name,email) VALUES(current_setting('vale.prof_a')::uuid,'Synthetic A','a@example.invalid');
DO $$ BEGIN
 IF (SELECT count(*) FROM public.profiles)<>1 THEN RAISE EXCEPTION 'Owner cannot read own profile'; END IF;
 UPDATE public.profiles SET full_name='Synthetic A Updated' WHERE id=current_setting('vale.prof_a')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner update failed'; END IF;
 BEGIN
  INSERT INTO public.profiles(id,full_name) VALUES(current_setting('vale.prof_b')::uuid,'Cross-account');
  RAISE EXCEPTION 'Cross-account insert allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.profiles SET id=current_setting('vale.prof_b')::uuid WHERE id=current_setting('vale.prof_a')::uuid;
  RAISE EXCEPTION 'Profile transfer allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  DELETE FROM public.profiles WHERE id=current_setting('vale.prof_a')::uuid;
  RAISE EXCEPTION 'Client DELETE allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.prof_b'),'role','authenticated')::text,true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.profiles WHERE id=current_setting('vale.prof_a')::uuid) THEN RAISE EXCEPTION 'Profile leaked across accounts'; END IF;
 UPDATE public.profiles SET full_name='Unauthorized' WHERE id=current_setting('vale.prof_a')::uuid;
 IF FOUND THEN RAISE EXCEPTION 'Cross-account update allowed'; END IF;
END $$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
DO $$
DECLARE row_count bigint;
BEGIN
 BEGIN
  SELECT count(*) INTO row_count FROM public.profiles;
  RAISE EXCEPTION 'Anonymous read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO public.profiles(id,full_name) VALUES(current_setting('vale.prof_a')::uuid,'Anonymous');
  RAISE EXCEPTION 'Anonymous insert allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'PASS: profiles owner read/update; cross-account, transfer, DELETE and anonymous access rejected. All fixtures rolled back.' AS result;
ROLLBACK;
