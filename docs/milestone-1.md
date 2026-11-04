# Milestone 1: verified database baseline and quick fixes

Completed locally on 2026-11-03. Nothing here has been pushed, deployed or run against a real database by this work.

This repository is public. Security findings are tracked privately, not here.

## Database baseline

The database can now be rebuilt from this repository: run `supabase/baseline/00_objects_before_migrations.sql`, then each migration in order. Use this for new, empty databases only.

A read-only structure snapshot of the development project was compared with a rebuild in a temporary in-memory database. 82 items were compared with no differences: tables, permissions, columns, indexes, access policies, constraints, triggers, functions, publications and the `ensure_rls` event trigger.

- The snapshot itself is kept private and is not stored here.
- `NOT NULL` rules are compared through the column data, because the in-memory database (Postgres 18) records them differently from the development project (Postgres 17.11).
- Default privileges and Supabase's own system objects differ by design and were not compared. Auth settings, storage and production are not in the snapshot.

## Checks

    npm test
    npm install --ignore-scripts
    npm run test:db

`npm test` runs the application suites with file writes and network access blocked. `npm run test:db` rebuilds the database in memory and never connects to Supabase. It runs every access test, confirms each test catches deliberately broken rules, confirms every column the app uses exists, and confirms the snapshot query returns no table rows.

These checks imitate Supabase's roles, so they do not replace running `supabase/tests/` on a real development project.

## Fixes

- Websites typed without `https://` are kept, and invalid entries show an error.
- Unreadable browser contacts are never replaced.
- Overview totals include cloud connections and count imports once.
- An unreadable saved My Card is kept unless the user chooses to replace it.
