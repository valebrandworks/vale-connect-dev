-- Report This Card, stage C: open any one report by its id.
-- The review page used to find a report by scanning the first 200 rows of admin_list_reports, so older reports
-- could not be opened once there were more. This returns exactly one report (by primary key), with the same fields
-- and the same admin check as the list: a listed admin signed in with two-step verification. Nothing else changes.
BEGIN;

CREATE FUNCTION public.admin_get_report(p_report_id uuid)
 RETURNS TABLE (id uuid, card_id uuid, card_slug text, card_snapshot jsonb, card_current jsonb, card_published boolean, card_hidden boolean,
  category text, details text, reporter_email text, status text, repeat_count integer, legal_hold boolean,
  created_at timestamptz, last_reported_at timestamptz, closed_at timestamptz,
  reports_on_card bigint, reporter_dismissed bigint, reporter_blocked boolean)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 PERFORM vale_private.require_admin();
 RETURN QUERY
 SELECT r.id, r.card_id, r.card_slug, r.card_snapshot,
  CASE WHEN c.id IS NOT NULL THEN jsonb_strip_nulls(jsonb_build_object('display_name', c.display_name, 'job_title', c.job_title,
   'business_name', c.business_name, 'introduction', c.introduction, 'public_email', c.public_email, 'public_phone', c.public_phone,
   'website', c.website, 'social_links', c.social_links, 'appearance', c.appearance, 'has_photo', c.photo_path IS NOT NULL, 'has_logo', c.logo_path IS NOT NULL)) END,
  c.published, h.card_id IS NOT NULL,
  r.category, r.details, r.reporter_email, r.status, r.repeat_count, r.legal_hold, r.created_at, r.last_reported_at, r.closed_at,
  (SELECT count(*) FROM vale_private.card_reports o WHERE o.card_id = r.card_id),
  (SELECT count(*) FROM vale_private.card_reports o WHERE o.network_hash = r.network_hash AND o.status = 'dismissed'),
  EXISTS (SELECT 1 FROM vale_private.blocked_reporters b WHERE b.network_hash = r.network_hash)
 FROM vale_private.card_reports r
 LEFT JOIN public.public_cards c ON c.id = r.card_id
 LEFT JOIN vale_private.card_holds h ON h.card_id = r.card_id
 WHERE r.id = p_report_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_get_report(uuid) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.admin_get_report(uuid) TO authenticated;

COMMIT;
