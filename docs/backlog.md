# Development backlog

This repository is public. Track security findings privately, not here.

## Requirements for every production change

Production changes need the product owner's explicit approval. Changes to how public cards are read must be staged as described in `docs/launch-checklist.md`, so any card in use at that time keeps working.

## Next reliability milestone

### Protect an unreadable My Card from being overwritten

Found by code review on 2026-11-03. Fixed on the local branch dev/my-card-safety; not yet released.

- **Problem:** `index.html` treats an unreadable saved My Card as a blank card, so pressing Save Card replaces the stored data. `cloud-auth.js` also reads it as empty, so a signed-in device replaces it with the cloud card.
- **Risk:** lower than the equivalent contacts issue, because it affects one card that can be re-entered or reloaded from the cloud.
- **Done when:** unreadable My Card data is never replaced without the user's explicit choice, the user sees a clear message, and a regression test covers both the signed-in and signed-out cases.
