# Public registration launch checklist

**Do not open public registration on any environment until every item is done on that environment.** Production's sign-ups must stay disabled until then.

## Public cards

The database changes are in two stages, because removing direct reads before the new page is live would take published cards offline.

- [ ] Back up the environment.
- [ ] Apply `20261104074759_harden_cards_and_add_membership_limits.sql`.
- [ ] Apply `add_deletion_and_usage`, `add_relationship_details` and `add_plan_features`.
- [ ] Add the site's address to the project's Auth redirect URLs.
- [ ] Deploy the app version that reads cards through `get_public_card`.
- [ ] Open a published test card's link and scan its QR code.
- [ ] Apply `20261104100100_restrict_public_card_reads.sql`.
- [ ] Open that card's link and scan its QR code again.
- [ ] Run `supabase/inspection/launch_gate.sql`. **Every row must say pass.** It's read-only.

## Accounts

- [ ] Password reset works end to end with real email.
- [ ] Reliable email delivery is configured, not just the default sending limits.
- [ ] Email confirmation, password rules and leaked-password protection are reviewed.
- [ ] Bot protection on sign-up.
- [ ] Account deletion tested with a test account, including its effect on published links.

## Business and data

- [ ] Privacy Policy and Terms published.
- [ ] Automatic backups enabled, and a restore rehearsed.
- [ ] Monitoring and a support contact in place.
- [ ] Plans and limits confirmed in `membership_plans`. Pro is tentative, and Business isn't defined.
- [ ] A way to delete browser-only data on shared devices is reviewed.

## Hosting

- [ ] The site is on its own web address.
- [ ] Any card links and QR codes already shared at launch are accounted for, if the address changes.
- [ ] Content security policy and script integrity are reviewed.

## Every production change

Needs the product owner's explicit approval, a backup first, and a check afterward that the app and public cards work.
