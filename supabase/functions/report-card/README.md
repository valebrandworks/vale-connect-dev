# report-card

The server side of "Report this card" (`report.html`). It's for **development only** until production gets its own
Turnstile widget, allowed address, alert key and review. Not deployed yet.

## What it does
1. **Requests:** it accepts `POST` requests only from `https://dev.valebrandworks.com`, plus the browser's `OPTIONS` preflight. Every other method is refused. The origin check is supplementary.
2. **Settings:** if any required setting is missing, it refuses every report. Only the names of missing settings go to the function log, never their values.
3. **Network address:** it takes the address only from Cloudflare's `CF-Connecting-IP`, and only once `SHARE_TRUSTED_ADDRESS_HEADER` is set. These rules are the same as share-card's, and a test proves they match. If a request has no single valid address, it's refused.
4. **Validation:** it checks requests strictly. Only these fields are accepted: `card`, `submission_id`, `category` (one of the 8 approved), `details` (up to 1,000 characters), `email` (optional), `attested: true` and `turnstile_token`.
5. **Turnstile:** it verifies the token with the secret key. The token must be for `dev.valebrandworks.com` with action `report-card`, so a share-form token is refused.
6. **Hashing:** it turns the network address into an HMAC-SHA256 hash with `SHARE_HASH_SALT` and the prefix `report-network:`. Report hashes therefore can't be matched with sharing hashes. The address is never stored, logged or sent to Cloudflare.
7. **Storing:** it calls `public.submit_card_report` with the secret key, sent only in the `apikey` header. The database then applies its own checks:
   - "public cards only";
   - rate limits;
   - merging of repeats;
   - blocked networks.
8. **Alerts:** for a stored or merged report, it asks `public.claim_report_alert` whether an alert is due. Alerts go out at most hourly, and only for new reports.
   - If one is due, it sends a plain email through Resend: "a card report is waiting", with no details.
   - A failed or missing alert never affects the report.

## Answers
- **Accepted:** every accepted report answers `received`, whether it was stored, merged, rate-limited, came from a blocked network, or was about a card that isn't public.
- **Problems:** the other answers are `invalid`, `verification_failed`, `forbidden_origin`, `method_not_allowed`, `too_large`, `address_unavailable`, `not_configured` and `error`.
- **Log:** it records outcome words only.

## Settings
Already set for share-card, and reused here:
- `TURNSTILE_SECRET_KEY`
- `SHARE_HASH_SALT`
- `SHARE_TRUSTED_ADDRESS_HEADER`
- `SUPABASE_URL` and `SUPABASE_SECRET_KEYS` (Supabase provides these)

New, and optional (without them, reports work but no alert is sent):
- `REPORT_ALERT_RESEND_KEY`: a Resend API key with **sending access only**, used only for alerts.
- `REPORT_ALERT_TO`: the address alerts go to.

Supabase function secrets are shared by every function in the project.

## Deploy
Deploy with `verify_jwt = false`. Visitors have no sign-in token, and none is needed. Deploy only after approval, from
the reviewed commit, with the same dry-run → deploy → check steps as share-card. Tests: `tests/report-card-function.cjs`
and `tests/report-form.cjs`.
