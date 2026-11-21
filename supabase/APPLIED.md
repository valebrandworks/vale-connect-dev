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
| `20261112000000_unlimited_free_connections.sql` | 2026-11-13, 01:16 UTC (2026-11-12 US time) | Applied once through Supabase migration tooling (without the file's BEGIN/COMMIT), after a verified backup and rolled-back dry runs | Yes, as version `20261113011616` (`unlimited_free_connections`) |
| `20261114000000_add_card_reports.sql` | 2026-11-13, 03:01 UTC | Applied once through Supabase's migration endpoint, exactly as committed at `22c8aa2` (without the file's BEGIN/COMMIT), after a verified backup and rolled-back dry runs. Enabled `pg_cron` and scheduled `vale-report-cleanup` (daily, 04:23 UTC) | Yes, as version `20261113030137` (`add_card_reports`) |
| `20261121000000_add_admin_get_report.sql` | 2026-11-21, 18:32 UTC | Applied once through Supabase's migration endpoint, exactly as committed at `4edb5d0` (sha256 `18401c2a…`, without the file's BEGIN/COMMIT), after a verified backup and rolled-back dry runs | Yes, as version `20261121183210` (`add_admin_get_report`) |
| `20261121000100_lift_restriction_keeps_card_private.sql` | 2026-11-21, 18:32 UTC | Applied once through Supabase's migration endpoint, exactly as committed at `4edb5d0` (sha256 `2ab48142…`, without the file's BEGIN/COMMIT), directly after the one above | Yes, as version `20261121183224` (`lift_restriction_keeps_card_private`) |
| `20261122000000_lift_marks_hidden_notice_read.sql` | 2026-11-21, 20:04 UTC | Applied once through Supabase's migration endpoint, exactly as committed at `4e4fbd8` (sha256 `18ce5d22…`, without the file's BEGIN/COMMIT), after a verified backup and rolled-back dry runs | Yes, as version `20261121200431` (`lift_marks_hidden_notice_read`) |

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

Verified after making Free connections unlimited, on 2026-11-13 UTC:
- Free's `max_active_connections` is NULL (unlimited). `connection_limits` holds 1,000 new connections per hour and 5,000 per day; RLS is on and members can't read it. The index `connections_owner_created_idx` exists.
- Existing cards, connections and share records are unchanged (row fingerprints identical before and after); notification count unchanged.
- All 15 live test files pass, rolled back, including `unlimited_connections.sql` (hourly and daily limits; edits, archiving and unarchiving never limited); the launch gate passes 10 of 10; the live structure matches the repository (240 items, 0 differences).

The reverse is `supabase/rollback/20261112000000_unlimited_free_connections.down.sql`. It returns Free to 1,000 and removes the table and index; no connections are deleted.

Verified after adding Report This Card (stage A), on 2026-11-13 UTC:
- Existing cards, connections, share records and notifications are unchanged (row fingerprints identical before and after). No admins, reports or hidden cards exist yet.
- No visitor, signed-in account or server role can read or change any `vale_private` table; the API exposes only `public` and refuses the private schema; visitors are refused every reporting and admin function.
- All 16 live test files pass, rolled back, including `card_reports.sql` (admin actions require a listed admin with two-step sign-in; reports never hide a card on their own; the cleanup keeps legal holds, open reports and still-hidden cards' records). The launch gate passes 14 of 14; the live structure matches the repository (387 items, 0 differences).

The reverse is `supabase/rollback/20261114000000_add_card_reports.down.sql`. It removes the feature and the scheduler (if nothing else uses it); cards hidden by moderation stay unpublished.

Verified after Report This Card stage C (`admin_get_report`, and lifting a restriction keeps the card private), on 2026-11-21 UTC:
- Both functions are identical to the repository (definition, SECURITY DEFINER, search_path); visitors and the server role can't call them.
- All existing data is unchanged: every app and moderation table has the same rows and content fingerprint as before, including the 2 open test reports. Only the two functions and the two history entries changed.
- All 18 live test files pass, rolled back, including `admin_get_report.sql` and `lift_restriction.sql`. The launch gate passes 16 of 16. The live structure matches the repository (388 items, 0 differences).
- As a visitor, the API refuses `admin_get_report`, `admin_restore_card` and `admin_list_reports`, and doesn't expose the private schema.

The reverse, in this order: `supabase/rollback/20261121000100_lift_restriction_keeps_card_private.down.sql` (restores the stage A function; no data changes), then `supabase/rollback/20261121000000_add_admin_get_report.down.sql`.

Verified after "lifting marks the card hidden notice read", on 2026-11-21 UTC:
- `admin_restore_card` is identical to the repository (definition, SECURITY DEFINER, search_path, permissions).
- The one-time tidy marked exactly 1 notice read: the "card hidden" notice from the manual moderation test, which is kept, not deleted. The other 2 notices have identical content fingerprints.
- Every other app and moderation table is unchanged.
- The admin and two-step checks still hold on the real admin record. All 18 live test files pass, rolled back. The launch gate passes 16 of 16. The live structure matches the repository (388 items, 0 differences).

The reverse is `supabase/rollback/20261122000000_lift_marks_hidden_notice_read.down.sql`, before the ones above. Notices already marked read stay read.

## Production

### New production project (VALE Connect Production, `uhribjaiyuwivzqxusur`)

Built on 2026-11-21 (UTC) as an empty, new project: the starting file, then every migration, exactly as committed at `cbb17a9`. Each file was checked by sha256 against the rolled-back dry run, applied once through Supabase's migration endpoint (without the file's BEGIN/COMMIT) and recorded in the migration list. No accounts or data were imported; public sign-ups are disabled.

- A rolled-back dry run of the whole build, with every test, passed first, and left the project empty.
- The first attempt stopped after the starting file: the next history entry was refused because two entries were stamped in the same second. That step was rolled back entirely. After checking that only the starting file was present (0 differences), the build resumed from the first migration, with a pause between steps.

| Repository file | In Supabase's migration list |
|---|---|
| `00_objects_before_migrations.sql` | `20261121220220` (`baseline_objects_before_migrations`) |
| `20261102224721_restore_private_profile_sync.sql` | `20261121220543` (`restore_private_profile_sync`) |
| `20261102224901_repair_public_card_client_permissions.sql` | `20261121220546` (`repair_public_card_client_permissions`) |
| `20261103001958_support_multiple_public_cards.sql` | `20261121220549` (`support_multiple_public_cards`) |
| `20261103025723_add_private_cloud_connections.sql` | `20261121220553` (`add_private_cloud_connections`) |
| `20261103044001_restrict_rls_event_trigger_client_execution.sql` | `20261121220556` (`restrict_rls_event_trigger_client_execution`) |
| `20261104074759_harden_cards_and_add_membership_limits.sql` | `20261121220559` (`harden_cards_and_add_membership_limits`) |
| `20261104080556_add_deletion_and_usage.sql` | `20261121220603` (`add_deletion_and_usage`) |
| `20261104080840_add_relationship_details.sql` | `20261121220606` (`add_relationship_details`) |
| `20261104082212_add_plan_features.sql` | `20261121220609` (`add_plan_features`) |
| `20261108203429_restrict_public_card_reads.sql` | `20261121220613` (`restrict_public_card_reads`) |
| `20261108220219_raise_free_connection_limit.sql` | `20261121220616` (`raise_free_connection_limit`) |
| `20261109010000_add_card_images_and_appearance.sql` | `20261121220619` (`add_card_images_and_appearance`) |
| `20261109020000_add_reciprocal_sharing.sql` | `20261121220623` (`add_reciprocal_sharing`) |
| `20261109030000_add_sharing_indexes.sql` | `20261121220626` (`add_sharing_indexes`) |
| `20261110000000_hash_share_contact_keys.sql` | `20261121220630` (`hash_share_contact_keys`) |
| `20261110000100_validate_share_contact_keys.sql` | `20261121220633` (`validate_share_contact_keys`) |
| `20261112000000_unlimited_free_connections.sql` | `20261121220636` (`unlimited_free_connections`) |
| `20261114000000_add_card_reports.sql` | `20261121220640` (`add_card_reports`) |
| `20261121000000_add_admin_get_report.sql` | `20261121220643` (`add_admin_get_report`) |
| `20261121000100_lift_restriction_keeps_card_private.sql` | `20261121220647` (`lift_restriction_keeps_card_private`) |
| `20261122000000_lift_marks_hidden_notice_read.sql` | `20261121220650` (`lift_marks_hidden_notice_read`) |

Verified after the build, on 2026-11-21 UTC:
- **Structure:** the live structure matches the repository (388 items, 0 differences).
- **Launch gate:** passes 16 of 16.
- **Tests:** all 18 test files pass, rolled back, leaving nothing behind.
- **Table access:**
  - row security is on for all 21 tables;
  - visitors have no direct table access;
  - visitors can call only `get_public_card` and the two image and hold helpers.
- **Admin functions:** all 9 require a listed admin with two-step sign-in, and visitors and the server role can't call them. No admins are listed yet.
- **Data:** configuration only (3 plans, settings, the private `card-images` bucket, one generated key). No accounts, cards, connections or files.
- **Daily cleanup:** `vale-report-cleanup` is scheduled at 04:23 UTC.
- **Security advisors:** reviewed. The findings are the expected ones for this design (private tables with no client policies; functions that check the caller themselves).

### Earlier v0.9 project

Unchanged. It's kept until at least 30 days after launch; pausing or deleting it needs separate approval.
