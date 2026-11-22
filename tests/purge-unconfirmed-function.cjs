// The purge-unconfirmed Edge Function, run against an in-memory database built from this repository (PGlite). The Admin API
// (account deletion) and the database calls are stand-ins; no network. Covers: secret check, dry run by default, deleting only when
// both switches are on, protected accounts never deleted, failures, invalid requests and that nothing identifying is returned or logged.
const path = require('node:path'), assert = require('node:assert/strict'), { pathToFileURL } = require('node:url');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const load = rel => import(pathToFileURL(path.join(root, rel)).href);
const HANDLER = 'supabase/functions/purge-unconfirmed/handler.mjs';
const URL_BASE = 'https://jlprxnmdvoloahssjlnu.supabase.co', KEY = 'sb_secret_SYNTHETICKEY_0123', TOKEN = 'purge-token-SYNTHETIC-0123456789abcdef0123';
const ENV = { SUPABASE_URL: URL_BASE, SUPABASE_SECRET_KEYS: JSON.stringify({ default: KEY }), PURGE_TOKEN: TOKEN };
const ID = n => `0b000000-0000-4000-8000-00000000000${n}`;

async function suite(fn, rebuild) {
  let checks = 0;
  const ok = (v, label) => { assert.ok(v, label); checks++; };
  const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
  const db = await rebuild(root);
  try {
    await db.exec(`
      INSERT INTO auth.users(id, email, created_at, email_confirmed_at, confirmed_at) VALUES
       ('${ID(1)}', 'old1@example.invalid', now() - interval '12 days', NULL, NULL),
       ('${ID(2)}', 'old2@example.invalid', now() - interval '40 days', NULL, NULL),
       ('${ID(3)}', 'young@example.invalid', now() - interval '3 days', NULL, NULL),
       ('${ID(4)}', 'confirmed@example.invalid', now() - interval '40 days', now() - interval '39 days', now() - interval '39 days');
      INSERT INTO vale_private.platform_admins(user_id, note) VALUES ('${ID(4)}', 'admin');`);
    const calls = [], logs = []; let failDelete = false, dbFails = false, badShape = false;
    const respond = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const fetchFake = async (url, init = {}) => {
      const headers = new Headers(init.headers || {});
      calls.push(init.method + ' ' + url.replace(URL_BASE, ''));
      ok(headers.get('apikey') === KEY && headers.get('authorization') === null, 'server key in apikey only');
      if (dbFails && url.includes('/rest/v1/rpc/')) return respond(500, { message: 'internal detail' });
      if (url.startsWith(URL_BASE + '/rest/v1/rpc/')) {
        const name = url.slice((URL_BASE + '/rest/v1/rpc/').length), p = JSON.parse(init.body);
        await db.exec('SET ROLE service_role');
        try {
          if (name === 'unconfirmed_purge_candidates' && badShape) return respond(200, [{ user_id: '../../admin' }]);
          if (name === 'unconfirmed_purge_candidates') return respond(200, (await db.query('SELECT user_id FROM public.unconfirmed_purge_candidates($1, $2)', [p.p_days, p.p_limit])).rows);
          if (name === 'record_purge_run') { await db.query('SELECT public.record_purge_run($1, $2, $3, $4)', [p.p_kind, p.p_days, p.p_candidates, p.p_deleted]); return respond(200, null); }
          throw new Error('unknown rpc ' + name);
        } catch (e) { return respond(400, { message: e.message }); } finally { await db.exec('RESET ROLE'); }
      }
      const m = url.match(/\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/);
      if (m && init.method === 'DELETE') {
        assert.deepEqual(JSON.parse(init.body), { should_soft_delete: false }, 'a hard delete through the Admin API');
        if (failDelete) return respond(500, { message: 'x' });
        await db.exec(`DELETE FROM auth.users WHERE id = '${m[1]}'`);
        return respond(200, {});
      }
      throw new Error('Unexpected outside call: ' + url);
    };
    const run = (env, { method = 'POST', token = TOKEN, body } = {}) => fn.createPurgeHandler({ env: n => env[n], fetch: fetchFake, log: e => logs.push(e) })(new Request('https://x.example/purge', { method, headers: token === null ? {} : { 'x-purge-token': token }, body: body === undefined ? undefined : JSON.stringify(body) }));
    const users = async () => (await db.query('SELECT id FROM auth.users ORDER BY id')).rows.map(r => r.id);
    const lastRun = async () => (await db.query('SELECT kind, days, candidates, deleted FROM vale_private.auth_maintenance_log ORDER BY id DESC LIMIT 1')).rows[0];

    // Secret and method.
    let r = await run(ENV, { token: null }); eq(r.status, 401, 'no secret: 401');
    r = await run(ENV, { token: 'wrong' }); eq(r.status, 401, 'wrong secret: 401');
    r = await run(ENV, { token: TOKEN + 'x' }); eq(r.status, 401, 'longer secret: 401');
    r = await run(ENV, { method: 'GET' }); eq(r.status, 405, 'GET refused');
    eq(calls.length, 0, 'nothing reached the database before the secret was accepted');
    r = await run({ ...ENV, PURGE_TOKEN: 'short' }); eq(r.status, 503, 'a weak or missing secret setting disables the function');
    r = await run({ SUPABASE_URL: URL_BASE }); eq(r.status, 503, 'missing server key disables the function');

    // Dry run by default, also when apply is asked but not enabled in the environment.
    r = await run(ENV); let j = await r.json();
    eq([r.status, j.result, j.candidates], [200, 'dry_run', 2], 'default call is a dry run listing the 2 old unconfirmed accounts');
    r = await run(ENV, { body: { apply: true } }); j = await r.json();
    eq([j.result, j.candidates, j.apply_requested, j.apply_enabled], ['dry_run', 2, true, false], 'apply asked but PURGE_APPLY is not on: still a dry run');
    r = await run({ ...ENV, PURGE_APPLY: 'true' }); j = await r.json();
    eq(j.result, 'dry_run', 'PURGE_APPLY on but the request does not ask: still a dry run');
    eq((await users()).length, 4, 'nothing deleted by dry runs');
    eq(await lastRun(), { kind: 'purge_dry_run', days: 7, candidates: 2, deleted: 0 }, 'dry run recorded (counts only)');
    ok(!calls.some(c => c.startsWith('DELETE')), 'no deletion call in dry runs');

    // Invalid requests.
    for (const body of [{ days: 2 }, { days: 6 }, { days: 400 }, { days: '7' }, { limit: 0 }, { limit: 201 }, { limit: 1.5 }, [1], 'x'])
      eq((await run({ ...ENV, PURGE_APPLY: 'true' }, { body })).status, 400, 'invalid request refused: ' + JSON.stringify(body));
    eq((await users()).length, 4, 'still nothing deleted');

    // Applying: both switches on. Only the listed accounts go; the young, confirmed and admin accounts stay.
    const live = { ...ENV, PURGE_APPLY: 'true' };
    failDelete = true; r = await run(live, { body: { apply: true } }); j = await r.json();
    eq([j.result, j.deleted, j.failed], ['applied_with_failures', 0, 2], 'failed deletions are counted, not hidden');
    eq((await users()).length, 4, 'a failed deletion removes nothing');
    failDelete = false; r = await run(live, { body: { apply: true, limit: 1 } }); j = await r.json();
    eq([j.result, j.candidates, j.deleted], ['applied', 1, 1], 'the batch limit is respected');
    eq((await users()).includes(ID(2)), false, 'the oldest account went first');
    r = await run(live, { body: { apply: true } }); j = await r.json();
    eq([j.result, j.candidates, j.deleted], ['applied', 1, 1], 'the next run deletes the remaining one');
    eq(await users(), [ID(3), ID(4)], 'the young, confirmed and admin accounts were never touched');
    eq(await lastRun(), { kind: 'purge_applied', days: 7, candidates: 1, deleted: 1 }, 'applied run recorded');
    r = await run(live, { body: { apply: true } }); j = await r.json();
    eq([j.result, j.candidates, j.deleted], ['applied', 0, 0], 'nothing left to delete');
    ok(calls.filter(c => c.startsWith('DELETE')).every(c => /\/auth\/v1\/admin\/users\//.test(c)), 'deletion only through the Admin API');

    // Database trouble: refuses, reveals nothing, deletes nothing.
    dbFails = true; r = await run(live, { body: { apply: true } }); j = await r.json();
    eq([r.status, j.result], [502, 'database_error'], 'database trouble gives a plain error'); ok(!JSON.stringify(j).includes('internal detail'), 'no database detail in the reply');
    dbFails = false;

    badShape = true; const before = calls.filter(c => c.startsWith('DELETE')).length; r = await run(live, { body: { apply: true } });
    eq(r.status, 502, 'an unexpected list from the database is refused'); eq(calls.filter(c => c.startsWith('DELETE')).length, before, 'and nothing is deleted'); badShape = false;

    // Nothing identifying anywhere.
    const everything = JSON.stringify(logs) + JSON.stringify(j);
    ok(!/example\.invalid|0b000000|sb_secret|purge-token/.test(everything), 'no address, id or secret in any log or reply');
    return checks;
  } finally { await db.close(); }
}

const SABOTAGE = [
  ['secret not checked', "if (!same(request.headers.get('x-purge-token') || '', config.token)) return finish(401, 'unauthorized');", ''],
  ['deleting without the environment switch', "const apply = body.apply === true && config.applyEnabled;", "const apply = body.apply === true;"],
  ['deleting without the request asking', "const apply = body.apply === true && config.applyEnabled;", "const apply = config.applyEnabled;"],
  ['fewer than 7 days accepted', 'days < MIN_DAYS ||', 'days < 1 ||'],
  ['soft delete used', 'should_soft_delete: false', 'should_soft_delete: true'],
  ['an unexpected list shape is acted on', "if (ids.length !== listed.data.length) return finish(502, 'database_error');", ''],
  ['ids written to the log', "return finish(200, failed ? 'applied_with_failures' : 'applied', { candidates: ids.length, deleted, failed });", "return finish(200, failed ? 'applied_with_failures' : 'applied', { candidates: ids.length, deleted, failed, ids });"],
];

(async () => {
  const { rebuild } = await load('scripts/db-rebuild.mjs');
  const source = require('node:fs').readFileSync(path.join(root, HANDLER), 'utf8').replace(/\r\n/g, '\n');
  const checks = await suite(await load(HANDLER), rebuild);
  console.log(`purge-unconfirmed function: ${checks} checks passed`);
  for (const [label, find, replace] of SABOTAGE) {
    if (!source.includes(find)) throw new Error('Sabotage target not found: ' + label);
    const mod = await import('data:text/javascript,' + encodeURIComponent(source.replace(find, () => replace)));
    let caught = false;
    try { await suite(mod, rebuild); } catch { caught = true; }
    assert.ok(caught, 'the checks did not notice: ' + label);
    console.log('detects broken protection: ' + label);
  }
})().catch(error => { console.error(error); process.exit(1); });
