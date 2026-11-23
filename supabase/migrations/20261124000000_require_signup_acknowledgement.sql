-- Sign-up acknowledgement, checked on the server (extends the Before User Created hook from 20261123000000_add_auth_hardening).
--
-- The sign-up page records, with every new account: the agreement version, that the Terms were accepted, and that the person confirmed they are
-- 18 or older and live in the United States. This hook now refuses any new account whose sign-up data does not carry exactly that, so a
-- request that skips the page (a direct call to the sign-up service) cannot create an account without it.
--
-- What this is NOT: it does not verify anyone's age, location or consent. It only requires that the confirmations were supplied, and the values
-- are whatever the caller sent. It is a check that the acknowledgement step was not skipped, not an identity or eligibility check.
--
-- Which sign-ups it applies to: every account Supabase Auth creates through the hook, i.e. self sign-up AND invitations or one-time-link
-- creation (they carry no sign-up data and are indistinguishable from a sign-up that skipped the page). Accounts created with the dashboard's
-- "Create new user" / the Admin "create user" API bypass the hook and are unaffected. Nothing in the public sign-up flow uses invitations.
--
-- Everything else in the hook is unchanged: the blocked-provider refusal runs first and is logged exactly as before; an internal failure still
-- lets the sign-up through (fail open) and is recorded in vale_private.auth_hook_log.
--
-- KEEP IN STEP with the page: the accepted version below must equal AGREEMENT_VERSION in auth-core.js (a test checks this). When the Terms or
-- Privacy Policy change and the version is raised, add the new version to the list here in the same release.
BEGIN;

CREATE OR REPLACE FUNCTION vale_private.before_user_created(event jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 dom text := lower(btrim(split_part(coalesce(event->'user'->>'email', ''), '@', 2)));
 meta jsonb := CASE WHEN jsonb_typeof(event->'user'->'user_metadata') = 'object' THEN event->'user'->'user_metadata' ELSE '{}'::jsonb END;
 accepted_versions text[] := ARRAY['2026-11-v2'];
BEGIN
 IF dom <> '' AND vale_private.email_domain_blocked(dom) THEN
  BEGIN INSERT INTO vale_private.auth_hook_log(kind, domain) VALUES ('blocked', left(dom, 255));
  EXCEPTION WHEN OTHERS THEN NULL; END;       -- the refusal stands even if the log write fails
  RETURN jsonb_build_object('error', jsonb_build_object('http_code', 400,
   'message', 'That email provider isn''t supported for new accounts. Please use a different email address.'));
 END IF;
 -- Each value must be present and exactly right: the JSON boolean true (not "true", 1 or null) and a version we currently accept.
 IF jsonb_typeof(meta->'agreement_version') IS DISTINCT FROM 'string' OR NOT ((meta->>'agreement_version') = ANY (accepted_versions))
    OR meta->'agreement_terms' IS DISTINCT FROM 'true'::jsonb
    OR meta->'age_18_confirmed' IS DISTINCT FROM 'true'::jsonb
    OR meta->'us_resident_confirmed' IS DISTINCT FROM 'true'::jsonb THEN
  RETURN jsonb_build_object('error', jsonb_build_object('http_code', 400,
   'message', 'Please confirm you are 18 or older, live in the United States, and agree to the Terms of Service and Privacy Policy to create an account.'));
 END IF;
 RETURN '{}'::jsonb;
EXCEPTION WHEN OTHERS THEN
 BEGIN INSERT INTO vale_private.auth_hook_log(kind, detail) VALUES ('hook_error', left(SQLSTATE || ' ' || SQLERRM, 300));
 EXCEPTION WHEN OTHERS THEN NULL; END;
 RETURN '{}'::jsonb;                            -- fail open: a bug here must never stop real people signing up
END $$;
REVOKE ALL ON FUNCTION vale_private.before_user_created(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION vale_private.before_user_created(jsonb) TO supabase_auth_admin;

COMMIT;
