-- Transaction-only test: Free has unlimited basic saved connections; a rate limit applies to NEW connections only.
-- All fixtures roll back. Never run against production.
BEGIN;
SELECT set_config('vale.ua', gen_random_uuid()::text, true), set_config('vale.ub', gen_random_uuid()::text, true);
INSERT INTO auth.users(id, email) VALUES
 (current_setting('vale.ua')::uuid, 'uc-a-' || current_setting('vale.ua') || '@example.invalid'),
 (current_setting('vale.ub')::uuid, 'uc-b-' || current_setting('vale.ub') || '@example.invalid');

-- A. Free has no total limit, and the rate limits are the approved ones.
DO $$ BEGIN
 IF (SELECT max_active_connections FROM public.membership_plans WHERE code = 'free') IS NOT NULL THEN RAISE EXCEPTION 'CHECK: Free still has a connection limit'; END IF;
 IF (SELECT max_count FROM public.connection_limits WHERE name = 'new_per_hour') <> 1000 OR (SELECT max_count FROM public.connection_limits WHERE name = 'new_per_day') <> 5000
 THEN RAISE EXCEPTION 'CHECK: the rate limits are not 1,000 per hour and 5,000 per day'; END IF;
END $$;

-- B. A Free member keeps more than 1,000 active connections. (The rate is raised here only so the test can add them
--    quickly; it is rolled back.)
UPDATE public.connection_limits SET max_count = 100000;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.ua'), 'role', 'authenticated')::text, true);
DO $$ DECLARE a uuid := current_setting('vale.ua')::uuid; BEGIN
 INSERT INTO public.connections(owner_id, full_name) SELECT a, 'Synthetic ' || i FROM generate_series(1, 1001) i;
 IF (SELECT count(*) FROM public.connections WHERE owner_id = a AND archived_at IS NULL) <> 1001 THEN RAISE EXCEPTION 'CHECK: Free stopped before 1,001 connections'; END IF;
 IF (SELECT max_active_connections FROM public.get_my_usage()) IS NOT NULL OR (SELECT active_connection_count FROM public.get_my_usage()) <> 1001 THEN RAISE EXCEPTION 'CHECK: usage reports a limit or a wrong count'; END IF;
 -- Members can't see or change the rate limits.
 BEGIN PERFORM 1 FROM public.connection_limits; RAISE EXCEPTION 'CHECK: members can read rate limits'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.connection_limits SET max_count = 1; RAISE EXCEPTION 'CHECK: members can change rate limits'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- C. The hourly limit: new connections only, per account, in one statement or many.
RESET ROLE;
UPDATE public.connection_limits SET max_count = 1005 WHERE name = 'new_per_hour';
SET LOCAL ROLE authenticated;
DO $$ DECLARE a uuid := current_setting('vale.ua')::uuid; BEGIN
 INSERT INTO public.connections(owner_id, full_name) VALUES (a, 'Under the rate');
 -- One statement that would pass the limit is refused whole.
 BEGIN INSERT INTO public.connections(owner_id, full_name) SELECT a, 'Burst ' || i FROM generate_series(1, 10) i; RAISE EXCEPTION 'CHECK: a bulk insert passed the rate limit';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF;
  IF SQLERRM NOT LIKE 'New connections are paused for now%' THEN RAISE EXCEPTION 'CHECK: unclear rate-limit message: %', SQLERRM; END IF; END;
 IF EXISTS (SELECT 1 FROM public.connections WHERE owner_id = a AND full_name LIKE 'Burst %') THEN RAISE EXCEPTION 'CHECK: part of a refused insert was kept'; END IF;
 INSERT INTO public.connections(owner_id, full_name) SELECT a, 'Up to ' || i FROM generate_series(1, 3) i;
 BEGIN INSERT INTO public.connections(owner_id, full_name) VALUES (a, 'One too many'); RAISE EXCEPTION 'CHECK: one more than the rate was allowed';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 -- Edits, archiving and unarchiving are never rate-limited.
 UPDATE public.connections SET notes = 'Edited at the rate limit' WHERE owner_id = a AND full_name = 'Synthetic 1';
 IF NOT FOUND THEN RAISE EXCEPTION 'CHECK: an edit was refused'; END IF;
 UPDATE public.connections SET archived_at = now() WHERE owner_id = a AND full_name = 'Synthetic 2';
 UPDATE public.connections SET archived_at = NULL WHERE owner_id = a AND full_name = 'Synthetic 2';
 IF NOT FOUND THEN RAISE EXCEPTION 'CHECK: unarchiving was refused'; END IF;
END $$;
-- Another account is unaffected.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.ub'), 'role', 'authenticated')::text, true);
INSERT INTO public.connections(owner_id, full_name) VALUES (current_setting('vale.ub')::uuid, 'Other account');
-- Connections older than the window stop counting.
RESET ROLE;
UPDATE public.connections SET created_at = now() - interval '2 hours' WHERE owner_id = current_setting('vale.ua')::uuid;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.ua'), 'role', 'authenticated')::text, true);
INSERT INTO public.connections(owner_id, full_name) VALUES (current_setting('vale.ua')::uuid, 'After the hour');

-- D. The daily limit applies on its own.
RESET ROLE;
UPDATE public.connection_limits SET max_count = 100000 WHERE name = 'new_per_hour';
UPDATE public.connection_limits SET max_count = 1006 WHERE name = 'new_per_day';  -- this account has added 1,006 today
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN INSERT INTO public.connections(owner_id, full_name) VALUES (current_setting('vale.ua')::uuid, 'Over the day'); RAISE EXCEPTION 'CHECK: the daily limit was not applied';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF;
  IF SQLERRM NOT LIKE '%in the last day%' THEN RAISE EXCEPTION 'CHECK: daily message unclear: %', SQLERRM; END IF; END;
END $$;
RESET ROLE;
SELECT 'PASS: Free keeps more than 1,000 connections; new connections are rate-limited per hour and per day, per account, including bulk inserts; edits, archiving and unarchiving are not; members cannot see or change the limits' AS test;
ROLLBACK;
