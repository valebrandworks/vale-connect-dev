# Milestone 4: configurable plan features

Development only. The database rules are live on the development project. App changes aren't deployed, and nothing here has reached production.

## Plans

| | Free | Plus | Pro (tentative) |
|---|---|---|---|
| Cards | 1 | 3 | 10 |
| Saved connections | Unlimited | Unlimited | Unlimited |
| Private notes, categories, follow-up dates | Yes | Yes | Yes |
| Name search | Yes | Yes | Yes |
| `dated_history` | No | Yes | Yes |
| `meeting_details` (meeting details and introductions) | No | Yes | Yes |
| `advanced_search` | No | Yes | Yes |
| `reminders` | No | Yes | Yes |

Free has offered unlimited basic saved connections since `20261112000000_unlimited_free_connections` (it was 5, then a 1,000 fair-use cap). Paid plans are set apart by features, not contact counts. Every account instead has a rate limit on **new** connections, 1,000 per hour and 5,000 per day, kept in `connection_limits`. Edits, archiving and unarchiving don't count toward it, and nobody's total is limited. Large lists show 200 connections at a time, and search covers all of them.

Business isn't defined. To change a plan, update its row in `membership_plans`: `max_cards`, `max_active_connections` or `features`. No code change is needed.

## How it's enforced

- **Enforced by the database:** card limits, the rate limit on new connections, any connection limit a plan sets (none do today), dated history and meeting details. Clients can't change plans or plan features.
- **Enforced by the app only: advanced search.** Search runs on the person's own records, already sent to their browser, so a server rule wouldn't protect anything.
- **Reminders:** the feature flag exists, but notifications aren't built yet.

## Moving to a lower plan

Nothing is deleted. Saved history and meeting details stay readable, the record's other fields stay editable, and the record can be archived. The restricted fields can't change until the person upgrades.

## Known behavior

- A Free account can't import a browser contact or restore a backup entry that includes dated history. The contact isn't changed, and the import summary counts it as failed. A clearer message is still to be added.
- A Free user over a limit can edit existing items, but can't add more.

## Migration on development

Applied: `20261104082212_add_plan_features.sql`.
