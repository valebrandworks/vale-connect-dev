-- Transaction-only test of relationship details. All fixtures roll back. Never run against production.
BEGIN;
SELECT set_config('vale.rel_a',gen_random_uuid()::text,true);
SELECT set_config('vale.rel_b',gen_random_uuid()::text,true);
INSERT INTO auth.users(id,email) VALUES
(current_setting('vale.rel_a')::uuid,'rel-a-'||current_setting('vale.rel_a')||'@example.invalid'),
(current_setting('vale.rel_b')::uuid,'rel-b-'||current_setting('vale.rel_b')||'@example.invalid');
INSERT INTO public.memberships(user_id,plan_code) VALUES(current_setting('vale.rel_a')::uuid,'plus');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.rel_a'),'role','authenticated')::text,true);
DO $$ BEGIN
 INSERT INTO public.connections(owner_id,full_name,met_on,met_where,met_how,introduced_by) VALUES(current_setting('vale.rel_a')::uuid,'Synthetic','2026-01-15','Synthetic expo','Trade show','Synthetic friend');
 IF (SELECT met_where FROM public.connections WHERE full_name='Synthetic')<>'Synthetic expo' THEN RAISE EXCEPTION 'Details not saved'; END IF;
 INSERT INTO public.connections(owner_id,full_name) VALUES(current_setting('vale.rel_a')::uuid,'No details');
 IF (SELECT met_on FROM public.connections WHERE full_name='No details') IS NOT NULL OR (SELECT introduced_by FROM public.connections WHERE full_name='No details')<>'' THEN RAISE EXCEPTION 'Details should be optional'; END IF;
 BEGIN UPDATE public.connections SET introduced_by=repeat('x',121) WHERE full_name='Synthetic'; RAISE EXCEPTION 'CHECK: oversized introducer allowed'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.connections SET met_where=repeat('x',201) WHERE full_name='Synthetic'; RAISE EXCEPTION 'CHECK: oversized place allowed'; EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.rel_b'),'role','authenticated')::text,true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.connections WHERE met_where='Synthetic expo') THEN RAISE EXCEPTION 'Details visible to another account'; END IF;
END $$;
RESET ROLE;
SELECT 'PASS: relationship details are optional, limited in size and private to their owner. All fixtures rolled back.' AS result;
ROLLBACK;
