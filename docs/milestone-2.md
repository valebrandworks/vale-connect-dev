# Milestone 2: secure public cards, membership limits, account recovery

Development only. Nothing here has been deployed or applied to production.

## What changed

**Public cards**
- `get_public_card` returns one published card by its link name, with public fields only. `p.html` uses it.
- `20261108203429_restrict_public_card_reads.sql` then removes direct table reads for visitors and limits card reads to their owners. Apply it only after a page using the lookup is live on that environment.
- New cards start as drafts, link names can't change, and a deleted card's link name is never reused.
- Field sizes are enforced in the database, and revisions and timestamps are set by the server for app clients.

**Membership limits**
- `membership_plans` holds each plan's limits, and `memberships` holds each account's plan. An account with no row is on Free. Clients can read these but not change them.
- Free: 1 card and 5 active connections. Plus: 3 cards (a placeholder awaiting a product decision) and unlimited connections.
- Limits apply when adding. Existing records over a limit stay viewable and editable.
- Connections can be archived and restored. Archived connections keep their notes and don't count toward the limit.

**Account recovery**
- Forgot password, set a new password from the emailed link, and change password while signed in.
- Reset messages don't reveal whether an account exists. New passwords need at least 8 characters in the app.

## Rollout order for any environment

1. Back up.
2. Apply `20261104074759_harden_cards_and_add_membership_limits.sql`. It's additive, so the current app keeps working.
3. Add the new address to the project's Auth redirect URLs.
4. Deploy the app, and confirm that public card links work.
5. Apply `20261108203429_restrict_public_card_reads.sql`, then confirm again.

## Status

Step 2 is done on development. Steps 3 to 5 aren't.

## Checks

- `npm test`
- `npm install --ignore-scripts`, then `npm run test:db`

## Not done yet

- Billing, and assigning plans when someone pays
- Deleting connections, cards and accounts
- Showing plan and usage in the app, and browsing archived connections separately
- Testing real password-reset emails, which needs step 3 and working email delivery
