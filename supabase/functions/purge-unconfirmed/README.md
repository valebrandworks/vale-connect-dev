# purge-unconfirmed

Removes sign-ups that were never confirmed, using Supabase's Admin API. **Dry run by default; not scheduled; not deployed to production.**

- Who is listed is decided by the database function `public.unconfirmed_purge_candidates` (older than 7 days, never confirmed or signed in, not invited, no second factor, no admin role, no data of ours). This function cannot add anyone to that list.
- Each account is **re-checked against the database rules immediately before its own deletion**; an account that confirmed, signed in, gained a second factor, an admin role or data since the list was made is skipped. Remaining race (documented in `handler.mjs`): a window of a few hundred milliseconds between the re-check and the Admin API delete, for an account that is 7+ days old, never confirmed and whose links have expired.
- **Audit trail is required.** A `purge_started` row must be written before any deletion batch (otherwise nothing is deleted: 503 `audit_unavailable`); a failed final row is reported as `applied_audit_failed` (HTTP 500), never as success; an unrecorded dry run is `audit_failed`.
- Needs the header `x-purge-token` equal to the `PURGE_TOKEN` setting (32+ characters).
- Dry run (default): counts and records the count (`record_purge_run`). Deleting happens only when the setting `PURGE_APPLY=true` is set **and** the request body says `{"apply": true}`.
- Returns and logs counts only, never ids or addresses.
- Production use needs separate approval (the founder's decision of 2026-11-22: no automatic production deletion without it).
