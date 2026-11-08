-- Apply only after a page using get_public_card is live on that environment, or public card links will stop working.
BEGIN;
REVOKE SELECT ON TABLE public.public_cards FROM anon;
DROP POLICY "Public can view published cards" ON public.public_cards;
CREATE POLICY public_cards_select_own ON public.public_cards
 FOR SELECT TO authenticated USING (owner_id = (SELECT auth.uid()));
COMMIT;
