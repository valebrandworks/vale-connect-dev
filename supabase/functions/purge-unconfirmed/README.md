# purge-unconfirmed

Removes sign-ups that were never confirmed, using Supabase's Admin API. **Dry run by default; not scheduled; not deployed to production.**

- Who is listed is decided by the database function `public.unconfirmed_purge_candidates` (older than 7 days, never confirmed or signed in, not invited, no second factor, no admin role, no data of ours). This function cannot add anyone to that list.
- Needs the header `x-purge-token` equal to the `PURGE_TOKEN` setting (32+ characters).
- Dry run (default): counts and records the count (`record_purge_run`). Deleting happens only when the setting `PURGE_APPLY=true` is set **and** the request body says `{"apply": true}`.
- Returns and logs counts only, never ids or addresses.
- Production use needs separate approval (the founder's decision of 2026-11-22: no automatic production deletion without it).
