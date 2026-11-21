-- Transaction-only test of admin_get_report: only an admin with two-step sign-in can open a report; any report can be
-- opened by its id, however many there are; the fields match the review list exactly; nothing about who reported.
-- All fixtures roll back. Never run against production.
BEGIN;
SELECT set_config('vale.o', gen_random_uuid()::text, true), set_config('vale.a', gen_random_uuid()::text, true),
 set_config('vale.n', gen_random_uuid()::text, true), set_config('vale.oc', gen_random_uuid()::text, true);
INSERT INTO auth.users(id, email) VALUES
 (current_setting('vale.o')::uuid, 'gr-o-' || current_setting('vale.o') || '@example.invalid'),
 (current_setting('vale.a')::uuid, 'gr-a-' || current_setting('vale.a') || '@example.invalid'),
 (current_setting('vale.n')::uuid, 'gr-n-' || current_setting('vale.n') || '@example.invalid');
INSERT INTO public.public_cards(id, owner_id, slug, display_name, published) VALUES
 (current_setting('vale.oc')::uuid, current_setting('vale.o')::uuid, 'gr-o-' || left(current_setting('vale.oc'), 8), 'Owner Synthetic', true);
INSERT INTO vale_private.platform_admins(user_id, note) VALUES (current_setting('vale.a')::uuid, 'test admin');
-- 250 open reports, more than the list returns at once (200). The list shows the oldest first, so the newest is past the first 200.
INSERT INTO vale_private.card_reports(submission_id, card_id, card_owner_id, card_slug, card_snapshot, category, details, reporter_email, network_hash, dedupe_key, created_at)
SELECT gen_random_uuid(), current_setting('vale.oc')::uuid, current_setting('vale.o')::uuid, 'gr-o-' || left(current_setting('vale.oc'), 8),
 '{"display_name":"Owner Synthetic"}', 'spam', 'report ' || i, CASE WHEN i = 250 THEN 'target@example.invalid' END, repeat('b', 64), 'k' || i,
 now() - make_interval(days => 300 - i)
FROM generate_series(1, 250) i;
SELECT set_config('vale.target', (SELECT id::text FROM vale_private.card_reports WHERE details = 'report 250'), true);

-- Visitors, the server role, ordinary accounts, and admins without two-step sign-in are refused.
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.admin_get_report(current_setting('vale.target')::uuid); RAISE EXCEPTION 'CHECK: a visitor opened a report';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM public.admin_get_report(current_setting('vale.target')::uuid); RAISE EXCEPTION 'CHECK: the server role opened a report';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.n'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
DO $$ BEGIN
 BEGIN PERFORM public.admin_get_report(current_setting('vale.target')::uuid); RAISE EXCEPTION 'CHECK: an ordinary account opened a report';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM LIKE '%two-step%' THEN RAISE EXCEPTION 'CHECK: a non-admin was asked for two-step sign-in'; END IF; END;
END $$;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.a'), 'role', 'authenticated', 'aal', 'aal1')::text, true);
DO $$ BEGIN
 BEGIN PERFORM public.admin_get_report(current_setting('vale.target')::uuid); RAISE EXCEPTION 'CHECK: an admin opened a report without two-step sign-in';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%two-step%' THEN RAISE EXCEPTION 'CHECK: unclear refusal: %', SQLERRM; END IF; END;
END $$;

-- An admin with two-step sign-in opens the newest of 250 reports, which the first 200 of the list don't include.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.a'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
DO $$ DECLARE one record; listed record; BEGIN
 IF EXISTS (SELECT 1 FROM public.admin_list_reports(NULL, 200, 0) l WHERE l.id = current_setting('vale.target')::uuid)
  THEN RAISE EXCEPTION 'CHECK: test setup: the report should be past the first 200'; END IF;
 IF (SELECT count(*) FROM public.admin_get_report(current_setting('vale.target')::uuid)) <> 1 THEN RAISE EXCEPTION 'CHECK: a report past the first 200 could not be opened'; END IF;
 SELECT * INTO one FROM public.admin_get_report(current_setting('vale.target')::uuid);
 SELECT * INTO listed FROM public.admin_list_reports(NULL, 200, 200) l WHERE l.id = current_setting('vale.target')::uuid;
 IF listed.id IS NULL OR to_jsonb(one) <> to_jsonb(listed) THEN RAISE EXCEPTION 'CHECK: the report differs from the review list'; END IF;
 IF one.details <> 'report 250' OR one.reporter_email <> 'target@example.invalid' OR one.reports_on_card <> 250 THEN RAISE EXCEPTION 'CHECK: the wrong report was returned'; END IF;
 IF (SELECT count(*) FROM public.admin_get_report(gen_random_uuid())) <> 0 THEN RAISE EXCEPTION 'CHECK: an unknown id returned a report'; END IF;
 IF (SELECT count(*) FROM public.admin_get_report(NULL)) <> 0 THEN RAISE EXCEPTION 'CHECK: no id returned a report'; END IF;
END $$;
RESET ROLE;
-- Same shape as the list, and nothing that identifies the reporter or the card's owner.
DO $$ BEGIN
 -- Refused above by the admin check; also never callable at all by visitors or the server role.
 IF has_function_privilege('anon', 'public.admin_get_report(uuid)', 'EXECUTE') OR has_function_privilege('service_role', 'public.admin_get_report(uuid)', 'EXECUTE')
  THEN RAISE EXCEPTION 'CHECK: visitors or the server role may call admin_get_report'; END IF;
 IF pg_get_function_result('public.admin_get_report(uuid)'::regprocedure) <>pg_get_function_result('public.admin_list_reports(text, integer, integer)'::regprocedure)
  THEN RAISE EXCEPTION 'CHECK: admin_get_report returns different fields from admin_list_reports'; END IF;
 IF pg_get_function_result('public.admin_get_report(uuid)'::regprocedure) ~ '(network_hash|card_owner_id|submission_id|dedupe_key)'
  THEN RAISE EXCEPTION 'CHECK: admin_get_report returns who reported or who owns the card'; END IF;
END $$;

SELECT 'PASS: any report opens by its id for an admin with two-step sign-in only, with the same fields as the list' AS test;
ROLLBACK;
