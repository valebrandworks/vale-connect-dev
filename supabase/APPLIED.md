# Applied database state

What each environment actually has, for migrations whose history entry differs from the repository.
Supabase's migration list (`supabase_migrations.schema_migrations`) records only migrations applied
through its migration tooling; SQL run in the dashboard's SQL Editor isn't listed there.

## Development (`jlprxnmdvoloahssjlnu`)

| Repository file | Applied | How | In Supabase's migration list |
|---|---|---|---|
| `20261109010000_add_card_images_and_appearance.sql` | 2026-11-08, before 22:55 UTC | Run by the product owner in the SQL Editor, exactly as in this file, after a rolled-back dry run on development and a verified backup | No |
| `20261109020000_add_reciprocal_sharing.sql` | 2026-11-09, 03:37 UTC | Applied through Supabase migration tooling (without the file's BEGIN/COMMIT, which the tooling adds), after a verified backup and a rolled-back dry run | Yes, as version `20261109033732` (`add_reciprocal_sharing`) |
| `20261109030000_add_sharing_indexes.sql` | 2026-11-09, 04:54 UTC | Applied once through Supabase migration tooling (the file's four CREATE INDEX statements, without its BEGIN/COMMIT), after a verified backup and a rolled-back dry run | Yes, as version `20261109045438` (`add_sharing_indexes`) |
| `20261110000000_hash_share_contact_keys.sql` | 2026-11-10, about 00:20 UTC | Applied once through Supabase migration tooling (without the file's BEGIN/COMMIT), after a verified backup (now including share records and notifications) and rolled-back dry runs | Yes |
| `20261110000100_validate_share_contact_keys.sql` | 2026-11-10, about 00:21 UTC | Its two statements run as SQL with the founder's approval: the one existing readable rate-limit record was hashed in place, then the check validated | No |

Verified after applying, on 2026-11-08 at 22:55 UTC:
- Private `card-images` bucket: 1 MB limit; WebP, PNG and JPEG only.
- The 4 storage rules, the 3 new card fields and their checks, the 3 `vale_private` helpers, the image-cleanup trigger, the image check in `delete_my_account`, and the extended `get_public_card`.
- `supabase/tests/card_images.sql` and every other live test pass.

The reverse is `supabase/rollback/20261109010000_add_card_images_and_appearance.down.sql`. It leaves the empty bucket in place, because Supabase blocks deleting buckets by SQL.

Verified after applying reciprocal sharing, on 2026-11-09 at about 03:45 UTC:
- The live structure matches an in-memory build of this repository exactly (226 items: tables, columns, indexes, rules, constraints, triggers, functions).
- `supabase/tests/reciprocal_sharing.sql` and all 10 other live test files pass, rolled back; the launch gate passes 10 of 10.
- Existing cards, connections, profiles and accounts are unchanged (fingerprints identical to before); the 2 card-based connections are labelled `saved_card`, the rest `manual`.

The reverse is `supabase/rollback/20261109020000_add_reciprocal_sharing.down.sql`. It deletes sharing history and notifications but keeps every connection.

Verified after applying the sharing indexes, on 2026-11-09 at about 04:58 UTC:
- The four indexes exist exactly as in the file, and the performance advisor no longer flags any sharing link. It still flags `memberships.plan_code`, which is left out on purpose because plans aren't deleted.
- The live structure matches an in-memory build of this repository exactly (230 items, the 226 before plus the 4 indexes).
- `supabase/tests/sharing_indexes.sql` and all 11 other live test files pass, rolled back; the launch gate passes 10 of 10. The security advisor lists only known findings about existing functions, tables and sign-in settings; none involve the indexes.
- Existing cards and connections are unchanged (counts and fingerprints identical to before); sharing tables are still empty.

The reverse is `supabase/rollback/20261109030000_add_sharing_indexes.down.sql`. It removes the four indexes only.

Verified after hashing contact keys, on 2026-11-10:
- The one rate-limit record is now a keyed hash, equal to what a new share stores; no readable contact keys remain, and the check covers every row.
- The existing share, connection, consent record and notification are unchanged (row fingerprints identical before and after).
- All 14 live test files pass, rolled back, including `share_contact_keys.sql`; the launch gate passes 10 of 10.

The reverse is `supabase/rollback/20261110000000_hash_share_contact_keys.down.sql`.

## Production

None of the November 2026 migrations are applied to production.
