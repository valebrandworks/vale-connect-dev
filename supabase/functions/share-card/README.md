# share-card

The server side of "Share your info back" on public card pages (`p.html`). It's for **development only** until
production gets its own Turnstile widget, allowed address and review.

## What it does
1. It accepts `POST` requests only from `https://dev.valebrandworks.com`, plus the browser's `OPTIONS` preflight.
   This origin check is supplementary. Every other method, including `GET`, is refused.
2. It refuses every share if any required setting is missing. The names of missing settings go to the function log,
   which only project admins can read, never to the caller.
3. It takes the network address only from Cloudflare's `CF-Connecting-IP`, and only after that's been confirmed
   (see below). It ignores `X-Forwarded-For`, `X-Real-IP`, `True-Client-IP`, `Forwarded` and similar headers,
   because callers can write them. If a request has no single valid address, it's refused.
4. It validates the request strictly: only known fields, consent ticked, limited sizes, a one-time submission ID.
5. It verifies the Cloudflare Turnstile token with the secret key. The token must be for `dev.valebrandworks.com`
   with action `share-card`.
6. **Members:** it checks their sign-in token with Supabase Auth, using the low-privilege publishable key. The
   database then reads the ticked fields from their own saved card. A member can't share someone else's card.
7. It turns the network address into an HMAC-SHA256 hash with `SHARE_HASH_SALT`. IPv4 addresses are hashed as they
   are; IPv6 addresses are hashed by their /64 network. Only the hash reaches the database. The address itself is
   never stored, logged or sent to Cloudflare.
8. It calls `public.record_share` with the secret key, sent only in the `apikey` header. That database step
   enforces consent, field rules, rate limits, duplicates and the owner's connection limit.

## Answers
The answer is one of `shared`, `invalid`, `rate_limited`, `unavailable`, `verification_failed`, `sign_in_required`,
`forbidden_origin`, `too_large`, `address_unavailable`, `not_configured` or `error`. A duplicate, or an owner at
their limit, still answers `shared`.

## Settings
| Name | Set by | Notes |
|---|---|---|
| `TURNSTILE_SECRET_KEY` | Founder, in Edge Function secrets | Never in files or chat |
| `SHARE_HASH_SALT` | Founder, in Edge Function secrets | Random text, at least 32 characters |
| `SHARE_TRUSTED_ADDRESS_HEADER` | Founder, in Edge Function secrets, **only after the address check below passes** | Must be exactly `cf-connecting-ip`; anything else refuses every share |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEYS`, `SUPABASE_PUBLISHABLE_KEYS` | Supabase, automatically | Legacy `SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_ANON_KEY` are read only if the new ones are absent |

## Confirming the network address (before setting `SHARE_TRUSTED_ADDRESS_HEADER`)
Neither Supabase nor Cloudflare documents whether a caller can override `CF-Connecting-IP` on Supabase-hosted
functions. Public reports show `X-Forwarded-For` keeps whatever a caller sends. Until a test on the deployed
platform proves the header can't be faked, shares stay switched off. The test:
1. **Platform check:** a separate, temporary probe function, deployed only with approval, compares the header it
   receives with a deliberately fake one sent by the caller. It reports only yes/no and stores nothing. Then it's
   deleted.
2. **Turning trust on:** if the fake value is always replaced by the real one, the founder sets
   `SHARE_TRUSTED_ADDRESS_HEADER = cf-connecting-ip`.
3. **If it isn't replaced:** the setting stays unset, shares stay refused, and the address design is revisited.

## Deploying (development, after approval)
Deploy with `verify_jwt = false`. Visitors have no sign-in token, and the new API keys aren't JWTs, so the function
checks member sign-ins itself.

## Tests
`tests/share-card-function.cjs` runs the handler against an in-memory copy of the database built from this
repository, with stand-ins for Turnstile and Supabase Auth. Its sabotage checks remove one protection at a time and
must notice each one. It passes under both Node (`npm test`) and Deno:

```bash
deno check --no-lock --no-config --check-js supabase/functions/share-card/index.ts
deno lint --no-config supabase/functions/share-card/index.ts supabase/functions/share-card/handler.mjs
deno run --no-lock --no-prompt --node-modules-dir=manual --allow-read --allow-env tests/share-card-function.cjs
```

`handler.mjs` carries JSDoc types, so the strict check (`--check-js`) covers it as well as `index.ts`.
