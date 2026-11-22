// Cleanup of never-confirmed sign-ups (R11). Server-to-server only: there is no browser use, no CORS, no visitor input.
//
// 1. Every call needs the shared secret in the x-purge-token header (PURGE_TOKEN, compared in constant time). Without it, 401.
// 2. The list of accounts comes from public.unconfirmed_purge_candidates (database), which already excludes confirmed, signed-in,
//    invited, administrator, second-factor and data-owning accounts. This function never decides who is deleted: it can only act on
//    that list, and re-reads it on every run.
// 3. DRY RUN BY DEFAULT: it counts and records the count. Accounts are deleted only when BOTH the environment setting
//    PURGE_APPLY = 'true' AND the request says {"apply": true}. Deleting uses Supabase's supported Admin API (DELETE
//    /auth/v1/admin/users/<id>), never SQL on the auth tables.
// 4. Nothing identifying is returned or logged: counts and outcome words only (no ids, no addresses).
// 5. Stops after 5 failed deletions in a row. Each run is recorded with record_purge_run (counts only).
//
// Plain JavaScript with no dependencies (Supabase Deno and Node tests). Everything from outside is passed in.

/** @typedef {(name: string) => (string | undefined)} Env */
/** @typedef {(input: string, init?: RequestInit) => Promise<Response>} Fetch */
/** @typedef {(entry: Record<string, unknown>) => void} Log */

export const MAX_BODY_BYTES = 1024;
export const MIN_DAYS = 7;          // this function never uses fewer days than the approved policy (the database allows 3 and up)
export const MAX_LIMIT = 200;
const MAX_CONSECUTIVE_FAILURES = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @param {string | undefined} raw */
function defaultKey(raw) {
  try { const keys = JSON.parse(raw || 'null'); return keys && typeof keys.default === 'string' ? keys.default.trim() : ''; } catch { return ''; }
}
/** @param {Env} env */
export function readConfig(env) {
  const get = (/** @type {string} */ name) => { const v = env(name); return typeof v === 'string' ? v.trim() : ''; };
  const serverKey = defaultKey(get('SUPABASE_SECRET_KEYS')) || get('SUPABASE_SERVICE_ROLE_KEY');
  const url = get('SUPABASE_URL').replace(/\/+$/, '');
  const token = get('PURGE_TOKEN');
  const checks = { server_key: serverKey !== '', supabase_url: /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url), purge_token: token.length >= 32 };
  return { ok: Object.values(checks).every(Boolean), checks, serverKey, url, token, applyEnabled: get('PURGE_APPLY') === 'true' };
}
/** Constant-time comparison of two strings (no early exit on the first difference). */
function same(a, b) {
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/**
 * @param {{ env: Env, fetch: Fetch, log: Log }} deps
 * @returns {(request: Request) => Promise<Response>}
 */
export function createPurgeHandler({ env, fetch: fetchImpl, log }) {
  const reply = (/** @type {number} */ status, /** @type {Record<string, unknown>} */ body) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  const finish = (/** @type {number} */ status, /** @type {string} */ result, /** @type {Record<string, unknown>} */ extra = {}) => {
    log({ event: 'purge', result, ...extra });
    return reply(status, { result, ...extra });
  };

  return async function handle(request) {
    const config = readConfig(env);
    if (request.method !== 'POST') return finish(405, 'method_not_allowed');
    if (!config.ok) { log({ event: 'purge', result: 'misconfigured', checks: config.checks }); return reply(503, { result: 'unavailable' }); }
    if (!same(request.headers.get('x-purge-token') || '', config.token)) return finish(401, 'unauthorized');

    let body = {};
    try {
      const text = await request.text();
      if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return finish(413, 'too_large');
      body = text.trim() ? JSON.parse(text) : {};
      if (!body || typeof body !== 'object' || Array.isArray(body)) return finish(400, 'invalid');
    } catch { return finish(400, 'invalid'); }
    const days = body.days === undefined ? MIN_DAYS : body.days, limit = body.limit === undefined ? MAX_LIMIT : body.limit;
    if (!Number.isInteger(days) || days < MIN_DAYS || days > 365 || !Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) return finish(400, 'invalid');
    const apply = body.apply === true && config.applyEnabled;

    const headers = { 'Content-Type': 'application/json', apikey: config.serverKey };
    // New secret keys aren't JWTs: Supabase accepts them in the apikey header only. A legacy service_role JWT also goes in Authorization.
    if (!config.serverKey.startsWith('sb_')) /** @type {Record<string, string>} */ (headers).Authorization = 'Bearer ' + config.serverKey;
    const timeout = () => AbortSignal.timeout(8000);
    const rpc = async (/** @type {string} */ name, /** @type {unknown} */ params) => {
      try {
        const res = await fetchImpl(config.url + '/rest/v1/rpc/' + name, { method: 'POST', signal: timeout(), headers, body: JSON.stringify(params) });
        if (!res.ok) { log({ event: 'database', call: name, status: res.status }); return { ok: false }; }
        return { ok: true, data: await res.json() };
      } catch { log({ event: 'database', call: name, status: 'network' }); return { ok: false }; }
    };

    const listed = await rpc('unconfirmed_purge_candidates', { p_days: days, p_limit: limit });
    if (!listed.ok || !Array.isArray(listed.data)) return finish(502, 'database_error');
    const ids = listed.data.map((/** @type {{ user_id?: unknown }} */ r) => r && r.user_id).filter((/** @type {unknown} */ id) => typeof id === 'string' && UUID.test(id));
    if (ids.length !== listed.data.length) return finish(502, 'database_error');   // never act on an unexpected shape

    if (!apply) {
      await rpc('record_purge_run', { p_kind: 'purge_dry_run', p_days: days, p_candidates: ids.length, p_deleted: 0 });
      return finish(200, 'dry_run', { candidates: ids.length, apply_requested: body.apply === true, apply_enabled: config.applyEnabled });
    }

    let deleted = 0, failed = 0, streak = 0;
    for (const id of ids) {
      let ok = false;
      try {
        const res = await fetchImpl(config.url + '/auth/v1/admin/users/' + id, { method: 'DELETE', signal: timeout(), headers, body: JSON.stringify({ should_soft_delete: false }) });
        ok = res.ok;
      } catch { ok = false; }
      if (ok) { deleted++; streak = 0; } else { failed++; if (++streak >= MAX_CONSECUTIVE_FAILURES) break; }
    }
    await rpc('record_purge_run', { p_kind: 'purge_applied', p_days: days, p_candidates: ids.length, p_deleted: deleted });
    return finish(200, failed ? 'applied_with_failures' : 'applied', { candidates: ids.length, deleted, failed });
  };
}
