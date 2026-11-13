-- Every foreign key in public and vale_private has an index that starts with its column(s), so deletes don't read whole tables.
-- One deliberate exception: memberships.plan_code points at the tiny membership_plans list, whose rows aren't deleted.
BEGIN;
DO $$
DECLARE missing text;
BEGIN
 SELECT string_agg(f.conname, ', ' ORDER BY f.conname) INTO missing
 FROM pg_constraint f JOIN pg_class t ON t.oid = f.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE f.contype = 'f' AND n.nspname IN ('public', 'vale_private') AND f.conname <> 'memberships_plan_code_fkey'
   AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = f.conrelid
     AND (i.indkey::int2[])[0:cardinality(f.conkey) - 1] = f.conkey);
 IF missing IS NOT NULL THEN RAISE EXCEPTION 'Foreign keys without a covering index: %', missing; END IF;
 IF (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN
   ('card_shares_sharer_card_idx', 'connections_share_idx', 'notifications_share_idx', 'notifications_connection_idx')) <> 4
 THEN RAISE EXCEPTION 'A sharing index is missing'; END IF;
END $$;
SELECT 'PASS: every public and vale_private foreign key has a covering index' AS test;
ROLLBACK;
