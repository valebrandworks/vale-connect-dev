# VALE Connect v0.9 development

Development repository and Supabase project jlprxnmdvoloahssjlnu only. Production v0.8.5 is separate.

## Two card workflows

- My Card retains the existing single private profile and its tested cross-device synchronization. Its Share & QR tab uses a snapshot encoded in the URL.
- Cards manages multiple independent cards under one signed-in account. Create a named private draft, save it, and explicitly publish it to enable its live p.html?u=slug link and QR. Unpublishing disables live public viewing. Existing downloaded or copied data cannot be recalled.
- Each managed card has a stable UUID, owner_id, unique immutable-in-the-UI slug, public-facing card_label, published flag and revision. The editor updates only the expected revision; stale saves preserve form edits and ask for a refresh. The old profiles table is not copied, migrated or published automatically.
- Contacts, dated notes and follow-ups remain browser-local. There is no Save to VALE Connections flow, billing or installable PWA yet.

## Security and compatibility

public_cards RLS permits anonymous published-card reads, owner draft reads and owner-only writes. All columns of a published row are public; never store private notes or secrets there. Private profiles remain owner-only. Browser clients use publishable configuration in cloud-auth.js and p.html; never add secret/service-role keys or passwords.

The multi-card migration preserves rows and existing slugs; it replaces the owner-only primary key with a per-card UUID, retaining an owner index and existing policies. SQL records under supabase/migrations are already applied in development; static Pages publishing does not execute them. Do not rerun them blindly.

## Files and checks

- index.html: existing workspace plus separate Cards editor.
- cloud-auth.js: original profile sync plus an account-ready event for the Cards controller.
- cards.js: card list/editor, guarded saves, publication, QR.
- cards-core.js: field mapping, validation and VCF formatting, also used by p.html.
- p.html: published-card viewer with VCF download.
- qr-bundle.js, QR_LICENSE.txt, assets/: existing QR encoder, MIT notice and logo.
- tests/multiple-cards.cjs: manager/core regression tests (mock network/DOM).
- tests/blank-sharing.cjs: original sharing regression tests.
- supabase/tests/: transactional real-role database tests; never run against production.

Run from repository root:

    node tests/multiple-cards.cjs
    node tests/blank-sharing.cjs

Serve as static files under /vale-connect-dev/ to check Pages routing. Use synthetic details in a fresh/private browser. User authentication and phone scans require hands-on verification. Actual managed-card creation is never done automatically on behalf of the user.

## Development releases and rollback

Routine development work and publishing are authorized by the user; production and destructive SQL remain separately approved. Verify target project/repository before writes. Record exact source and deployment SHA and test results. Revert application changes to the preceding development source if needed; keep the additive database fields and preserve saved cards. Never delete extra cards to restore the former one-card-per-owner constraint.

Legacy profile sync remains read/compare/upsert and can race across simultaneous devices. Managed-card revision checks protect normal editor saves; direct API clients must also use conditional revisions. Account sign-out still leaves the original My Card's local storage intact; the Cards manager clears its own in-memory editor/list on account changes.

## Asset provenance

Exact restored QR/logo assets originate from authorized source commit 9b4c39fd0d514d51438568f9b38598fb9dea3481:
QR blob 395aac77ecee54627700ebce01c77d8442b9cbde; logo blob 97f20ad180c205dc9292554d421e6dc6ea284c63. Preserve the Kazuhiko Arase MIT notice.

