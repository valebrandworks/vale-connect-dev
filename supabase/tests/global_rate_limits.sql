-- Transaction-only test: production-wide (global) rate limits for sharing and reporting. Normal use passes; the Nth+1 accepted
-- request over a global limit is refused with the usual reply and stores nothing but its attempt row; attempts refused by a narrower
-- limit do not use up the global budget; visitor and member buckets are independent; hourly and daily windows; recovery when the
-- window passes; invalid requests are not counted; the lock helper is private. Existing narrower limits are tested elsewhere
-- (reciprocal_sharing, share_contact_keys, card_reports) and must still pass unchanged.
-- Real concurrency and lock timeouts need separate connections and are tested on development by scripts/test-rate-concurrency.mjs.
-- All fixtures roll back. Never run against production.
BEGIN;
SELECT set_config('vale.o', gen_random_uuid()::text, true), set_config('vale.m', gen_random_uuid()::text, true);
SELECT set_config('vale.oc', gen_random_uuid()::text, true), set_config('vale.mc', gen_random_uuid()::text, true);
INSERT INTO auth.users(id, email) VALUES
 (current_setting('vale.o')::uuid, 'gl-o-' || current_setting('vale.o') || '@example.invalid'),
 (current_setting('vale.m')::uuid, 'gl-m-' || current_setting('vale.m') || '@example.invalid');
INSERT INTO public.public_cards(id, owner_id, slug, display_name, public_email, public_phone, published) VALUES
 (current_setting('vale.oc')::uuid, current_setting('vale.o')::uuid, 'gl-o-' || left(current_setting('vale.oc'), 8), 'Owner Synthetic', '', '', true),
 (current_setting('vale.mc')::uuid, current_setting('vale.m')::uuid, 'gl-m-' || left(current_setting('vale.mc'), 8), 'Member Synthetic', 'member.gl@example.invalid', '+1 555 010 0444', true);

-- A visitor share from network `net` with a fresh email each time (so the per-contact limit never interferes).
CREATE FUNCTION pg_temp.vshare(net text) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE r text; s text := (SELECT slug FROM public.public_cards WHERE id = current_setting('vale.oc')::uuid);
 BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  r := public.record_share(s, gen_random_uuid(), true, 'v1',
        jsonb_build_object('full_name', 'Visitor ' || net, 'email', 'v-' || gen_random_uuid()::text || '@example.invalid'), NULL, NULL, NULL, net, '');
  EXECUTE 'RESET ROLE';
  RETURN r;
 END $$;
-- A member share (the member's card is the sharer card), distinct note each time so it is a new share.
CREATE FUNCTION pg_temp.mshare(net text) RETURNS text LANGUAGE plpgsql AS $$
 DECLARE r text; s text := (SELECT slug FROM public.public_cards WHERE id = current_setting('vale.oc')::uuid);
 BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  r := public.record_share(s, gen_random_uuid(), true, 'v1', NULL, ARRAY['full_name', 'email'], current_setting('vale.m')::uuid, current_setting('vale.mc')::uuid, net, 'n-' || gen_random_uuid()::text);
  EXECUTE 'RESET ROLE';
  RETURN r;
 END $$;
-- A report from network hash made of one character repeated, with distinct details each time.
CREATE FUNCTION pg_temp.report(net_char text, cat text DEFAULT 'spam') RETURNS text LANGUAGE plpgsql AS $$
 DECLARE r text; s text := (SELECT slug FROM public.public_cards WHERE id = current_setting('vale.oc')::uuid);
 BEGIN
  EXECUTE 'SET LOCAL ROLE service_role';
  r := public.submit_card_report(s, gen_random_uuid(), cat, 'details ' || gen_random_uuid()::text, '', true, repeat(net_char, 64));
  EXECUTE 'RESET ROLE';
  RETURN r;
 END $$;
CREATE FUNCTION pg_temp.expect(label text, got text, want text) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'CHECK: % (got %, wanted %)', label, got, want; END IF; END $$;
CREATE FUNCTION pg_temp.expect_n(label text, got bigint, want bigint) RETURNS void LANGUAGE plpgsql AS $$
 BEGIN IF got IS DISTINCT FROM want THEN RAISE EXCEPTION 'CHECK: % (got %, wanted %)', label, got, want; END IF; END $$;

DO $$
DECLARE r text; i integer; slug text;
BEGIN
 -- 0. The new limits exist with the approved values, and the helper is private.
 PERFORM pg_temp.expect_n('four global share limits present', (SELECT count(*) FROM public.share_limits WHERE name LIKE 'global\_%'), 4);
 PERFORM pg_temp.expect_n('global_visitor 1500/hour', (SELECT max_count FROM public.share_limits WHERE name = 'global_visitor' AND window_seconds = 3600), 1500);
 PERFORM pg_temp.expect_n('global_visitor_day 6000/day', (SELECT max_count FROM public.share_limits WHERE name = 'global_visitor_day' AND window_seconds = 86400), 6000);
 PERFORM pg_temp.expect_n('global_member 600/hour', (SELECT max_count FROM public.share_limits WHERE name = 'global_member' AND window_seconds = 3600), 600);
 PERFORM pg_temp.expect_n('global_member_day 3000/day', (SELECT max_count FROM public.share_limits WHERE name = 'global_member_day' AND window_seconds = 86400), 3000);
 PERFORM pg_temp.expect_n('global report limits 40/hour 200/day', (SELECT value FROM vale_private.report_settings WHERE name = 'global_all_per_hour') * 1000 + (SELECT value FROM vale_private.report_settings WHERE name = 'global_all_per_day'), 40200);
 PERFORM pg_temp.expect('the lock helper is private', (has_function_privilege('anon', 'vale_private.try_lock(text)', 'EXECUTE') OR has_function_privilege('authenticated', 'vale_private.try_lock(text)', 'EXECUTE') OR has_function_privilege('service_role', 'vale_private.try_lock(text)', 'EXECUTE'))::text, 'false');
 PERFORM pg_temp.expect('the lock helper takes a free lock', vale_private.try_lock('gl-test-free')::text, 'true');

 -- A. Normal use under the default limits: accepted, nothing refused.
 FOR i IN 1..3 LOOP PERFORM pg_temp.expect('normal visitor share ' || i, pg_temp.vshare('net-n' || i), 'shared'); END LOOP;
 PERFORM pg_temp.expect('normal member share', pg_temp.mshare('net-m1'), 'shared');
 PERFORM pg_temp.expect_n('no attempt refused in normal use', (SELECT count(*) FROM public.share_attempts WHERE refused), 0);
 PERFORM pg_temp.expect('normal report', pg_temp.report('a'), 'stored');
 PERFORM pg_temp.expect_n('no report attempt refused in normal use', (SELECT count(*) FROM vale_private.report_attempts WHERE refused), 0);

 -- B. Global visitor hourly limit (lowered for the test): the Nth+1 accepted share is refused, stores nothing, and is flagged.
 DELETE FROM public.share_attempts;
 UPDATE public.share_limits SET max_count = 3 WHERE name = 'global_visitor';
 FOR i IN 1..3 LOOP PERFORM pg_temp.expect('visitor within the global limit ' || i, pg_temp.vshare('net-b' || i), 'shared'); END LOOP;
 PERFORM pg_temp.expect_n('shares so far', (SELECT count(*) FROM public.card_shares WHERE card_id = current_setting('vale.oc')::uuid), 7);
 PERFORM pg_temp.expect('visitor over the global limit', pg_temp.vshare('net-b4'), 'rate_limited');
 PERFORM pg_temp.expect_n('the refused share stored nothing', (SELECT count(*) FROM public.card_shares WHERE card_id = current_setting('vale.oc')::uuid), 7);
 PERFORM pg_temp.expect_n('its attempt row is kept and flagged', (SELECT count(*) FROM public.share_attempts WHERE refused), 1);
 -- The member bucket is independent of the visitor bucket.
 PERFORM pg_temp.expect('member share still accepted while the visitor bucket is full', pg_temp.mshare('net-b5'), 'shared');

 -- C. Attempts refused by a narrower limit do not use up the global budget.
 DELETE FROM public.share_attempts;
 UPDATE public.share_limits SET max_count = 1 WHERE name = 'network_card';
 UPDATE public.share_limits SET max_count = 3 WHERE name = 'global_visitor';
 PERFORM pg_temp.expect('network A first share accepted', pg_temp.vshare('net-A'), 'shared');
 PERFORM pg_temp.expect('network A second share refused by its own limit', pg_temp.vshare('net-A'), 'rate_limited');
 PERFORM pg_temp.expect('network A third share refused by its own limit', pg_temp.vshare('net-A'), 'rate_limited');
 PERFORM pg_temp.expect('network B accepted (the refused ones did not count globally)', pg_temp.vshare('net-B'), 'shared');
 PERFORM pg_temp.expect('network C accepted (accepted so far: 3 = the limit)', pg_temp.vshare('net-C'), 'shared');
 PERFORM pg_temp.expect('network D refused by the global limit', pg_temp.vshare('net-D'), 'rate_limited');
 PERFORM pg_temp.expect_n('three refused attempts flagged', (SELECT count(*) FROM public.share_attempts WHERE refused), 3);
 UPDATE public.share_limits SET max_count = 5 WHERE name = 'network_card';

 -- D. Member global limit, independent of the visitor bucket.
 DELETE FROM public.share_attempts;
 UPDATE public.share_limits SET max_count = 1 WHERE name = 'global_member';
 UPDATE public.share_limits SET max_count = 1500 WHERE name = 'global_visitor';
 PERFORM pg_temp.expect('first member share accepted', pg_temp.mshare('net-d1'), 'shared');
 PERFORM pg_temp.expect('second member share refused by the global member limit', pg_temp.mshare('net-d2'), 'rate_limited');
 PERFORM pg_temp.expect('a visitor share is still accepted', pg_temp.vshare('net-d3'), 'shared');
 UPDATE public.share_limits SET max_count = 600 WHERE name = 'global_member';

 -- E. Daily limit (hourly high): refused over the daily count.
 DELETE FROM public.share_attempts;
 UPDATE public.share_limits SET max_count = 2 WHERE name = 'global_visitor_day';
 PERFORM pg_temp.expect('daily 1', pg_temp.vshare('net-e1'), 'shared');
 PERFORM pg_temp.expect('daily 2', pg_temp.vshare('net-e2'), 'shared');
 PERFORM pg_temp.expect('daily over', pg_temp.vshare('net-e3'), 'rate_limited');

 -- F. Recovery: once the window has passed the limit frees up (attempts moved back in time).
 UPDATE public.share_attempts SET created_at = created_at - interval '2 days';
 PERFORM pg_temp.expect('recovered after the window passed', pg_temp.vshare('net-f1'), 'shared');
 UPDATE public.share_limits SET max_count = 6000 WHERE name = 'global_visitor_day';
 -- Hourly window only: attempts older than an hour free the hourly limit but still count for the day.
 DELETE FROM public.share_attempts;
 UPDATE public.share_limits SET max_count = 2 WHERE name = 'global_visitor';
 PERFORM pg_temp.expect('hourly 1', pg_temp.vshare('net-g1'), 'shared');
 PERFORM pg_temp.expect('hourly 2', pg_temp.vshare('net-g2'), 'shared');
 PERFORM pg_temp.expect('hourly over', pg_temp.vshare('net-g3'), 'rate_limited');
 UPDATE public.share_attempts SET created_at = created_at - interval '2 hours';
 PERFORM pg_temp.expect('hourly recovered after two hours', pg_temp.vshare('net-g4'), 'shared');
 UPDATE public.share_limits SET max_count = 1500 WHERE name = 'global_visitor';

 -- G. Invalid requests are not counted.
 DELETE FROM public.share_attempts;
 slug := (SELECT c.slug FROM public.public_cards c WHERE c.id = current_setting('vale.oc')::uuid);
 EXECUTE 'SET LOCAL ROLE service_role';
 r := public.record_share(slug, gen_random_uuid(), true, 'v1', '{"full_name":"No Contact"}'::jsonb, NULL, NULL, NULL, 'net-inv', '');
 EXECUTE 'RESET ROLE';
 PERFORM pg_temp.expect('a share with no email or phone is invalid', r, 'invalid');
 PERFORM pg_temp.expect_n('invalid requests leave no attempt', (SELECT count(*) FROM public.share_attempts), 0);

 -- H. Reports: global hourly limit; refused by a narrower limit do not count; recovery.
 DELETE FROM vale_private.report_attempts;
 UPDATE vale_private.report_settings SET value = 3 WHERE name = 'global_all_per_hour';
 UPDATE vale_private.report_settings SET value = 1 WHERE name = 'network_card_per_day';
 PERFORM pg_temp.expect('report from network 1 stored', pg_temp.report('1'), 'stored');
 PERFORM pg_temp.expect('report from network 1 again refused by its own limit', pg_temp.report('1', 'scam'), 'limited');
 PERFORM pg_temp.expect('another report from network 1 refused by its own limit', pg_temp.report('1', 'other'), 'limited');
 PERFORM pg_temp.expect('report from network 2 stored (refused ones did not count)', pg_temp.report('2'), 'stored');
 PERFORM pg_temp.expect('report from network 3 stored (3 accepted = the limit)', pg_temp.report('3'), 'stored');
 PERFORM pg_temp.expect('report from network 4 refused by the global limit', pg_temp.report('4'), 'limited');
 PERFORM pg_temp.expect_n('the refused report stored nothing', (SELECT count(*) FROM vale_private.card_reports WHERE network_hash = repeat('4', 64)), 0);
 PERFORM pg_temp.expect_n('three report attempts flagged refused', (SELECT count(*) FROM vale_private.report_attempts WHERE refused), 3);
 UPDATE vale_private.report_attempts SET created_at = created_at - interval '2 hours';
 PERFORM pg_temp.expect('report recovered once the hour passed', pg_temp.report('5'), 'stored');
 UPDATE vale_private.report_settings SET value = 40 WHERE name = 'global_all_per_hour';
 UPDATE vale_private.report_settings SET value = 3 WHERE name = 'network_card_per_day';

 -- I. Reports: daily limit.
 DELETE FROM vale_private.report_attempts;
 UPDATE vale_private.report_settings SET value = 2 WHERE name = 'global_all_per_day';
 PERFORM pg_temp.expect('daily report 1', pg_temp.report('6'), 'stored');
 PERFORM pg_temp.expect('daily report 2', pg_temp.report('7'), 'stored');
 PERFORM pg_temp.expect('daily report over', pg_temp.report('8'), 'limited');
 UPDATE vale_private.report_settings SET value = 200 WHERE name = 'global_all_per_day';
END $$;
SELECT 'PASS: global rate limits for sharing and reporting: normal use accepted; over-limit refused with usual replies and nothing stored; refused-by-narrow attempts do not count globally; visitor and member buckets independent; hourly and daily windows; recovery; invalid requests uncounted; lock helper private' AS test;
ROLLBACK;
