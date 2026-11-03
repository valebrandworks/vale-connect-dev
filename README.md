# VALE Connect v0.9 development

Development repository and Supabase project jlprxnmdvoloahssjlnu only. Production v0.8.5 is separate.

## Two card workflows

- My Card retains the existing single private profile and its tested cross-device synchronization. Its Share & QR tab uses a snapshot encoded in the URL.
- Cards manages multiple independent cards under one signed-in account. Create a named private draft, save it, and explicitly publish it to enable its live p.html?u=slug link and QR. Unpublishing disables live public viewing. Existing downloaded or copied data cannot be recalled.
- Each managed card has a stable UUID, owner_id, unique immutable-in-the-UI slug, public-facing card_label, published flag and revision. The editor updates only the expected revision; stale saves preserve form edits and ask for a refresh. The old profiles table is not copied, migrated or published automatically.
- Contacts, dated notes and follow-ups remain browser-local. Save to VALE Connections is browser-local; billing is not implemented. PWA installation is a development candidate requiring device acceptance.

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


## PWA development candidate

manifest.webmanifest identifies only /vale-connect-dev/ as VALE Connect Development (VALE Dev), launches in standalone mode and uses icons derived from the existing brand artwork with a DEV label. All app HTML pages link to this manifest. pwa.js offers native installation where the browser supplies a prompt and manual Android/iOS/desktop guidance otherwise.

sw.js registers only inside /vale-connect-dev/. Its versioned CacheStorage contains only offline.html and four static icons. App navigations use network with cache:no-store and fall back to the connection screen when unavailable. It never stores navigation/query responses, Supabase API data, authentication state, cards or contacts. Existing localStorage is unchanged; this is not an offline card editor. Public card navigation also needs the internet. External Supabase JS still requires online loading.

Updates wait. The Update app button asks users to save edits before requesting activation; only that tab reloads after activation. Other tabs are not forcibly reloaded. Bump the sw.js cache version and changed script version query strings on future app releases so installed clients can discover updated code/assets. Activation removes only caches with the development PWA prefix, never another app's caches or user localStorage.

Tests:

    node tests/pwa-service-worker.cjs
    node tests/pwa-ui.cjs

Browser/device acceptance remains necessary: native installation (PC/Android/iPhone as available), correct icon/name, standalone launch, online sign-in/cards, offline connection screen without stale private content, and update behavior across a later release. Do not call PWA acceptance complete merely because scripts and tests pass. Manifest/service-worker setup follows web.dev/learn/pwa/web-app-manifest and WebKit's Add to Home Screen guidance.

PWA rollback needs more than reverting index.html because a registered worker persists. See docs/pwa-rollback.md for a development-scoped retirement worker; do not unregister unrelated workers or clear user data.


## Save to VALE Connections — Build 3

Both encoded snapshot shared cards and published p.html cards offer an explicit, confirmed save into vale-connect-dev-v09-contacts. No sign-in, account-data transmission, reciprocal exchange or cloud write occurs. The save UI explains that data remains in the current device/browser; Safari, Chrome and an installed app can have separate storage. Open my VALE Connections navigates to the local Connections view in that same browser. Existing VCF export remains separate.

Exact stable published-card identities and repeated snapshot identities are blocked from being saved again. Possible matches by normalized email, phone (at least seven digits) or both name/company preserve the existing record and notes and allow the user to explicitly save a separate entry. There is no automatic merge or overwrite. Updates to a shared card do not silently modify an already saved connection.

Read existing storage immediately before save. Unreadable/corrupt lists and failed/quota-limited writes produce an error rather than overwriting the list. Web Locks serialize cooperating import actions across tabs when available; this is not a claim of transactional cross-tab storage for the legacy manual editor. App storage events refresh open local connection lists. Imported role/website/social fields and source URL are preserved/exported along with standard contact fields; source links accept only HTTP(S).

connections-core.js contains validation, duplicate detection and local storage operations; connections-ui.js mounts the public-view save controls. Tests:

    node tests/connections.cjs

Acceptance: open a synthetic shared card, save explicitly, verify it appears in Connections in the same browser, reopen/rescan and confirm no duplicate. Exercise a possible match without modifying existing notes. Phone/browser/installed-app storage boundaries should be explained rather than hidden.

Rollback: revert the Build 3 app-source change using a development history-preserving revert; retain the browser connection list. Do not clear localStorage or rerun SQL. Retained extra contact properties are ignored by older renderers, and existing records/notes remain compatible.

## Private cloud connections — Build 4

Connections now has separate Browser connections and Cloud connections lists. The original browser list and its CSV export remain device/browser specific. Cloud connections require sign-in and an internet connection, and refresh on focus or approximately every 20 seconds while the editor has no unsaved changes. Cloud lists are kept in memory, not copied into the shared browser contact storage or service-worker cache. Account changes clear the cloud editor and list.

Use Review browser connections, select individual unchecked entries, and confirm the destination account to import. Originals remain intact. Shared cards also offer a separately confirmed Save to my cloud connections action when signed in in that browser. Stable source identities prevent repeat imports per account; possible email/phone/name-company matches need an explicit separate-entry choice. Existing notes and dated history are never automatically merged or overwritten. Saving someone else's card does not disclose the recipient's details or establish reciprocal sharing.

Migration 20261103025723_add_private_cloud_connections adds only public.connections in development project jlprxnmdvoloahssjlnu. RLS and table privileges permit authenticated owner-only SELECT/INSERT/UPDATE; anonymous access, ownership transfer, DELETE and TRUNCATE are denied. Owner/source uniqueness is separate from public_cards. Conditional revision updates preserve stale editor text for manual resolution. Direct API clients must also use the revision predicate. Cloud editing is online-only; no background retry queue or automatic import is implemented. Browser CSV export does not include cloud records.

Tests: node tests/cloud-connections.cjs and node tests/cloud-connections-manager.cjs. The transaction-only database test verifies actual anon/authenticated roles, cross-account isolation, ownership transfer denial, source uniqueness per owner, own writes, history retention and stale revision rejection; all synthetic fixtures roll back.

Rollback: revert the Build 4 application commit while keeping public.connections and its saved records/policies. Publish a new development service-worker version so installed clients receive the rollback. Do not drop the table, revoke access to existing records, clear browser storage or restore production. If a future schema rollback is essential, first export/verify development data and request explicit approval for destructive operations. Existing profile/card tables are unchanged.
