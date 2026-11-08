-- Transaction-only test of public card access and membership limits. All fixtures roll back.
-- Never run against production.
BEGIN;
SELECT set_config('vale.rule_a',gen_random_uuid()::text,true);
SELECT set_config('vale.rule_b',gen_random_uuid()::text,true);
INSERT INTO auth.users(id,email) VALUES
(current_setting('vale.rule_a')::uuid,'rule-a-'||current_setting('vale.rule_a')||'@example.invalid'),
(current_setting('vale.rule_b')::uuid,'rule-b-'||current_setting('vale.rule_b')||'@example.invalid');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.rule_a'),'role','authenticated')::text,true);
DO $$
DECLARE a uuid:=current_setting('vale.rule_a')::uuid; first_slug text:='rule-a-'||current_setting('vale.rule_a'); r public.public_cards;
BEGIN
 BEGIN INSERT INTO public.public_cards(owner_id,slug,display_name,published) VALUES(a,first_slug,'Synthetic',true); RAISE EXCEPTION 'CHECK: published insert allowed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 INSERT INTO public.public_cards(owner_id,slug,display_name,revision,updated_at) VALUES(a,first_slug,'Synthetic',99,'2001-01-01') RETURNING * INTO r;
 IF r.revision<>0 OR r.updated_at<'2020-01-01' THEN RAISE EXCEPTION 'Client set revision or timestamp on insert'; END IF;
 BEGIN INSERT INTO public.public_cards(owner_id,slug,display_name) VALUES(a,'second-'||current_setting('vale.rule_a'),'Second'); RAISE EXCEPTION 'CHECK: second Free card allowed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 UPDATE public.public_cards SET display_name='Edited',revision=50,updated_at='2001-01-01' WHERE slug=first_slug RETURNING * INTO r;
 IF r.revision<>1 OR r.updated_at<'2020-01-01' THEN RAISE EXCEPTION 'Client set revision or timestamp on update'; END IF;
 BEGIN UPDATE public.public_cards SET slug='renamed-'||current_setting('vale.rule_a') WHERE slug=first_slug; RAISE EXCEPTION 'CHECK: link name change allowed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 BEGIN UPDATE public.public_cards SET display_name='   ' WHERE slug=first_slug; RAISE EXCEPTION 'Blank display name allowed'; EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN UPDATE public.public_cards SET introduction=repeat('x',301) WHERE slug=first_slug; RAISE EXCEPTION 'Oversized introduction allowed'; EXCEPTION WHEN check_violation THEN NULL; END;
 UPDATE public.public_cards SET published=true WHERE slug=first_slug;
 -- Free's active-connection limit is reached exactly; one more isn't allowed; archiving frees a place.
 FOR i IN 1..(SELECT max_active_connections FROM public.membership_plans WHERE code='free') LOOP INSERT INTO public.connections(owner_id,full_name) VALUES(a,'Synthetic '||i); END LOOP;
 BEGIN INSERT INTO public.connections(owner_id,full_name) VALUES(a,'Sixth'); RAISE EXCEPTION 'CHECK: sixth Free connection allowed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 BEGIN INSERT INTO public.connections(owner_id,full_name,notes) VALUES(a,'Big',repeat('x',10001)); RAISE EXCEPTION 'CHECK: oversized notes or sixth connection allowed';
 EXCEPTION WHEN check_violation OR raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 UPDATE public.connections SET archived_at=now() WHERE full_name='Synthetic 1';
 INSERT INTO public.connections(owner_id,full_name) VALUES(a,'Replacement');
 BEGIN UPDATE public.connections SET archived_at=NULL WHERE full_name='Synthetic 1'; RAISE EXCEPTION 'CHECK: unarchive over the limit allowed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 UPDATE public.connections SET notes='Still editable' WHERE full_name='Synthetic 2';
 IF NOT FOUND THEN RAISE EXCEPTION 'Existing connection not editable at the limit'; END IF;
 -- Members can read, but not change, their plan.
 BEGIN INSERT INTO public.memberships(user_id,plan_code) VALUES(a,'plus'); RAISE EXCEPTION 'CHECK: client gave itself a plan';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.membership_plans SET max_cards=NULL; RAISE EXCEPTION 'CHECK: client changed plan limits';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT count(*) FROM public.membership_plans)<2 THEN RAISE EXCEPTION 'Plans not readable'; END IF;
 BEGIN PERFORM 1 FROM public.retired_card_slugs; RAISE EXCEPTION 'CHECK: retired names readable';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.rule_b'),'role','authenticated')::text,true);
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.public_cards WHERE owner_id=current_setting('vale.rule_a')::uuid) THEN RAISE EXCEPTION 'Another account can list published cards directly'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.get_public_card('rule-a-'||current_setting('vale.rule_a'))) THEN RAISE EXCEPTION 'Signed-in lookup failed'; END IF;
END $$;
SET LOCAL ROLE anon;
SELECT set_config('request.jwt.claims','{"role":"anon"}',true);
DO $$
DECLARE visible bigint; found_name text;
BEGIN
 BEGIN SELECT count(*) INTO visible FROM public.public_cards; RAISE EXCEPTION 'CHECK: anonymous table read allowed';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 SELECT display_name INTO found_name FROM public.get_public_card('rule-a-'||current_setting('vale.rule_a'));
 IF found_name IS DISTINCT FROM 'Edited' THEN RAISE EXCEPTION 'Anonymous lookup of a published card failed'; END IF;
 IF EXISTS(SELECT 1 FROM public.get_public_card('no-such-card')) THEN RAISE EXCEPTION 'Lookup invented a card'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM information_schema.routine_columns WHERE false) THEN NULL; END IF;
EXCEPTION WHEN undefined_table THEN NULL; END $$;
DO $$ BEGIN
 IF (SELECT pg_get_function_result('public.get_public_card(text)'::regprocedure)) ~ 'owner_id|card_label|revision' THEN RAISE EXCEPTION 'Lookup returns private fields'; END IF;
END $$;
INSERT INTO public.memberships(user_id,plan_code) VALUES(current_setting('vale.rule_b')::uuid,'plus');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims',json_build_object('sub',current_setting('vale.rule_b'),'role','authenticated')::text,true);
DO $$
DECLARE b uuid:=current_setting('vale.rule_b')::uuid; old_slug text:='rule-b-'||current_setting('vale.rule_b');
BEGIN
 FOR i IN 1..7 LOOP INSERT INTO public.connections(owner_id,full_name) VALUES(b,'Plus '||i); END LOOP;
 INSERT INTO public.public_cards(owner_id,slug,display_name) VALUES(b,old_slug,'One'),(b,old_slug||'-2','Two');
 IF (SELECT count(*) FROM public.memberships)<>1 THEN RAISE EXCEPTION 'Membership not readable, or another member visible'; END IF;
 -- A deleted card's link name can't be claimed again.
 DELETE FROM public.public_cards WHERE slug=old_slug;
 BEGIN INSERT INTO public.public_cards(owner_id,slug,display_name) VALUES(b,old_slug,'Reclaim'); RAISE EXCEPTION 'CHECK: retired link name reused';
 EXCEPTION WHEN unique_violation THEN NULL; END;
END $$;
RESET ROLE;
SELECT 'PASS: public cards readable only by lookup with public fields; drafts-first; link names fixed and never reused; server-set revisions; field limits; Free and Plus limits; archiving; plans read-only. All fixtures rolled back.' AS result;
ROLLBACK;
