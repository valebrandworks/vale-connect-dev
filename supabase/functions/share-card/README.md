# share-card

The server side of "Share your info back" on public card pages (`p.html`). It's for **development only** until
production gets its own Turnstile widget, allowed address and review.

## What it does
1. It accepts `POST` requests only from `https://dev.valebrandworks.com`. This origin check is supplementary.
2. It refuses every share if any required setting is missing.
3. It validates the request strictly: only known fields, consent ticked, limited sizes, a one-time submission ID.
4. It verifies the Cloudflare Turnstile token with the secret key. The token must be for `dev.valebrandworks.com`
   with action `share-card`.
5. **Members:** it checks their sign-in token with Supabase Auth. The database then reads the ticked fields from
   their own saved card. A member can't share someone else's card.
6. It turns the network address into an HMAC-SHA256 hash with `SHARE_HASH_SALT`. Only the hash reaches the database.
   The address itself is never stored or logged.
7. It calls `public.record_share` with the server key. That database step enforces consent, field rules, rate
   limits, duplicates and the owner's connection limit.

## Answers
The answer is one of `shared`, `invalid`, `rate_limited`, `unavailable`, `verification_failed`, `sign_in_required`,
`forbidden_origin`, `too_large`, `not_configured` or `error`. A duplicate, or an owner at their limit, still answers
`shared`.

## Settings
| Name | Set by | Notes |
|---|---|---|
| `TURNSTILE_SECRET_KEY` | Founder, in Edge Function secrets | Never in files or chat |
| `SHARE_HASH_SALT` | Founder, in Edge Function secrets | Random text, at least 32 characters |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEYS` (or legacy `SUPABASE_SERVICE_ROLE_KEY`) | Supabase, automatically | |

A `GET` request reports `checks` (true/false for each setting) and `network_source` (which header supplied the
address). It never shows values or the address.

## Deploying (development, after approval)
- Deploy with `verify_jwt = false`, then send a `GET` and confirm every check is `true`.
- Confirm `network_source` is `cf-connecting-ip`. Then send a request with a made-up `X-Forwarded-For` header and
  confirm the address used doesn't change, so the hash can't be faked.
- Before any production use: add a production widget and origin, and consider removing the `GET` check.

## Tests
`tests/share-card-function.cjs` runs the handler against an in-memory copy of the database built from this
repository, with stand-ins for Turnstile and Supabase Auth.
