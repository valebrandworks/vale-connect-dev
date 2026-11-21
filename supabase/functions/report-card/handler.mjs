// "Report this card": the server side of the report form (report.html).
//
// Every security decision is made on the server. Origin checks are supplementary; the protections that matter are:
// 1. Cloudflare Turnstile, verified here with the secret key and the action 'report-card' (the browser can't skip it).
// 2. Strict request validation here, then the same rules again inside public.submit_card_report, which also enforces
//    rate limits, merging of repeats, blocked networks and "public cards only". Only this function's server key can
//    call it.
// 3. The visitor's network address is never stored, logged or sent anywhere: only a salted hash of it (made for
//    reports only, so it can't be matched with sharing records) reaches the database.
// 4. The visitor always gets the same answer for an accepted report, whether it was stored, merged with an earlier
//    one, rate-limited, from a blocked network or about a card that isn't public. Nothing about the card, the owner
//    or other reports is ever returned.
// 5. Email alerts: when the database says one is due (at most hourly, only for new reports), a plain "a report is
//    waiting" email goes to the owner of VALE Connect through Resend. It contains no report details. A failed or
//    unconfigured alert never affects the report.
//
// Network address trust is the same as the share-card function: only Cloudflare's CF-Connecting-IP, only once
// SHARE_TRUSTED_ADDRESS_HEADER = 'cf-connecting-ip' is set; client-written headers are ignored. The address
// functions below are a copy of share-card's; a test checks both give identical results.
//
// Plain JavaScript with no dependencies, so the same code runs on Supabase (Deno) and in the Node tests. Everything
// from outside (settings, fetch, logging) is passed in.

/** @typedef {(name: string) => (string | undefined)} Env */
/** @typedef {(input: string, init?: RequestInit) => Promise<Response>} Fetch */
/** @typedef {(entry: Record<string, unknown>) => void} Log */
/** @typedef {ReturnType<typeof readConfig>} Config */
/**
 * @typedef {object} ReportRequest
 * @property {string} card
 * @property {string} submissionId
 * @property {string} category
 * @property {string} details
 * @property {string} email
 * @property {string} token
 */

export const ALLOWED_ORIGINS = Object.freeze(['https://dev.valebrandworks.com']);
export const TURNSTILE_HOSTNAMES = Object.freeze(['dev.valebrandworks.com']);
export const TURNSTILE_ACTION = 'report-card';
export const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const RESEND_URL = 'https://api.resend.com/emails';
export const ALERT_FROM = 'VALE Connect <no-reply@valebrandworks.com>';
export const ALERT_SUBJECT = 'VALE Connect: a card report is waiting';
export const ALERT_TEXT = 'A new report about a public card is waiting for review.\n\nSign in to the private review page to see it. '
  + 'For privacy, this email contains no details about the report, the card or the person who sent it.\n';
export const MAX_BODY_BYTES = 8000;
export const MIN_SALT_LENGTH = 32;
export const TRUSTED_ADDRESS_HEADER = 'cf-connecting-ip';
export const CATEGORIES = Object.freeze(['impersonation', 'scam', 'spam', 'harassment', 'sexual_violent', 'personal_info', 'ip', 'other']);
export const MAX_DETAILS = 1000;
export const MAX_EMAIL = 254;

const KEYS = Object.freeze(['card', 'submission_id', 'category', 'details', 'email', 'attested', 'turnstile_token']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// What the browser can learn. Every accepted report answers 'received'.
/** @type {Readonly<Record<string, number>>} */
const HTTP = Object.freeze({
  ok: 200, received: 200, invalid: 400, verification_failed: 403, forbidden_origin: 403, method_not_allowed: 405,
  too_large: 413, error: 502, not_configured: 503, address_unavailable: 503,
});
// Database answers that all mean "received" to the visitor.
const RECEIVED = Object.freeze(['stored', 'merged', 'limited', 'blocked', 'repeat_submission', 'unavailable']);

/** @param {string} raw @returns {string} */
function defaultKey(raw) {
  try { const keys = JSON.parse(raw || 'null'); return keys && typeof keys.default === 'string' ? keys.default.trim() : ''; } catch { return ''; }
}

// Reads the settings. Anything required that is missing makes the function refuse every report. Alerts are optional:
// without them reports still work and the admin checks the review page.
/** @param {Env} env */
export function readConfig(env) {
  /** @param {string} name */
  const get = name => { const v = env(name); return typeof v === 'string' ? v.trim() : ''; };
  const serverKey = defaultKey(get('SUPABASE_SECRET_KEYS')) || get('SUPABASE_SERVICE_ROLE_KEY');
  const url = get('SUPABASE_URL').replace(/\/+$/, '');
  /** @type {Record<string, boolean>} */
  const checks = {
    turnstile_secret: get('TURNSTILE_SECRET_KEY') !== '',
    hash_salt: get('SHARE_HASH_SALT').length >= MIN_SALT_LENGTH,
    server_key: serverKey !== '',
    supabase_url: /^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url),
    trusted_address_header: get('SHARE_TRUSTED_ADDRESS_HEADER').toLowerCase() === TRUSTED_ADDRESS_HEADER,
  };
  const alertKey = get('REPORT_ALERT_RESEND_KEY'), alertTo = get('REPORT_ALERT_TO');
  const alerts = alertKey.startsWith('re_') && EMAIL.test(alertTo) && alertTo.length <= MAX_EMAIL;
  return { ok: Object.values(checks).every(Boolean), checks, alerts, alertKey, alertTo, turnstileSecret: get('TURNSTILE_SECRET_KEY'), salt: get('SHARE_HASH_SALT'), serverKey, url };
}

// ---- Network address: identical rules to share-card (see tests/report-card-function.cjs) ----
/** @param {string} text @returns {number[] | null} */
function ipv4(text) {
  const parts = text.split('.');
  if (parts.length !== 4 || !parts.every(p => /^(0|[1-9][0-9]{0,2})$/.test(p) && Number(p) <= 255)) return null;
  return parts.map(Number);
}
/** @param {string} text @returns {number[] | null} */
function ipv6(text) {
  if (!/^[0-9a-f:.]+$/i.test(text) || text.length > 45 || !text.includes(':')) return null;
  /** @type {number[] | null} */
  let four = null;
  let head = text;
  if (text.includes('.')) {
    const lastColon = text.lastIndexOf(':');
    four = ipv4(text.slice(lastColon + 1));
    if (!four) return null;
    head = text.slice(0, lastColon + 1) + '0:0';
  }
  const halves = head.split('::');
  if (halves.length > 2) return null;
  /** @param {string} s @returns {string[]} */
  const group = s => (s === '' ? [] : s.split(':'));
  const left = group(halves[0]), right = halves.length === 2 ? group(halves[1]) : [];
  if (![...left, ...right].every(g => /^[0-9a-f]{1,4}$/i.test(g))) return null;
  const known = left.length + right.length;
  if (halves.length === 1 ? known !== 8 : known > 7) return null;
  const groups = [...left, ...Array(8 - known).fill('0'), ...right].map(g => parseInt(g, 16));
  if (four) { groups[6] = (four[0] << 8) | four[1]; groups[7] = (four[2] << 8) | four[3]; }
  return groups;
}
/** @param {string | null | undefined} text @returns {string | null} */
export function addressKey(text) {
  const value = (text || '').trim();
  if (!value || value.includes(',') || value.includes(' ')) return null;
  const four = ipv4(value);
  if (four) return 'ipv4:' + four.join('.');
  const six = ipv6(value);
  if (!six) return null;
  if (six.slice(0, 5).every(g => g === 0) && six[5] === 0xffff) return 'ipv4:' + [six[6] >> 8, six[6] & 255, six[7] >> 8, six[7] & 255].join('.');
  return 'ipv6:' + six.slice(0, 4).map(g => g.toString(16)).join(':') + '::/64';
}
/** @param {Headers} headers @returns {string | null} */
export function networkKey(headers) {
  return addressKey(headers.get(TRUSTED_ADDRESS_HEADER));
}
// A report-only hash: the 'report-network:' prefix makes it differ from the sharing hash of the same network.
/** @param {string} salt @param {string | null} key @returns {Promise<string | null>} */
export async function hashAddress(salt, key) {
  if (!key) return null;
  const enc = new TextEncoder();
  const hmac = await crypto.subtle.importKey('raw', enc.encode(salt), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', hmac, enc.encode('report-network:' + key)));
  return Array.from(mac, b => b.toString(16).padStart(2, '0')).join('');
}

// Checks the request shape. Returns the cleaned request, or null. The database checks everything again.
/** @param {any} body @returns {ReportRequest | null} */
export function validateRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  if (Object.keys(body).some(key => !KEYS.includes(key))) return null;
  const { card, submission_id: submissionId, category, attested, turnstile_token: token } = body;
  const details = body.details === undefined ? '' : body.details;
  const email = body.email === undefined ? '' : body.email;
  if (typeof card !== 'string' || card.length < 3 || card.length > 60 || !SLUG.test(card)) return null;
  if (typeof submissionId !== 'string' || !UUID.test(submissionId)) return null;
  if (typeof category !== 'string' || !CATEGORIES.includes(category)) return null;
  if (attested !== true) return null;
  if (typeof token !== 'string' || token.length < 1 || token.length > 2048) return null;
  if (typeof details !== 'string' || details.length > MAX_DETAILS) return null;
  if (typeof email !== 'string' || email.length > MAX_EMAIL || (email.trim() !== '' && !EMAIL.test(email.trim()))) return null;
  return { card, submissionId: submissionId.toLowerCase(), category, details, email: email.trim(), token };
}

/**
 * @param {{ env: Env, fetch: Fetch, log?: Log, timeoutMs?: number }} options
 * @returns {(req: Request) => Promise<Response>}
 */
export function createReportHandler({ env, fetch: fetchImpl, log = () => {}, timeoutMs = 8000 }) {
  const signal = () => AbortSignal.timeout(timeoutMs);

  /** @param {string} result @param {string} origin */
  const reply = (result, origin) => {
    /** @type {Record<string, string>} */
    const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Origin' };
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      headers['Access-Control-Allow-Origin'] = origin;
      headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
      headers['Access-Control-Allow-Headers'] = 'apikey, content-type, x-client-info';
      headers['Access-Control-Max-Age'] = '600';
    }
    return new Response(JSON.stringify({ status: result }), { status: HTTP[result] ?? 500, headers });
  };
  // Logs outcome words only: never the card, the text, an email, a token, an address or its hash.
  /** @param {string} result @param {string} origin @param {string} [stored] */
  const finish = (result, origin, stored) => { log({ event: 'report', result, ...(stored ? { stored } : {}) }); return reply(result, origin); };

  /** @param {Config} config @param {string} token @param {string} submissionId @returns {Promise<string>} */
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

  /** @param {Config} config @param {string} name @param {Record<string, unknown>} params @returns {Promise<{ ok: boolean, value?: unknown }>} */
  async function rpc(config, name, params) {
    /** @type {Record<string, string>} */
    const headers = { 'Content-Type': 'application/json', apikey: config.serverKey };
    // New secret keys aren't JWTs: Supabase accepts them in the apikey header only. A legacy service_role JWT also
    // goes in Authorization.
    if (!config.serverKey.startsWith('sb_')) headers.Authorization = 'Bearer ' + config.serverKey;
    let res;
    try { res = await fetchImpl(config.url + '/rest/v1/rpc/' + name, { method: 'POST', signal: signal(), headers, body: JSON.stringify(params) }); }
    catch { return { ok: false }; }
    if (!res.ok) { log({ event: 'database', call: name, status: res.status }); return { ok: false }; }
    try { return { ok: true, value: await res.json() }; } catch { return { ok: false }; }
  }

  // At most hourly, only when the database says a new report has arrived since the last alert.
  /** @param {Config} config @param {string} submissionId */
  async function alert(config, submissionId) {
    if (!config.alerts) { log({ event: 'alert', result: 'not_configured' }); return; }
    const due = await rpc(config, 'claim_report_alert', {});
    if (!due.ok) { log({ event: 'alert', result: 'check_failed' }); return; }
    if (due.value !== true) { log({ event: 'alert', result: 'not_due' }); return; }
    let res;
    try {
      res = await fetchImpl(RESEND_URL, {
        method: 'POST', signal: signal(),
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + config.alertKey, 'Idempotency-Key': 'report-alert-' + submissionId },
        body: JSON.stringify({ from: ALERT_FROM, to: [config.alertTo], subject: ALERT_SUBJECT, text: ALERT_TEXT }),
      });
    } catch { log({ event: 'alert', result: 'failed' }); return; }
    log({ event: 'alert', result: res.ok ? 'sent' : 'failed', ...(res.ok ? {} : { status: res.status }) });
  }

  /** @param {Request} req */
  return async function handle(req) {
    const origin = req.headers.get('origin') || '';
    const config = readConfig(env);

    if (req.method === 'OPTIONS') {
      if (!ALLOWED_ORIGINS.includes(origin)) return reply('forbidden_origin', '');
      return new Response(null, { status: 204, headers: reply('ok', origin).headers });
    }
    if (req.method !== 'POST') return reply('method_not_allowed', origin);
    if (!ALLOWED_ORIGINS.includes(origin)) return finish('forbidden_origin', '');
    if (!config.ok) { log({ event: 'config', missing: Object.keys(config.checks).filter(k => !config.checks[k]) }); return finish('not_configured', origin); }
    // No trustworthy network address, no report: the network limits and blocks must not be escapable.
    const network = networkKey(req.headers);
    if (!network) return finish('address_unavailable', origin);

    if (!/^application\/json\b/i.test(req.headers.get('content-type') || '')) return finish('invalid', origin);
    const declared = Number(req.headers.get('content-length') || '0');
    if (declared > MAX_BODY_BYTES) return finish('too_large', origin);
    let text;
    try { text = await req.text(); } catch { return finish('invalid', origin); }
    if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return finish('too_large', origin);
    let body; try { body = JSON.parse(text); } catch { return finish('invalid', origin); }
    const request = validateRequest(body);
    if (!request) return finish('invalid', origin);

    const human = await verifyTurnstile(config, request.token, request.submissionId);
    if (human !== 'ok') return finish(human, origin);

    const networkHash = await hashAddress(config.salt, network);
    const answer = await rpc(config, 'submit_card_report', {
      p_card_slug: request.card,
      p_submission_id: request.submissionId,
      p_category: request.category,
      p_details: request.details,
      p_reporter_email: request.email || null,
      p_attested: true,
      p_network_hash: networkHash,
    });
    if (!answer.ok) return finish('error', origin);
    const stored = typeof answer.value === 'string' ? answer.value : '';
    if (stored === 'invalid') return finish('invalid', origin);
    if (!RECEIVED.includes(stored)) return finish('error', origin);
    if (stored === 'stored' || stored === 'merged') await alert(config, request.submissionId);
    return finish('received', origin, stored);
  };
}
