-- Transaction-only test of the R11 authentication hardening (database part): the disposable-email hook (blocks, parent domains, allow list,
-- fail-open with a logged error, who may call it), the list of never-confirmed accounts that may be purged (exactly the intended ones;
-- every protected kind stays out), the daily statistics and the administrator-only overview.
-- All fixtures roll back. Never run against production.
BEGIN;
SELECT set_config('vale.' || n, gen_random_uuid()::text, true) FROM unnest(ARRAY['old1','old2','young','exact','confirmed','signedin','invited','mfa','admin','google','data','anon','aal','plain']) n;
INSERT INTO auth.users(id, email, created_at, email_confirmed_at, last_sign_in_at, invited_at, is_anonymous)
SELECT current_setting('vale.' || n)::uuid, 'ah-' || n || '-' || current_setting('vale.' || n) || '@example.invalid', now() - age, conf, signin, inv, anon
FROM (VALUES
 ('old1',      interval '10 days', NULL::timestamptz, NULL::timestamptz, NULL::timestamptz, false),
 ('old2',      interval '30 days', NULL, NULL, NULL, false),
 ('young',     interval '2 days',  NULL, NULL, NULL, false),
 ('exact',     interval '7 days',  NULL, NULL, NULL, false),     -- exactly 7 days is not "older than 7 days"
 ('confirmed', interval '10 days', now() - interval '9 days', NULL, NULL, false),
 ('signedin',  interval '10 days', NULL, now() - interval '5 days', NULL, false),
 ('invited',   interval '60 days', NULL, NULL, now() - interval '60 days', false),
 ('mfa',       interval '10 days', NULL, NULL, NULL, false),
 ('admin',     interval '10 days', NULL, NULL, NULL, false),
 ('google',    interval '10 days', NULL, NULL, NULL, false),
 ('data',      interval '10 days', NULL, NULL, NULL, false),
 ('anon',      interval '10 days', NULL, NULL, NULL, true),
 ('aal',       interval '10 days', now() - interval '9 days', NULL, NULL, false),
 ('plain',     interval '10 days', now() - interval '9 days', NULL, NULL, false)) v(n, age, conf, signin, inv, anon);
INSERT INTO auth.identities(user_id, provider, provider_id, identity_data) VALUES (current_setting('vale.google')::uuid, 'google', current_setting('vale.google'), '{}'::jsonb);
INSERT INTO auth.mfa_factors(id, user_id, friendly_name, factor_type, status, created_at, updated_at) VALUES (gen_random_uuid(), current_setting('vale.mfa')::uuid, 'test', 'totp', 'verified', now(), now());
INSERT INTO vale_private.platform_admins(user_id, note) VALUES (current_setting('vale.admin')::uuid, 'test admin');
INSERT INTO public.public_cards(id, owner_id, slug, display_name, public_email, public_phone, published)
 VALUES (gen_random_uuid(), current_setting('vale.data')::uuid, 'ah-data-' || left(current_setting('vale.data'), 8), 'Has Data', '', '', false);
INSERT INTO vale_private.platform_admins(user_id, note) VALUES (current_setting('vale.aal')::uuid, 'confirmed admin for the overview tests');

-- 1. Block list: domain, parent domain, case and spaces; normal providers pass; the allow list wins.
DO $$ BEGIN
 IF NOT vale_private.email_domain_blocked('mailinator.com') THEN RAISE EXCEPTION 'CHECK: a listed domain was not blocked'; END IF;
 IF NOT vale_private.email_domain_blocked('Sub.Mailinator.COM ') THEN RAISE EXCEPTION 'CHECK: a subdomain of a listed domain was not blocked'; END IF;
 IF vale_private.email_domain_blocked('gmail.com') OR vale_private.email_domain_blocked('outlook.com') OR vale_private.email_domain_blocked('valebrandworks.com') THEN RAISE EXCEPTION 'CHECK: a normal provider was blocked'; END IF;
 IF vale_private.email_domain_blocked('notmailinator.com') THEN RAISE EXCEPTION 'CHECK: a look-alike domain was blocked'; END IF;
 IF vale_private.email_domain_blocked('') OR vale_private.email_domain_blocked('com') THEN RAISE EXCEPTION 'CHECK: an empty or top-level value was blocked'; END IF;
 INSERT INTO vale_private.allowed_email_domains(domain, reason) VALUES ('mailinator.com', 'test override');
 IF vale_private.email_domain_blocked('mailinator.com') OR vale_private.email_domain_blocked('x.mailinator.com') THEN RAISE EXCEPTION 'CHECK: the allow list did not override the block list'; END IF;
 DELETE FROM vale_private.allowed_email_domains WHERE domain = 'mailinator.com';
END $$;

-- 2. The hook (called as its owner; who may call it is asserted below): refuses with a clear message, logs the domain only, never refuses anything else.
DO $$ DECLARE r jsonb; BEGIN
 r := vale_private.before_user_created('{"user": {"email": "Someone@Guerrillamail.com"}, "metadata": {"ip_address": "203.0.113.9"}}'::jsonb);
 IF (r->'error'->>'http_code') <> '400' OR coalesce(r->'error'->>'message', '') = '' THEN RAISE EXCEPTION 'CHECK: a disposable address was not refused with a message: %', r; END IF;
 IF r::text LIKE '%Someone%' THEN RAISE EXCEPTION 'CHECK: the refusal repeats the address'; END IF;
 IF vale_private.before_user_created('{"user": {"email": "person@gmail.com"}}'::jsonb) <> '{}'::jsonb THEN RAISE EXCEPTION 'CHECK: a normal address was refused'; END IF;
 IF vale_private.before_user_created('{"user": {}}'::jsonb) <> '{}'::jsonb OR vale_private.before_user_created('{}'::jsonb) <> '{}'::jsonb THEN RAISE EXCEPTION 'CHECK: a request without an address was refused'; END IF;
END $$;
DO $$ BEGIN
 IF (SELECT count(*) FROM vale_private.auth_hook_log WHERE kind = 'blocked' AND domain = 'guerrillamail.com') < 1 THEN RAISE EXCEPTION 'CHECK: the refusal was not logged by domain'; END IF;
 IF EXISTS (SELECT 1 FROM vale_private.auth_hook_log WHERE coalesce(domain, '') || coalesce(detail, '') ILIKE '%someone%') THEN RAISE EXCEPTION 'CHECK: the log holds an address'; END IF;
END $$;
-- 2b. An internal failure lets the sign-up through (fail open) and is recorded, so it can be noticed.
SELECT set_config('vale.err0', (SELECT count(*)::text FROM vale_private.auth_hook_log WHERE kind = 'hook_error'), true), set_config('vale.blk0', (SELECT count(*)::text FROM vale_private.auth_hook_log WHERE kind = 'blocked' AND domain = 'guerrillamail.com'), true);
ALTER TABLE vale_private.blocked_email_domains RENAME TO blocked_email_domains_x;
DO $$ BEGIN
 IF vale_private.before_user_created('{"user": {"email": "person@mailinator.com"}}'::jsonb) <> '{}'::jsonb THEN RAISE EXCEPTION 'CHECK: a hook failure blocked a sign-up'; END IF;
END $$;
ALTER TABLE vale_private.blocked_email_domains_x RENAME TO blocked_email_domains;
DO $$ BEGIN
 IF (SELECT count(*) FROM vale_private.auth_hook_log WHERE kind = 'hook_error' AND detail <> '') - current_setting('vale.err0')::int <> 1 THEN RAISE EXCEPTION 'CHECK: the hook failure was not logged'; END IF;
 IF vale_private.before_user_created('{"user": {"email": "person@mailinator.com"}}'::jsonb)->'error' IS NULL THEN RAISE EXCEPTION 'CHECK: blocking did not resume after the failure'; END IF;
END $$;
-- Only Supabase Auth may call the hook and the helper.
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
  EXECUTE format('SET LOCAL ROLE %I', r);
  BEGIN PERFORM vale_private.before_user_created('{"user": {"email": "x@mailinator.com"}}'::jsonb); RAISE EXCEPTION 'CHECK: % called the hook', r;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
 END LOOP;
END $$;
DO $$ BEGIN
 IF NOT has_function_privilege('supabase_auth_admin', 'vale_private.before_user_created(jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'CHECK: Supabase Auth cannot call the hook'; END IF;
 IF has_function_privilege('supabase_auth_admin', 'vale_private.email_domain_blocked(text)', 'EXECUTE') THEN RAISE EXCEPTION 'CHECK: the hook role can call the helper directly'; END IF;
 IF has_function_privilege('supabase_auth_admin', 'public.unconfirmed_purge_candidates(integer, integer, uuid)', 'EXECUTE') OR has_function_privilege('supabase_auth_admin', 'public.record_purge_run(text, integer, integer, integer)', 'EXECUTE') THEN RAISE EXCEPTION 'CHECK: the hook role can use the purge functions'; END IF;
 IF has_table_privilege('supabase_auth_admin', 'vale_private.blocked_email_domains', 'SELECT') THEN RAISE EXCEPTION 'CHECK: the hook role can read the list directly'; END IF;
END $$;

-- 3. Purge candidates: exactly the two old never-confirmed accounts; every protected kind is left out.
SET LOCAL ROLE service_role;
CREATE TEMP TABLE ah_found ON COMMIT DROP AS SELECT * FROM public.unconfirmed_purge_candidates(7, 200);
GRANT SELECT ON ah_found TO PUBLIC;
RESET ROLE;
DO $$ DECLARE bad text; BEGIN
 SELECT string_agg(n, ', ') INTO bad FROM unnest(ARRAY['young','exact','confirmed','signedin','invited','mfa','admin','google','data','anon','aal','plain']) n
  WHERE EXISTS (SELECT 1 FROM pg_temp.ah_found f WHERE f.user_id = current_setting('vale.' || n)::uuid);
 IF bad IS NOT NULL THEN RAISE EXCEPTION 'CHECK: protected accounts listed for deletion: %', bad; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_temp.ah_found WHERE user_id = current_setting('vale.old1')::uuid)
    OR NOT EXISTS (SELECT 1 FROM pg_temp.ah_found WHERE user_id = current_setting('vale.old2')::uuid) THEN RAISE EXCEPTION 'CHECK: an old never-confirmed account was not listed'; END IF;
 IF (SELECT count(*) FROM pg_temp.ah_found) <> 2 THEN RAISE EXCEPTION 'CHECK: expected exactly 2 candidates, found %', (SELECT count(*) FROM pg_temp.ah_found); END IF;
 IF (SELECT user_id FROM pg_temp.ah_found ORDER BY created_at LIMIT 1) <> current_setting('vale.old2')::uuid THEN RAISE EXCEPTION 'CHECK: oldest first expected'; END IF;
END $$;
-- Limits and invalid settings; nothing leaks addresses; who may call it.
DO $$ BEGIN
 IF (SELECT count(*) FROM public.unconfirmed_purge_candidates(7, 1)) <> 1 THEN RAISE EXCEPTION 'CHECK: the batch limit was ignored'; END IF;
 IF (SELECT count(*) FROM public.unconfirmed_purge_candidates(9, 200)) <> 2 THEN RAISE EXCEPTION 'CHECK: a 9-day rule should still list both (10 and 30 days old)'; END IF;
 IF (SELECT count(*) FROM public.unconfirmed_purge_candidates(20, 200)) <> 1 THEN RAISE EXCEPTION 'CHECK: a 20-day rule should list only the 30-day-old account'; END IF;
 BEGIN PERFORM * FROM public.unconfirmed_purge_candidates(1, 200); RAISE EXCEPTION 'CHECK: a 1-day purge rule was accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 BEGIN PERFORM * FROM public.unconfirmed_purge_candidates(7, 5000); RAISE EXCEPTION 'CHECK: a huge batch was accepted'; EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
END $$;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
  EXECUTE format('SET LOCAL ROLE %I', r);
  BEGIN PERFORM * FROM public.unconfirmed_purge_candidates(7, 200); RAISE EXCEPTION 'CHECK: % listed purge candidates', r;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN PERFORM public.record_purge_run('purge_dry_run', 7, 2, 0); RAISE EXCEPTION 'CHECK: % recorded a purge run', r;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
 END LOOP;
END $$;
SET LOCAL ROLE service_role;
SELECT public.record_purge_run('purge_started', 7, 2, 0);
SELECT public.record_purge_run('purge_dry_run', 7, 2, 0);
DO $$ BEGIN BEGIN PERFORM public.record_purge_run('delete_everything', 7, 2, 0); RAISE EXCEPTION 'CHECK: an unknown run kind was accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END; END $$;
RESET ROLE;
-- The same list can be asked about ONE account (used to re-check right before a deletion): protected accounts and unknown ids give nothing.
DO $$ DECLARE n text; BEGIN
 IF (SELECT count(*) FROM public.unconfirmed_purge_candidates(7, 200, current_setting('vale.old2')::uuid)) <> 1 THEN RAISE EXCEPTION 'CHECK: an eligible account was not confirmed eligible'; END IF;
 IF (SELECT count(*) FROM public.unconfirmed_purge_candidates(7, 200, gen_random_uuid())) <> 0 THEN RAISE EXCEPTION 'CHECK: an unknown id was listed'; END IF;
 FOREACH n IN ARRAY ARRAY['young','exact','confirmed','signedin','invited','mfa','admin','google','data','anon','aal','plain'] LOOP
  IF EXISTS (SELECT 1 FROM public.unconfirmed_purge_candidates(7, 200, current_setting('vale.' || n)::uuid)) THEN RAISE EXCEPTION 'CHECK: protected account % confirmed eligible', n; END IF;
 END LOOP;
END $$;
-- An account that becomes protected after the list was made is no longer eligible: it confirms, signs in, or gets a card or a second factor.
UPDATE auth.users SET email_confirmed_at = now() WHERE id = current_setting('vale.old2')::uuid;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.unconfirmed_purge_candidates(7, 200, current_setting('vale.old2')::uuid)) THEN RAISE EXCEPTION 'CHECK: an account that confirmed was still eligible'; END IF; END $$;
UPDATE auth.users SET email_confirmed_at = NULL, last_sign_in_at = now() WHERE id = current_setting('vale.old2')::uuid;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.unconfirmed_purge_candidates(7, 200, current_setting('vale.old2')::uuid)) THEN RAISE EXCEPTION 'CHECK: an account that signed in was still eligible'; END IF; END $$;
UPDATE auth.users SET last_sign_in_at = NULL WHERE id = current_setting('vale.old2')::uuid;
INSERT INTO auth.mfa_factors(id, user_id, friendly_name, factor_type, status, created_at, updated_at) VALUES (gen_random_uuid(), current_setting('vale.old2')::uuid, 'test', 'totp', 'verified', now(), now());
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.unconfirmed_purge_candidates(7, 200, current_setting('vale.old2')::uuid)) THEN RAISE EXCEPTION 'CHECK: an account that gained a second factor was still eligible'; END IF; END $$;
DELETE FROM auth.mfa_factors WHERE user_id = current_setting('vale.old2')::uuid;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM public.unconfirmed_purge_candidates(7, 200, current_setting('vale.old2')::uuid)) THEN RAISE EXCEPTION 'CHECK: the account was not eligible again after the changes were undone'; END IF; END $$;
-- Deleting an account removes nothing the list protects, and the list reacts to data appearing later (found from the foreign keys).
INSERT INTO public.public_cards(id, owner_id, slug, display_name, public_email, public_phone, published)
 VALUES (gen_random_uuid(), current_setting('vale.old1')::uuid, 'ah-late-' || left(current_setting('vale.old1'), 8), 'Late Data', '', '', false);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.unconfirmed_purge_candidates(7, 200) WHERE user_id = current_setting('vale.old1')::uuid) THEN RAISE EXCEPTION 'CHECK: an account that gained data was still listed'; END IF;
END $$;

-- 4. Statistics: counts only, idempotent per day.
INSERT INTO auth.users(id, email, created_at, confirmation_sent_at) VALUES (gen_random_uuid(), 'ah-today@example.invalid', now(), now());
SELECT vale_private.record_auth_stats();
SELECT vale_private.record_auth_stats();
DO $$ DECLARE s record; BEGIN
 SELECT * INTO s FROM vale_private.auth_daily_stats WHERE day = (now() AT TIME ZONE 'UTC')::date;
 IF (SELECT count(*) FROM vale_private.auth_daily_stats WHERE day = (now() AT TIME ZONE 'UTC')::date) <> 1 THEN RAISE EXCEPTION 'CHECK: one row per day expected'; END IF;
 IF s.hook_blocked < 2 OR s.hook_errors < 1 THEN RAISE EXCEPTION 'CHECK: hook counts wrong: % blocked, % errors', s.hook_blocked, s.hook_errors; END IF;
 IF s.purge_candidates <> 1 THEN RAISE EXCEPTION 'CHECK: purge candidate count wrong: %', s.purge_candidates; END IF;   -- old1 gained data above
 IF s.new_users < 1 OR s.confirmation_emails_seen < 1 THEN RAISE EXCEPTION 'CHECK: today''s new account and email were not counted'; END IF;
 IF s.unconfirmed_pending < 5 THEN RAISE EXCEPTION 'CHECK: unconfirmed count wrong: %', s.unconfirmed_pending; END IF;
END $$;

-- 5. Overview: a listed admin with two-step sign-in only; no addresses in it.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.plain'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.admin_auth_overview(); RAISE EXCEPTION 'CHECK: an ordinary account opened the overview'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.aal'), 'role', 'authenticated', 'aal', 'aal1')::text, true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
 BEGIN PERFORM public.admin_auth_overview(); RAISE EXCEPTION 'CHECK: an admin without two-step sign-in opened the overview'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.aal'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
SET LOCAL ROLE authenticated;
DO $$ DECLARE o jsonb; BEGIN
 o := public.admin_auth_overview();
 IF NOT (o ? 'now' AND o ? 'history' AND o ? 'hook_recent' AND o ? 'purge_runs') THEN RAISE EXCEPTION 'CHECK: overview is missing parts: %', o; END IF;
 IF o::text ILIKE '%@example.invalid%' OR o::text ILIKE '%someone%' THEN RAISE EXCEPTION 'CHECK: the overview shows an address'; END IF;
 IF jsonb_array_length(o->'purge_runs') < 2 OR (o->'now'->>'new_users')::int < 1 OR (o->'now'->>'confirmation_emails_seen')::int < 1 THEN RAISE EXCEPTION 'CHECK: overview numbers wrong: %', o; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE r text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon', 'service_role'] LOOP
  EXECUTE format('SET LOCAL ROLE %I', r);
  BEGIN PERFORM public.admin_auth_overview(); RAISE EXCEPTION 'CHECK: % opened the overview', r; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  EXECUTE 'RESET ROLE';
 END LOOP;
END $$;

-- 6. The lists and logs are closed to every API role (no table privilege at all, on top of the private schema).
DO $$ DECLARE r text; tb text; BEGIN
 FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'supabase_auth_admin'] LOOP
  FOREACH tb IN ARRAY ARRAY['blocked_email_domains', 'allowed_email_domains', 'auth_hook_log', 'auth_maintenance_log', 'auth_daily_stats'] LOOP
   IF has_table_privilege(r, 'vale_private.' || tb, 'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'CHECK: % has access to vale_private.%', r, tb; END IF;
  END LOOP;
 END LOOP;
END $$;
ROLLBACK;
