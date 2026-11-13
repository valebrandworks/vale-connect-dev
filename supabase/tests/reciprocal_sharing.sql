-- Transaction-only test of reciprocal sharing: access, consent, field choices, validation, duplicates, rate limits,
-- mutual connections, the owner's limit, owner actions, retention and account deletion. All fixtures roll back.
-- Never run against production.
BEGIN;
SELECT set_config('vale.o', gen_random_uuid()::text, true), set_config('vale.m', gen_random_uuid()::text, true), set_config('vale.x', gen_random_uuid()::text, true);
SELECT set_config('vale.oc', gen_random_uuid()::text, true), set_config('vale.mc', gen_random_uuid()::text, true), set_config('vale.xc', gen_random_uuid()::text, true);
INSERT INTO auth.users(id, email) VALUES
 (current_setting('vale.o')::uuid, 'rs-o-' || current_setting('vale.o') || '@example.invalid'),
 (current_setting('vale.m')::uuid, 'rs-m-' || current_setting('vale.m') || '@example.invalid'),
 (current_setting('vale.x')::uuid, 'rs-x-' || current_setting('vale.x') || '@example.invalid');
INSERT INTO public.public_cards(id, owner_id, slug, display_name, public_email, public_phone, published) VALUES
 (current_setting('vale.oc')::uuid, current_setting('vale.o')::uuid, 'rs-o-' || left(current_setting('vale.oc'), 8), 'Owner Synthetic', 'owner@example.invalid', '', true),
 (current_setting('vale.mc')::uuid, current_setting('vale.m')::uuid, 'rs-m-' || left(current_setting('vale.mc'), 8), 'Member Synthetic', 'member@example.invalid', '+1 555 010 0222', true),
 (current_setting('vale.xc')::uuid, current_setting('vale.x')::uuid, 'rs-x-' || left(current_setting('vale.xc'), 8), 'Other Synthetic', '', '', true);
-- A shorter way to call record_share in these tests. Visitor unless a member is given.
CREATE FUNCTION pg_temp.share(slug text, fields jsonb, net text DEFAULT 'net-a', consent boolean DEFAULT true, version text DEFAULT 'v1',
  member uuid DEFAULT NULL, member_card uuid DEFAULT NULL, member_fields text[] DEFAULT NULL, sub uuid DEFAULT gen_random_uuid(), note text DEFAULT '')
 RETURNS text LANGUAGE plpgsql AS $$
 DECLARE r text;
 BEGIN
  -- Called as the server role, which has no table access of its own, only this function.
  EXECUTE 'SET LOCAL ROLE service_role';
  r := public.record_share(slug, sub, consent, version, fields, member_fields, member, member_card, net, note);
  EXECUTE 'RESET ROLE';
  RETURN r;
 END $$;
CREATE FUNCTION pg_temp.slug(card text) RETURNS text LANGUAGE sql AS $$ SELECT slug FROM public.public_cards WHERE id = current_setting(card)::uuid $$;
SELECT set_config('vale.os', pg_temp.slug('vale.oc'), true), set_config('vale.ms', pg_temp.slug('vale.mc'), true), set_config('vale.xs', pg_temp.slug('vale.xc'), true);

-- A. Visitors and signed-in accounts can't record shares or touch sharing data directly.
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.record_share(current_setting('vale.os'), gen_random_uuid(), true, 'v1', '{"full_name":"A","email":"a@example.invalid"}', NULL, NULL, NULL, 'n', ''); RAISE EXCEPTION 'CHECK: a visitor called record_share directly';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM public.card_shares; RAISE EXCEPTION 'CHECK: a visitor read shares'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM public.notifications; RAISE EXCEPTION 'CHECK: a visitor read notifications'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.m'), 'role', 'authenticated')::text, true);
DO $$ DECLARE c uuid; BEGIN
 BEGIN PERFORM public.record_share(current_setting('vale.os'), gen_random_uuid(), true, 'v1', '{"full_name":"A","email":"a@example.invalid"}', NULL, NULL, NULL, 'n', ''); RAISE EXCEPTION 'CHECK: an account called record_share directly';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.card_shares(submission_id, owner_id, shared_fields, shared, consent_version, consented_at, dedupe_key, outcome) VALUES (gen_random_uuid(), current_setting('vale.o')::uuid, '{full_name}', '{}', 'v1', now(), 'k', 'added'); RAISE EXCEPTION 'CHECK: an account wrote a share';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.notifications(owner_id, kind) VALUES (current_setting('vale.o')::uuid, 'share_added'); RAISE EXCEPTION 'CHECK: an account wrote a notification';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.share_limits SET max_count = 1000; RAISE EXCEPTION 'CHECK: an account changed rate limits'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM public.share_attempts; RAISE EXCEPTION 'CHECK: an account read rate-limit records'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO public.connections(owner_id, full_name, source) VALUES (current_setting('vale.m')::uuid, 'Fake share', 'shared_back'); RAISE EXCEPTION 'CHECK: an account created a shared connection';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 BEGIN INSERT INTO public.connections(owner_id, full_name, mutual) VALUES (current_setting('vale.m')::uuid, 'Fake mutual', true); RAISE EXCEPTION 'CHECK: an account created a mutual connection';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 INSERT INTO public.connections(owner_id, full_name) VALUES (current_setting('vale.m')::uuid, 'Manual Synthetic') RETURNING id INTO c;
 BEGIN UPDATE public.connections SET mutual = true WHERE id = c; RAISE EXCEPTION 'CHECK: an account marked a connection mutual';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 BEGIN UPDATE public.connections SET source = 'shared_back' WHERE id = c; RAISE EXCEPTION 'CHECK: an account changed a connection''s source';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 DELETE FROM public.connections WHERE id = c;
 BEGIN PERFORM public.add_shared_as_connection(gen_random_uuid()); RAISE EXCEPTION 'CHECK: added an unknown share';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
END $$;

-- B. Recording shares (the server function's role). Limits are relaxed here and tested on their own in C.
RESET ROLE;
UPDATE public.share_limits SET max_count = 1000;
SELECT set_config('request.jwt.claims', '', true);
DO $$
DECLARE o uuid := current_setting('vale.o')::uuid; m uuid := current_setting('vale.m')::uuid; sub uuid := gen_random_uuid(); r text; n int; s public.card_shares%ROWTYPE; c public.connections%ROWTYPE;
BEGIN
 -- Consent and validation.
 IF pg_temp.share(current_setting('vale.os'), '{"full_name":"Visitor One","email":"v1@example.invalid"}', consent => false) <> 'invalid' THEN RAISE EXCEPTION 'Saved without consent'; END IF;
 IF pg_temp.share(current_setting('vale.os'), '{"full_name":"Visitor One","email":"v1@example.invalid"}', version => ' ') <> 'invalid' THEN RAISE EXCEPTION 'Saved without a consent version'; END IF;
 IF pg_temp.share(current_setting('vale.os'), '{"full_name":"Visitor One"}') <> 'invalid' THEN RAISE EXCEPTION 'Saved without an email or phone'; END IF;
 IF pg_temp.share(current_setting('vale.os'), '{"email":"v1@example.invalid"}') <> 'invalid' THEN RAISE EXCEPTION 'Saved without a name'; END IF;
 IF pg_temp.share(current_setting('vale.os'), '{"full_name":"V","email":"not-an-email"}') <> 'invalid' THEN RAISE EXCEPTION 'Saved a bad email'; END IF;
 IF pg_temp.share(current_setting('vale.os'), '{"full_name":"V","phone":"call me"}') <> 'invalid' THEN RAISE EXCEPTION 'Saved a bad phone'; END IF;
 IF pg_temp.share(current_setting('vale.os'), jsonb_build_object('full_name', repeat('x', 91), 'email', 'v@example.invalid')) <> 'invalid' THEN RAISE EXCEPTION 'Saved an oversized name'; END IF;
 IF pg_temp.share(current_setting('vale.os'), '{"full_name":["V"],"email":"v@example.invalid"}') <> 'invalid' THEN RAISE EXCEPTION 'Saved a non-text value'; END IF;
 IF pg_temp.share(current_setting('vale.os'), '{"full_name":"V","email":"v@example.invalid"}', note => repeat('x', 301)) <> 'invalid' THEN RAISE EXCEPTION 'Saved an oversized note'; END IF;
 IF (SELECT count(*) FROM public.card_shares WHERE owner_id = o) <> 0 THEN RAISE EXCEPTION 'Invalid shares were stored'; END IF;
 -- A valid visitor share: only allowed, filled-in fields are stored; extra keys are ignored.
 r := pg_temp.share(current_setting('vale.os'), '{"full_name":" Visitor One ","email":"V1@example.invalid","phone":"","owner_id":"x","notes":"inject","mutual":true}', sub => sub, note => 'Met at the expo');
 IF r <> 'shared' THEN RAISE EXCEPTION 'Valid share refused: %', r; END IF;
 SELECT * INTO s FROM public.card_shares WHERE submission_id = sub;
 IF s.outcome <> 'added' OR s.shared <> '{"full_name":"Visitor One","email":"V1@example.invalid"}'::jsonb OR s.consent_version <> 'v1' OR s.sharer_user_id IS NOT NULL THEN RAISE EXCEPTION 'Share stored wrongly: %', s.shared; END IF;
 SELECT * INTO c FROM public.connections WHERE id = s.connection_id;
 IF c.owner_id <> o OR c.source <> 'shared_back' OR c.share_id <> s.id OR c.mutual OR c.notes <> 'Their note: Met at the expo' OR c.phone <> '' THEN RAISE EXCEPTION 'Connection created wrongly'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE owner_id = o AND kind = 'share_added' AND share_id = s.id) THEN RAISE EXCEPTION 'No notification'; END IF;
 -- The same submission again (a double tap) changes nothing.
 IF pg_temp.share(current_setting('vale.os'), '{"full_name":"Visitor One","email":"V1@example.invalid"}', sub => sub, note => 'Met at the expo') <> 'shared' THEN RAISE EXCEPTION 'Replay not answered as shared'; END IF;
 -- An identical share later is counted, not stored again.
 IF pg_temp.share(current_setting('vale.os'), '{"full_name":"Visitor One","email":"V1@example.invalid"}', net => 'net-a2', note => 'Met at the expo') <> 'shared' THEN RAISE EXCEPTION 'Repeat refused'; END IF;
 IF (SELECT count(*) FROM public.card_shares WHERE owner_id = o) <> 1 OR (SELECT repeat_count FROM public.card_shares WHERE submission_id = sub) <> 2 THEN RAISE EXCEPTION 'Identical repeat stored again'; END IF;
 IF (SELECT count(*) FROM public.connections WHERE owner_id = o) <> 1 OR (SELECT count(*) FROM public.notifications WHERE owner_id = o) <> 1 THEN RAISE EXCEPTION 'Repeat added a connection or notification'; END IF;
 -- Duplicates by email, phone, and name with company: answered "shared", existing connection untouched, share kept for review.
 r := pg_temp.share(current_setting('vale.os'), '{"full_name":"Visitor Renamed","email":"v1@EXAMPLE.invalid","business_name":"New Co"}', net => 'net-a3');
 SELECT * INTO s FROM public.card_shares WHERE owner_id = o AND shared->>'full_name' = 'Visitor Renamed';
 IF r <> 'shared' OR s.outcome <> 'duplicate' OR s.connection_id <> c.id THEN RAISE EXCEPTION 'Email duplicate not detected'; END IF;
 IF (SELECT full_name || '|' || business_name FROM public.connections WHERE id = c.id) <> 'Visitor One|' THEN RAISE EXCEPTION 'Duplicate overwrote the connection'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE share_id = s.id AND kind = 'share_duplicate') THEN RAISE EXCEPTION 'No duplicate notification'; END IF;
 PERFORM pg_temp.share(current_setting('vale.os'), '{"full_name":"Phone Person","phone":"+1 555 010 0199"}', net => 'net-b');
 IF pg_temp.share(current_setting('vale.os'), '{"full_name":"Someone Else","phone":"(1) 555-010-0199"}', net => 'net-b2') <> 'shared'
    OR (SELECT outcome FROM public.card_shares WHERE owner_id = o AND shared->>'full_name' = 'Someone Else') <> 'duplicate' THEN RAISE EXCEPTION 'Phone duplicate not detected'; END IF;
 PERFORM pg_temp.share(current_setting('vale.os'), '{"full_name":"Casey Lee","business_name":"Acme","email":"c1@example.invalid"}', net => 'net-c');
 IF pg_temp.share(current_setting('vale.os'), '{"full_name":"  casey  LEE ","business_name":"ACME","email":"c2@example.invalid"}', net => 'net-c2') <> 'shared'
    OR (SELECT outcome FROM public.card_shares WHERE owner_id = o AND shared->>'email' = 'c2@example.invalid') <> 'duplicate' THEN RAISE EXCEPTION 'Name and company duplicate not detected'; END IF;
 -- Cards that are off, unpublished or unknown.
 UPDATE public.public_cards SET accept_shares = false WHERE id = current_setting('vale.xc')::uuid;
 IF pg_temp.share(current_setting('vale.xs'), '{"full_name":"V","email":"off@example.invalid"}') <> 'unavailable' THEN RAISE EXCEPTION 'Shared to a card with sharing off'; END IF;
 UPDATE public.public_cards SET accept_shares = true, published = false WHERE id = current_setting('vale.xc')::uuid;
 IF pg_temp.share(current_setting('vale.xs'), '{"full_name":"V","email":"off@example.invalid"}') <> 'unavailable' THEN RAISE EXCEPTION 'Shared to an unpublished card'; END IF;
 UPDATE public.public_cards SET published = true WHERE id = current_setting('vale.xc')::uuid;
 IF pg_temp.share('no-such-card-zz', '{"full_name":"V","email":"v@example.invalid"}') <> 'unavailable' THEN RAISE EXCEPTION 'Unknown card accepted'; END IF;
END $$;

-- C. Rate limits (adjusted in place by a trusted role, then restored by the rollback).
RESET ROLE;
UPDATE public.share_limits SET max_count = d.max_count FROM (VALUES ('network_card', 5), ('network_all', 50), ('card_all', 30), ('contact_card', 2), ('member_all', 10)) d(name, max_count) WHERE share_limits.name = d.name;
DELETE FROM public.share_attempts;
UPDATE public.share_limits SET max_count = 2 WHERE name = 'network_card';
DO $$ BEGIN
 IF pg_temp.share(current_setting('vale.xs'), '{"full_name":"R1","email":"r1@example.invalid"}', net => 'net-r') <> 'shared'
    OR pg_temp.share(current_setting('vale.xs'), '{"full_name":"R2","email":"r2@example.invalid"}', net => 'net-r') <> 'shared' THEN RAISE EXCEPTION 'Rate limit too strict'; END IF;
 IF pg_temp.share(current_setting('vale.xs'), '{"full_name":"R3","email":"r3@example.invalid"}', net => 'net-r') <> 'rate_limited' THEN RAISE EXCEPTION 'CHECK: same network, same card not limited'; END IF;
 IF pg_temp.share(current_setting('vale.os'), '{"full_name":"R4","email":"r4@example.invalid"}', net => 'net-r') <> 'shared' THEN RAISE EXCEPTION 'Shared conference network blocked across cards'; END IF;
 -- Same email to the same card: 2 a day, from any network.
 PERFORM pg_temp.share(current_setting('vale.xs'), '{"full_name":"Z","email":"z@example.invalid"}', net => 'net-z1');
 PERFORM pg_temp.share(current_setting('vale.xs'), '{"full_name":"Z Two","email":"z@example.invalid"}', net => 'net-z2');
 IF pg_temp.share(current_setting('vale.xs'), '{"full_name":"Z Three","email":"z@example.invalid"}', net => 'net-z3') <> 'rate_limited' THEN RAISE EXCEPTION 'CHECK: same contact, same card not limited'; END IF;
END $$;
RESET ROLE;
UPDATE public.share_limits SET max_count = 5 WHERE name = 'contact_card';   -- the limits are adjustable
UPDATE public.share_limits SET max_count = 1 WHERE name = 'card_all';
UPDATE public.share_limits SET max_count = 3 WHERE name = 'network_all';
DO $$ BEGIN
 IF pg_temp.share(current_setting('vale.xs'), '{"full_name":"Z Four","email":"z@example.invalid"}', net => 'net-z4') <> 'rate_limited' THEN RAISE EXCEPTION 'CHECK: same card, any senders not limited'; END IF;
 IF pg_temp.share(current_setting('vale.ms'), '{"full_name":"N1","email":"n1@example.invalid"}', net => 'net-n') <> 'shared'
    OR pg_temp.share(current_setting('vale.ms'), '{"full_name":"N2","email":"n2@example.invalid"}', net => 'net-n') <> 'rate_limited' THEN RAISE EXCEPTION 'CHECK: adjusted card limit not applied'; END IF;
END $$;
RESET ROLE;
UPDATE public.share_limits SET max_count = 30 WHERE name = 'card_all';
UPDATE public.share_limits SET max_count = 1 WHERE name = 'member_all';
DO $$ DECLARE m uuid := current_setting('vale.m')::uuid; BEGIN
 IF pg_temp.share(current_setting('vale.xs'), NULL, net => 'net-q1', member => m, member_card => current_setting('vale.mc')::uuid, member_fields => '{full_name,email}') <> 'shared'
    OR pg_temp.share(current_setting('vale.os'), NULL, net => 'net-q2', member => m, member_card => current_setting('vale.mc')::uuid, member_fields => '{full_name,email}') <> 'rate_limited' THEN RAISE EXCEPTION 'CHECK: member limit not applied'; END IF;
 IF (SELECT count(*) FROM public.share_attempts WHERE network_hash = 'net-q1' AND sharer_user_id = m) = 0 THEN RAISE EXCEPTION 'Attempts not recorded'; END IF;
END $$;
RESET ROLE;
UPDATE public.share_limits SET max_count = d.max_count FROM (VALUES ('network_card', 5), ('network_all', 50), ('card_all', 30), ('contact_card', 2), ('member_all', 10)) d(name, max_count) WHERE share_limits.name = d.name;
DELETE FROM public.share_attempts;

-- D. Members: the server copies only the fields they ticked, from their own card; mutual needs both to share.
DO $$
DECLARE o uuid := current_setting('vale.o')::uuid; m uuid := current_setting('vale.m')::uuid; mc uuid := current_setting('vale.mc')::uuid; oc uuid := current_setting('vale.oc')::uuid; c public.connections%ROWTYPE; s public.card_shares%ROWTYPE;
BEGIN
 IF pg_temp.share(current_setting('vale.os'), '{"full_name":"Forged","email":"forged@example.invalid"}', net => 'net-m', member => m, member_card => mc, member_fields => '{email}') <> 'invalid' THEN RAISE EXCEPTION 'CHECK: member share without their name'; END IF;
 IF pg_temp.share(current_setting('vale.os'), NULL, net => 'net-m', member => m, member_card => mc, member_fields => '{full_name,email,owner_id}') <> 'invalid' THEN RAISE EXCEPTION 'CHECK: member asked for an unknown field'; END IF;
 IF pg_temp.share(current_setting('vale.os'), NULL, net => 'net-m', member => m, member_card => current_setting('vale.xc')::uuid, member_fields => '{full_name,email}') <> 'invalid' THEN RAISE EXCEPTION 'CHECK: member shared someone else''s card'; END IF;
 IF pg_temp.share(current_setting('vale.ms'), NULL, net => 'net-m', member => m, member_card => mc, member_fields => '{full_name,email}') <> 'invalid' THEN RAISE EXCEPTION 'CHECK: shared to own card'; END IF;
 IF pg_temp.share(current_setting('vale.os'), '{"full_name":"Forged","email":"forged@example.invalid","phone":"+1 555 999 9999"}', net => 'net-m', member => m, member_card => mc, member_fields => '{full_name,email}') <> 'shared' THEN RAISE EXCEPTION 'Member share refused'; END IF;
 SELECT * INTO s FROM public.card_shares WHERE owner_id = o AND sharer_user_id = m;
 IF s.shared <> '{"full_name":"Member Synthetic","email":"member@example.invalid"}'::jsonb THEN RAISE EXCEPTION 'CHECK: member share stored other values: %', s.shared; END IF;
 SELECT * INTO c FROM public.connections WHERE id = s.connection_id;
 IF c.phone <> '' OR c.source_identity <> 'card:' || mc::text OR c.mutual THEN RAISE EXCEPTION 'CHECK: unticked phone shared, or mutual too early'; END IF;
 -- The owner shares back: now both have consented, so both connections are mutual.
 IF pg_temp.share(current_setting('vale.ms'), NULL, net => 'net-o', member => o, member_card => oc, member_fields => '{full_name,email}') <> 'shared' THEN RAISE EXCEPTION 'Share back refused'; END IF;
 IF NOT (SELECT mutual FROM public.connections WHERE id = c.id) OR NOT EXISTS (SELECT 1 FROM public.connections WHERE owner_id = m AND source_identity = 'card:' || oc::text AND mutual) THEN RAISE EXCEPTION 'CHECK: mutual not set after both consented'; END IF;
 IF (SELECT count(*) FROM public.notifications WHERE kind = 'mutual' AND owner_id IN (o, m)) <> 2 THEN RAISE EXCEPTION 'Mutual notifications missing'; END IF;
END $$;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.connections WHERE owner_id = current_setting('vale.o')::uuid AND source_identity IS NULL AND mutual) THEN RAISE EXCEPTION 'CHECK: a visitor connection became mutual'; END IF;
END $$;

-- E. The owner's connection limit: the share is kept for review and the sender still sees "shared".
RESET ROLE;
UPDATE public.membership_plans SET max_active_connections = (SELECT count(*) FROM public.connections WHERE owner_id = current_setting('vale.o')::uuid AND archived_at IS NULL) WHERE code = 'free';
DO $$ DECLARE before int := (SELECT count(*) FROM public.connections WHERE owner_id = current_setting('vale.o')::uuid); BEGIN
 IF pg_temp.share(current_setting('vale.os'), '{"full_name":"Late Arrival","email":"late@example.invalid"}', net => 'net-l') <> 'shared' THEN RAISE EXCEPTION 'Limit revealed to the sender'; END IF;
 IF (SELECT count(*) FROM public.connections WHERE owner_id = current_setting('vale.o')::uuid) <> before THEN RAISE EXCEPTION 'CHECK: added over the owner''s limit'; END IF;
 IF (SELECT outcome FROM public.card_shares WHERE shared->>'email' = 'late@example.invalid') <> 'limit_reached'
    OR NOT EXISTS (SELECT 1 FROM public.notifications WHERE kind = 'share_limit') THEN RAISE EXCEPTION 'Limit share not kept for review'; END IF;
END $$;
RESET ROLE;
UPDATE public.membership_plans SET max_active_connections = NULL WHERE code = 'free';

-- F. Owner actions: read only their own shares; add a reviewed share as a separate connection; mark notifications read.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.x'), 'role', 'authenticated')::text, true);
DO $$ DECLARE dup uuid; BEGIN
 IF EXISTS (SELECT 1 FROM public.card_shares WHERE owner_id = current_setting('vale.o')::uuid) OR EXISTS (SELECT 1 FROM public.notifications WHERE owner_id = current_setting('vale.o')::uuid) THEN RAISE EXCEPTION 'CHECK: another account read the owner''s shares'; END IF;
 PERFORM public.mark_notifications_read(NULL);
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.notifications WHERE owner_id = current_setting('vale.o')::uuid AND read_at IS NOT NULL) THEN RAISE EXCEPTION 'CHECK: another account marked the owner''s notifications'; END IF;
END $$;
SELECT set_config('vale.dup', (SELECT id::text FROM public.card_shares WHERE owner_id = current_setting('vale.o')::uuid AND outcome = 'duplicate' ORDER BY created_at LIMIT 1), true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.add_shared_as_connection(current_setting('vale.dup')::uuid); RAISE EXCEPTION 'CHECK: another account added the owner''s share';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.o'), 'role', 'authenticated')::text, true);
DO $$ DECLARE c uuid; unread int; BEGIN
 IF (SELECT count(*) FROM public.card_shares) <> (SELECT count(*) FROM public.card_shares WHERE owner_id = current_setting('vale.o')::uuid) THEN RAISE EXCEPTION 'CHECK: the owner saw another account''s shares'; END IF;
 c := public.add_shared_as_connection(current_setting('vale.dup')::uuid);
 IF (SELECT outcome FROM public.card_shares WHERE id = current_setting('vale.dup')::uuid) <> 'owner_added' OR NOT EXISTS (SELECT 1 FROM public.connections WHERE id = c AND source = 'shared_back') THEN RAISE EXCEPTION 'Reviewed share not added'; END IF;
 BEGIN PERFORM public.add_shared_as_connection(current_setting('vale.dup')::uuid); RAISE EXCEPTION 'CHECK: added the same share twice';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 unread := (SELECT count(*) FROM public.notifications WHERE read_at IS NULL);
 IF unread = 0 THEN RAISE EXCEPTION 'No unread notifications to test with'; END IF;
 IF public.mark_notifications_read(NULL) <> unread THEN RAISE EXCEPTION 'Wrong number marked read'; END IF;
 IF EXISTS (SELECT 1 FROM public.notifications WHERE read_at IS NULL) THEN RAISE EXCEPTION 'Notifications not marked read'; END IF;
END $$;

-- G. Retention: old read notifications, old and excess duplicate shares, and old rate-limit records are removed.
RESET ROLE;
DO $$ DECLARE o uuid := current_setting('vale.o')::uuid; conn uuid; BEGIN
 UPDATE public.notifications SET read_at = now() - interval '100 days' WHERE owner_id = o;
 SELECT id INTO conn FROM public.connections WHERE owner_id = o AND email = 'V1@example.invalid';
 INSERT INTO public.card_shares(submission_id, card_id, owner_id, shared_fields, shared, consent_version, consented_at, dedupe_key, outcome, connection_id, last_shared_at)
  SELECT gen_random_uuid(), current_setting('vale.oc')::uuid, o, '{full_name}', jsonb_build_object('full_name', 'Old ' || i), 'v1', now(), 'k' || i, 'duplicate', conn, now() - make_interval(days => i)
  FROM generate_series(1, 12) i;
 UPDATE public.card_shares SET last_shared_at = now() - interval '200 days' WHERE owner_id = o AND shared->>'full_name' = 'Old 12';
 INSERT INTO public.share_attempts(card_id, network_hash, created_at) VALUES (current_setting('vale.oc')::uuid, 'old', now() - interval '3 days');
 PERFORM public.purge_share_history(o);
 IF EXISTS (SELECT 1 FROM public.notifications WHERE owner_id = o) THEN RAISE EXCEPTION 'CHECK: old read notifications kept'; END IF;
 IF (SELECT count(*) FROM public.card_shares WHERE connection_id = conn AND outcome = 'duplicate') > 10 THEN RAISE EXCEPTION 'CHECK: more than 10 duplicates kept for one connection'; END IF;
 IF EXISTS (SELECT 1 FROM public.share_attempts WHERE network_hash = 'old') THEN RAISE EXCEPTION 'CHECK: old rate-limit records kept'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.card_shares WHERE owner_id = o AND outcome = 'added') THEN RAISE EXCEPTION 'History for existing connections was removed'; END IF;
END $$;

-- H. Account deletion. A member's deletion leaves what they shared with the owner; the owner's removes everything of theirs.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.m'), 'role', 'authenticated', 'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch FROM now())::bigint)))::text, true);
SELECT public.delete_my_account('rs-m-' || current_setting('vale.m') || '@example.invalid');
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.o'), 'role', 'authenticated', 'amr', json_build_array(json_build_object('method', 'password', 'timestamp', extract(epoch FROM now())::bigint)))::text, true);
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.connections WHERE full_name = 'Member Synthetic') THEN RAISE EXCEPTION 'CHECK: a member''s deletion removed what they shared with the owner'; END IF;
 IF EXISTS (SELECT 1 FROM public.card_shares WHERE sharer_user_id IS NOT NULL) THEN RAISE EXCEPTION 'CHECK: deleted member still linked to shares'; END IF;
END $$;
SELECT public.delete_my_account('rs-o-' || current_setting('vale.o') || '@example.invalid');
RESET ROLE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.card_shares WHERE owner_id IN (current_setting('vale.o')::uuid, current_setting('vale.m')::uuid))
    OR EXISTS (SELECT 1 FROM public.notifications WHERE owner_id IN (current_setting('vale.o')::uuid, current_setting('vale.m')::uuid))
    OR EXISTS (SELECT 1 FROM public.connections WHERE owner_id IN (current_setting('vale.o')::uuid, current_setting('vale.m')::uuid))
    OR EXISTS (SELECT 1 FROM public.share_attempts WHERE sharer_user_id IN (current_setting('vale.o')::uuid, current_setting('vale.m')::uuid)) THEN RAISE EXCEPTION 'CHECK: deleted accounts left sharing data'; END IF;
END $$;
SELECT 'PASS: shares only through the server; consent, field choices and validation enforced; duplicates kept without overwriting and never revealed; identical repeats collapsed; five adjustable rate limits; mutual only after both share; owner limit respected; owners see only their own; retention rules applied; account deletion cleans up. All fixtures rolled back.' AS result;
ROLLBACK;
