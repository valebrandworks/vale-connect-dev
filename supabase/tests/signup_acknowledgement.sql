-- Transaction-only test of the server-side sign-up acknowledgement (the Before User Created hook, migration 20261124000000): an account may only be
-- created when the sign-up data carries the current agreement version and true Terms, age-18 and U.S.-residency confirmations. It verifies that
-- the confirmations were supplied, nothing more (no age or location check exists). All fixtures roll back. Never run against production.
BEGIN;
-- A helper to build an event; only exists inside this transaction.
CREATE FUNCTION pg_temp.ev(meta jsonb, email text DEFAULT 'person@gmail.com') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('user', jsonb_build_object('email', email, 'user_metadata', meta), 'metadata', jsonb_build_object('name', 'before-user-created'))
$$;
CREATE FUNCTION pg_temp.refused(e jsonb) RETURNS boolean LANGUAGE sql AS $$
 SELECT coalesce((vale_private.before_user_created(e)->'error'->>'http_code') = '400', false)
$$;
SELECT set_config('vale.err0', (SELECT count(*)::text FROM vale_private.auth_hook_log WHERE kind = 'hook_error'), true);

-- 1. Valid registration data is accepted (extra fields are fine).
DO $$ DECLARE ok jsonb := '{"agreement_version": "2026-11-v2", "agreement_terms": true, "age_18_confirmed": true, "us_resident_confirmed": true, "agreed_at": "2026-11-23T00:00:00Z"}'; BEGIN
 IF vale_private.before_user_created(pg_temp.ev(ok)) <> '{}'::jsonb THEN RAISE EXCEPTION 'CHECK: valid acknowledgement data was refused'; END IF;
 IF vale_private.before_user_created(pg_temp.ev(ok || '{"anything_else": "x"}')) <> '{}'::jsonb THEN RAISE EXCEPTION 'CHECK: extra fields caused a refusal'; END IF;
 IF vale_private.before_user_created(pg_temp.ev(ok - 'agreed_at')) <> '{}'::jsonb THEN RAISE EXCEPTION 'CHECK: the time stamp is not part of the rule'; END IF;
END $$;

-- 2. Missing data is refused: no data at all, an empty object, a missing user, and each field missing in turn.
DO $$ DECLARE ok jsonb := '{"agreement_version": "2026-11-v2", "agreement_terms": true, "age_18_confirmed": true, "us_resident_confirmed": true}'; k text; BEGIN
 IF NOT pg_temp.refused('{"user": {"email": "person@gmail.com"}}') THEN RAISE EXCEPTION 'CHECK: a sign-up without any data was accepted'; END IF;
 IF NOT pg_temp.refused(pg_temp.ev('{}')) THEN RAISE EXCEPTION 'CHECK: empty data was accepted'; END IF;
 IF NOT pg_temp.refused('{}') OR NOT pg_temp.refused('{"user": {}}') THEN RAISE EXCEPTION 'CHECK: an event without a user was accepted'; END IF;
 FOREACH k IN ARRAY ARRAY['agreement_version', 'agreement_terms', 'age_18_confirmed', 'us_resident_confirmed'] LOOP
  IF NOT pg_temp.refused(pg_temp.ev(ok - k)) THEN RAISE EXCEPTION 'CHECK: a sign-up without % was accepted', k; END IF;
 END LOOP;
 -- user_metadata that is not an object
 IF NOT pg_temp.refused(jsonb_build_object('user', jsonb_build_object('email', 'person@gmail.com', 'user_metadata', 'text'))) OR NOT pg_temp.refused(jsonb_build_object('user', jsonb_build_object('email', 'person@gmail.com', 'user_metadata', jsonb_build_array(ok)))) OR NOT pg_temp.refused(jsonb_build_object('user', jsonb_build_object('email', 'person@gmail.com', 'user_metadata', NULL::text))) THEN
  RAISE EXCEPTION 'CHECK: sign-up data that is not an object was accepted'; END IF;
END $$;

-- 3. A wrong or missing agreement version is refused.
DO $$ DECLARE ok jsonb := '{"agreement_version": "2026-11-v2", "agreement_terms": true, "age_18_confirmed": true, "us_resident_confirmed": true}'; v jsonb; BEGIN
 FOREACH v IN ARRAY ARRAY['"2026-11-v1"', '"2026-11-v3"', '""', '"2026-11-V2"', '" 2026-11-v2"', 'null', '2', '2026', 'true', '["2026-11-v2"]', '{"v": "2026-11-v2"}']::jsonb[] LOOP
  IF NOT pg_temp.refused(pg_temp.ev(jsonb_set(ok, '{agreement_version}', v))) THEN RAISE EXCEPTION 'CHECK: agreement version % was accepted', v; END IF;
 END LOOP;
END $$;

-- 4. False or non-boolean confirmations are refused, for each of the three confirmations.
DO $$ DECLARE ok jsonb := '{"agreement_version": "2026-11-v2", "agreement_terms": true, "age_18_confirmed": true, "us_resident_confirmed": true}'; k text; v jsonb; BEGIN
 FOREACH k IN ARRAY ARRAY['agreement_terms', 'age_18_confirmed', 'us_resident_confirmed'] LOOP
  FOREACH v IN ARRAY ARRAY['false', 'null', '"true"', '"yes"', '1', '0', '[true]', '{"ok": true}', '""']::jsonb[] LOOP
   IF NOT pg_temp.refused(pg_temp.ev(jsonb_set(ok, ARRAY[k], v))) THEN RAISE EXCEPTION 'CHECK: % = % was accepted', k, v; END IF;
  END LOOP;
 END LOOP;
END $$;

-- 5. Order and messages: a blocked provider still gets its own message (and is logged by domain only); the acknowledgement refusal
--    names what is missing without repeating the address, and neither refusal is recorded as a hook error.
DO $$ DECLARE r jsonb; ok jsonb := '{"agreement_version": "2026-11-v2", "agreement_terms": true, "age_18_confirmed": true, "us_resident_confirmed": true}'; BEGIN
 r := vale_private.before_user_created(pg_temp.ev(ok, 'someone@mailinator.com'));
 IF NOT coalesce(r->'error'->>'message' LIKE '%email provider%', false) THEN RAISE EXCEPTION 'CHECK: the blocked provider message changed: %', r; END IF;
 r := vale_private.before_user_created(pg_temp.ev(ok, 'someone@mailinator.com') #- '{user,user_metadata}');
 IF NOT coalesce(r->'error'->>'message' LIKE '%email provider%', false) THEN RAISE EXCEPTION 'CHECK: a blocked provider was not refused first: %', r; END IF;
 r := vale_private.before_user_created(pg_temp.ev('{}', 'secret.person@gmail.com'));
 IF NOT coalesce((r->'error'->>'http_code') = '400' AND r->'error'->>'message' LIKE '%18 or older%United States%Terms of Service and Privacy Policy%', false) THEN RAISE EXCEPTION 'CHECK: the acknowledgement refusal does not say what is needed: %', r; END IF;
 IF r::text ILIKE '%secret.person%' OR r::text ILIKE '%gmail%' THEN RAISE EXCEPTION 'CHECK: the refusal repeats the address'; END IF;
 IF (SELECT count(*) FROM vale_private.auth_hook_log WHERE kind = 'hook_error') <> current_setting('vale.err0')::int THEN RAISE EXCEPTION 'CHECK: a refusal was recorded as a hook error'; END IF;
 IF EXISTS (SELECT 1 FROM vale_private.auth_hook_log WHERE coalesce(domain, '') || coalesce(detail, '') ILIKE '%secret.person%') THEN RAISE EXCEPTION 'CHECK: the log holds an address'; END IF;
END $$;

-- 6. Failure behaviour. The SCREENING fails open (a valid sign-up still goes through when the block list cannot be read); the ACKNOWLEDGEMENT fails closed
--    (a sign-up without the required data is refused even when the screening is broken, and when the acknowledgement check itself fails).
SELECT set_config('vale.err6', (SELECT count(*)::text FROM vale_private.auth_hook_log WHERE kind = 'hook_error'), true);
ALTER TABLE vale_private.blocked_email_domains RENAME TO blocked_email_domains_x;       -- the screening now fails with an internal error
DO $$ DECLARE ok jsonb := '{"agreement_version": "2026-11-v2", "agreement_terms": true, "age_18_confirmed": true, "us_resident_confirmed": true}'; v jsonb; k text; BEGIN
 -- valid data: still accepted (fail open for the screening only)
 IF vale_private.before_user_created(pg_temp.ev(ok, 'person@gmail.com')) <> '{}'::jsonb THEN RAISE EXCEPTION 'CHECK: a screening failure blocked a valid sign-up'; END IF;
 -- missing, wrong or false acknowledgement: refused although the screening is broken
 IF NOT pg_temp.refused(pg_temp.ev('{}', 'person@gmail.com')) OR NOT pg_temp.refused('{"user": {"email": "person@gmail.com"}}') OR NOT pg_temp.refused('{}') THEN RAISE EXCEPTION 'CHECK: with the screening broken, a sign-up without acknowledgement data was accepted'; END IF;
 FOREACH k IN ARRAY ARRAY['agreement_version', 'agreement_terms', 'age_18_confirmed', 'us_resident_confirmed'] LOOP
  IF NOT pg_temp.refused(pg_temp.ev(ok - k, 'person@gmail.com')) THEN RAISE EXCEPTION 'CHECK: with the screening broken, a sign-up without % was accepted', k; END IF;
  IF k <> 'agreement_version' AND NOT pg_temp.refused(pg_temp.ev(jsonb_set(ok, ARRAY[k], 'false'), 'person@gmail.com')) THEN RAISE EXCEPTION 'CHECK: with the screening broken, % = false was accepted', k; END IF;
  IF k <> 'agreement_version' AND NOT pg_temp.refused(pg_temp.ev(jsonb_set(ok, ARRAY[k], '"true"'), 'person@gmail.com')) THEN RAISE EXCEPTION 'CHECK: with the screening broken, % = "true" was accepted', k; END IF;
 END LOOP;
 FOREACH v IN ARRAY ARRAY['"2026-11-v1"', '""', 'null', '2']::jsonb[] LOOP
  IF NOT pg_temp.refused(pg_temp.ev(jsonb_set(ok, '{agreement_version}', v), 'person@gmail.com')) THEN RAISE EXCEPTION 'CHECK: with the screening broken, version % was accepted', v; END IF;
 END LOOP;
 -- the refusal message is the acknowledgement message, not a fail-open and not a raw error
 IF NOT coalesce(vale_private.before_user_created(pg_temp.ev('{}', 'person@gmail.com'))->'error'->>'message' LIKE '%18 or older%', false) THEN RAISE EXCEPTION 'CHECK: wrong message when the screening is broken'; END IF;
END $$;
ALTER TABLE vale_private.blocked_email_domains_x RENAME TO blocked_email_domains;
DO $$ BEGIN
 IF (SELECT count(*) FROM vale_private.auth_hook_log WHERE kind = 'hook_error') <= current_setting('vale.err6')::int THEN RAISE EXCEPTION 'CHECK: the screening failures were not logged'; END IF;
 -- the screening works again and still refuses a blocked provider first
 IF NOT coalesce(vale_private.before_user_created(pg_temp.ev('{"agreement_version": "2026-11-v2", "agreement_terms": true, "age_18_confirmed": true, "us_resident_confirmed": true}', 'x@mailinator.com'))->'error'->>'message' LIKE '%email provider%', false) THEN RAISE EXCEPTION 'CHECK: blocking did not resume'; END IF;
END $$;

-- 7. Who may call what: the hook only Supabase Auth; the acknowledgement helper nobody but the database owner (the hook runs as its owner).
DO $$ DECLARE r text; BEGIN
 IF NOT has_function_privilege('supabase_auth_admin', 'vale_private.before_user_created(jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'CHECK: Supabase Auth cannot call the hook'; END IF;
 FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
  IF has_function_privilege(r, 'vale_private.before_user_created(jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'CHECK: % may call the hook', r; END IF;
  IF has_function_privilege(r, 'vale_private.signup_acknowledged(jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'CHECK: % may call the acknowledgement helper', r; END IF;
 END LOOP;
 IF has_function_privilege('supabase_auth_admin', 'vale_private.signup_acknowledged(jsonb)', 'EXECUTE') THEN RAISE EXCEPTION 'CHECK: Supabase Auth may call the helper directly'; END IF;
END $$;

-- 8. The acknowledgement check itself failing: the sign-up is refused ("try again"), never accepted, and the failure is logged. (Done last: it replaces the helper inside this transaction.)
SELECT set_config('vale.err8', (SELECT count(*)::text FROM vale_private.auth_hook_log WHERE kind = 'hook_error'), true);
CREATE OR REPLACE FUNCTION vale_private.signup_acknowledged(meta jsonb) RETURNS boolean LANGUAGE plpgsql SET search_path TO '' AS $$ BEGIN RAISE EXCEPTION 'injected acknowledgement failure'; END $$;
DO $$ DECLARE r jsonb; BEGIN
 r := vale_private.before_user_created(pg_temp.ev('{"agreement_version": "2026-11-v2", "agreement_terms": true, "age_18_confirmed": true, "us_resident_confirmed": true}', 'person@gmail.com'));
 IF NOT coalesce((r->'error'->>'http_code') = '400' AND (r->'error'->>'message') LIKE '%try again%', false) THEN RAISE EXCEPTION 'CHECK: a failing acknowledgement check did not refuse the sign-up: %', r; END IF;
 IF r::text ILIKE '%person@gmail%' OR r::text ILIKE '%injected%' THEN RAISE EXCEPTION 'CHECK: the refusal repeats the address or the internal error'; END IF;
 IF NOT pg_temp.refused(pg_temp.ev('{}', 'person@gmail.com')) THEN RAISE EXCEPTION 'CHECK: a failing acknowledgement check let an unacknowledged sign-up through'; END IF;
 IF (SELECT count(*) FROM vale_private.auth_hook_log WHERE kind = 'hook_error' AND detail LIKE '%injected acknowledgement failure%') < 2 OR (SELECT count(*) FROM vale_private.auth_hook_log WHERE kind = 'hook_error') - current_setting('vale.err8')::int < 2 THEN RAISE EXCEPTION 'CHECK: the failures were not logged'; END IF;
 IF EXISTS (SELECT 1 FROM vale_private.auth_hook_log WHERE coalesce(domain, '') || coalesce(detail, '') ILIKE '%person@%') THEN RAISE EXCEPTION 'CHECK: the log holds an address'; END IF;
END $$;
ROLLBACK;
