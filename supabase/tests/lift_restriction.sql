-- Transaction-only test of lifting a restriction (admin_restore_card): the hold goes, the card stays private until
-- its owner publishes it again, the owner is told, the decision is in the audit trail, and only an admin with
-- two-step sign-in can do it. All fixtures roll back. Never run against production.
BEGIN;
SELECT set_config('vale.o', gen_random_uuid()::text, true), set_config('vale.a', gen_random_uuid()::text, true),
 set_config('vale.n', gen_random_uuid()::text, true), set_config('vale.c1', gen_random_uuid()::text, true), set_config('vale.c2', gen_random_uuid()::text, true);
INSERT INTO auth.users(id, email) VALUES
 (current_setting('vale.o')::uuid, 'lr-o-' || current_setting('vale.o') || '@example.invalid'),
 (current_setting('vale.a')::uuid, 'lr-a-' || current_setting('vale.a') || '@example.invalid'),
 (current_setting('vale.n')::uuid, 'lr-n-' || current_setting('vale.n') || '@example.invalid');
INSERT INTO public.public_cards(id, owner_id, slug, display_name, published) VALUES
 (current_setting('vale.c1')::uuid, current_setting('vale.o')::uuid, 'lr-one-' || left(current_setting('vale.c1'), 8), 'Public Synthetic', true),
 (current_setting('vale.c2')::uuid, current_setting('vale.o')::uuid, 'lr-two-' || left(current_setting('vale.c2'), 8), 'Second Synthetic', true);
INSERT INTO vale_private.platform_admins(user_id, note) VALUES (current_setting('vale.a')::uuid, 'test admin');
INSERT INTO vale_private.card_reports(submission_id, card_id, card_owner_id, card_slug, card_snapshot, category, network_hash, dedupe_key)
SELECT gen_random_uuid(), c.id, c.owner_id, c.slug, jsonb_build_object('display_name', c.display_name), 'scam', repeat('c', 64), 'k-' || c.slug
FROM public.public_cards c WHERE c.owner_id = current_setting('vale.o')::uuid;
CREATE FUNCTION pg_temp.report_for(card text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM vale_private.card_reports WHERE card_id = current_setting(card)::uuid $$;
CREATE FUNCTION pg_temp.slug(card text) RETURNS text LANGUAGE sql AS $$ SELECT slug FROM public.public_cards WHERE id = current_setting(card)::uuid $$;
SELECT set_config('vale.r1', pg_temp.report_for('vale.c1')::text, true), set_config('vale.r2', pg_temp.report_for('vale.c2')::text, true),
 set_config('vale.s1', pg_temp.slug('vale.c1'), true), set_config('vale.s2', pg_temp.slug('vale.c2'), true);

-- The owner makes the second card private themselves before it is hidden.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.o'), 'role', 'authenticated')::text, true);
UPDATE public.public_cards SET published = false WHERE id = current_setting('vale.c2')::uuid;

-- An admin with two-step sign-in hides both.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.a'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
SELECT public.admin_hide_card(current_setting('vale.r1')::uuid, 'Asked visitors for payment details.', 'Confirmed by review.');
SELECT public.admin_hide_card(current_setting('vale.r2')::uuid, 'Asked visitors for payment details.', 'Confirmed by review.');

-- Only an admin with two-step sign-in can lift a restriction.
RESET ROLE;
DO $$ BEGIN
 -- While hidden, each card has an unread "card hidden" notice.
 IF (SELECT count(*) FROM public.notifications WHERE kind = 'card_hidden' AND read_at IS NULL AND card_id IN (current_setting('vale.c1')::uuid, current_setting('vale.c2')::uuid)) <> 2
  THEN RAISE EXCEPTION 'CHECK: hiding did not leave an unread notice for each card'; END IF;
 IF has_function_privilege('anon', 'public.admin_restore_card(uuid, text)', 'EXECUTE') OR has_function_privilege('service_role', 'public.admin_restore_card(uuid, text)', 'EXECUTE')
  THEN RAISE EXCEPTION 'CHECK: visitors or the server role may lift restrictions'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.o'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
DO $$ BEGIN
 BEGIN PERFORM public.admin_restore_card(current_setting('vale.c1')::uuid, 'mine'); RAISE EXCEPTION 'CHECK: the owner lifted their own restriction';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 -- While hidden, the owner can't publish it.
 BEGIN UPDATE public.public_cards SET published = true WHERE id = current_setting('vale.c1')::uuid; RAISE EXCEPTION 'CHECK: a hidden card was published by its owner';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.n'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
DO $$ BEGIN
 BEGIN PERFORM public.admin_restore_card(current_setting('vale.c1')::uuid, 'x'); RAISE EXCEPTION 'CHECK: an ordinary account lifted a restriction';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.a'), 'role', 'authenticated', 'aal', 'aal1')::text, true);
DO $$ BEGIN
 BEGIN PERFORM public.admin_restore_card(current_setting('vale.c1')::uuid, 'x'); RAISE EXCEPTION 'CHECK: an admin lifted a restriction without two-step sign-in';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

-- Lifting needs a note; then the hold goes and both cards stay private.
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.a'), 'role', 'authenticated', 'aal', 'aal2')::text, true);
DO $$ BEGIN
 BEGIN PERFORM public.admin_restore_card(current_setting('vale.c1')::uuid, '  '); RAISE EXCEPTION 'CHECK: lifted without a note';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
 PERFORM public.admin_restore_card(current_setting('vale.c1')::uuid, 'Appeal accepted: the payment link was removed.');
 PERFORM public.admin_restore_card(current_setting('vale.c2')::uuid, 'Appeal accepted.');
 BEGIN PERFORM public.admin_restore_card(current_setting('vale.c1')::uuid, 'again'); RAISE EXCEPTION 'CHECK: lifted twice';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
END $$;
RESET ROLE;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM vale_private.card_holds WHERE card_id IN (current_setting('vale.c1')::uuid, current_setting('vale.c2')::uuid)) THEN RAISE EXCEPTION 'CHECK: the restriction was not removed'; END IF;
 -- The out-of-date "card hidden" notices are marked read; they are kept, not deleted.
 IF EXISTS (SELECT 1 FROM public.notifications WHERE kind = 'card_hidden' AND read_at IS NULL AND card_id IN (current_setting('vale.c1')::uuid, current_setting('vale.c2')::uuid))
  THEN RAISE EXCEPTION 'CHECK: a "card hidden" notice stayed unread after the restriction was lifted'; END IF;
 IF (SELECT count(*) FROM public.notifications WHERE kind = 'card_hidden' AND card_id IN (current_setting('vale.c1')::uuid, current_setting('vale.c2')::uuid)) <> 2
  THEN RAISE EXCEPTION 'CHECK: a "card hidden" notice was deleted'; END IF;
 IF EXISTS (SELECT 1 FROM public.public_cards WHERE id IN (current_setting('vale.c1')::uuid, current_setting('vale.c2')::uuid) AND published)
  THEN RAISE EXCEPTION 'CHECK: lifting a restriction published a card'; END IF;
 IF EXISTS (SELECT 1 FROM public.get_public_card(current_setting('vale.s1'))) OR EXISTS (SELECT 1 FROM public.get_public_card(current_setting('vale.s2')))
  THEN RAISE EXCEPTION 'CHECK: a card is visible to visitors after the restriction was lifted'; END IF;
 -- The audit trail keeps the hide and the lift, with who, why and which report.
 IF (SELECT count(*) FROM vale_private.moderation_actions WHERE action = 'restore_card' AND admin_id = current_setting('vale.a')::uuid AND note <> ''
     AND card_id IN (current_setting('vale.c1')::uuid, current_setting('vale.c2')::uuid) AND report_id IS NOT NULL) <> 2 THEN RAISE EXCEPTION 'CHECK: lifting not logged with its note'; END IF;
 IF (SELECT count(*) FROM vale_private.moderation_actions WHERE action = 'hide_card' AND card_id IN (current_setting('vale.c1')::uuid, current_setting('vale.c2')::uuid)) <> 2
  THEN RAISE EXCEPTION 'CHECK: the hide entries were lost'; END IF;
END $$;

-- The owner: no longer restricted, told it can be published, and nothing about the report or who made it.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.o'), 'role', 'authenticated')::text, true);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.get_my_card_holds()) THEN RAISE EXCEPTION 'CHECK: the owner still sees a restriction'; END IF;
 IF (SELECT count(*) FROM public.notifications WHERE kind = 'card_restored' AND read_at IS NULL AND card_id IN (current_setting('vale.c1')::uuid, current_setting('vale.c2')::uuid)) <> 2
  THEN RAISE EXCEPTION 'CHECK: the owner was not told'; END IF;
END $$;
-- The owner publishes the first card when ready; the second stays private, as they had chosen.
UPDATE public.public_cards SET published = true WHERE id = current_setting('vale.c1')::uuid;
SELECT public.mark_notifications_read((SELECT array_agg(id) FROM public.notifications WHERE kind = 'card_restored' AND card_id = current_setting('vale.c1')::uuid));
RESET ROLE;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM public.get_public_card(current_setting('vale.s1'))) THEN RAISE EXCEPTION 'CHECK: the owner could not publish after the restriction was lifted'; END IF;
 IF EXISTS (SELECT 1 FROM public.get_public_card(current_setting('vale.s2'))) THEN RAISE EXCEPTION 'CHECK: the second card became public'; END IF;
 IF (SELECT count(*) FROM public.notifications WHERE kind = 'card_restored' AND read_at IS NULL) <> 1 THEN RAISE EXCEPTION 'CHECK: the notice was not marked read'; END IF;
END $$;
-- Another account sees none of it.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.n'), 'role', 'authenticated')::text, true);
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM public.notifications WHERE kind IN ('card_restored', 'card_hidden')) THEN RAISE EXCEPTION 'CHECK: another account saw the notices'; END IF;
END $$;
RESET ROLE;

SELECT 'PASS: lifting a restriction removes the hold, never publishes the card, tells the owner, keeps the audit trail, and needs an admin with two-step sign-in' AS test;
ROLLBACK;
