-- Transaction-only test of plan features. All fixtures roll back. Never run against production.
BEGIN;
SELECT set_config('vale.pf_free',gen_random_uuid()::text,true);
SELECT set_config('vale.pf_plus',gen_random_uuid()::text,true);
INSERT INTO auth.users(id,email) VALUES
(current_setting('vale.pf_free')::uuid,'pf-free-'||current_setting('vale.pf_free')||'@example.invalid'),
(current_setting('vale.pf_plus')::uuid,'pf-plus-'||current_setting('vale.pf_plus')||'@example.invalid');
INSERT INTO public.memberships(user_id,plan_code) VALUES(current_setting('vale.pf_plus')::uuid,'plus');
-- A record saved before moving to Free: history and meeting details already exist.
INSERT INTO public.connections(owner_id,full_name,history,met_where,introduced_by)
VALUES(current_setting('vale.pf_free')::uuid,'Downgraded','[{"date":"2026-01-01","text":"Keep me"}]','Synthetic expo','Synthetic friend');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.pf_free'),'role','authenticated')::text,true);
DO $$
DECLARE a uuid:=current_setting('vale.pf_free')::uuid;
BEGIN
 IF cardinality(public.get_my_features())<>0 THEN RAISE EXCEPTION 'Free should have no extra features'; END IF;
 -- Free includes notes, categories and follow-up dates.
 INSERT INTO public.connections(owner_id,full_name,notes,category,follow_up_on) VALUES(a,'Free basics','Private note','Customer','2026-12-01');
 UPDATE public.connections SET notes='Edited',category='Partner',follow_up_on='2026-12-02' WHERE full_name='Free basics';
 IF NOT FOUND THEN RAISE EXCEPTION 'Free could not edit basics'; END IF;
 BEGIN INSERT INTO public.connections(owner_id,full_name,history) VALUES(a,'H','[{"date":"2026-01-01","text":"x"}]'); RAISE EXCEPTION 'CHECK: Free added history';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 BEGIN UPDATE public.connections SET history='[{"date":"2026-01-01","text":"x"}]' WHERE full_name='Free basics'; RAISE EXCEPTION 'CHECK: Free changed history';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 BEGIN INSERT INTO public.connections(owner_id,full_name,met_where) VALUES(a,'M','Expo'); RAISE EXCEPTION 'CHECK: Free added meeting details';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 BEGIN UPDATE public.connections SET introduced_by='Someone' WHERE full_name='Free basics'; RAISE EXCEPTION 'CHECK: Free changed introducer';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 BEGIN UPDATE public.connections SET met_on='2026-01-01' WHERE full_name='Free basics'; RAISE EXCEPTION 'CHECK: Free changed meeting date';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 -- Data saved earlier stays readable, its other fields stay editable, and it can be archived.
 UPDATE public.connections SET notes='Edited after moving to Free' WHERE full_name='Downgraded';
 IF NOT FOUND THEN RAISE EXCEPTION 'Existing record not editable after moving to Free'; END IF;
 IF (SELECT history->0->>'text' FROM public.connections WHERE full_name='Downgraded')<>'Keep me' OR (SELECT met_where FROM public.connections WHERE full_name='Downgraded')<>'Synthetic expo' THEN RAISE EXCEPTION 'Saved details lost'; END IF;
 UPDATE public.connections SET archived_at=now() WHERE full_name='Downgraded';
 BEGIN UPDATE public.membership_plans SET features='{dated_history}'; RAISE EXCEPTION 'CHECK: client changed plan features';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.pf_plus'),'role','authenticated')::text,true);
DO $$
DECLARE b uuid:=current_setting('vale.pf_plus')::uuid;
BEGIN
 IF NOT ('meeting_details'=ANY(public.get_my_features())) OR NOT ('reminders'=ANY(public.get_my_features())) THEN RAISE EXCEPTION 'Plus features missing'; END IF;
 INSERT INTO public.connections(owner_id,full_name,history,met_on,met_where,met_how,introduced_by) VALUES(b,'Plus record','[{"date":"2026-01-01","text":"x"}]','2026-01-01','Expo','Trade show','Friend');
 UPDATE public.connections SET history=history||'[{"date":"2026-01-02","text":"y"}]',met_where='Elsewhere' WHERE full_name='Plus record';
 IF NOT FOUND THEN RAISE EXCEPTION 'Plus could not edit'; END IF;
END $$;
RESET ROLE;
-- Configurable: changing a plan's features changes what the server allows, with no code change.
UPDATE public.membership_plans SET features='{meeting_details}' WHERE code='free';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.pf_free'),'role','authenticated')::text,true);
DO $$ BEGIN
 UPDATE public.connections SET introduced_by='Now allowed' WHERE full_name='Free basics';
 IF NOT FOUND THEN RAISE EXCEPTION 'Configured feature not honored'; END IF;
END $$;
RESET ROLE;
SELECT 'PASS: Free keeps basics; history and meeting details need the feature; saved data survives a downgrade; plans are read-only to clients and configurable. All fixtures rolled back.' AS result;
ROLLBACK;
