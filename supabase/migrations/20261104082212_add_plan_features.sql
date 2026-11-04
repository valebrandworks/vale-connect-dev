-- Which features each plan includes, adjustable by updating membership_plans.features.
-- Existing records are kept: on a plan without a feature, saved data stays readable and editable elsewhere, but its feature's fields can't change.
BEGIN;
ALTER TABLE public.membership_plans ADD COLUMN features text[] NOT NULL DEFAULT '{}';
UPDATE public.membership_plans SET features = ARRAY['dated_history', 'reminders', 'advanced_search', 'meeting_details'] WHERE code IN ('plus', 'pro');

CREATE OR REPLACE FUNCTION public.enforce_connection_rules() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 connection_limit integer;
 active_count integer;
 plan_name text;
 plan_features text[];
BEGIN
 IF coalesce(current_setting('role', true), '') NOT IN ('anon', 'authenticated') THEN RETURN NEW; END IF;
 SELECT p.max_active_connections, p.name, p.features INTO connection_limit, plan_name, plan_features FROM public.membership_plans p
  WHERE p.code = coalesce((SELECT m.plan_code FROM public.memberships m WHERE m.user_id = NEW.owner_id), 'free');
 IF NOT ('dated_history' = ANY (plan_features)) AND (
  (TG_OP = 'INSERT' AND NEW.history <> '[]'::jsonb) OR (TG_OP = 'UPDATE' AND NEW.history IS DISTINCT FROM OLD.history)) THEN
  RAISE EXCEPTION 'Dated relationship history isn''t included in your % plan. Upgrade to add dated notes.', plan_name;
 END IF;
 IF NOT ('meeting_details' = ANY (plan_features)) AND (
  (TG_OP = 'INSERT' AND (NEW.met_on IS NOT NULL OR NEW.met_where <> '' OR NEW.met_how <> '' OR NEW.introduced_by <> ''))
  OR (TG_OP = 'UPDATE' AND (NEW.met_on, NEW.met_where, NEW.met_how, NEW.introduced_by) IS DISTINCT FROM (OLD.met_on, OLD.met_where, OLD.met_how, OLD.introduced_by))) THEN
  RAISE EXCEPTION 'Meeting details and introductions aren''t included in your % plan. Upgrade to add them.', plan_name;
 END IF;
 IF NEW.archived_at IS NULL AND (TG_OP = 'INSERT' OR OLD.archived_at IS NOT NULL) THEN
  PERFORM pg_advisory_xact_lock(hashtextextended('connections:' || NEW.owner_id::text, 0));
  SELECT count(*) INTO active_count FROM public.connections c WHERE c.owner_id = NEW.owner_id AND c.archived_at IS NULL;
  IF connection_limit IS NOT NULL AND active_count >= connection_limit THEN
   RAISE EXCEPTION 'Your % plan includes % active connections. Archive one or upgrade to add more.', plan_name, connection_limit;
  END IF;
 END IF;
 IF TG_OP = 'INSERT' THEN
  NEW.revision := 0;
  NEW.created_at := now();
 ELSE
  NEW.revision := OLD.revision + 1;
  NEW.created_at := OLD.created_at;
 END IF;
 NEW.updated_at := now();
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.enforce_connection_rules() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.get_my_features() RETURNS text[]
 LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO '' AS $$
 SELECT p.features FROM public.membership_plans p
 WHERE p.code = coalesce((SELECT m.plan_code FROM public.memberships m WHERE m.user_id = (SELECT auth.uid())), 'free')
$$;
REVOKE ALL ON FUNCTION public.get_my_features() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_features() TO authenticated;
COMMIT;
