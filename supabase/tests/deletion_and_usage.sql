-- Transaction-only test of connection deletion, usage and account deletion. All fixtures roll back.
-- Never run against production.
BEGIN;
SELECT set_config('vale.del_a',gen_random_uuid()::text,true);
SELECT set_config('vale.del_b',gen_random_uuid()::text,true);
INSERT INTO auth.users(id,email) VALUES
(current_setting('vale.del_a')::uuid,'del-a-'||current_setting('vale.del_a')||'@example.invalid'),
(current_setting('vale.del_b')::uuid,'del-b-'||current_setting('vale.del_b')||'@example.invalid');
INSERT INTO public.public_cards(owner_id,slug,display_name) VALUES(current_setting('vale.del_a')::uuid,'del-card-'||current_setting('vale.del_a'),'Synthetic A');
INSERT INTO public.connections(owner_id,full_name,archived_at) VALUES(current_setting('vale.del_a')::uuid,'Archived A',now());
INSERT INTO public.connections(owner_id,full_name) VALUES(current_setting('vale.del_a')::uuid,'Keep A'),(current_setting('vale.del_a')::uuid,'Remove A'),(current_setting('vale.del_b')::uuid,'Keep B');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.del_b'),'role','authenticated','amr',json_build_array(json_build_object('method','password','timestamp',extract(epoch FROM now())::bigint)))::text,true);
DO $$ BEGIN
 DELETE FROM public.connections WHERE owner_id=current_setting('vale.del_a')::uuid;
 IF FOUND THEN RAISE EXCEPTION 'Another account deleted a connection'; END IF;
 IF (SELECT card_count FROM public.get_my_usage())<>0 THEN RAISE EXCEPTION 'Usage counted another account''s card'; END IF;
 IF (SELECT active_connection_count FROM public.get_my_usage())<>1 THEN RAISE EXCEPTION 'Usage counted another account''s connections'; END IF;
END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.del_a'),'role','authenticated','amr',json_build_array(json_build_object('method','password','timestamp',extract(epoch FROM now())::bigint)))::text,true);
DO $$
DECLARE u record;
BEGIN
 SELECT * INTO u FROM public.get_my_usage();
 IF u.plan_code<>'free' OR u.max_cards<>1 OR u.max_active_connections<>5 THEN RAISE EXCEPTION 'Wrong plan limits in usage'; END IF;
 IF u.card_count<>1 OR u.active_connection_count<>2 OR u.archived_connection_count<>1 THEN RAISE EXCEPTION 'Wrong usage counts'; END IF;
 DELETE FROM public.connections WHERE full_name='Remove A';
 IF NOT FOUND THEN RAISE EXCEPTION 'Owner could not delete a connection'; END IF;
 IF (SELECT active_connection_count FROM public.get_my_usage())<>1 THEN RAISE EXCEPTION 'Deletion not reflected in usage'; END IF;
 BEGIN PERFORM public.delete_my_account('wrong@example.invalid'); RAISE EXCEPTION 'CHECK: wrong email accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 IF NOT EXISTS(SELECT 1 FROM public.public_cards) THEN RAISE EXCEPTION 'Wrong email deleted data'; END IF;
END $$;
-- A sign-in older than ten minutes isn't enough, and a missing one isn't either.
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.del_a'),'role','authenticated','amr',json_build_array(json_build_object('method','password','timestamp',extract(epoch FROM now())::bigint-3600)))::text,true);
DO $$ BEGIN
 BEGIN PERFORM public.delete_my_account('del-a-'||current_setting('vale.del_a')||'@example.invalid'); RAISE EXCEPTION 'CHECK: old sign-in accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.del_a'),'role','authenticated')::text,true);
DO $$ BEGIN
 BEGIN PERFORM public.delete_my_account('del-a-'||current_setting('vale.del_a')||'@example.invalid'); RAISE EXCEPTION 'CHECK: missing sign-in accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
END $$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
DO $$ BEGIN
 BEGIN PERFORM public.delete_my_account('x@example.invalid'); RAISE EXCEPTION 'CHECK: visitor could call account deletion';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM * FROM public.get_my_usage(); RAISE EXCEPTION 'CHECK: visitor could read usage';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.del_a'),'role','authenticated','amr',json_build_array(json_build_object('method','password','timestamp',extract(epoch FROM now())::bigint)))::text,true);
SELECT public.delete_my_account(upper('del-a-'||current_setting('vale.del_a')||'@example.invalid'));
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM auth.users WHERE id=current_setting('vale.del_a')::uuid) THEN RAISE EXCEPTION 'Account not deleted'; END IF;
 IF EXISTS(SELECT 1 FROM public.public_cards WHERE owner_id=current_setting('vale.del_a')::uuid) THEN RAISE EXCEPTION 'Cards left behind'; END IF;
 IF EXISTS(SELECT 1 FROM public.connections WHERE owner_id=current_setting('vale.del_a')::uuid) THEN RAISE EXCEPTION 'Connections left behind'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.retired_card_slugs WHERE slug='del-card-'||current_setting('vale.del_a')) THEN RAISE EXCEPTION 'Deleted card link name not retired'; END IF;
 IF NOT EXISTS(SELECT 1 FROM auth.users WHERE id=current_setting('vale.del_b')::uuid) OR NOT EXISTS(SELECT 1 FROM public.connections WHERE owner_id=current_setting('vale.del_b')::uuid) THEN RAISE EXCEPTION 'Another account was affected'; END IF;
END $$;
SELECT 'PASS: own connection deletion; usage counts own records only; account deletion needs matching email and recent sign-in, cascades, retires link names and leaves other accounts alone. All fixtures rolled back.' AS result;
ROLLBACK;
