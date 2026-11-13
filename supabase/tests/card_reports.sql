-- Transaction-only test of Report This Card (stage A): who can do what, validation, merging, rate limits, blocks,
-- admin two-step requirement, every admin decision and its log, hidden cards, owner notices, email alert throttling,
-- retention and account deletion. All fixtures roll back. Never run against production.
BEGIN;
SELECT set_config('vale.o', gen_random_uuid()::text, true), set_config('vale.a', gen_random_uuid()::text, true),
 set_config('vale.n', gen_random_uuid()::text, true), set_config('vale.x', gen_random_uuid()::text, true);
SELECT set_config('vale.oc', gen_random_uuid()::text, true), set_config('vale.od', gen_random_uuid()::text, true), set_config('vale.xc', gen_random_uuid()::text, true);
INSERT INTO auth.users(id, email) VALUES
 (current_setting('vale.o')::uuid, 'cr-o-' || current_setting('vale.o') || '@example.invalid'),
 (current_setting('vale.a')::uuid, 'cr-a-' || current_setting('vale.a') || '@example.invalid'),
 (current_setting('vale.n')::uuid, 'cr-n-' || current_setting('vale.n') || '@example.invalid'),
 (current_setting('vale.x')::uuid, 'cr-x-' || current_setting('vale.x') || '@example.invalid');
INSERT INTO public.public_cards(id, owner_id, slug, display_name, job_title, public_email, published) VALUES
 (current_setting('vale.oc')::uuid, current_setting('vale.o')::uuid, 'cr-o-' || left(current_setting('vale.oc'), 8), 'Owner Synthetic', 'Owner', 'owner@example.invalid', true),
 (current_setting('vale.od')::uuid, current_setting('vale.o')::uuid, 'cr-d-' || left(current_setting('vale.od'), 8), 'Draft Synthetic', '', '', false),
 (current_setting('vale.xc')::uuid, current_setting('vale.x')::uuid, 'cr-x-' || left(current_setting('vale.xc'), 8), 'Other Synthetic', '', '', true);
INSERT INTO vale_private.platform_admins(user_id, note) VALUES (current_setting('vale.a')::uuid, 'test admin');
CREATE FUNCTION pg_temp.slug(card text) RETURNS text LANGUAGE sql AS $$ SELECT slug FROM public.public_cards WHERE id = current_setting(card)::uuid $$;
SELECT set_config('vale.os', pg_temp.slug('vale.oc'), true), set_config('vale.ds', pg_temp.slug('vale.od'), true), set_config('vale.xs', pg_temp.slug('vale.xc'), true);
-- Network hashes are 64 hex characters, as made by the server function.
CREATE FUNCTION pg_temp.net(c text) RETURNS text LANGUAGE sql AS $$ SELECT repeat(c, 64) $$;
-- Report as the server role, which has no table access of its own, only this function. Call it from the test's own role.
CREATE FUNCTION pg_temp.report(slug text, cat text, details text DEFAULT '', net text DEFAULT 'a', email text DEFAULT NULL,
  attested boolean DEFAULT true, sub uuid DEFAULT gen_random_uuid())
 RETURNS text LANGUAGE plpgsql AS $$
 DECLARE r text;
 BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  r := public.submit_card_report(slug, sub, cat, details, email, attested, CASE WHEN length(net) = 1 THEN repeat(net, 64) ELSE net END);
  EXECUTE 'RESET ROLE';
  RETURN r;
 END $$;
CREATE FUNCTION pg_temp.reports(card text) RETURNS integer LANGUAGE sql AS $$ SELECT count(*)::int FROM vale_private.card_reports WHERE card_id = current_setting(card)::uuid $$;

-- A. Nobody reaches reports directly: visitors, accounts and the server role have no access to the tables.
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.submit_card_report(current_setting('vale.os'), gen_random_uuid(), 'spam', '', NULL, true, repeat('a', 64)); RAISE EXCEPTION 'CHECK: a visitor called submit_card_report directly';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM vale_private.card_reports; RAISE EXCEPTION 'CHECK: a visitor read reports'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.admin_list_reports(); RAISE EXCEPTION 'CHECK: a visitor listed reports'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.get_my_card_holds(); RAISE EXCEPTION 'CHECK: a visitor called get_my_card_holds'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.claim_report_alert(); RAISE EXCEPTION 'CHECK: a visitor claimed an alert'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 BEGIN PERFORM 1 FROM vale_private.card_reports; RAISE EXCEPTION 'CHECK: the server role read reports'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM vale_private.platform_admins; RAISE EXCEPTION 'CHECK: the server role read the admin list'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE vale_private.report_settings SET value = 1000; RAISE EXCEPTION 'CHECK: the server role changed report limits'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.admin_list_reports(); RAISE EXCEPTION 'CHECK: the server role listed reports'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM vale_private.purge_reports(); RAISE EXCEPTION 'CHECK: the server role ran the cleanup'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.n'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
DO $$ BEGIN
 BEGIN PERFORM public.submit_card_report(current_setting('vale.os'), gen_random_uuid(), 'spam', '', NULL, true, repeat('a', 64)); RAISE EXCEPTION 'CHECK: an account called submit_card_report directly';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.claim_report_alert(); RAISE EXCEPTION 'CHECK: an account claimed an alert'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM vale_private.card_reports; RAISE EXCEPTION 'CHECK: an account read reports'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM vale_private.card_holds; RAISE EXCEPTION 'CHECK: an account read hidden cards'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM vale_private.moderation_actions; RAISE EXCEPTION 'CHECK: an account read the moderation log'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO vale_private.platform_admins(user_id) VALUES (current_setting('vale.n')::uuid); RAISE EXCEPTION 'CHECK: an account made itself an admin';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM vale_private.require_admin(); RAISE EXCEPTION 'CHECK: an account called the admin check directly'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 -- A signed-in account that isn't an admin, even with two-step sign-in, is refused by every admin function.
 BEGIN PERFORM public.admin_list_reports(); RAISE EXCEPTION 'CHECK: a member listed reports'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.admin_report_history(gen_random_uuid()); RAISE EXCEPTION 'CHECK: a member read history'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.admin_set_report_status(gen_random_uuid(), 'dismissed', 'x'); RAISE EXCEPTION 'CHECK: a member changed a status'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.admin_add_note(gen_random_uuid(), 'x'); RAISE EXCEPTION 'CHECK: a member added a note'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.admin_hide_card(gen_random_uuid(), 'x', 'x'); RAISE EXCEPTION 'CHECK: a member hid a card'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.admin_restore_card(current_setting('vale.oc')::uuid, 'x'); RAISE EXCEPTION 'CHECK: a member restored a card'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.admin_set_legal_hold(gen_random_uuid(), true, 'x'); RAISE EXCEPTION 'CHECK: a member set a legal hold'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM public.admin_block_reporter(gen_random_uuid(), true, 'x'); RAISE EXCEPTION 'CHECK: a member blocked a reporter'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT count(*) FROM public.get_my_card_holds()) <> 0 THEN RAISE EXCEPTION 'CHECK: a member saw hidden cards that aren''t theirs'; END IF;
END $$;
RESET ROLE;

-- B. Validation: consent to accuracy, known category, sizes, email shape and a real network hash. Only public cards.
DO $$ BEGIN
 IF pg_temp.report(current_setting('vale.os'), 'spam', '', 'a', NULL, false) <> 'invalid' THEN RAISE EXCEPTION 'CHECK: stored without the accuracy confirmation'; END IF;
 IF pg_temp.report(current_setting('vale.os'), 'rude') <> 'invalid' THEN RAISE EXCEPTION 'CHECK: unknown category accepted'; END IF;
 IF pg_temp.report(current_setting('vale.os'), NULL) <> 'invalid' THEN RAISE EXCEPTION 'CHECK: missing category accepted'; END IF;
 IF pg_temp.report(current_setting('vale.os'), 'spam', repeat('x', 1001)) <> 'invalid' THEN RAISE EXCEPTION 'CHECK: 1,001-character explanation accepted'; END IF;
 IF pg_temp.report(current_setting('vale.os'), 'spam', '', 'a', 'not-an-email') <> 'invalid' THEN RAISE EXCEPTION 'CHECK: bad email accepted'; END IF;
 IF pg_temp.report(current_setting('vale.os'), 'spam', '', '203.0.113.9') <> 'invalid' THEN RAISE EXCEPTION 'CHECK: a raw address was accepted as the network'; END IF;
 IF pg_temp.report(current_setting('vale.os'), 'spam', '', '') <> 'invalid' THEN RAISE EXCEPTION 'CHECK: missing network accepted'; END IF;
 IF pg_temp.report(current_setting('vale.ds'), 'spam') <> 'unavailable' THEN RAISE EXCEPTION 'CHECK: a private draft could be reported'; END IF;
 IF pg_temp.report('no-such-card-xyz', 'spam') <> 'unavailable' THEN RAISE EXCEPTION 'CHECK: an unknown card could be reported'; END IF;
 IF (SELECT count(*) FROM vale_private.card_reports) <> 0 OR (SELECT count(*) FROM vale_private.report_attempts) <> 0 THEN RAISE EXCEPTION 'CHECK: invalid reports left records'; END IF;
END $$;

-- C. A valid report is stored once, with the card's public details only, cleaned text and a lower-case email.
DO $$ DECLARE r record; BEGIN
 PERFORM set_config('vale.sub1', gen_random_uuid()::text, true);
 IF pg_temp.report(current_setting('vale.os'), 'impersonation', E'  Pretends\tto be  me  ', 'a', ' Reporter@Example.INVALID ', true, current_setting('vale.sub1')::uuid) <> 'stored' THEN RAISE EXCEPTION 'CHECK: valid report not stored'; END IF;
 IF pg_temp.report(current_setting('vale.os'), 'impersonation', 'Pretends to be me', 'a', NULL, true, current_setting('vale.sub1')::uuid) <> 'repeat_submission' THEN RAISE EXCEPTION 'CHECK: a retried submission was not recognised'; END IF;
 SELECT * INTO r FROM vale_private.card_reports WHERE card_id = current_setting('vale.oc')::uuid;
 IF pg_temp.reports('vale.oc') <> 1 OR r.status <> 'new' OR r.repeat_count <> 1 THEN RAISE EXCEPTION 'CHECK: retry stored twice'; END IF;
 IF r.details ~ '[[:cntrl:]]' OR r.details <> btrim(r.details) THEN RAISE EXCEPTION 'CHECK: explanation not cleaned: %', r.details; END IF;
 IF r.reporter_email <> 'reporter@example.invalid' THEN RAISE EXCEPTION 'CHECK: email not normalised'; END IF;
 IF r.card_owner_id <> current_setting('vale.o')::uuid OR r.card_slug <> current_setting('vale.os') THEN RAISE EXCEPTION 'CHECK: card not recorded'; END IF;
 IF r.card_snapshot->>'display_name' <> 'Owner Synthetic' OR r.card_snapshot ? 'owner_id' OR r.card_snapshot ? 'published' OR r.card_snapshot ? 'revision'
    OR r.card_snapshot ? 'card_label' OR r.card_snapshot ? 'photo_path' OR r.card_snapshot ? 'slug' THEN RAISE EXCEPTION 'CHECK: snapshot holds private fields: %', r.card_snapshot; END IF;
 IF r.network_hash <> repeat('a', 64) THEN RAISE EXCEPTION 'CHECK: network hash not stored as given'; END IF;
END $$;

-- D. Repeats merge; distinct reports are kept; floods are limited per network, per card, and for one card overall.
DO $$ BEGIN
 IF pg_temp.report(current_setting('vale.os'), 'impersonation', 'PRETENDS  to be ME') <> 'merged' THEN RAISE EXCEPTION 'CHECK: an identical repeat was stored again'; END IF;
 IF (SELECT repeat_count FROM vale_private.card_reports WHERE card_id = current_setting('vale.oc')::uuid) <> 2 THEN RAISE EXCEPTION 'CHECK: repeat not counted'; END IF;
 IF pg_temp.report(current_setting('vale.os'), 'scam', 'Asked me for a deposit') <> 'stored' THEN RAISE EXCEPTION 'CHECK: a distinct report from the same network was lost'; END IF;
 IF pg_temp.reports('vale.oc') <> 2 THEN RAISE EXCEPTION 'CHECK: distinct reports not both kept'; END IF;
 -- Network a has now made 3 attempts on this card today: the 4th is limited and not stored.
 IF pg_temp.report(current_setting('vale.os'), 'spam', 'Another one') <> 'limited' THEN RAISE EXCEPTION 'CHECK: per-card network limit not applied'; END IF;
 IF pg_temp.reports('vale.oc') <> 2 THEN RAISE EXCEPTION 'CHECK: a limited report was stored'; END IF;
 -- Network c: 3 on one card and 2 on another make 5 today; the 6th, on any card, is limited.
 PERFORM pg_temp.report(current_setting('vale.os'), 'spam', 'c1', 'c'), pg_temp.report(current_setting('vale.os'), 'spam', 'c2', 'c'), pg_temp.report(current_setting('vale.os'), 'spam', 'c3', 'c');
 PERFORM pg_temp.report(current_setting('vale.xs'), 'spam', 'c4', 'c'), pg_temp.report(current_setting('vale.xs'), 'spam', 'c5', 'c');
 IF pg_temp.report(current_setting('vale.xs'), 'spam', 'c6', 'c') <> 'limited' THEN RAISE EXCEPTION 'CHECK: per-network daily limit not applied'; END IF;
 -- Everyone together: with the card limit at 7, the 8th attempt on this card today is limited.
 UPDATE vale_private.report_settings SET value = 7 WHERE name = 'card_all_per_day';
 IF pg_temp.report(current_setting('vale.os'), 'other', 'd1', 'd') <> 'limited' THEN RAISE EXCEPTION 'CHECK: per-card daily limit not applied'; END IF;
 IF pg_temp.report(current_setting('vale.xs'), 'other', 'd2', 'd') <> 'stored' THEN RAISE EXCEPTION 'CHECK: the card limit blocked another card'; END IF;
 UPDATE vale_private.report_settings SET value = 50 WHERE name = 'card_all_per_day';
 -- Yesterday's attempts don't count.
 UPDATE vale_private.report_attempts SET created_at = now() - interval '25 hours' WHERE network_hash = repeat('a', 64);
 IF pg_temp.report(current_setting('vale.os'), 'spam', 'A new day') <> 'stored' THEN RAISE EXCEPTION 'CHECK: old attempts still counted'; END IF;
 -- Many reports never hide a card on their own.
 IF NOT (SELECT published FROM public.public_cards WHERE id = current_setting('vale.oc')::uuid) OR EXISTS (SELECT 1 FROM vale_private.card_holds)
 THEN RAISE EXCEPTION 'CHECK: reports hid a card without an admin decision'; END IF;
END $$;

-- E. Email alerts: at most one per hour, and only for new reports since the last alert.
DO $$ DECLARE ok boolean; BEGIN
 EXECUTE 'SET LOCAL ROLE service_role';
 ok := public.claim_report_alert();
 IF NOT ok THEN RAISE EXCEPTION 'CHECK: no alert for new reports'; END IF;
 IF public.claim_report_alert() THEN RAISE EXCEPTION 'CHECK: a second alert within the hour'; END IF;
 EXECUTE 'RESET ROLE';
 UPDATE vale_private.report_alerts SET last_sent_at = now() - interval '61 minutes';
 EXECUTE 'SET LOCAL ROLE service_role';
 IF NOT public.claim_report_alert() THEN RAISE EXCEPTION 'CHECK: no alert after an hour with new reports waiting'; END IF;
 EXECUTE 'RESET ROLE';
 UPDATE vale_private.report_alerts SET last_sent_at = now() - interval '61 minutes';
 UPDATE vale_private.card_reports SET last_reported_at = now() - interval '2 hours';
 EXECUTE 'SET LOCAL ROLE service_role';
 IF public.claim_report_alert() THEN RAISE EXCEPTION 'CHECK: an alert with nothing new'; END IF;
 EXECUTE 'RESET ROLE';
END $$;

-- F. An admin without two-step sign-in is refused, with a clear reason.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.a'), 'role', 'authenticated', 'aal', 'aal1')::text, true);
DO $$ BEGIN
 BEGIN PERFORM public.admin_list_reports(); RAISE EXCEPTION 'CHECK: an admin listed reports without two-step sign-in';
 EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM NOT LIKE '%two-step%' THEN RAISE EXCEPTION 'CHECK: unclear refusal: %', SQLERRM; END IF; END;
 BEGIN PERFORM public.admin_restore_card(current_setting('vale.oc')::uuid, 'x'); RAISE EXCEPTION 'CHECK: an admin acted without two-step sign-in';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.a'), 'role', 'authenticated')::text, true);
DO $$ BEGIN
 BEGIN PERFORM public.admin_list_reports(); RAISE EXCEPTION 'CHECK: an admin listed reports with no assurance level';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- G. An admin with two-step sign-in reviews, decides and documents. Every decision is logged.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.a'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
DO $$ DECLARE first uuid; second uuid; r record; n integer; BEGIN
 SELECT l.id INTO first FROM public.admin_list_reports() l WHERE l.card_id = current_setting('vale.oc')::uuid AND l.category = 'impersonation';
 SELECT l.id INTO second FROM public.admin_list_reports() l WHERE l.card_id = current_setting('vale.oc')::uuid AND l.category = 'scam';
 SELECT * INTO r FROM public.admin_list_reports() l WHERE l.id = first;
 IF first IS NULL OR r.reporter_email <> 'reporter@example.invalid' OR r.repeat_count <> 2 OR NOT r.card_published OR r.card_hidden
    OR r.card_current->>'display_name' <> 'Owner Synthetic' OR r.reports_on_card < 2 THEN RAISE EXCEPTION 'CHECK: the review list is incomplete'; END IF;
 IF (SELECT count(*) FROM public.admin_list_reports('new', 2)) <> 2 THEN RAISE EXCEPTION 'CHECK: the list limit was ignored'; END IF;
 -- Statuses: closing needs a note; the reporter's email isn't kept once closed.
 PERFORM public.admin_set_report_status(first, 'reviewing', '');
 BEGIN PERFORM public.admin_set_report_status(first, 'dismissed', '  '); RAISE EXCEPTION 'CHECK: dismissed without a note';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.admin_set_report_status(first, 'closed', 'x'); RAISE EXCEPTION 'CHECK: unknown status accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 PERFORM public.admin_set_report_status(first, 'dismissed', 'Owner verified; not impersonation.');
 SELECT * INTO r FROM public.admin_list_reports() l WHERE l.id = first;
 IF r.status <> 'dismissed' OR r.closed_at IS NULL OR r.reporter_email IS NOT NULL THEN RAISE EXCEPTION 'CHECK: dismissal not recorded, or email kept'; END IF;
 IF (SELECT reporter_dismissed FROM public.admin_list_reports() l WHERE l.id = second) <> 1 THEN RAISE EXCEPTION 'CHECK: the reporter''s dismissed count is missing'; END IF;
 PERFORM public.admin_add_note(second, 'Checking with the owner.');
 BEGIN PERFORM public.admin_add_note(second, ''); RAISE EXCEPTION 'CHECK: an empty note was logged';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 -- Hide the card: needs an explanation for the owner and a note.
 BEGIN PERFORM public.admin_hide_card(second, '', 'note'); RAISE EXCEPTION 'CHECK: hidden without an explanation for the owner';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.admin_hide_card(second, 'Explanation', ''); RAISE EXCEPTION 'CHECK: hidden without a note';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 PERFORM public.admin_hide_card(second, 'This card asked visitors for payment details. Remove the request and appeal to support.', 'Confirmed scam wording on the card.');
 BEGIN PERFORM public.admin_hide_card(second, 'Again', 'Again'); RAISE EXCEPTION 'CHECK: hidden twice';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 SELECT * INTO r FROM public.admin_list_reports() l WHERE l.id = second;
 IF r.status <> 'action_taken' OR r.closed_at IS NULL OR NOT r.card_hidden OR r.card_published THEN RAISE EXCEPTION 'CHECK: hiding did not take effect'; END IF;
 PERFORM public.admin_set_legal_hold(second, true, 'Kept for a records request.');
 BEGIN PERFORM public.admin_set_legal_hold(second, true, 'again'); RAISE EXCEPTION 'CHECK: legal hold set twice';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 PERFORM set_config('vale.first', first::text, true), set_config('vale.second', second::text, true);
 SELECT count(*) INTO n FROM public.admin_report_history(second);
 IF n < 4 OR EXISTS (SELECT 1 FROM public.admin_report_history(second) h WHERE h.admin_email IS NULL OR h.admin_email NOT LIKE 'cr-a-%') THEN RAISE EXCEPTION 'CHECK: the history is incomplete (% entries)', n; END IF;
END $$;
RESET ROLE;

-- H. A hidden card is gone from every public path, and its owner can't publish it again but can still edit it.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.get_public_card(current_setting('vale.os'))) THEN RAISE EXCEPTION 'CHECK: a hidden card is still public'; END IF;
 IF pg_temp.report(current_setting('vale.os'), 'spam', 'hidden', 'f') <> 'unavailable' THEN RAISE EXCEPTION 'CHECK: a hidden card could still be reported'; END IF;
END $$;
SET LOCAL ROLE service_role;
DO $$ BEGIN
 IF public.record_share(current_setting('vale.os'), gen_random_uuid(), true, 'v1', '{"full_name":"V","email":"v@example.invalid"}', NULL, NULL, NULL, repeat('f', 64), '') <> 'unavailable'
 THEN RAISE EXCEPTION 'CHECK: a hidden card still accepts shares'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.o'), 'role', 'authenticated')::text, true);
DO $$ DECLARE h record; BEGIN
 SELECT * INTO h FROM public.get_my_card_holds();
 IF h.card_id <> current_setting('vale.oc')::uuid OR h.category <> 'scam' OR h.owner_message NOT LIKE 'This card asked visitors%' THEN RAISE EXCEPTION 'CHECK: the owner wasn''t told why'; END IF;
END $$;
DO $$ BEGIN
 -- The owner's view has exactly these columns: nothing about who reported or what they wrote.
 IF (SELECT array_to_string(proargnames, ',') FROM pg_proc WHERE oid = 'public.get_my_card_holds()'::regprocedure) <> 'card_id,hidden_at,category,owner_message'
 THEN RAISE EXCEPTION 'CHECK: the owner''s hidden-card view exposes more than the reason'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE kind = 'card_hidden' AND card_id = current_setting('vale.oc')::uuid AND owner_id = current_setting('vale.o')::uuid)
 THEN RAISE EXCEPTION 'CHECK: the owner got no notice'; END IF;
 UPDATE public.public_cards SET job_title = 'Fixed title' WHERE id = current_setting('vale.oc')::uuid;
 IF NOT FOUND THEN RAISE EXCEPTION 'CHECK: the owner couldn''t edit a hidden card'; END IF;
 BEGIN UPDATE public.public_cards SET published = true WHERE id = current_setting('vale.oc')::uuid; RAISE EXCEPTION 'CHECK: the owner republished a hidden card';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; IF SQLERRM NOT LIKE '%appeal%' THEN RAISE EXCEPTION 'CHECK: no appeal route in: %', SQLERRM; END IF; END;
 IF (SELECT published FROM public.public_cards WHERE id = current_setting('vale.oc')::uuid) THEN RAISE EXCEPTION 'CHECK: hidden card is published'; END IF;
END $$;
-- Another account sees nothing of it.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.x'), 'role', 'authenticated')::text, true);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.get_my_card_holds()) OR EXISTS (SELECT 1 FROM public.notifications WHERE kind = 'card_hidden') THEN RAISE EXCEPTION 'CHECK: another account saw the hidden card'; END IF;
END $$;

-- I. Blocking a reporter, and restoring a card.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.a'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
DO $$ BEGIN
 PERFORM public.admin_block_reporter(current_setting('vale.first')::uuid, true, 'Repeated false impersonation reports.');
 BEGIN PERFORM public.admin_block_reporter(current_setting('vale.first')::uuid, true, 'again'); RAISE EXCEPTION 'CHECK: blocked twice';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 IF NOT (SELECT reporter_blocked FROM public.admin_list_reports() l WHERE l.id = current_setting('vale.first')::uuid) THEN RAISE EXCEPTION 'CHECK: block not shown'; END IF;
 BEGIN PERFORM public.admin_restore_card(current_setting('vale.xc')::uuid, 'x'); RAISE EXCEPTION 'CHECK: restored a card that wasn''t hidden';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 BEGIN PERFORM public.admin_restore_card(current_setting('vale.oc')::uuid, ''); RAISE EXCEPTION 'CHECK: restored without a note';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 PERFORM public.admin_restore_card(current_setting('vale.oc')::uuid, 'Owner removed the payment request.');
END $$;
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.get_public_card(current_setting('vale.os'))) THEN RAISE EXCEPTION 'CHECK: restored card isn''t public'; END IF;
 IF EXISTS (SELECT 1 FROM vale_private.card_holds) THEN RAISE EXCEPTION 'CHECK: hold not removed'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE kind = 'card_restored' AND card_id = current_setting('vale.oc')::uuid) THEN RAISE EXCEPTION 'CHECK: owner not told of the restore'; END IF;
 -- The blocked network's reports are quietly not stored; others still are.
 IF pg_temp.report(current_setting('vale.xs'), 'harassment', 'blocked one', 'a') <> 'blocked' THEN RAISE EXCEPTION 'CHECK: a blocked network''s report was accepted'; END IF;
 IF EXISTS (SELECT 1 FROM vale_private.card_reports WHERE details = 'blocked one') THEN RAISE EXCEPTION 'CHECK: a blocked report was stored'; END IF;
 IF (SELECT count(*) FROM vale_private.moderation_actions WHERE admin_id = current_setting('vale.a')::uuid) < 8 THEN RAISE EXCEPTION 'CHECK: decisions missing from the log'; END IF;
 IF EXISTS (SELECT 1 FROM vale_private.moderation_actions WHERE action IN ('hide_card', 'restore_card', 'block_reporter', 'legal_hold', 'note') AND note = '') THEN RAISE EXCEPTION 'CHECK: a decision was logged without a note'; END IF;
END $$;
-- The restored card's owner can unpublish and publish it as usual.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.o'), 'role', 'authenticated')::text, true);
UPDATE public.public_cards SET published = false WHERE id = current_setting('vale.oc')::uuid;
UPDATE public.public_cards SET published = true WHERE id = current_setting('vale.oc')::uuid;
RESET ROLE;

-- J. Retention: closed reports, rate-limit records, the log and blocks go after their periods; open reports, legal
-- holds and the reason a card is still hidden stay.
DO $$ DECLARE kept uuid; held uuid; open_old uuid; hid uuid; BEGIN
 INSERT INTO vale_private.card_reports(submission_id, card_id, card_owner_id, card_slug, card_snapshot, category, network_hash, dedupe_key, status, closed_at, created_at) VALUES
  (gen_random_uuid(), current_setting('vale.xc')::uuid, current_setting('vale.x')::uuid, 's', '{}', 'spam', repeat('1', 64), 'k1', 'dismissed', now() - interval '91 days', now() - interval '100 days'),
  (gen_random_uuid(), current_setting('vale.xc')::uuid, current_setting('vale.x')::uuid, 's', '{}', 'spam', repeat('2', 64), 'k2', 'action_taken', now() - interval '366 days', now() - interval '400 days');
 INSERT INTO vale_private.card_reports(submission_id, card_id, card_owner_id, card_slug, card_snapshot, category, network_hash, dedupe_key, status, closed_at)
  VALUES (gen_random_uuid(), current_setting('vale.xc')::uuid, current_setting('vale.x')::uuid, 's', '{}', 'spam', repeat('3', 64), 'k3', 'dismissed', now() - interval '89 days') RETURNING id INTO kept;
 INSERT INTO vale_private.card_reports(submission_id, card_id, card_owner_id, card_slug, card_snapshot, category, network_hash, dedupe_key, status, closed_at, legal_hold)
  VALUES (gen_random_uuid(), current_setting('vale.xc')::uuid, current_setting('vale.x')::uuid, 's', '{}', 'spam', repeat('4', 64), 'k4', 'dismissed', now() - interval '400 days', true) RETURNING id INTO held;
 INSERT INTO vale_private.card_reports(submission_id, card_id, card_owner_id, card_slug, card_snapshot, category, network_hash, dedupe_key, created_at)
  VALUES (gen_random_uuid(), current_setting('vale.xc')::uuid, current_setting('vale.x')::uuid, 's', '{}', 'spam', repeat('5', 64), 'k5', now() - interval '900 days') RETURNING id INTO open_old;
 INSERT INTO vale_private.card_reports(submission_id, card_id, card_owner_id, card_slug, card_snapshot, category, network_hash, dedupe_key, status, closed_at)
  VALUES (gen_random_uuid(), current_setting('vale.xc')::uuid, current_setting('vale.x')::uuid, 's', '{}', 'spam', repeat('6', 64), 'k6', 'action_taken', now() - interval '400 days') RETURNING id INTO hid;
 INSERT INTO vale_private.card_holds(card_id, report_id, category, owner_message) VALUES (current_setting('vale.xc')::uuid, hid, 'spam', 'Hidden long ago');
 INSERT INTO vale_private.report_attempts(card_id, network_hash, created_at) VALUES (current_setting('vale.xc')::uuid, repeat('7', 64), now() - interval '31 days');
 INSERT INTO vale_private.moderation_actions(action, report_id, note, created_at) VALUES ('note', held, 'held log', now() - interval '400 days'), ('note', NULL, 'old log', now() - interval '366 days');
 INSERT INTO vale_private.moderation_actions(action, card_id, note, created_at) VALUES ('hide_card', current_setting('vale.xc')::uuid, 'still hidden log', now() - interval '400 days');
 INSERT INTO vale_private.blocked_reporters(network_hash, reason, blocked_at) VALUES (repeat('8', 64), 'old block', now() - interval '366 days');
 PERFORM vale_private.purge_reports();
 IF EXISTS (SELECT 1 FROM vale_private.card_reports WHERE dedupe_key IN ('k1', 'k2')) THEN RAISE EXCEPTION 'CHECK: expired closed reports kept'; END IF;
 IF (SELECT count(*) FROM vale_private.card_reports WHERE id IN (kept, held, open_old, hid)) <> 4 THEN RAISE EXCEPTION 'CHECK: a report that should stay was deleted'; END IF;
 IF EXISTS (SELECT 1 FROM vale_private.report_attempts WHERE network_hash = repeat('7', 64)) THEN RAISE EXCEPTION 'CHECK: old rate-limit records kept'; END IF;
 IF EXISTS (SELECT 1 FROM vale_private.moderation_actions WHERE note = 'old log') OR NOT EXISTS (SELECT 1 FROM vale_private.moderation_actions WHERE note = 'held log')
    OR NOT EXISTS (SELECT 1 FROM vale_private.moderation_actions WHERE note = 'still hidden log') THEN RAISE EXCEPTION 'CHECK: log retention wrong'; END IF;
 IF EXISTS (SELECT 1 FROM vale_private.blocked_reporters WHERE network_hash = repeat('8', 64)) THEN RAISE EXCEPTION 'CHECK: expired block kept'; END IF;
 IF EXISTS (SELECT 1 FROM vale_private.blocked_reporters WHERE network_hash = repeat('a', 64)) IS NOT TRUE THEN RAISE EXCEPTION 'CHECK: a current block was removed'; END IF;
 -- A closed report can't keep the reporter's email.
 BEGIN UPDATE vale_private.card_reports SET reporter_email = 'r@example.invalid' WHERE id = kept; RAISE EXCEPTION 'CHECK: email stored on a closed report';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- K. Deleting accounts and cards keeps the evidence: the report and snapshot stay, the links clear.
DO $$ DECLARE n integer := (SELECT count(*) FROM vale_private.card_reports WHERE card_owner_id = current_setting('vale.o')::uuid); BEGIN
 DELETE FROM auth.users WHERE id = current_setting('vale.o')::uuid;
 IF (SELECT count(*) FROM vale_private.card_reports WHERE card_slug = current_setting('vale.os') AND card_id IS NULL AND card_owner_id IS NULL AND card_snapshot ? 'display_name') <> n
 THEN RAISE EXCEPTION 'CHECK: deleting the account removed reports'; END IF;
 DELETE FROM auth.users WHERE id = current_setting('vale.a')::uuid;
 IF EXISTS (SELECT 1 FROM vale_private.platform_admins) OR NOT EXISTS (SELECT 1 FROM vale_private.moderation_actions WHERE admin_id IS NULL AND action = 'hide_card' AND card_id IS NULL)
 THEN RAISE EXCEPTION 'CHECK: deleting the admin account lost the log or kept admin rights'; END IF;
END $$;

SELECT 'PASS: reports are private to admins with two-step sign-in; validated, merged and rate-limited; blocks work; decisions are logged; hidden cards leave every public path and stay hidden until restored; owners are told why without learning who reported; alerts at most hourly; retention and deletion work' AS test;
ROLLBACK;
