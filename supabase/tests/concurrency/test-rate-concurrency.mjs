// DEVELOPMENT ONLY. Real-concurrency test of the global rate limits: many simultaneous calls through SEPARATE database connections
// (each management-API call is its own connection) against the DEVELOPMENT project. It is not part of `npm test` and never runs against
// production: the project reference is fixed below and the script refuses any other.
//
// Why committed settings: separate connections cannot see another connection's uncommitted changes, so a test that changes limits
// inside a transaction cannot test concurrency. This script therefore COMMITS small limits, runs, and restores them, with these guarantees:
//   1. Before changing anything it saves the original limit rows to a file (in the OS temp folder) and refuses to start if a previous run
//      left that file or any test fixture behind (run with --restore to put things back first).
//   2. Every change is restored in `finally` (also after a failure or Ctrl+C), then verified: limits equal the originals, and no
//      fixture, attempt, report, share or retired slug of the test remains. A failed verification exits non-zero and says what is left.
//   3. All fixtures are marked: users '...@concurrency-test.invalid', cards 'cc-test-...', so cleanup deletes only those.
//   4. Only development tables and the two functions under test are touched; no production credential or address appears here.
//
// Usage (PowerShell):  $env:VALE_DEV_HEADERS = 'C:\path\to\supabase-dev-headers.ps1'; node test-rate-concurrency.mjs [--restore]
// The headers script prints {"Authorization":"Bearer <development token>"}; the token is never printed by this script.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const DEV = 'jlprxnmdvoloahssjlnu';
const PRODUCTION_REFS = ['uhribjaiyuwivzqxusur', 'xmrhohffgmfqhisqzaqb'];
if (PRODUCTION_REFS.includes(DEV)) throw new Error('This script must never target production.');
const headersScript = process.env.VALE_DEV_HEADERS;
if (!headersScript) { console.log('Set VALE_DEV_HEADERS to the path of the development headers script.'); process.exit(2); }
const h = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', headersScript], { encoding: 'utf8' });
if (h.status !== 0) { console.log('Could not load the stored development token.'); process.exit(2); }
const AUTH = JSON.parse(h.stdout).Authorization;
const STATE = path.join(os.tmpdir(), 'vale-concurrency-originals.json');
const EMAIL_DOMAIN = '@concurrency-test.invalid', SLUG_PREFIX = 'cc-test-';

const call = async query => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${DEV}/database/query`, { method: 'POST', headers: { Authorization: AUTH, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: r.status, text, json };
};
// Setup, cleanup and checks (via `must`, which throws on any non-201 result) wait and retry when the management API throttles (HTTP 429); only the simultaneous calls under test use the raw call.
const callPatient = async query => { for (let i = 0; i < 10; i++) { const r = await call(query); if (r.status !== 429) return r; await new Promise(res => setTimeout(res, 3000 * (i + 1))); } return call(query); };
const rows = async query => { const r = await callPatient(query); if (r.status !== 201) throw new Error('query failed (' + r.status + '): ' + r.text.slice(0, 200)); return r.json; };
const uuid = () => crypto.randomUUID();
const hex64 = () => crypto.randomBytes(32).toString('hex');
let problems = 0;
const check = (ok, label, detail = '') => { console.log((ok ? 'pass  ' : 'FAIL  ') + label + (detail ? ' ' + detail : '')); if (!ok) problems++; };

// ---------- cleanup, restore and verification ----------
// Every cleanup/restore statement must succeed: a non-201 answer (after patient retries) stops the run with an error naming the step.
async function must(query, label) {
  const r = await callPatient(query);
  if (r.status !== 201) throw new Error(label + ' failed (HTTP ' + r.status + '): ' + r.text.slice(0, 200));
  return r;
}
const NONE = '00000000-0000-0000-0000-000000000000';
const idList = ids => ids.length ? ids.map(i => `'${i}'`).join(',') : `'${NONE}'`;
// fixtureIds: user and card ids recorded when the fixtures were created (also saved in the state file), so records tied to them
// are removed and verified even if a row lost its marker or its card. Rows are also matched by the markers alone (crash recovery).
const usersOf = f => `(SELECT id FROM auth.users WHERE email LIKE '%${EMAIL_DOMAIN}' UNION SELECT unnest(ARRAY[${idList(f.users)}]::uuid[]))`;
const cardsOf = f => `(SELECT id FROM public.public_cards WHERE slug LIKE '${SLUG_PREFIX}%' UNION SELECT unnest(ARRAY[${idList(f.cards)}]::uuid[]))`;
async function removeFixtures(f = { users: [], cards: [] }) {
  const U = usersOf(f), C = cardsOf(f);
  await must(`DELETE FROM public.notifications WHERE owner_id IN ${U};`, 'delete notifications');
  await must(`DELETE FROM public.share_attempts WHERE card_id IN ${C} OR network_hash LIKE 'cc-net-%' OR sharer_user_id IN ${U};`, 'delete share attempts');
  await must(`DELETE FROM vale_private.report_attempts WHERE card_id IN ${C};`, 'delete report attempts');
  await must(`DELETE FROM vale_private.card_reports WHERE card_slug LIKE '${SLUG_PREFIX}%';`, 'delete reports');
  await must(`DELETE FROM public.card_shares WHERE card_id IN ${C} OR owner_id IN ${U};`, 'delete shares');
  await must(`DELETE FROM public.connections WHERE owner_id IN ${U} OR email LIKE '%${EMAIL_DOMAIN}';`, 'delete connections');
  await must(`DELETE FROM public.public_cards WHERE slug LIKE '${SLUG_PREFIX}%' OR id IN ${C};`, 'delete cards');
  await must(`DELETE FROM auth.users WHERE email LIKE '%${EMAIL_DOMAIN}' OR id IN ${U};`, 'delete users');
  await must(`DELETE FROM public.retired_card_slugs WHERE slug LIKE '${SLUG_PREFIX}%';`, 'delete retired slugs');
}
async function restoreLimits(originals) {
  for (const l of originals.share) await must(`UPDATE public.share_limits SET max_count = ${l.max_count}, window_seconds = ${l.window_seconds} WHERE name = '${l.name}'`, 'restore share limit ' + l.name);
  for (const s of originals.report) await must(`UPDATE vale_private.report_settings SET value = ${s.value} WHERE name = '${s.name}'`, 'restore report setting ' + s.name);
}
const snapshotLimits = async () => ({
  share: await rows(`SELECT name, max_count, window_seconds FROM public.share_limits ORDER BY name`),
  report: await rows(`SELECT name, value FROM vale_private.report_settings ORDER BY name`) });
const leftovers = async (f = { users: [], cards: [] }) => (await rows(`SELECT
  (SELECT count(*) FROM auth.users WHERE id IN ${usersOf(f)})::int AS users,
  (SELECT count(*) FROM public.public_cards WHERE id IN ${cardsOf(f)} OR slug LIKE '${SLUG_PREFIX}%')::int AS cards,
  (SELECT count(*) FROM vale_private.card_reports WHERE card_slug LIKE '${SLUG_PREFIX}%')::int AS reports,
  (SELECT count(*) FROM public.retired_card_slugs WHERE slug LIKE '${SLUG_PREFIX}%')::int AS retired,
  (SELECT count(*) FROM public.card_shares WHERE card_id IN ${cardsOf(f)} OR owner_id IN ${usersOf(f)})::int AS shares,
  (SELECT count(*) FROM public.share_attempts WHERE card_id IN ${cardsOf(f)} OR network_hash LIKE 'cc-net-%' OR sharer_user_id IN ${usersOf(f)})::int AS share_attempts,
  (SELECT count(*) FROM vale_private.report_attempts WHERE card_id IN ${cardsOf(f)})::int AS report_attempts,
  (SELECT count(*) FROM public.connections WHERE owner_id IN ${usersOf(f)} OR email LIKE '%${EMAIL_DOMAIN}')::int AS connections,
  (SELECT count(*) FROM public.notifications WHERE owner_id IN ${usersOf(f)})::int AS notifications`))[0];
async function restoreAndVerify(originals, label, f) {
  await removeFixtures(f); await restoreLimits(originals);
  const now = await snapshotLimits(), left = await leftovers(f);
  check(JSON.stringify(now) === JSON.stringify(originals), label + ': limits restored exactly');
  check(Object.values(left).every(n => n === 0), label + ': no test fixture, share, share attempt, report, report attempt, connection, notification or retired slug left', JSON.stringify(left));
}

if (process.argv.includes('--restore')) {
  if (!fs.existsSync(STATE)) { console.log('No saved originals found; nothing to restore.'); const left = await leftovers(); console.log('leftovers:', JSON.stringify(left)); if (Object.values(left).some(n => n)) { await removeFixtures(); const after = await leftovers(); console.log('after removal:', JSON.stringify(after)); process.exit(Object.values(after).every(n => n === 0) ? 0 : 1); } process.exit(0); }
  const saved = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  const originals = saved.originals ?? saved, f = saved.fixtures ?? { users: [], cards: [] };
  try { await restoreAndVerify(originals, 'restore', f); } catch (e) { console.log('Restore failed: ' + e.message); problems++; }
  if (!problems) fs.unlinkSync(STATE);
  console.log(problems ? `\n${problems} PROBLEM(S); saved originals kept` : '\nRESTORED'); process.exit(problems ? 1 : 0);
}
if (fs.existsSync(STATE)) { console.log('A previous run left its saved originals at ' + STATE + '. Run with --restore first.'); process.exit(2); }
{ const left = await leftovers(); if (!Object.values(left).every(n => n === 0)) { console.log('Test fixtures from an earlier run exist (' + JSON.stringify(left) + '). Run with --restore first.'); process.exit(2); } }

const originals = await snapshotLimits();
const fixtures = { users: [], cards: [] };
const saveState = () => fs.writeFileSync(STATE, JSON.stringify({ originals, fixtures }));
saveState();
let interrupted = false;
const bail = async () => { if (interrupted) return; interrupted = true; console.log('\nInterrupted: restoring...'); try { const b = problems; await restoreAndVerify(originals, 'interrupted', fixtures); if (problems === b) fs.unlinkSync(STATE); else console.log('Cleanup not verified; saved originals kept (run with --restore)'); } catch (e) { console.log('Restore failed: ' + e.message + ' (run with --restore)'); } process.exit(1); };
process.on('SIGINT', bail); process.on('SIGTERM', bail);

const setShare = (name, max, win) => must(`UPDATE public.share_limits SET max_count = ${max}${win ? ', window_seconds = ' + win : ''} WHERE name = '${name}'`, 'set share limit ' + name);
const setReport = (name, value) => must(`UPDATE vale_private.report_settings SET value = ${value} WHERE name = '${name}'`, 'set report setting ' + name);
const result = r => { try { return r.json?.[0]?.r ?? ('HTTP ' + r.status + ' ' + r.text.slice(0, 80)); } catch { return 'unreadable'; } };
const tally = list => list.reduce((a, x) => (a[x] = (a[x] || 0) + 1, a), {});

try {
  // ---------- fixtures (committed, marked) ----------
  const owners = Array.from({ length: 6 }, (_, i) => ({ id: uuid(), card: uuid(), slug: `${SLUG_PREFIX}${i}-${crypto.randomBytes(3).toString('hex')}` }));
  const member = { id: uuid(), card: uuid(), slug: `${SLUG_PREFIX}m-${crypto.randomBytes(3).toString('hex')}` };
  fixtures.users.push(...owners.map(o => o.id), member.id); fixtures.cards.push(...owners.map(o => o.card), member.card); saveState();
  let setup = '';
  for (const o of owners) setup += `INSERT INTO auth.users(id, email) VALUES ('${o.id}', 'cc-o-${o.id}${EMAIL_DOMAIN}');
    INSERT INTO public.public_cards(id, owner_id, slug, display_name, public_email, public_phone, published) VALUES ('${o.card}', '${o.id}', '${o.slug}', 'CC Owner', '', '', true);\n`;
  setup += `INSERT INTO auth.users(id, email) VALUES ('${member.id}', 'cc-m-${member.id}${EMAIL_DOMAIN}');
    INSERT INTO public.public_cards(id, owner_id, slug, display_name, public_email, public_phone, published) VALUES ('${member.card}', '${member.id}', '${member.slug}', 'CC Member', 'cc.member@concurrency-test.invalid', '+1 555 010 0555', true);`;
  const made = await callPatient(setup);
  check(made.status === 201, 'fixtures created (committed, marked)', made.status === 201 ? '' : made.text.slice(0, 200));
  if (made.status !== 201) throw new Error('fixture creation failed');
  const slugOf = i => owners[i % owners.length].slug;

  const visitorShare = (i, net) => `SET LOCAL ROLE service_role; SELECT public.record_share('${slugOf(i)}', '${uuid()}'::uuid, true, 'v1', '{"full_name":"CC ${i}","email":"cc-${i}-${crypto.randomBytes(4).toString('hex')}${EMAIL_DOMAIN}"}'::jsonb, NULL, NULL, NULL, '${net}', '') AS r;`;
  const memberShare = (i, net) => `SET LOCAL ROLE service_role; SELECT public.record_share('${slugOf(i)}', '${uuid()}'::uuid, true, 'v1', NULL, ARRAY['full_name','email'], '${member.id}'::uuid, '${member.card}'::uuid, '${net}', 'cc note ${i} ${crypto.randomBytes(3).toString('hex')}') AS r;`;
  const report = (i, net) => `SET LOCAL ROLE service_role; SELECT public.submit_card_report('${slugOf(i)}', '${uuid()}'::uuid, 'spam', 'cc ${i}', '', true, '${net}') AS r;`;
  const pause = ms => new Promise(res => setTimeout(res, ms));
  const fire = async (n, make) => { const t0 = Date.now(); const res = await Promise.all(Array.from({ length: n }, (_, i) => call(make(i)))); return { res, ms: Date.now() - t0 }; };
  const clearAttempts = () => must(`DELETE FROM public.share_attempts WHERE card_id IN (SELECT id FROM public.public_cards WHERE slug LIKE '${SLUG_PREFIX}%'); DELETE FROM vale_private.report_attempts WHERE card_id IN (SELECT id FROM public.public_cards WHERE slug LIKE '${SLUG_PREFIX}%'); DELETE FROM vale_private.card_reports WHERE card_slug LIKE '${SLUG_PREFIX}%'; DELETE FROM public.card_shares WHERE card_id IN (SELECT id FROM public.public_cards WHERE slug LIKE '${SLUG_PREFIX}%')`, 'clear attempts');
  // Retry a scenario if the management API throttled some calls (a throttled call never reached the database).
  const scenario = async (name, setupFn, n, make, expected) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await pause(8000); await clearAttempts(); const info = await setupFn();
      const { res, ms } = await fire(n, make);
      const bad = res.filter(r => r.status !== 201);
      if (bad.length && attempt < 3) { console.log(`      (${bad.length} call(s) not executed, HTTP ${[...new Set(bad.map(b => b.status))]}; repeating scenario)`); continue; }
      const outcome = tally(res.map(result));
      console.log(`      ${name}: ${n} simultaneous calls in ${ms} ms -> ${JSON.stringify(outcome)}`);
      expected(outcome, info, bad.length);
      return;
    }
  };

  // S1 global visitor hourly limit, across 6 cards and 24 different networks
  await scenario('S1 global visitor limit', async () => {
    const base = (await rows(`SELECT count(*)::int AS n FROM public.share_attempts WHERE NOT refused AND sharer_user_id IS NULL AND created_at > now() - interval '1 hour'`))[0].n;
    await setShare('global_visitor', base + 5, 3600); await setShare('global_visitor_day', 100000, 86400); return { base };
  }, 24, i => visitorShare(i, 'cc-net-s1-' + i), (o, info, notRun) => {
    check(o.shared === 5 && (o.rate_limited || 0) === 24 - 5 - notRun, 'S1: exactly 5 accepted, the rest refused (no overshoot under 24 simultaneous requests)', JSON.stringify(o));
  });
  const s1 = (await rows(`SELECT count(*) FILTER (WHERE refused)::int AS refused, count(*) FILTER (WHERE NOT refused)::int AS accepted FROM public.share_attempts WHERE network_hash LIKE 'cc-net-s1-%'`))[0];
  check(s1.accepted === 5, 'S1: attempt rows agree (5 accepted, rest flagged refused)', JSON.stringify(s1));
  check((await rows(`SELECT count(*)::int AS n FROM public.card_shares s JOIN public.public_cards c ON c.id = s.card_id WHERE c.slug LIKE '${SLUG_PREFIX}%'`))[0].n === 5, 'S1: only the 5 accepted shares were stored');
  await restoreLimits(originals);

  // S2 per-network limit that spans cards (was racy before the network lock)
  await scenario('S2 network limit across cards', async () => { await setShare('network_all', 4, 3600); return {}; }, 16, i => visitorShare(i, 'cc-net-s2-same'), (o, _i, notRun) => {
    check(o.shared === 4 && (o.rate_limited || 0) === 16 - 4 - notRun, 'S2: exactly 4 accepted from one network across 6 cards', JSON.stringify(o));
  });
  await restoreLimits(originals);

  // S3 per-member limit across cards
  await scenario('S3 member limit', async () => { await setShare('member_all', 3, 3600); return {}; }, 12, i => memberShare(i, 'cc-net-s3-' + i), (o, _i, notRun) => {
    check(o.shared === 3 && (o.rate_limited || 0) === 12 - 3 - notRun, 'S3: exactly 3 accepted for one member across 6 cards', JSON.stringify(o));
  });
  await restoreLimits(originals);

  // S4 global report hourly limit
  await scenario('S4 global report limit', async () => {
    const base = (await rows(`SELECT count(*)::int AS n FROM vale_private.report_attempts WHERE NOT refused AND created_at > now() - interval '1 hour'`))[0].n;
    await setReport('global_all_per_hour', base + 4); await setReport('global_all_per_day', 100000); return { base };
  }, 16, i => report(i, hex64()), (o, _i, notRun) => {
    check(o.stored === 4 && (o.limited || 0) === 16 - 4 - notRun, 'S4: exactly 4 reports accepted, the rest limited', JSON.stringify(o));
  });
  await restoreLimits(originals);

  // S5 lock timeout fails closed: another session holds the lock; the request must come back as the usual refusal after about 3 s,
  // with no error and nothing stored.
  for (const [label, lock, make, refusal, table] of [
    ['share', 'share:global', i => visitorShare(i, 'cc-net-s5-share'), 'rate_limited', 'public.share_attempts'],
    ['report', 'report:global', i => report(i, 'ab'.repeat(32)), 'limited', 'vale_private.report_attempts']]) {
    await clearAttempts();
    const holder = call(`SELECT pg_advisory_xact_lock(hashtextextended('${lock}', 0)); SELECT pg_sleep(8) AS r;`);
    await new Promise(r => setTimeout(r, 1500));
    const t0 = Date.now(), r = await call(make(1)), ms = Date.now() - t0;
    check(r.status === 201 && result(r) === refusal, `S5 (${label}): a request that cannot get the lock is refused with the usual reply, not an error`, `${result(r)} after ${ms} ms`);
    check(ms >= 2500 && ms <= 7000, `S5 (${label}): it waited about the 3-second lock timeout, not forever`, ms + ' ms');
    await holder;
    const n = (await rows(`SELECT count(*)::int AS n FROM ${table} WHERE ${table === 'public.share_attempts' ? "network_hash = 'cc-net-s5-share'" : "network_hash = '" + 'ab'.repeat(32) + "'"}`))[0].n;
    check(n === 0, `S5 (${label}): nothing was stored by the refused request`, 'rows: ' + n);
    check((await callPatient(make(2))).status === 201, `S5 (${label}): after the lock is released a request works again`);
  }

  // S6 mixed load, original limits: no deadlock, no error text, every reply is a known outcome
  await clearAttempts();
  const { res: mixed, ms: mixedMs } = await fire(30, i => i % 3 === 0 ? memberShare(i, 'cc-net-s6-' + (i % 4)) : i % 3 === 1 ? visitorShare(i, 'cc-net-s6-' + (i % 5)) : report(i, hex64()));
  const known = new Set(['shared', 'rate_limited', 'stored', 'limited', 'merged', 'invalid', 'unavailable']);
  const outs = mixed.map(result);
  check(mixed.every(r => r.status === 201) && outs.every(x => known.has(x)), 'S6: 30 mixed simultaneous calls: no deadlock or database error, every reply a known outcome', JSON.stringify(tally(outs)) + ' in ' + mixedMs + ' ms');
} catch (e) {
  console.log('Run failed: ' + e.message); problems++;
} finally {
  const before = problems;
  try { await restoreAndVerify(originals, 'cleanup', fixtures); } catch (e) { console.log('FAIL  cleanup stopped: ' + e.message + ' (saved originals kept; run with --restore)'); problems++; }
  // Keep the saved originals if cleanup could not be verified, so '--restore' can finish the job.
  if (problems === before) { try { fs.unlinkSync(STATE); } catch {} }
}
console.log(problems ? `\n${problems} PROBLEM(S)` : '\nCONCURRENCY TESTS PASSED; development limits and data restored');
process.exit(problems ? 1 : 0);
