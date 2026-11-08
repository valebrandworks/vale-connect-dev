# Milestone 4: configurable plan features

Development only. The database rules are live on the development project. App changes aren't deployed, and nothing here has reached production.

## Plans

| | Free | Plus | Pro (tentative) |
|---|---|---|---|
| Cards | 1 | 3 | 10 |
| Active connections | 5 | Unlimited | Unlimited |
| Private notes, categories, follow-up dates | Yes | Yes | Yes |
| Name search | Yes | Yes | Yes |
| `dated_history` | No | Yes | Yes |
| `meeting_details` (meeting details and introductions) | No | Yes | Yes |
| `advanced_search` | No | Yes | Yes |
| `reminders` | No | Yes | Yes |

Business isn't defined. To change a plan, update its row in `membership_plans`: `max_cards`, `max_active_connections` or `features`. No code change is needed.

## How it's enforced

- **Enforced by the database:** card and connection limits, dated history and meeting details. Clients can't change plans or plan features.
- **Enforced by the app only: advanced search.** Search runs on the person's own records, already sent to their browser, so a server rule wouldn't protect anything.
- **Reminders:** the feature flag exists, but notifications aren't built yet.

## Moving to a lower plan

Nothing is deleted. Saved history and meeting details stay readable, the record's other fields stay editable, and the record can be archived. The restricted fields can't change until the person upgrades.

## Known behavior

- A Free account can't import a browser contact or restore a backup entry that includes dated history. The contact isn't changed, and the import summary counts it as failed. A clearer message is still to be added.
- A Free user over a limit can edit existing items, but can't add more.

## Migration on development

Applied: `20261104082212_add_plan_features.sql`.
