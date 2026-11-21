-- Reverses 20261121000100_lift_restriction_keeps_card_private.sql. Development only; take a verified backup first.
-- Puts back the stage A behaviour: lifting a restriction makes the card public again at once. Cards whose
-- restriction was already lifted stay as they are (private until their owners publish them); no data changes.
-- Roll this back before 20261121000000 and 20261114000000.
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
 UPDATE public.public_cards SET published = true WHERE id = p_card_id;
 INSERT INTO public.notifications(owner_id, kind, card_id) VALUES (v_owner, 'card_restored', p_card_id);
 INSERT INTO vale_private.moderation_actions(admin_id, action, report_id, card_id, note) VALUES (uid, 'restore_card', hold.report_id, p_card_id, v_note);
END $$;

COMMIT;
