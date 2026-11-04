# VALE Connect v0.9 development

Development repository and Supabase project jlprxnmdvoloahssjlnu only. Production is separate: the product owner reports v0.9 live with public registration closed. This repository does not define production's code or configuration.

Current candidate: Build 9, prepared for the development address https://dev.valebrandworks.com/ and not yet deployed. Build 8 is the last deployed build. Guided PC/Android export/restore and earlier install/card/sync checks passed. iPhone core checks were user-reported; its update cycle remains an accepted, unverified planning assumption. Versioned sections below describe development history; current behavior includes private cloud connections and selected JSON restore.

## Two card workflows

- My Card retains the existing single private profile and its tested cross-device synchronization. Its Share & QR tab uses a snapshot encoded in the URL.
- Cards manages multiple independent cards under one signed-in account. Create a named private draft, save it, and explicitly publish it to enable its live p.html?u=slug link and QR. Unpublishing disables live public viewing. Existing downloaded or copied data cannot be recalled.
- Each managed card has a stable UUID, owner_id, unique immutable-in-the-UI slug, public-facing card_label, published flag and revision. The editor updates only the expected revision; stale saves preserve form edits and ask for a refresh. The old profiles table is not copied, migrated or published automatically.
- Browser connections stay device/browser specific. Cloud connections sync private notes/follow-ups across the signed-in account; reviewed imports copy selected browser entries. Shared cards offer separate browser and cloud destinations. Billing is not implemented.

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
- supabase/tests/: transactional real-role database tests; never run against production. supabase/inspection/structure_snapshot.sql: read-only structure query that returns no table rows. supabase/baseline/: objects that predate the migrations, for rebuilding a new empty database only.

Run from repository root:

    npm test
    node tests/multiple-cards.cjs   (one suite)
    npm install --ignore-scripts && npm run test:db   (access rules, in a temporary in-memory database; never connects to Supabase)

Serve as static files at a site root to check routing. Use synthetic details in a fresh/private browser. User authentication and phone scans require hands-on verification. Actual managed-card creation is never done automatically on behalf of the user.

## Development releases and rollback

Routine development work and publishing are authorized by the user; production and destructive SQL remain separately approved. Verify target project/repository before writes. Record exact source and deployment SHA and test results. Revert application changes to the preceding development source if needed; keep the additive database fields and preserve saved cards. Never delete extra cards to restore the former one-card-per-owner constraint.

Legacy profile sync remains read/compare/upsert and can race across simultaneous devices. Managed-card revision checks protect normal editor saves; direct API clients must also use conditional revisions. Account sign-out still leaves the original My Card's local storage intact; the Cards manager clears its own in-memory editor/list on account changes.

## Asset provenance

Exact restored QR/logo assets originate from authorized source commit 9b4c39fd0d514d51438568f9b38598fb9dea3481:
QR blob 395aac77ecee54627700ebce01c77d8442b9cbde; logo blob 97f20ad180c205dc9292554d421e6dc6ea284c63. Preserve the Kazuhiko Arase MIT notice.


## PWA development candidate

manifest.webmanifest identifies the development site root as VALE Connect Development (VALE Dev), launches in standalone mode and uses icons derived from the existing brand artwork with a DEV label. All app HTML pages link to this manifest. pwa.js offers native installation where the browser supplies a prompt and manual Android/iOS/desktop guidance otherwise.

pwa.js registers sw.js only on dev.valebrandworks.com and local test hosts. At the former /vale-connect-dev/ path, sw.js removes itself and its own caches, and pwa.js does not register it. Its versioned CacheStorage contains only offline.html and four static icons. App navigations use network with cache:no-store and fall back to the connection screen when unavailable. It never stores navigation/query responses, Supabase API data, authentication state, cards or contacts. Existing localStorage is unchanged; this is not an offline card editor. Public card navigation also needs the internet. External Supabase JS still requires online loading.

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

## Cloud connection downloads — Build 5

Cloud connections offers Export cloud CSV and Download cloud backup (JSON), each with an account-specific confirmation that private notes are included. Exports read saved records directly from the signed-in account with the existing owner filter and RLS. They do not save editor drafts, import browser contacts, change database data or upload files elsewhere. Account changes cancel preparation before download. Download success must be confirmed in the browser's downloads; the app can only request the download.

The export reads ordered, paginated results with an exact total and refuses an incomplete list, mismatched owner, repeated ID, changed count or failed page. It supports API row caps below the requested page size by advancing by the actual number returned. Concurrent edits across pages are not a transactional snapshot; export while other devices are idle and retry if the list changes. No new database privileges or migrations are required.

CSV includes saved details, follow-up fields, private notes and dated history as JSON in a cell; cells with spreadsheet formula prefixes are escaped. UTF-8 BOM and quoted cells preserve Unicode/commas/line breaks. JSON format vale-connect-cloud-connections version 1 preserves original values, IDs, revision, timestamps, source references and full dated history; owner IDs/authentication metadata are omitted. Build 6 added selected missing-connection restore, described below. Browser CSV remains separate. Store these private downloads securely and verify their contents.

Tests: node tests/connections-export.cjs plus the expanded cloud manager test. Includes 1,003 records with lower server cap, pagination failure/change/cancellation, note/history retention, safe CSV, empty data, explicit confirmation, unsaved drafts retained and account-switch cancellation. Roll back app source with a new worker version while preserving downloaded files, cloud records and browser storage. Production remains untouched.

## Restore missing cloud connections — Build 6

Choose a development JSON backup under Cloud connections, then Preview backup. The file is read locally; preview validates the whole file and reads the signed-in cloud list without importing any file records. Only individually selected rows are sent after account-specific confirmation. Nothing is selected automatically. Review details exposes the saved fields/notes as text. Existing IDs/source identities and repeated file entries are skipped; possible email/phone/name-company matches require an explicit separate-entry selection. Before applying, the full saved cloud list is read again. This uses INSERT only; no upsert, UPDATE, DELETE or automatic merge is performed.

Restored connections keep saved private details, follow-up fields and dated history, receive new database IDs/revision/save times, and retain a stable source identity (backup ID fallback for manual entries). Original ownership, revision and save timestamps are not restored. Ownership always comes from the signed-in destination account and RLS. Existing notes are never replaced by older backup notes. New rows remain private; public cards and browser contacts are unchanged. Account changes clear file/preview and stop subsequent inserts; a request already sent can finish in the original account. Restore is not an atomic batch: the summary reports additions/skips/failures, stops on the first non-duplicate request failure, and a fresh preview safely identifies already saved rows before retrying.

Supports JSON format vale-connect-cloud-connections version1, development environment only. Maximum 10 MB/5,000 records/file, 50 selected records/apply, 1,000 dated entries/record. Names/contact fields/notes/history/date/HTTP(S) links are validated with UI-compatible field limits. Unsupported/invalid files are rejected before any writes. CSV and production backup restore are unsupported. Malformed or over-limit historical data may require separate reviewed conversion; it is not silently truncated.

Tests: node tests/connections-restore.cjs and node tests/connections-restore-ui.cjs. Covers exported JSON round trip; malformed/wrong-environment/count/date/history/link/size rejection; exact/repeated/possible matches; explicit unchecked preview; cancel; fresh insert owner/identity; preserved notes/history/follow-up; repeat import; uniqueness races; stopped failure; account-change cancellation. Existing export/cloud/local/cards/PWA/sharing checks pass. Device restore acceptance remains required.

Rollback: revert Build6 app changes with a fresh development worker version. Retain all records, including newly restored entries, and browser storage. No database migration or permission changes are involved; do not delete restored rows automatically to roll back the UI. Destructive data removal remains separately approved. Production remains untouched.

## Account transitions and complete lists — Build 7

Manual profile preview/load/upload and queued automatic operations are bound to the account/session generation at the time of the action. Delayed results/errors are ignored after sign-out or an account switch; profile previews clear on every transition, including cross-tab events. The authentication listener is registered before the initial user check so a stale initial result cannot replace a newer auth event. An already-sent write may finish in its original account; later actions cannot silently switch destination. Browser-local My Card/contacts are not erased by sign-out.

account-lists.js reads owner-filtered connections/cards in ID-ordered pages with exact totals. It rejects failed/incomplete pages, changed totals, duplicate IDs or mismatched owners instead of returning a partial list, and stops after account changes. Only a complete result replaces the displayed list; earlier saved data stays intact on errors. Connection display sorts newest first after fetching; cards sort by label. Shared-card duplicate checks use the same complete connection reader. Simultaneous changes are not a transactional snapshot; refresh if loading reports a change.

Tests: node tests/account-transitions.cjs, node tests/account-lists.cjs, expanded tests/multiple-cards.cjs and existing cloud/export/restore/PWA/sharing suites. Includes delayed success/error, sign-out/A-to-B/queued manual and automatic actions, retained current-account behavior and 1,003-record card/connection lists under a lower API cap. No schema, grants, cloud records or production data changed to implement the repairs. Exact cloud-client pinning and security-advisory dispositions remain separate readiness follow-ups.

Rollback through a history-preserving app revert with a new development worker cache version, preserving database records and browser storage. Reverting Build7 reintroduces the known stale-response/list-cap defects, so prefer a targeted forward fix when possible.

## Dependency and function permissions — Build 8

App and public viewer explicitly load @supabase/supabase-js 2.118.0 UMD from jsDelivr, replacing the floating @2 URL. The CDN package metadata and upstream release v2.118.0 were verified. Future upgrades require an explicit source/version change and regression check. This is a version pin, not a vendored bundle or SRI integrity check; CDN availability/trust still applies. Browser runtime and user sign-in/card/connection smoke checks remain part of acceptance.

Development migration20261103044001_restrict_rls_event_trigger_client_execution revokes EXECUTE on public.rls_auto_enable() from PUBLIC/anon/authenticated. Function body/search path/SECURITY DEFINER mode/owner and ensure_rls event trigger remain unchanged. The owner retains execution and automatic RLS remains enabled. A randomly named empty public-table probe verified automatic RLS inside a rolled-back subtransaction, with no probe left behind. No application record was modified. Permission/catalog checks passed and advisors now show only the pre-existing leaked-password warning.

The organization is currently on the Free plan. Leaked-password protection requires a paid plan; the user plans to upgrade when launch needs justify it and enable that protection then. Keep Free during development and revisit current pricing/requirements before a billing action. This is a documented limitation and future intent, not current billing authorization or a claim that the feature is enabled.

Tests: node tests/client-pin.cjs, the existing thirteen suites/checks, and supabase/tests/rls_event_trigger_permissions.sql. Security advisor results fell from three warnings to the single known Free-plan warning. No production configuration/data was touched.

Rollback: reverting the frontend pin requires a new development worker version and verification of the previous exact library version, while keeping database records and RLS protections. Do not restore a floating client URL as routine rollback. Keep the restrictive function permissions when reverting frontend code. Prior function ACL was default PUBLIC EXECUTE (proacl NULL); restoring that would reintroduce warnings and should require a separately reviewed reason. No destructive database rollback is required.
