# VALE Connect v0.9 development

Static development application. Production v0.8.5 is separate and must not be changed from this branch.

## Files
- index.html: card editor, local connections, URL-based sharing, QR and VCF export.
- cloud-auth.js: authentication and private single-profile synchronization.
- p.html?u=slug: published public-card viewer; not yet integrated with the editor.
- qr-bundle.js and QR_LICENSE.txt: restored QR encoder and upstream MIT notice.
- assets/vale-connect-logo.png: existing VALE Connect artwork.
- supabase/migrations/: exact development repairs recorded in Supabase.
- supabase/tests/: transactional synthetic role tests; database-owner execution required. Never run against production.

## Development environment
Supabase project: jlprxnmdvoloahssjlnu (VALE Connect Development).
The browser publishable configuration is present in cloud-auth.js and p.html.
Never add secret/service-role keys, passwords, or access tokens.
profiles is private to its account owner through RLS. public_cards exposes published rows and owner drafts according to RLS.
Contacts and notes stay in this browser; they are not cloud-synchronized.
Browser storage names begin vale-connect-dev-v09-. This separates names, not browser-origin security.

## Local review
Serve this folder with a static HTTP server. Test under /vale-connect-dev/ when checking Pages routing.
Use synthetic data in a fresh browser profile; signing in can synchronize an existing locally saved card.
Verify logo loading, QR generation and scanning, shared profile display, VCF export, and account isolation.

## Publication
This repair branch is not approved for merge or deployment.
The recorded Pages run published main at 8e879753dab27cf1db77626197d315336047071b.
Confirm current Settings > Pages source and URL before any future merge; branch publishing settings were not accessible through the connector.
Do not assume a branch push is an accepted release.

## Known limits
Single card per account; no card manager, publish UI, Save to VALE Connections, or deduplication.
URL-based sharing and the database-backed public viewer are separate flows.
No installable PWA, offline cache, service worker, or update workflow yet.
Profile synchronization uses client-side read/compare/upsert; concurrent devices can still race.
Account sign-out leaves local card/contacts on the device.
Full browser/phone, real-login and two-device acceptance testing remains required.

## Asset provenance
QR and logo copied without alteration from the authorized source snapshot
valebrandworks/vale-connect at 9b4c39fd0d514d51438568f9b38598fb9dea3481.
QR blob: 395aac77ecee54627700ebce01c77d8442b9cbde.
Logo blob: 97f20ad180c205dc9292554d421e6dc6ea284c63.
QR license notice: https://github.com/kazuhikoarase/qrcode-generator/blob/master/LICENSE
