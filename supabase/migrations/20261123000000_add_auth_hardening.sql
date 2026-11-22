-- Authentication hardening (R11), database part. Nothing here changes who may register: sign-ups are still switched on or off in the
-- Supabase dashboard, and Cloudflare Turnstile is untouched.
--
-- 1. Disposable-email protection: a "Before User Created" hook function (registered by the owner in Authentication > Hooks) that refuses
--    new accounts from a small reviewed list of throwaway-mail domains, with an allow list for false positives. It only looks at NEW
--    sign-ups. An internal failure never blocks anyone (fails open) but is recorded in vale_private.auth_hook_log so it is detectable.
-- 2. Never-confirmed accounts: public.unconfirmed_purge_candidates() lists self-sign-ups that never confirmed and are older than N days
--    (default 7), excluding anyone confirmed, signed in, invited, with a second sign-in factor or admin role, or with any data of ours.
--    It only LISTS. Deleting uses Supabase's Admin API from a separate server function (never direct SQL on auth.users here).
-- 3. Lightweight statistics: one counts-only row per day (vale_private.auth_daily_stats, no addresses) and an admin-only overview
--    (public.admin_auth_overview(), two-step sign-in enforced like every admin function).
-- No existing table is changed. Existing accounts, the admin role and the two-step rule are not touched.
BEGIN;

-- 1. Lists and logs (RLS on, no access for the API roles; the server functions below use them).
CREATE TABLE vale_private.blocked_email_domains (
 domain text PRIMARY KEY CHECK (domain = lower(domain) AND domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'),
 source text NOT NULL DEFAULT 'disposable-email-domains (CC0 1.0)',
 added_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE vale_private.allowed_email_domains (
 domain text PRIMARY KEY CHECK (domain = lower(domain) AND domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'),
 reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
 added_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE vale_private.auth_hook_log (
 id bigserial PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now(),
 kind text NOT NULL CHECK (kind IN ('blocked', 'hook_error')),
 domain text,                      -- the refused domain only, never the address
 detail text);                     -- for errors: the database error code and text, no address
CREATE INDEX auth_hook_log_created_idx ON vale_private.auth_hook_log (created_at);
CREATE TABLE vale_private.auth_maintenance_log (
 id bigserial PRIMARY KEY,
 ran_at timestamptz NOT NULL DEFAULT now(),
 kind text NOT NULL CHECK (kind IN ('purge_dry_run', 'purge_applied')),
 days integer NOT NULL, candidates integer NOT NULL, deleted integer NOT NULL DEFAULT 0);
CREATE TABLE vale_private.auth_daily_stats (
 day date PRIMARY KEY,
 new_users integer NOT NULL, confirmed_users integer NOT NULL, unconfirmed_pending integer NOT NULL,
 confirmation_emails_seen integer NOT NULL, recovery_emails_seen integer NOT NULL,   -- lower bounds: Auth keeps only each user's latest send time
 purge_candidates integer NOT NULL,
 share_accepted integer NOT NULL, share_refused integer NOT NULL, report_accepted integer NOT NULL, report_refused integer NOT NULL,
 hook_blocked integer NOT NULL, hook_errors integer NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE vale_private.blocked_email_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE vale_private.allowed_email_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE vale_private.auth_hook_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE vale_private.auth_maintenance_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE vale_private.auth_daily_stats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON vale_private.blocked_email_domains, vale_private.allowed_email_domains, vale_private.auth_hook_log,
 vale_private.auth_maintenance_log, vale_private.auth_daily_stats FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE vale_private.auth_hook_log_id_seq, vale_private.auth_maintenance_log_id_seq FROM PUBLIC, anon, authenticated, service_role;

-- Starting list: well-known throwaway-mail domains, each checked as present in the public "disposable-email-domains" list
-- (CC0 1.0 Universal, no attribution needed) and none a normal mail provider. Changes later by a reviewed statement.
INSERT INTO vale_private.blocked_email_domains(domain) VALUES
 ('mailinator.com'), ('guerrillamail.com'), ('guerrillamail.net'), ('guerrillamail.org'), ('guerrillamailblock.com'), ('sharklasers.com'),
 ('grr.la'), ('10minutemail.com'), ('10minutemail.net'), ('temp-mail.org'), ('tempmailo.com'), ('yopmail.com'), ('yopmail.net'),
 ('trashmail.com'), ('trashmail.net'), ('getnada.com'), ('nada.email'), ('dispostable.com'), ('maildrop.cc'), ('throwawaymail.com'),
 ('fakeinbox.com'), ('mohmal.com'), ('emailondeck.com'), ('mytemp.email'), ('moakt.com'), ('mailnesia.com'), ('tempr.email'),
 ('discard.email'), ('mintemail.com'), ('mailcatch.com'), ('mailnull.com'), ('spambox.us'), ('tempinbox.com'), ('mail.tm'),
 ('1secmail.com'), ('1secmail.net'), ('harakirimail.com'), ('inboxkitten.com'), ('mailforspam.com'), ('tmail.ws'), ('emailfake.com'),
 ('fakemail.net'), ('jetable.org'), ('spam4.me'), ('trbvm.com'), ('byom.de');

-- True when the domain, or any parent domain of it, is on the block list and none of them is on the allow list.
CREATE FUNCTION vale_private.email_domain_blocked(p_domain text) RETURNS boolean
 LANGUAGE sql STABLE SET search_path TO '' AS $$
 WITH RECURSIVE s(d) AS (
  SELECT lower(btrim(p_domain, ' .'))
  UNION ALL
  SELECT substr(d, strpos(d, '.') + 1) FROM s WHERE strpos(d, '.') > 0 AND strpos(d, '.') < length(d))
 SELECT EXISTS (SELECT 1 FROM vale_private.blocked_email_domains b JOIN s ON s.d = b.domain)
    AND NOT EXISTS (SELECT 1 FROM vale_private.allowed_email_domains a JOIN s ON s.d = a.domain)
$$;
REVOKE ALL ON FUNCTION vale_private.email_domain_blocked(text) FROM PUBLIC, anon, authenticated, service_role;

-- The hook. Called by Supabase Auth (role supabase_auth_admin) with {"user": {"email": ...}, "metadata": {...}} before a user is created.
-- Returns {} to allow, or {"error": {...}} to refuse. Never raises: any internal failure allows the sign-up and is logged.
CREATE FUNCTION vale_private.before_user_created(event jsonb) RETURNS jsonb
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
GRANT USAGE ON SCHEMA vale_private TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION vale_private.before_user_created(jsonb) TO supabase_auth_admin;

-- 2. Never-confirmed self-sign-ups, for the server function that deletes them through the Admin API. Lists ids only, never addresses.
-- Protected: confirmed or ever signed in, invited, anonymous or single-sign-on, any sign-in method other than email, any second factor,
-- any admin role, and anyone with a row in any of our tables that refers to the account (found from the foreign keys, so tables
-- added later are covered automatically).
CREATE FUNCTION public.unconfirmed_purge_candidates(p_days integer DEFAULT 7, p_limit integer DEFAULT 200)
 RETURNS TABLE (user_id uuid, created_at timestamptz)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE refs text;
BEGIN
 IF p_days IS NULL OR p_days < 3 OR p_limit IS NULL OR p_limit < 1 OR p_limit > 1000 THEN RAISE EXCEPTION 'Invalid purge settings.'; END IF;
 SELECT coalesce(string_agg(format(' AND NOT EXISTS (SELECT 1 FROM %s t WHERE t.%I = u.id)', c.conrelid::regclass, a.attname), ''), '')
  INTO refs
  FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
  WHERE c.contype = 'f' AND c.confrelid = 'auth.users'::regclass AND array_length(c.conkey, 1) = 1
    AND c.connamespace IN ('public'::regnamespace, 'vale_private'::regnamespace);
 RETURN QUERY EXECUTE
  'SELECT u.id, u.created_at FROM auth.users u
   WHERE u.email_confirmed_at IS NULL AND u.confirmed_at IS NULL AND u.last_sign_in_at IS NULL AND u.invited_at IS NULL
     AND NOT coalesce(u.is_anonymous, false) AND NOT coalesce(u.is_sso_user, false)
     AND u.created_at < now() - make_interval(days => $1)
     AND NOT EXISTS (SELECT 1 FROM auth.identities i WHERE i.user_id = u.id AND i.provider <> ''email'')
     AND NOT EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM vale_private.platform_admins pa WHERE pa.user_id = u.id)' || refs || '
   ORDER BY u.created_at LIMIT $2' USING p_days, p_limit;
END $$;
-- Records one run (dry run or applied) so history is visible in the admin overview. Counts only.
CREATE FUNCTION public.record_purge_run(p_kind text, p_days integer, p_candidates integer, p_deleted integer)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF p_kind NOT IN ('purge_dry_run', 'purge_applied') THEN RAISE EXCEPTION 'Invalid run.'; END IF;
 INSERT INTO vale_private.auth_maintenance_log(kind, days, candidates, deleted) VALUES (p_kind, p_days, greatest(p_candidates, 0), greatest(p_deleted, 0));
 DELETE FROM vale_private.auth_maintenance_log WHERE ran_at < now() - interval '365 days';
END $$;
REVOKE ALL ON FUNCTION public.unconfirmed_purge_candidates(integer, integer), public.record_purge_run(text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unconfirmed_purge_candidates(integer, integer), public.record_purge_run(text, integer, integer, integer) TO service_role;

-- 3. Statistics: live numbers for today, one stored row per day.
CREATE FUNCTION vale_private.auth_stats_now() RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE d0 timestamptz := date_trunc('day', now());
BEGIN
 RETURN jsonb_build_object(
  'day', (d0 AT TIME ZONE 'UTC')::date,
  'new_users', (SELECT count(*) FROM auth.users WHERE created_at >= d0),
  'confirmed_users', (SELECT count(*) FROM auth.users WHERE email_confirmed_at IS NOT NULL),
  'unconfirmed_pending', (SELECT count(*) FROM auth.users WHERE email_confirmed_at IS NULL AND invited_at IS NULL),
  'confirmation_emails_seen', (SELECT count(*) FROM auth.users WHERE confirmation_sent_at >= d0),
  'recovery_emails_seen', (SELECT count(*) FROM auth.users WHERE recovery_sent_at >= d0),
  'purge_candidates', (SELECT count(*) FROM public.unconfirmed_purge_candidates(7, 1000)),
  'share_accepted', (SELECT count(*) FROM public.share_attempts WHERE created_at >= d0 AND NOT refused),
  'share_refused', (SELECT count(*) FROM public.share_attempts WHERE created_at >= d0 AND refused),
  'report_accepted', (SELECT count(*) FROM vale_private.report_attempts WHERE created_at >= d0 AND NOT refused),
  'report_refused', (SELECT count(*) FROM vale_private.report_attempts WHERE created_at >= d0 AND refused),
  'hook_blocked', (SELECT count(*) FROM vale_private.auth_hook_log WHERE created_at >= d0 AND kind = 'blocked'),
  'hook_errors', (SELECT count(*) FROM vale_private.auth_hook_log WHERE created_at >= d0 AND kind = 'hook_error'));
END $$;
CREATE FUNCTION vale_private.record_auth_stats() RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE s jsonb := vale_private.auth_stats_now();
BEGIN
 INSERT INTO vale_private.auth_daily_stats(day, new_users, confirmed_users, unconfirmed_pending, confirmation_emails_seen, recovery_emails_seen,
  purge_candidates, share_accepted, share_refused, report_accepted, report_refused, hook_blocked, hook_errors)
 VALUES ((s->>'day')::date, (s->>'new_users')::int, (s->>'confirmed_users')::int, (s->>'unconfirmed_pending')::int,
  (s->>'confirmation_emails_seen')::int, (s->>'recovery_emails_seen')::int, (s->>'purge_candidates')::int,
  (s->>'share_accepted')::int, (s->>'share_refused')::int, (s->>'report_accepted')::int, (s->>'report_refused')::int,
  (s->>'hook_blocked')::int, (s->>'hook_errors')::int)
 ON CONFLICT (day) DO UPDATE SET new_users = EXCLUDED.new_users, confirmed_users = EXCLUDED.confirmed_users,
  unconfirmed_pending = EXCLUDED.unconfirmed_pending, confirmation_emails_seen = EXCLUDED.confirmation_emails_seen,
  recovery_emails_seen = EXCLUDED.recovery_emails_seen, purge_candidates = EXCLUDED.purge_candidates,
  share_accepted = EXCLUDED.share_accepted, share_refused = EXCLUDED.share_refused, report_accepted = EXCLUDED.report_accepted,
  report_refused = EXCLUDED.report_refused, hook_blocked = EXCLUDED.hook_blocked, hook_errors = EXCLUDED.hook_errors, updated_at = now();
 DELETE FROM vale_private.auth_daily_stats WHERE day < current_date - 400;
 DELETE FROM vale_private.auth_hook_log WHERE created_at < now() - interval '90 days';
END $$;
REVOKE ALL ON FUNCTION vale_private.auth_stats_now(), vale_private.record_auth_stats() FROM PUBLIC, anon, authenticated, service_role;

-- Administrator view: counts and recent history only (no addresses). Same two-step rule as every other admin function.
CREATE FUNCTION public.admin_auth_overview() RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 PERFORM vale_private.require_admin();
 RETURN jsonb_build_object(
  'now', vale_private.auth_stats_now(),
  'history', coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.day DESC) FROM (SELECT * FROM vale_private.auth_daily_stats ORDER BY day DESC LIMIT 30) h), '[]'::jsonb),
  'hook_recent', coalesce((SELECT jsonb_agg(jsonb_build_object('at', l.created_at, 'kind', l.kind, 'domain', l.domain) ORDER BY l.created_at DESC)
                           FROM (SELECT * FROM vale_private.auth_hook_log ORDER BY created_at DESC LIMIT 20) l), '[]'::jsonb),
  'purge_runs', coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.ran_at DESC) FROM (SELECT ran_at, kind, days, candidates, deleted FROM vale_private.auth_maintenance_log ORDER BY ran_at DESC LIMIT 10) m), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.admin_auth_overview() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_auth_overview() TO authenticated;

-- Daily snapshot with Supabase's built-in scheduler (pg_cron, free), where available. Local test databases skip this.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
  EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog';
  EXECUTE $c$SELECT cron.schedule('vale-auth-daily-stats', '55 23 * * *', 'SELECT vale_private.record_auth_stats()')$c$;
 END IF;
END $$;

COMMIT;
