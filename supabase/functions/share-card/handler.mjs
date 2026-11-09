// "Share your info back": the server side of the form on a public card page.
//
// Every security decision is made on the server. Origin checks are supplementary; the protections that matter are:
// 1. Cloudflare Turnstile, verified here with the secret key (the browser can't skip it).
// 2. For members, their sign-in token, checked with Supabase Auth. Their card details are then read from their own
//    saved card inside the database, never taken from the request.
// 3. Strict request validation here, then the same rules again inside public.record_share, which also enforces
//    consent, rate limits, duplicates and the owner's connection limit. Only this function's server key can call it.
// The visitor's network address is never stored or logged: only a salted hash of it reaches the database.
//
// Plain JavaScript with no dependencies, so the same code runs on Supabase (Deno) and in the Node tests. Everything
// from outside (settings, fetch, logging) is passed in.

export const ALLOWED_ORIGINS = Object.freeze(['https://dev.valebrandworks.com']);
export const TURNSTILE_HOSTNAMES = Object.freeze(['dev.valebrandworks.com']);
export const TURNSTILE_ACTION = 'share-card';
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const MAX_BODY_BYTES = 12000;
export const MIN_SALT_LENGTH = 32;

const VISITOR_FIELDS = Object.freeze({ full_name: 90, job_title: 80, business_name: 90, email: 120, phone: 40, website: 300 });
const MEMBER_FIELDS = Object.freeze(['full_name', 'job_title', 'business_name', 'email', 'phone', 'website', 'social_links']);
const TOP_LEVEL = Object.freeze({
  visitor: ['mode', 'card', 'submission_id', 'consent', 'consent_version', 'turnstile_token', 'note', 'fields'],
  member: ['mode', 'card', 'submission_id', 'consent', 'consent_version', 'turnstile_token', 'note', 'card_id', 'member_fields'],
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const JWT = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const ADDRESS = /^[0-9A-Fa-f:.]{2,45}$/;

// What each answer means. The browser only ever learns one of these words, never why a share was a duplicate etc.
const HTTP = Object.freeze({
  ok: 200, shared: 200, invalid: 400, sign_in_required: 401, verification_failed: 403, forbidden_origin: 403,
  unavailable: 404, method_not_allowed: 405, too_large: 413, rate_limited: 429, error: 502, not_configured: 503,
});

// Reads the settings. Anything missing or unusable makes the function refuse every share.
export function readConfig(env) {
  const get = name => { const v = env(name); return typeof v === 'string' ? v.trim() : ''; };
  let serverKey = '';
  try { const keys = JSON.parse(get('SUPABASE_SECRET_KEYS') || 'null'); if (keys && typeof keys.default === 'string') serverKey = keys.default.trim(); } catch { /* unusable, treated as missing */ }
  if (!serverKey) serverKey = get('SUPABASE_SERVICE_ROLE_KEY');
  const url = get('SUPABASE_URL').replace(/\/+$/, '');
  const checks = {
    turnstile_secret: get('TURNSTILE_SECRET_KEY') !== '',
    hash_salt: get('SHARE_HASH_SALT').length >= MIN_SALT_LENGTH,
    server_key: serverKey !== '',
    supabase_url: /^https:\/\/[a-z0-9.-]+$/i.test(url),
  };
  return { ok: Object.values(checks).every(Boolean), checks, turnstileSecret: get('TURNSTILE_SECRET_KEY'), salt: get('SHARE_HASH_SALT'), serverKey, url };
}

// Where the visitor's network address comes from. Cloudflare sets cf-connecting-ip itself; otherwise the first
// x-forwarded-for entry. Which one the platform provides is reported (without the address) by a GET request.
export function networkAddress(headers) {
  const cf = (headers.get('cf-connecting-ip') || '').trim();
  if (ADDRESS.test(cf)) return { source: 'cf-connecting-ip', address: cf };
  const first = (headers.get('x-forwarded-for') || '').split(',')[0].trim();
  if (ADDRESS.test(first)) return { source: 'x-forwarded-for', address: first };
  return { source: 'none', address: null };
}

export async function hashAddress(salt, address) {
  if (!address) return null;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode('network:' + address.toLowerCase())));
  return Array.from(mac, b => b.toString(16).padStart(2, '0')).join('');
}

// Checks the request shape. Returns the cleaned request, or null. The database checks everything again.
export function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const mode = body.mode;
  if (mode !== 'visitor' && mode !== 'member') return null;
  if (Object.keys(body).some(key => !TOP_LEVEL[mode].includes(key))) return null;
  const { card, submission_id: submissionId, consent, consent_version: version, turnstile_token: token } = body;
  const note = body.note === undefined ? '' : body.note;
  if (typeof card !== 'string' || card.length < 3 || card.length > 60 || !SLUG.test(card)) return null;
  if (typeof submissionId !== 'string' || !UUID.test(submissionId)) return null;
  if (consent !== true) return null;
  if (typeof version !== 'string' || !/^[A-Za-z0-9._-]{1,40}$/.test(version)) return null;
  if (typeof token !== 'string' || token.length < 1 || token.length > 2048) return null;
  if (typeof note !== 'string' || note.length > 300) return null;
  const clean = { mode, card, submissionId: submissionId.toLowerCase(), version, token, note };
  if (mode === 'visitor') {
    const fields = body.fields;
    if (!fields || typeof fields !== 'object' || Array.isArray(fields)) return null;
    const out = {};
    for (const [key, value] of Object.entries(fields)) {
      if (!Object.hasOwn(VISITOR_FIELDS, key) || typeof value !== 'string' || value.length > VISITOR_FIELDS[key]) return null;
      if (value.trim() !== '') out[key] = value;
    }
    if (!out.full_name || !(out.email || out.phone)) return null;
    clean.fields = out;
  } else {
    const list = body.member_fields;
    if (typeof body.card_id !== 'string' || !UUID.test(body.card_id)) return null;
    if (!Array.isArray(list) || list.length < 1 || list.length > MEMBER_FIELDS.length) return null;
    if (!list.every(f => typeof f === 'string' && MEMBER_FIELDS.includes(f)) || new Set(list).size !== list.length || !list.includes('full_name')) return null;
    clean.cardId = body.card_id.toLowerCase();
    clean.memberFields = list;
  }
  return clean;
}

export function createShareHandler({ env, fetch: fetchImpl, log = () => {}, timeoutMs = 8000 }) {
  const signal = () => AbortSignal.timeout(timeoutMs);

  const reply = (result, origin, extra = {}) => {
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'authorization, apikey, content-type, x-client-info';
      headers['Access-Control-Max-Age'] = '600';
    }
    return new Response(JSON.stringify({ status: result, ...extra }), { status: HTTP[result] ?? 500, headers });
  };
  const finish = (result, origin, mode) => { log({ event: 'share', result, mode: mode || 'unknown' }); return reply(result, origin); };

  async function verifyTurnstile(config, token, submissionId) {
    let res;
    try {
      res = await fetchImpl(SITEVERIFY_URL, {
        method: 'POST', signal: signal(),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ secret: config.turnstileSecret, response: token, idempotency_key: submissionId }).toString(),
      });
    } catch { return 'error'; }
    if (!res.ok) return 'error';
    let data; try { data = await res.json(); } catch { return 'error'; }
    const codes = Array.isArray(data?.['error-codes']) ? data['error-codes'] : [];
    if (codes.includes('missing-input-secret') || codes.includes('invalid-input-secret')) { log({ event: 'config', problem: 'turnstile secret rejected' }); return 'not_configured'; }
    if (data?.success !== true) return 'verification_failed';
    if (!TURNSTILE_HOSTNAMES.includes(data.hostname) || data.action !== TURNSTILE_ACTION) return 'verification_failed';
    return 'ok';
  }

  async function memberId(config, jwt) {
    let res;
    try {
      res = await fetchImpl(config.url + '/auth/v1/user', { method: 'GET', signal: signal(), headers: { apikey: config.serverKey, Authorization: 'Bearer ' + jwt } });
    } catch { return { result: 'error' }; }
    if (res.status === 401 || res.status === 403) return { result: 'sign_in_required' };
    if (!res.ok) return { result: 'error' };
    let user; try { user = await res.json(); } catch { return { result: 'error' }; }
    if (typeof user?.id !== 'string' || !UUID.test(user.id)) return { result: 'sign_in_required' };
    return { result: 'ok', id: user.id.toLowerCase() };
  }

  async function recordShare(config, params) {
    const headers = { 'Content-Type': 'application/json', apikey: config.serverKey };
    // New secret keys go in the apikey header only; the legacy service_role key is a JWT and also goes in Authorization.
    if (!config.serverKey.startsWith('sb_')) headers.Authorization = 'Bearer ' + config.serverKey;
    let res;
    try { res = await fetchImpl(config.url + '/rest/v1/rpc/record_share', { method: 'POST', signal: signal(), headers, body: JSON.stringify(params) }); }
    catch { return 'error'; }
    if (!res.ok) { log({ event: 'database', status: res.status }); return 'error'; }
    let answer; try { answer = await res.json(); } catch { return 'error'; }
    return ['shared', 'invalid', 'rate_limited', 'unavailable'].includes(answer) ? answer : 'error';
  }

  return async function handle(req) {
    const origin = req.headers.get('origin') || '';
    const config = readConfig(env);

    // A settings check for after deploying: says only which settings are present and where the network address
    // came from, never their values or the address.
    if (req.method === 'GET') {
      const { source } = networkAddress(req.headers);
      return reply(config.ok ? 'ok' : 'not_configured', '', { checks: config.checks, network_source: source });
    }
    if (req.method === 'OPTIONS') {
      if (!ALLOWED_ORIGINS.includes(origin)) return reply('forbidden_origin', '');
      return new Response(null, { status: 204, headers: reply('ok', origin).headers });
    }
    if (req.method !== 'POST') return reply('method_not_allowed', origin);
    if (!ALLOWED_ORIGINS.includes(origin)) return finish('forbidden_origin', '', '');
    if (!config.ok) { log({ event: 'config', missing: Object.keys(config.checks).filter(k => !config.checks[k]) }); return finish('not_configured', origin, ''); }

    if (!/^application\/json\b/i.test(req.headers.get('content-type') || '')) return finish('invalid', origin, '');
    const declared = Number(req.headers.get('content-length') || '0');
    if (declared > MAX_BODY_BYTES) return finish('too_large', origin, '');
    let text;
    try { text = await req.text(); } catch { return finish('invalid', origin, ''); }
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return finish('too_large', origin, '');
    let body; try { body = JSON.parse(text); } catch { return finish('invalid', origin, ''); }
    const request = validateRequest(body);
    if (!request) return finish('invalid', origin, ['visitor', 'member'].includes(body?.mode) ? body.mode : 'other');

    // Members must send their own sign-in token. A visitor's request carries none that counts.
    let jwt = '';
    if (request.mode === 'member') {
      const auth = req.headers.get('authorization') || '';
      jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
      if (!JWT.test(jwt)) return finish('sign_in_required', origin, request.mode);
    }

    const human = await verifyTurnstile(config, request.token, request.submissionId);
    if (human !== 'ok') return finish(human, origin, request.mode);

    let sharerId = null;
    if (request.mode === 'member') {
      const member = await memberId(config, jwt);
      if (member.result !== 'ok') return finish(member.result, origin, request.mode);
      sharerId = member.id;
    }

    const networkHash = await hashAddress(config.salt, networkAddress(req.headers).address);
    const result = await recordShare(config, {
      p_card_slug: request.card,
      p_submission_id: request.submissionId,
      p_consented: true,
      p_consent_version: request.version,
      p_fields: request.mode === 'visitor' ? request.fields : null,
      p_member_fields: request.mode === 'member' ? request.memberFields : null,
      p_sharer_user_id: sharerId,
      p_sharer_card_id: request.mode === 'member' ? request.cardId : null,
      p_network_hash: networkHash,
      p_note: request.note,
    });
    return finish(result, origin, request.mode);
  };
}
