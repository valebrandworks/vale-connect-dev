-- Transaction-only access test for public.connections. All fixtures roll back.
-- Never run against production.
BEGIN;
SELECT set_config('vale.conn_a',gen_random_uuid()::text,true);
SELECT set_config('vale.conn_b',gen_random_uuid()::text,true);
INSERT INTO auth.users(id,email) VALUES
(current_setting('vale.conn_a')::uuid,'conn-a-'||current_setting('vale.conn_a')||'@example.invalid'),
(current_setting('vale.conn_b')::uuid,'conn-b-'||current_setting('vale.conn_b')||'@example.invalid');
INSERT INTO public.memberships(user_id,plan_code) VALUES(current_setting('vale.conn_a')::uuid,'plus');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.conn_a'),'role','authenticated')::text,true);
INSERT INTO public.connections(owner_id,full_name,notes,source_identity,history)
VALUES(current_setting('vale.conn_a')::uuid,'Synthetic Contact','Private synthetic note','card:synthetic','[{"date":"2026-01-01","text":"Keep me"}]');
DO $$ BEGIN
 IF (SELECT count(*) FROM public.connections WHERE notes='Private synthetic note')<>1 THEN RAISE EXCEPTION 'Owner cannot read own connection'; END IF;
 UPDATE public.connections SET notes='Updated synthetic note',revision=1 WHERE full_name='Synthetic Contact' AND revision=0;
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner update failed'; END IF;
 UPDATE public.connections SET notes='Stale overwrite',revision=1 WHERE full_name='Synthetic Contact' AND revision=0;
 IF FOUND THEN RAISE EXCEPTION 'Stale revision overwritten'; END IF;
 IF (SELECT history->0->>'text' FROM public.connections WHERE full_name='Synthetic Contact')<>'Keep me' THEN RAISE EXCEPTION 'History not retained'; END IF;
 BEGIN
  INSERT INTO public.connections(owner_id,full_name,source_identity) VALUES(current_setting('vale.conn_a')::uuid,'Repeat','card:synthetic');
  RAISE EXCEPTION 'Repeated source identity allowed';
 EXCEPTION WHEN unique_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.connections(owner_id,full_name) VALUES(current_setting('vale.conn_b')::uuid,'Cross-account');
  RAISE EXCEPTION 'Cross-account insert allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.connections SET owner_id=current_setting('vale.conn_b')::uuid WHERE full_name='Synthetic Contact';
  RAISE EXCEPTION 'Ownership transfer allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  TRUNCATE public.connections;
  RAISE EXCEPTION 'Client TRUNCATE allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO public.connections(owner_id,full_name,category) VALUES(current_setting('vale.conn_a')::uuid,'Bad category','Not a category');
  RAISE EXCEPTION 'Invalid category allowed';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.conn_b'),'role','authenticated')::text,true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.connections WHERE owner_id=current_setting('vale.conn_a')::uuid) THEN RAISE EXCEPTION 'Private connection leaked across accounts'; END IF;
 UPDATE public.connections SET notes='Unauthorized' WHERE owner_id=current_setting('vale.conn_a')::uuid;
 IF FOUND THEN RAISE EXCEPTION 'Cross-account update allowed'; END IF;
 INSERT INTO public.connections(owner_id,full_name,source_identity) VALUES(current_setting('vale.conn_b')::uuid,'Same card, other owner','card:synthetic');
 IF (SELECT count(*) FROM public.connections)<>1 THEN RAISE EXCEPTION 'Account should see only its own connection'; END IF;
END $$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
DO $$
DECLARE row_count bigint;
BEGIN
 BEGIN
  SELECT count(*) INTO row_count FROM public.connections;
  RAISE EXCEPTION 'Anonymous read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  INSERT INTO public.connections(owner_id,full_name) VALUES(current_setting('vale.conn_a')::uuid,'Anonymous');
  RAISE EXCEPTION 'Anonymous insert allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'PASS: connections owner read/update; stale revision guard; history retained; source identity unique per owner; cross-account, ownership transfer, TRUNCATE, invalid category and anonymous access rejected. All fixtures rolled back.' AS result;
ROLLBACK;
