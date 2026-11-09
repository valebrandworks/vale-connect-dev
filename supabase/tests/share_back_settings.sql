-- Transaction-only test of the owner's "Let people share their details back" switch (public_cards.accept_shares).
-- Owners change it on their own cards only, through the access they already have; nothing new is granted.
-- All fixtures roll back. Never run against production.
BEGIN;
SELECT set_config('vale.o', gen_random_uuid()::text, true), set_config('vale.x', gen_random_uuid()::text, true), set_config('vale.oc', gen_random_uuid()::text, true);
INSERT INTO auth.users(id, email) VALUES
 (current_setting('vale.o')::uuid, 'sb-o-' || current_setting('vale.o') || '@example.invalid'),
 (current_setting('vale.x')::uuid, 'sb-x-' || current_setting('vale.x') || '@example.invalid');
INSERT INTO public.public_cards(id, owner_id, slug, display_name, published) VALUES
 (current_setting('vale.oc')::uuid, current_setting('vale.o')::uuid, 'sb-o-' || left(current_setting('vale.oc'), 8), 'Owner Synthetic', true);
SELECT set_config('vale.os', (SELECT slug FROM public.public_cards WHERE id = current_setting('vale.oc')::uuid), true);

DO $$ BEGIN
 IF (SELECT accept_shares FROM public.public_cards WHERE id = current_setting('vale.oc')::uuid) IS NOT TRUE THEN RAISE EXCEPTION 'CHECK: sharing back should be on by default'; END IF;
 IF (SELECT accept_shares FROM public.get_public_card(current_setting('vale.os'))) IS NOT TRUE THEN RAISE EXCEPTION 'CHECK: the public lookup should report sharing back on'; END IF;
END $$;

-- Visitors can't change the switch.
SET LOCAL ROLE anon;
DO $$ BEGIN
 BEGIN UPDATE public.public_cards SET accept_shares = false WHERE id = current_setting('vale.oc')::uuid; RAISE EXCEPTION 'CHECK: a visitor changed sharing back';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- Another account can't change it either: its update matches no rows.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.x'), 'role', 'authenticated')::text, true);
DO $$ DECLARE n integer; BEGIN
 UPDATE public.public_cards SET accept_shares = false WHERE id = current_setting('vale.oc')::uuid; GET DIAGNOSTICS n = ROW_COUNT;
 IF n <> 0 THEN RAISE EXCEPTION 'CHECK: another account changed sharing back'; END IF;
END $$;
RESET ROLE;
DO $$ BEGIN IF (SELECT accept_shares FROM public.public_cards WHERE id = current_setting('vale.oc')::uuid) IS NOT TRUE THEN RAISE EXCEPTION 'CHECK: the switch changed'; END IF; END $$;

-- The owner turns it off, the same way the card editor saves (revision-guarded update of their own card).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub', current_setting('vale.o'), 'role', 'authenticated')::text, true);
DO $$ DECLARE n integer; BEGIN
 UPDATE public.public_cards SET accept_shares = false, revision = revision + 1, updated_at = now()
  WHERE id = current_setting('vale.oc')::uuid AND owner_id = current_setting('vale.o')::uuid; GET DIAGNOSTICS n = ROW_COUNT;
 IF n <> 1 THEN RAISE EXCEPTION 'CHECK: the owner could not turn sharing back off'; END IF;
END $$;
RESET ROLE;

-- Off: the public lookup says so, and the server refuses shares for this card.
DO $$ DECLARE r text; BEGIN
 IF (SELECT accept_shares FROM public.get_public_card(current_setting('vale.os'))) IS NOT FALSE THEN RAISE EXCEPTION 'CHECK: the public lookup should report sharing back off'; END IF;
 EXECUTE 'SET LOCAL ROLE service_role';
 r := public.record_share(current_setting('vale.os'), gen_random_uuid(), true, 'v1', '{"full_name":"Visitor Synthetic","email":"v@example.invalid"}', NULL, NULL, NULL, 'net-sb', '');
 EXECUTE 'RESET ROLE';
 IF r <> 'unavailable' THEN RAISE EXCEPTION 'CHECK: a share reached a card with sharing back off (%)', r; END IF;
 IF EXISTS (SELECT 1 FROM public.card_shares WHERE card_id = current_setting('vale.oc')::uuid) THEN RAISE EXCEPTION 'CHECK: a share was stored'; END IF;
END $$;

-- The public lookup still reveals nothing private.
DO $$ BEGIN
 IF pg_get_function_result('public.get_public_card(text)'::regprocedure) ~ '(owner_id|card_label|revision|published|updated_at)' THEN RAISE EXCEPTION 'CHECK: the public lookup returns private fields'; END IF;
END $$;
SELECT 'PASS: sharing back on by default; only the owner can turn it off; off is shown publicly and enforced by the server' AS test;
ROLLBACK;
