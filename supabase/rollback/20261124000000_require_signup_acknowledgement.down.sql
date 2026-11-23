-- Rollback of 20261124000000_require_signup_acknowledgement.sql: puts the hook back as 20261123000000_add_auth_hardening defined it and removes the acknowledgement helper function
-- (blocked-provider refusal only, fail open). Safe to run while the hook is registered: the function is replaced, never dropped.
BEGIN;
CREATE OR REPLACE FUNCTION vale_private.before_user_created(event jsonb) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE dom text := lower(btrim(split_part(coalesce(event->'user'->>'email', ''), '@', 2)));
BEGIN
 IF dom <> '' AND vale_private.email_domain_blocked(dom) THEN
  BEGIN INSERT INTO vale_private.auth_hook_log(kind, domain) VALUES ('blocked', left(dom, 255));
  EXCEPTION WHEN OTHERS THEN NULL; END;       -- the refusal stands even if the log write fails
  RETURN jsonb_build_object('error', jsonb_build_object('http_code', 400,
   'message', 'That email provider isn''t supported for new accounts. Please use a different email address.'));
 END IF;
 RETURN '{}'::jsonb;
EXCEPTION WHEN OTHERS THEN
 BEGIN INSERT INTO vale_private.auth_hook_log(kind, detail) VALUES ('hook_error', left(SQLSTATE || ' ' || SQLERRM, 300));
 EXCEPTION WHEN OTHERS THEN NULL; END;
 RETURN '{}'::jsonb;                            -- fail open: a bug here must never stop real people signing up
END $$;
REVOKE ALL ON FUNCTION vale_private.before_user_created(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION vale_private.before_user_created(jsonb) TO supabase_auth_admin;
-- The previous hook does not call the helper, so it can go now (the hook was replaced above, never dropped).
DROP FUNCTION IF EXISTS vale_private.signup_acknowledged(jsonb);
COMMIT;
