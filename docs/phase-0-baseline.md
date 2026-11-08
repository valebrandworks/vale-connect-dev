# Phase 0 development baseline

Recorded 2026-11-03. This is the known-good starting point for later development work.

This repository is public. Do not add security findings, credentials, backups or real contact data to this file.

## Source

| Item | Value |
|---|---|
| Repository | valebrandworks/vale-connect-dev |
| Baseline commit | `a1878d175f6769e4a3d55112c48d8095a501facb` (`main`, Build 8) |
| Local branch | `dev/phase-0-baseline` |
| Commits on `main` | 23 |
| Unmerged remote branches | None |
| Open pull requests | None |

The ZIP snapshot used for the first assessment matches this commit: all 48 files have identical SHA-256 hashes.

## Local environment

| Tool | Version |
|---|---|
| Windows | 11 Home |
| Git | 2.56.0.windows.4 |
| Node.js | 26.13.0 (LTS) |
| npm | 11.20.0 (not required by the current tests) |

The local clone has safeguards in its own Git settings:

- Pushes are disabled: the push URL is the invalid placeholder `no-push-until-approved`.
- No GitHub credentials are configured: `credential.helper` is blank for this repository.
- `core.autocrlf=false` keeps files byte-identical to the repository.

To re-enable pushing after explicit approval, restore the push URL:

    git remote set-url --push origin https://github.com/valebrandworks/vale-connect-dev.git

## Automated test results

All 13 suites pass (13 passed, 0 failed). Run each from the repository root:

    node tests/<name>.cjs

The tests use simulated browser and network objects. For this baseline they also ran with file writes and network access blocked:

    node --permission --allow-fs-read=* tests/<name>.cjs

| Suite | Result |
|---|---|
| account-lists | Pass |
| account-transitions | Pass |
| blank-sharing | Pass |
| client-pin | Pass |
| cloud-connections | Pass |
| cloud-connections-manager | Pass |
| connections | Pass |
| connections-export | Pass |
| connections-restore | Pass |
| connections-restore-ui | Pass |
| multiple-cards | Pass |
| pwa-service-worker | Pass |
| pwa-ui | Pass |

## Not covered by this baseline

- `supabase/tests/*.sql` were not run. They need a live database, and they must never run against production.
- The live Supabase schema, policies and settings were not inspected, for development or production.
- Production source and configuration were not inspected. This repository is the development app.
- No browser, device or sign-in testing was done against this commit.

## Known documentation and test gaps

- The README describes production as v0.8.5. The product owner reports that v0.9 is now live in production with public registration closed.
- The migrations do not create `public.public_cards` or its access policies, or the `rls_auto_enable` function and `ensure_rls` trigger, so a new database cannot be built from them alone.
- `supabase/tests/` has no test for `connections` or `profiles`, although the README describes a `connections` database test.
- There is no `package.json`, linter or automated test run on GitHub.

## Reproduced functional defects

Left unchanged at this baseline:

1. A cloud connection's website entered without `https://` (for example `example.com`) is saved as blank.
2. The main screen treats unreadable browser contact data as an empty list, so the next save would replace the stored data. The newer save path in `connections-core.js` correctly refuses.
3. The Overview counts include browser connections only, not cloud connections.
