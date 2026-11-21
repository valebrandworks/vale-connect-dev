-- Reverses 20261122000000_lift_marks_hidden_notice_read.sql. Development only; take a verified backup first.
-- Puts back admin_restore_card exactly as in 20261121000100 (lifting leaves "card hidden" notices unread).
-- Notices already marked read stay read; that has no visible effect. Roll this back before 20261121000100.
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
 INSERT INTO public.notifications(owner_id, kind, card_id) VALUES (v_owner, 'card_restored', p_card_id);
 INSERT INTO vale_private.moderation_actions(admin_id, action, report_id, card_id, note) VALUES (uid, 'restore_card', hold.report_id, p_card_id, v_note);
END $$;

COMMIT;
