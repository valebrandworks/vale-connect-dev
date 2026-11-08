# Milestone 3: account management and relationship details

Development only. Database changes are live on the development project. App changes aren't deployed, and nothing here has reached production.

## Account management

- Delete a connection or a card, with confirmation and protection against deleting a record changed elsewhere.
- Delete an account: requires the account email, the password and a final confirmation. The server also requires a sign-in within the last 10 minutes. It works only for password accounts for now.
- Active and archived connection views, with restore.
- Plan and usage shown on Overview, Cards, Connections and Cloud Account, read from the database.

Plans live in `membership_plans`: Free 1 card and 5 active connections, Plus 3 cards, Pro tentatively 10 cards. Business isn't defined. To adjust a limit, update its row. No code change is needed.

## Relationship details

- Each cloud connection can record the date, place and way you met, and who introduced you.
- Search across names, companies, contact details, meeting details, notes and dated history.
- Filter by category and by follow-ups due now or overdue.
- These fields are included in backups, and older backups still restore.

These features are currently available on every plan. Which ones are Plus-only is a product decision still to be made.

## Migrations on development

Applied: `20261104080556_add_deletion_and_usage.sql` and `20261104080840_add_relationship_details.sql`.

Not applied: `20261108203429_restrict_public_card_reads.sql`, which must follow a deployed page. See `docs/launch-checklist.md`.

## Not done yet

- Reminders that notify someone. The follow-ups filter only works inside the app.
- Introductions that link to another connection. "Introduced by" is free text for now.
- Enforcing Plus-only features, and billing.
- Testing signed-in screens in a real browser, and real account deletion with a throwaway account. Both need a deployment.
