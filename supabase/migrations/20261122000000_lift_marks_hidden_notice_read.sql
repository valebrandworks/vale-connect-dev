-- Report This Card: lifting a restriction also marks the card's "card hidden" notice as read.
-- That notice is out of date once the restriction is lifted (the owner gets a "restriction lifted" notice instead).
-- It was never shown in the app, but it stayed unread, so it was kept 365 days instead of 90. admin_restore_card is
-- otherwise unchanged: it still leaves the card private, tells the owner, and logs the decision. Same signature and
-- permissions. A one-time tidy marks existing "card hidden" notices read where the card is no longer hidden.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_restore_card(p_card_id uuid, p_note text)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 uid uuid := vale_private.require_admin();
 hold vale_private.card_holds%ROWTYPE;
 v_owner uuid;
 v_note text := vale_private.clean_note(p_note, true);
BEGIN
 SELECT * INTO hold FROM vale_private.card_holds h WHERE h.card_id = p_card_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'That card isn''t hidden.'; END IF;
 SELECT c.owner_id INTO v_owner FROM public.public_cards c WHERE c.id = p_card_id FOR UPDATE;
 DELETE FROM vale_private.card_holds WHERE card_id = p_card_id;
 -- The card is not published here. Only its owner can publish it again.
 -- Its "card hidden" notice is now out of date.
 UPDATE public.notifications SET read_at = now() WHERE owner_id = v_owner AND card_id = p_card_id AND kind = 'card_hidden' AND read_at IS NULL;
 INSERT INTO public.notifications(owner_id, kind, card_id) VALUES (v_owner, 'card_restored', p_card_id);
 INSERT INTO vale_private.moderation_actions(admin_id, action, report_id, card_id, note) VALUES (uid, 'restore_card', hold.report_id, p_card_id, v_note);
END $$;

-- One-time tidy: "card hidden" notices whose card is no longer hidden (on development: 1, from the manual test).
UPDATE public.notifications n SET read_at = now()
 WHERE n.kind = 'card_hidden' AND n.read_at IS NULL
   AND NOT EXISTS (SELECT 1 FROM vale_private.card_holds h WHERE h.card_id = n.card_id);

COMMIT;
