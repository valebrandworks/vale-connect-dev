-- Transaction-only test: rate-limit records keep a keyed hash of the sharer's email or phone, never the readable
-- value, while the two-per-day limit, duplicate handling and the owner's readable details are unchanged.
-- Checks only this test's own records: rate-limit records made before the change are handled separately.
-- All fixtures roll back. Never run against production.
BEGIN;
SELECT set_config('vale.o', gen_random_uuid()::text, true), set_config('vale.m', gen_random_uuid()::text, true);
SELECT set_config('vale.oc', gen_random_uuid()::text, true), set_config('vale.oc2', gen_random_uuid()::text, true), set_config('vale.mc', gen_random_uuid()::text, true);
INSERT INTO auth.users(id, email) VALUES
 (current_setting('vale.o')::uuid, 'ck-o-' || current_setting('vale.o') || '@example.invalid'),
 (current_setting('vale.m')::uuid, 'ck-m-' || current_setting('vale.m') || '@example.invalid');
INSERT INTO public.public_cards(id, owner_id, slug, display_name, public_email, public_phone, published) VALUES
 (current_setting('vale.oc')::uuid, current_setting('vale.o')::uuid, 'ck-o-' || left(current_setting('vale.oc'), 8), 'Owner Synthetic', '', '', true),
 (current_setting('vale.oc2')::uuid, current_setting('vale.o')::uuid, 'ck-p-' || left(current_setting('vale.oc2'), 8), 'Owner Second', '', '', true),
 (current_setting('vale.mc')::uuid, current_setting('vale.m')::uuid, 'ck-m-' || left(current_setting('vale.mc'), 8), 'Member Synthetic', 'Member.Key@Example.invalid', '+1 555 010 0333', true);
CREATE FUNCTION pg_temp.share(card uuid, fields jsonb, net text, member uuid DEFAULT NULL, member_card uuid DEFAULT NULL, member_fields text[] DEFAULT NULL)
 RETURNS text LANGUAGE plpgsql AS $$
 DECLARE r text; s text := (SELECT slug FROM public.public_cards WHERE id = card);
 BEGIN
  -- Called as the server role, which has no table access of its own, only record_share.
  EXECUTE 'SET LOCAL ROLE service_role';
  r := public.record_share(s, gen_random_uuid(), true, 'v1', fields, member_fields, member, member_card, net, '');
  EXECUTE 'RESET ROLE';
  RETURN r;
 END $$;

DO $$
DECLARE o uuid := current_setting('vale.o')::uuid; oc uuid := current_setting('vale.oc')::uuid; oc2 uuid := current_setting('vale.oc2')::uuid; r text; k1 text; k2 text;
BEGIN
 -- A. Visitor by email: the rate-limit record holds only a hash.
 r := pg_temp.share(oc, '{"full_name":"Key Visitor","email":"Key.Visitor@Example.invalid"}', 'net-1');
 IF r <> 'shared' THEN RAISE EXCEPTION 'CHECK: first share failed (%)', r; END IF;
 SELECT contact_key INTO k1 FROM public.share_attempts WHERE card_id = oc ORDER BY id DESC LIMIT 1;
 IF k1 !~ '^h1:[0-9a-f]{64}$' THEN RAISE EXCEPTION 'CHECK: the contact key is not a keyed hash'; END IF;
 IF EXISTS (SELECT 1 FROM public.share_attempts WHERE card_id IN (oc, oc2) AND (contact_key ILIKE '%example.invalid%' OR contact_key !~ '^h1:[0-9a-f]{64}$')) THEN RAISE EXCEPTION 'CHECK: a readable contact is stored in rate-limit records'; END IF;
 IF k1 = 'h1:' || encode(sha256(convert_to('email:key.visitor@example.invalid', 'UTF8')), 'hex') THEN RAISE EXCEPTION 'CHECK: the hash is not keyed'; END IF;

 -- B. The owner's readable details are unchanged.
 IF NOT EXISTS (SELECT 1 FROM public.connections WHERE owner_id = o AND email = 'Key.Visitor@Example.invalid' AND source = 'shared_back') THEN RAISE EXCEPTION 'CHECK: the owner''s connection lost the readable email'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.card_shares WHERE card_id = oc AND shared->>'email' = 'Key.Visitor@Example.invalid') THEN RAISE EXCEPTION 'CHECK: the owner''s share record lost the readable email'; END IF;

 -- C. Normalised before hashing: case and spaces don't change the key, so the two-per-day limit still holds.
 r := pg_temp.share(oc, '{"full_name":"Key Visitor Again","email":"  KEY.VISITOR@example.INVALID "}', 'net-2');
 IF r <> 'shared' THEN RAISE EXCEPTION 'CHECK: second share failed (%)', r; END IF;
 SELECT contact_key INTO k2 FROM public.share_attempts WHERE card_id = oc ORDER BY id DESC LIMIT 1;
 IF k2 <> k1 THEN RAISE EXCEPTION 'CHECK: the same email in another case gives another key'; END IF;
 r := pg_temp.share(oc, '{"full_name":"Key Visitor Third","email":"key.visitor@example.invalid"}', 'net-3');
 IF r <> 'rate_limited' THEN RAISE EXCEPTION 'CHECK: the third share from one email within a day was not limited (%)', r; END IF;
 -- ...per card, as before: the same email can still share with another card.
 r := pg_temp.share(oc2, '{"full_name":"Key Visitor","email":"key.visitor@example.invalid"}', 'net-4');
 IF r <> 'shared' THEN RAISE EXCEPTION 'CHECK: the limit spread to another card (%)', r; END IF;

 -- D. Duplicate handling unchanged: the second share matched the existing connection by email.
 IF (SELECT count(*) FROM public.connections WHERE owner_id = o AND lower(email) = 'key.visitor@example.invalid') <> 1 THEN RAISE EXCEPTION 'CHECK: a duplicate connection was created'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.card_shares WHERE card_id = oc AND outcome = 'duplicate') THEN RAISE EXCEPTION 'CHECK: the repeat was not kept as a duplicate for review'; END IF;

 -- E. Phones: formatting doesn't change the key; a different number or email gives a different key.
 r := pg_temp.share(oc, '{"full_name":"Phone Visitor","phone":"+1 (555) 010-0444"}', 'net-5');
 SELECT contact_key INTO k1 FROM public.share_attempts WHERE card_id = oc ORDER BY id DESC LIMIT 1;
 r := pg_temp.share(oc, '{"full_name":"Phone Visitor Two","phone":"15550100444"}', 'net-6');
 SELECT contact_key INTO k2 FROM public.share_attempts WHERE card_id = oc ORDER BY id DESC LIMIT 1;
 IF k1 <> k2 OR k1 !~ '^h1:[0-9a-f]{64}$' THEN RAISE EXCEPTION 'CHECK: phone formatting changed the key'; END IF;
 IF EXISTS (SELECT 1 FROM public.share_attempts WHERE card_id IN (oc, oc2) AND contact_key LIKE '%5550100444%') THEN RAISE EXCEPTION 'CHECK: a readable phone is stored'; END IF;
 IF (SELECT count(DISTINCT contact_key) FROM public.share_attempts WHERE card_id IN (oc, oc2)) <> 2 THEN RAISE EXCEPTION 'CHECK: different contacts should give different keys'; END IF;
END $$;

-- F. Members: their card's email is hashed the same way.
DO $$ DECLARE r text; BEGIN
 r := pg_temp.share(current_setting('vale.oc')::uuid, NULL, 'net-7', current_setting('vale.m')::uuid, current_setting('vale.mc')::uuid, ARRAY['full_name','email']);
 IF r <> 'shared' THEN RAISE EXCEPTION 'CHECK: member share failed (%)', r; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.share_attempts WHERE sharer_user_id = current_setting('vale.m')::uuid AND contact_key ~ '^h1:[0-9a-f]{64}$') THEN RAISE EXCEPTION 'CHECK: a member''s contact is not hashed'; END IF;
 IF EXISTS (SELECT 1 FROM public.share_attempts WHERE sharer_user_id = current_setting('vale.m')::uuid AND contact_key ILIKE '%member.key%') THEN RAISE EXCEPTION 'CHECK: a member''s readable email is stored'; END IF;
END $$;

-- G. New rate-limit records can't hold readable contacts, even written directly.
DO $$ BEGIN
 BEGIN
  INSERT INTO public.share_attempts(card_id, contact_key) VALUES (current_setting('vale.oc')::uuid, 'email:direct@example.invalid');
  RAISE EXCEPTION 'CHECK: a readable contact key was accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
END $$;

-- H. The key and the hash function are private.
DO $$ BEGIN
 IF has_table_privilege('anon', 'vale_private.share_keys', 'SELECT') OR has_table_privilege('authenticated', 'vale_private.share_keys', 'SELECT') OR has_table_privilege('service_role', 'vale_private.share_keys', 'SELECT')
 THEN RAISE EXCEPTION 'CHECK: a client or server role can read the hashing key'; END IF;
 IF has_function_privilege('anon', 'vale_private.share_contact_key(text)', 'EXECUTE') OR has_function_privilege('authenticated', 'vale_private.share_contact_key(text)', 'EXECUTE') OR has_function_privilege('service_role', 'vale_private.share_contact_key(text)', 'EXECUTE')
 THEN RAISE EXCEPTION 'CHECK: the hash function can be called directly'; END IF;
 IF (SELECT octet_length(key) FROM vale_private.share_keys WHERE name = 'contact') < 32 THEN RAISE EXCEPTION 'CHECK: the hashing key is too short'; END IF;
END $$;

-- I. Without the key, sharing fails instead of skipping the limit.
DELETE FROM vale_private.share_keys;
DO $$ DECLARE r text; BEGIN
 BEGIN
  r := pg_temp.share(current_setting('vale.oc2')::uuid, '{"full_name":"No Key","email":"nokey@example.invalid"}', 'net-8');
  RAISE EXCEPTION 'CHECK: a share was accepted without the hashing key (%)', r;
 EXCEPTION WHEN raise_exception THEN IF SQLERRM LIKE 'CHECK:%' THEN RAISE; END IF; END;
END $$;
SELECT 'PASS: contact keys are keyed hashes of normalised values; limits, duplicates and readable owner details unchanged; key private; fails closed' AS test;
ROLLBACK;
