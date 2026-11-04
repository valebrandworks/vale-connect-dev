-- Additive: existing app versions keep working.
BEGIN;
-- Tentative, and adjustable by updating this row. Business isn't defined yet.
INSERT INTO public.membership_plans(code, name, max_cards, max_active_connections) VALUES ('pro', 'Pro', 10, NULL);

GRANT DELETE ON TABLE public.connections TO authenticated;
CREATE POLICY connections_delete_own ON public.connections FOR DELETE TO authenticated
 USING (owner_id = (SELECT auth.uid()));

-- Runs with the caller's own access, so it can only count the caller's records.
CREATE FUNCTION public.get_my_usage()
 RETURNS TABLE (plan_code text, plan_name text, max_cards integer, max_active_connections integer, card_count bigint, active_connection_count bigint, archived_connection_count bigint)
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO '' AS $$
 SELECT p.code, p.name, p.max_cards, p.max_active_connections,
  (SELECT count(*) FROM public.public_cards c WHERE c.owner_id = (SELECT auth.uid())),
  (SELECT count(*) FROM public.connections k WHERE k.owner_id = (SELECT auth.uid()) AND k.archived_at IS NULL),
  (SELECT count(*) FROM public.connections k WHERE k.owner_id = (SELECT auth.uid()) AND k.archived_at IS NOT NULL)
 FROM public.membership_plans p
 WHERE p.code = coalesce((SELECT m.plan_code FROM public.memberships m WHERE m.user_id = (SELECT auth.uid())), 'free')
$$;
REVOKE ALL ON FUNCTION public.get_my_usage() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_usage() TO authenticated;

-- Deletes the caller's own account. Cards, profile, connections and membership follow by cascade,
-- and deleted cards' link names stay retired. Requires the account email and a recent sign-in,
-- so an unattended or stolen long-lived session can't delete an account.
CREATE FUNCTION public.delete_my_account(confirm_email text) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 account_id uuid := auth.uid();
 account_email text;
 last_sign_in bigint;
BEGIN
 IF account_id IS NULL THEN RAISE EXCEPTION 'Sign in to delete your account.'; END IF;
 SELECT u.email INTO account_email FROM auth.users u WHERE u.id = account_id;
 IF account_email IS NULL OR lower(btrim(confirm_email)) IS DISTINCT FROM lower(account_email) THEN
  RAISE EXCEPTION 'That email doesn''t match this account. Nothing was deleted.';
 END IF;
 SELECT max((entry->>'timestamp')::bigint) INTO last_sign_in
  FROM jsonb_array_elements(coalesce(auth.jwt()->'amr', '[]'::jsonb)) AS entry;
 IF last_sign_in IS NULL OR last_sign_in < extract(epoch FROM now())::bigint - 600 THEN
  RAISE EXCEPTION 'Please sign in again to confirm it''s you. Nothing was deleted.';
 END IF;
 DELETE FROM auth.users u WHERE u.id = account_id;
END $$;
REVOKE ALL ON FUNCTION public.delete_my_account(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_my_account(text) TO authenticated;
COMMIT;
