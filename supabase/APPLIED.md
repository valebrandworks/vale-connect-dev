# Applied database state

What each environment actually has, for migrations whose history entry differs from the repository.
Supabase's migration list (`supabase_migrations.schema_migrations`) records only migrations applied
through its migration tooling; SQL run in the dashboard's SQL Editor isn't listed there.

## Development (`jlprxnmdvoloahssjlnu`)

| Repository file | Applied | How | In Supabase's migration list |
|---|---|---|---|
| `20261109010000_add_card_images_and_appearance.sql` | 2026-11-08, before 22:55 UTC | Run by the product owner in the SQL Editor, exactly as in this file, after a rolled-back dry run on development and a verified backup | No |

Verified after applying, on 2026-11-08 at 22:55 UTC:
- Private `card-images` bucket: 1 MB limit; WebP, PNG and JPEG only.
- The 4 storage rules, the 3 new card fields and their checks, the 3 `vale_private` helpers, the image-cleanup trigger, the image check in `delete_my_account`, and the extended `get_public_card`.
- `supabase/tests/card_images.sql` and every other live test pass.

The reverse is `supabase/rollback/20261109010000_add_card_images_and_appearance.down.sql`. It leaves the empty bucket in place, because Supabase blocks deleting buckets by SQL.

## Production

None of the November 2026 migrations are applied to production.
