// The report-card Edge Function, run against an in-memory database built from this repository (PGlite), with
// stand-ins for Cloudflare Turnstile and Resend. No network: every outside call goes to the fakes below.
// Covers accepted reports (always the same answer), invalid requests, abuse attempts, alerts and missing settings.
const path = require('node:path'), assert = require('node:assert/strict'), { pathToFileURL } = require('node:url');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const load = rel => import(pathToFileURL(path.join(root, rel)).href);

const ORIGIN = 'https://dev.valebrandworks.com', URL_BASE = 'https://jlprxnmdvoloahssjlnu.supabase.co';
const SECRETS = { turnstile: 'turnstile-secret-SYNTHETIC', salt: 'salt-SYNTHETIC-0123456789abcdef-0123456789', key: 'sb_secret_SYNTHETICKEY_0123', resend: 're_SYNTHETIC_alerts_0123' };
const ALERT_TO = 'owner-alerts@example.invalid';
const ENV = { TURNSTILE_SECRET_KEY: SECRETS.turnstile, SHARE_HASH_SALT: SECRETS.salt, SUPABASE_URL: URL_BASE, SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRETS.key }), SHARE_TRUSTED_ADDRESS_HEADER: 'cf-connecting-ip', REPORT_ALERT_RESEND_KEY: SECRETS.resend, REPORT_ALERT_TO: ALERT_TO };
const ID = { owner: '0a000000-0000-4000-8000-000000000001', other: '0a000000-0000-4000-8000-000000000003' };
const CARD = { owner: '0c000000-0000-4000-8000-000000000001', other: '0c000000-0000-4000-8000-000000000003', draft: '0c000000-0000-4000-8000-000000000005', blocked: '0c000000-0000-4000-8000-000000000006' };
const uuid = () => crypto.randomUUID();
const HANDLER = 'supabase/functions/report-card/handler.mjs';

async function suite(fn, rebuild, share) {
  let checks = 0;
  const ok = (value, label) => { assert.ok(value, label); checks++; };
  const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
  const db = await rebuild(root);
  try {
  await db.exec(`
    INSERT INTO auth.users(id, email) VALUES ('${ID.owner}', 'o@example.invalid'), ('${ID.other}', 'x@example.invalid');
    INSERT INTO public.public_cards(id, owner_id, slug, display_name, public_email, published) VALUES
     ('${CARD.owner}', '${ID.owner}', 'owner-card', 'Owner Synthetic', 'owner@example.invalid', true),
     ('${CARD.other}', '${ID.other}', 'other-card', 'Other Synthetic', '', true),
     ('${CARD.draft}', '${ID.other}', 'draft-card', 'Draft Synthetic', '', false),
     ('${CARD.blocked}', '${ID.other}', 'blocked-card', 'Blocked Synthetic', '', true);`);

  const calls = [], logs = [];
  let dbFails = false, resendMode = 'ok';
  const respond = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  async function fakeFetch(url, init = {}) {
    const headers = new Headers(init.headers || {});
    calls.push({ url, headers, body: init.body });
    if (url === fn.SITEVERIFY_URL) {
      const form = new URLSearchParams(init.body);
      if (form.get('secret') !== SECRETS.turnstile) return respond(200, { success: false, 'error-codes': ['invalid-input-secret'] });
      const token = form.get('response');
      if (token === 'down') throw new Error('network down');
      if (token === 'secret-rejected') return respond(200, { success: false, 'error-codes': ['invalid-input-secret'] });
      if (token === 'wrong-host') return respond(200, { success: true, hostname: 'evil.example', action: fn.TURNSTILE_ACTION });
      if (token === 'share-token') return respond(200, { success: true, hostname: 'dev.valebrandworks.com', action: 'share-card' });
      if (token === 'pass') return respond(200, { success: true, hostname: 'dev.valebrandworks.com', action: fn.TURNSTILE_ACTION });
      return respond(200, { success: false, 'error-codes': ['invalid-input-response'] });
    }
    if (url.startsWith(URL_BASE + '/rest/v1/rpc/')) {
      assert.equal(headers.get('apikey'), SECRETS.key, 'the database is called with the server key in apikey');
      assert.equal(headers.get('authorization'), null, 'a new secret key is never sent as a bearer token');
      if (dbFails) return respond(500, { message: 'internal detail that must not reach the browser' });
      const name = url.slice((URL_BASE + '/rest/v1/rpc/').length), p = JSON.parse(init.body);
      await db.exec('SET ROLE service_role');
      try {
        if (name === 'submit_card_report') {
          const r = await db.query('SELECT public.submit_card_report($1, $2, $3, $4, $5, $6, $7) AS r', [p.p_card_slug, p.p_submission_id, p.p_category, p.p_details, p.p_reporter_email, p.p_attested, p.p_network_hash]);
          return respond(200, r.rows[0].r);
        }
        if (name === 'claim_report_alert') return respond(200, (await db.query('SELECT public.claim_report_alert() AS r')).rows[0].r);
        throw new Error('unknown rpc ' + name);
      } catch (error) { return respond(400, { message: error.message }); }
      finally { await db.exec('RESET ROLE'); }
    }
    if (url === fn.RESEND_URL) {
      if (resendMode === 'down') throw new Error('resend down');
      if (resendMode === 'fail') return respond(500, { message: 'resend failed' });
      return respond(200, { id: 'email-synthetic' });
    }
    throw new Error('Unexpected outside call: ' + url);
  }

  const handlerFor = env => fn.createReportHandler({ env: name => env[name], fetch: fakeFetch, log: entry => logs.push(JSON.stringify(entry)) });
  const handle = handlerFor(ENV);
  const post = async (body, { origin = ORIGIN, ip = '203.0.113.7', xff, raw, type = 'application/json', h = handle, method = 'POST', extra = {} } = {}) => {
    const headers = { 'Content-Type': type };
    if (origin) headers.Origin = origin;
    if (ip) headers['cf-connecting-ip'] = ip;
    if (xff) headers['x-forwarded-for'] = xff;
    Object.assign(headers, extra);
    const before = calls.length;
    const res = await h(new Request(URL_BASE + '/functions/v1/report-card', { method, headers, body: method === 'POST' ? (raw ?? JSON.stringify(body)) : undefined }));
    const text = await res.text();
    let data = {}; try { data = JSON.parse(text); } catch {}
    return { status: res.status, answer: data.status, text, res, outside: calls.slice(before).map(c => c.url), sent: calls.slice(before) };
  };
  const report = (over = {}) => ({ card: 'owner-card', submission_id: uuid(), category: 'impersonation', details: 'Pretends to be me', email: '', attested: true, turnstile_token: 'pass', ...over });
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const count = async (where = 'true', params) => (await one(`SELECT count(*)::int AS n FROM vale_private.card_reports WHERE ${where}`, params)).n;
  const RECEIVED = '{"status":"received"}';

  // ---- An accepted report ----
  const first = report({ email: ' Reporter@Example.INVALID ' });
  let r = await post(first);
  eq([r.status, r.text], [200, RECEIVED], 'a visitor can report a public card');
  eq(r.outside, [fn.SITEVERIFY_URL, URL_BASE + '/rest/v1/rpc/submit_card_report', URL_BASE + '/rest/v1/rpc/claim_report_alert', fn.RESEND_URL], 'Turnstile first, then the database, then the alert');
  eq(r.res.headers.get('access-control-allow-origin'), ORIGIN, 'the allowed page can read the answer');
  let row = await one(`SELECT * FROM vale_private.card_reports WHERE submission_id = $1`, [first.submission_id]);
  eq([row.category, row.details, row.reporter_email, row.card_slug], ['impersonation', 'Pretends to be me', 'reporter@example.invalid', 'owner-card'], 'the report is stored as sent, email normalised');
  const turnstileCall = r.sent.find(c => c.url === fn.SITEVERIFY_URL);
  eq(new URLSearchParams(turnstileCall.body).get('idempotency_key'), first.submission_id, 'Turnstile is told the submission ID');
  ok(!new URLSearchParams(turnstileCall.body).has('remoteip'), 'the network address is not sent to Cloudflare');

  // The network: only a report-specific salted hash is stored, never the address.
  const reportHash = await fn.hashAddress(SECRETS.salt, 'ipv4:203.0.113.7');
  ok(/^[0-9a-f]{64}$/.test(reportHash) && row.network_hash === reportHash, 'the stored network value is the 64-character report hash');
  ok(reportHash !== await share.hashAddress(SECRETS.salt, 'ipv4:203.0.113.7'), 'report hashes differ from sharing hashes for the same network');
  const everything = JSON.stringify((await db.query(`SELECT (SELECT json_agg(t) FROM vale_private.card_reports t) a, (SELECT json_agg(t) FROM vale_private.report_attempts t) b`)).rows);
  ok(!everything.includes('203.0.113.7'), 'the raw network address is stored nowhere');

  // The alert: plain, with no details of the report, card or reporter.
  const mail = r.sent.find(c => c.url === fn.RESEND_URL), message = JSON.parse(mail.body);
  eq([message.from, message.to, message.subject], [fn.ALERT_FROM, [ALERT_TO], fn.ALERT_SUBJECT], 'the alert goes to the configured address');
  eq(mail.headers.get('authorization'), 'Bearer ' + SECRETS.resend, 'the alert uses the alert key');
  eq(mail.headers.get('idempotency-key'), 'report-alert-' + first.submission_id, 'a retried alert is not sent twice');
  ok(!/owner|Owner|Pretends|reporter|example\.invalid|impersonation|203\.0/.test(message.subject + message.text + (message.html || '')), 'the alert contains no report details');

  // ---- Every accepted outcome looks the same to the visitor ----
  r = await post(report({ category: 'scam', details: 'Asked for a deposit' }));
  eq([r.status, r.text], [200, RECEIVED], 'a distinct report from the same network is received');
  ok(!r.outside.includes(fn.RESEND_URL), 'no second alert within the hour');
  ok(await count(`card_slug = 'owner-card'`) === 2, 'distinct reports are both kept');
  r = await post(report({ details: 'PRETENDS  to be me' }));
  eq([r.text, await count(`card_slug = 'owner-card'`)], [RECEIVED, 2], 'an identical repeat is received and merged, not stored again');
  r = await post(first);
  eq([r.text, await count('submission_id = $1', [first.submission_id])], [RECEIVED, 1], 'a retried submission is received once');
  r = await post(report({ category: 'spam', details: 'one too many' }));
  eq([r.text, await count(`card_slug = 'owner-card'`)], [RECEIVED, 2], 'a rate-limited report gets the same answer and is not stored');
  r = await post(report({ card: 'draft-card' }), { ip: '198.51.100.5' });
  eq([r.text, await count(`card_slug = 'draft-card'`)], [RECEIVED, 0], 'a private card gets the same answer and nothing is stored');
  r = await post(report({ card: 'no-such-card' }), { ip: '198.51.100.6' });
  eq(r.text, RECEIVED, 'an unknown card gets the same answer');
  const blockedHash = await fn.hashAddress(SECRETS.salt, 'ipv4:198.51.100.66');
  await db.exec(`INSERT INTO vale_private.blocked_reporters(network_hash, reason) VALUES ('${blockedHash}', 'test')`);
  r = await post(report({ card: 'blocked-card' }), { ip: '198.51.100.66' });
  eq([r.text, await count(`card_slug = 'blocked-card'`)], [RECEIVED, 0], 'a blocked network gets the same answer and nothing is stored');
  ok(await one(`SELECT published FROM public.public_cards WHERE id = '${CARD.owner}'`).then(c => c.published) && await count('true') >= 2, 'reports never hide a card');

  // IPv6: one network (/64) counts once, so rotating addresses doesn't escape the limits.
  r = await post(report({ card: 'other-card', category: 'spam', details: 'v6 one' }), { ip: '2001:db8:1:2::10' });
  await post(report({ card: 'other-card', category: 'spam', details: 'v6 two' }), { ip: '2001:db8:1:2:ffff::1' });
  const v6 = await one(`SELECT count(DISTINCT network_hash)::int AS n FROM vale_private.card_reports WHERE card_slug = 'other-card'`);
  eq(v6.n, 1, 'addresses in one IPv6 /64 network share one hash');

  // ---- Invalid requests: refused before Turnstile or the database ----
  const invalid = [
    ['unknown field', report({ extra: 1 })],
    ['missing category', (({ category, ...rest }) => rest)(report())],
    ['unknown category', report({ category: 'rude' })],
    ['accuracy not confirmed', report({ attested: false })],
    ['accuracy missing', (({ attested, ...rest }) => rest)(report())],
    ['accuracy as text', report({ attested: 'true' })],
    ['explanation too long', report({ details: 'x'.repeat(1001) })],
    ['explanation not text', report({ details: 5 })],
    ['bad email', report({ email: 'not-an-email' })],
    ['email too long', report({ email: 'a'.repeat(250) + '@x.io' })],
    ['bad card link', report({ card: 'Owner Card' })],
    ['card link too short', report({ card: 'ab' })],
    ['bad submission ID', report({ submission_id: 'abc' })],
    ['missing Turnstile token', report({ turnstile_token: '' })],
    ['oversized Turnstile token', report({ turnstile_token: 'x'.repeat(2049) })],
    ['a list instead of an object', [report()]],
  ];
  for (const [label, body] of invalid) {
    r = await post(body);
    eq([r.status, r.answer, r.outside], [400, 'invalid', []], 'refused before any outside call: ' + label);
  }
  r = await post(null, { raw: '{not json' });
  eq([r.status, r.outside], [400, []], 'malformed JSON is refused');
  r = await post(report(), { type: 'text/plain' });
  eq([r.status, r.outside], [400, []], 'only JSON is accepted');
  r = await post(null, { raw: JSON.stringify(report({ details: 'x'.repeat(900) })) + ' '.repeat(8000) });
  eq([r.status, r.answer, r.outside], [413, 'too_large', []], 'oversized requests are refused');

  // ---- Turnstile ----
  for (const [token, status, answer, label] of [['fail', 403, 'verification_failed', 'a failed check'], ['wrong-host', 403, 'verification_failed', 'a token for another website'],
    ['share-token', 403, 'verification_failed', 'a token from the share form'], ['down', 502, 'error', 'Cloudflare unreachable'], ['secret-rejected', 503, 'not_configured', 'a rejected secret key']]) {
    r = await post(report({ turnstile_token: token }), { ip: '192.0.2.99' });
    eq([r.status, r.answer, r.outside], [status, answer, [fn.SITEVERIFY_URL]], 'refused without reaching the database: ' + label);
  }

  // ---- Origins and methods ----
  r = await post(report(), { origin: 'https://evil.example' });
  eq([r.status, r.outside, r.res.headers.get('access-control-allow-origin')], [403, [], null], 'another website is refused');
  r = await post(report(), { origin: '' });
  eq([r.status, r.outside], [403, []], 'a request without an origin is refused');
  r = await post(null, { method: 'OPTIONS' });
  eq([r.status, r.res.headers.get('access-control-allow-origin'), r.res.headers.get('access-control-allow-methods')], [204, ORIGIN, 'POST, OPTIONS'], 'the browser preflight is answered for the allowed page');
  r = await post(null, { method: 'OPTIONS', origin: 'https://evil.example' });
  eq(r.status, 403, 'other websites get no preflight');
  r = await post(null, { method: 'GET' });
  eq([r.status, r.answer, r.outside], [405, 'method_not_allowed', []], 'GET is refused and reveals nothing');
  ok(!/turnstile|salt|key|check/i.test(r.text), 'no settings in a refused GET');

  // ---- Network addresses: only Cloudflare's header counts ----
  r = await post(report(), { ip: null });
  eq([r.status, r.answer, r.outside], [503, 'address_unavailable', []], 'no trusted address, no report');
  r = await post(report(), { ip: null, xff: '203.0.113.50' });
  eq([r.status, r.outside], [503, []], 'X-Forwarded-For is ignored');
  r = await post(report(), { ip: null, extra: { 'x-real-ip': '203.0.113.51', 'true-client-ip': '203.0.113.52', forwarded: 'for=203.0.113.53' } });
  eq([r.status, r.outside], [503, []], 'other address headers are ignored');
  r = await post(report(), { ip: '203.0.113.7, 198.51.100.1' });
  eq([r.status, r.outside], [503, []], 'a list of addresses is refused');
  r = await post(report(), { ip: 'not-an-address' });
  eq([r.status, r.outside], [503, []], 'an invalid address is refused');

  // ---- Settings ----
  for (const name of ['TURNSTILE_SECRET_KEY', 'SHARE_HASH_SALT', 'SUPABASE_SECRET_KEYS', 'SUPABASE_URL', 'SHARE_TRUSTED_ADDRESS_HEADER']) {
    const before = logs.length;
    r = await post(report(), { h: handlerFor({ ...ENV, [name]: undefined }) });
    eq([r.status, r.answer, r.outside], [503, 'not_configured', []], 'refused when a required setting is missing: ' + name);
    ok(logs.slice(before).some(l => l.includes('"missing"')), 'the missing setting is named in the log: ' + name);
  }
  r = await post(report(), { h: handlerFor({ ...ENV, SHARE_HASH_SALT: 'short' }) });
  eq(r.status, 503, 'a short hash salt is refused');
  r = await post(report(), { h: handlerFor({ ...ENV, SHARE_TRUSTED_ADDRESS_HEADER: 'x-forwarded-for' }) });
  eq(r.status, 503, 'only Cloudflare\'s header can be trusted');

  // ---- Alerts never affect the report ----
  await db.exec(`UPDATE vale_private.report_alerts SET last_sent_at = now() - interval '2 hours'`);
  r = await post(report({ card: 'other-card', category: 'harassment', details: 'no alert settings' }), { ip: '192.0.2.10', h: handlerFor({ ...ENV, REPORT_ALERT_RESEND_KEY: undefined }) });
  eq([r.text, r.outside.includes(fn.RESEND_URL)], [RECEIVED, false], 'without alert settings, the report is still received');
  resendMode = 'fail';
  r = await post(report({ card: 'other-card', category: 'harassment', details: 'resend fails' }), { ip: '192.0.2.11' });
  eq([r.text, r.outside.includes(fn.RESEND_URL)], [RECEIVED, true], 'a failed alert doesn\'t fail the report');
  resendMode = 'down';
  await db.exec(`UPDATE vale_private.report_alerts SET last_sent_at = now() - interval '2 hours'`);
  r = await post(report({ card: 'other-card', category: 'harassment', details: 'resend down' }), { ip: '192.0.2.12' });
  eq(r.text, RECEIVED, 'an unreachable email service doesn\'t fail the report');
  resendMode = 'ok';
  r = await post(report({ card: 'other-card', category: 'harassment', details: 'bad alert address' }), { ip: '192.0.2.13', h: handlerFor({ ...ENV, REPORT_ALERT_TO: 'nobody' }) });
  eq([r.text, r.outside.includes(fn.RESEND_URL)], [RECEIVED, false], 'an invalid alert address sends nothing');

  // ---- Database problems ----
  dbFails = true;
  const before = logs.length;
  r = await post(report({ card: 'other-card', details: 'db down' }), { ip: '192.0.2.20' });
  eq([r.status, r.answer], [502, 'error'], 'a database problem answers error');
  ok(!r.text.includes('internal detail') && !logs.slice(before).some(l => l.includes('internal detail')), 'database details reach neither the browser nor the log');
  dbFails = false;

  // ---- The log holds outcome words only ----
  const logText = logs.join('\n');
  for (const secret of ['203.0.113.7', '198.51.100', '2001:db8', 'reporter@example', 'Pretends', 'Asked for a deposit', 'owner-card', reportHash, SECRETS.salt, SECRETS.key, SECRETS.resend, SECRETS.turnstile, ALERT_TO, 'pass'])
    ok(!logText.includes(secret), 'the log never contains: ' + (secret.length > 20 ? secret.slice(0, 12) + '…' : secret));
  ok(logs.some(l => l.includes('"stored":"stored"')) && logs.some(l => l.includes('"stored":"limited"')), 'the log records outcomes for troubleshooting');

  // ---- Same address rules as the share-card function ----
  for (const ip of ['203.0.113.7', ' 203.0.113.7 ', '010.0.0.1', '256.1.1.1', '1.2.3', '::ffff:192.0.2.1', '2001:db8::1', '2001:DB8:0:0:1::1', '2001:db8::1%eth0', '[2001:db8::1]', '::', '1::2::3', 'fe80::1:2:3:4:5:6:7', '1.2.3.4,5.6.7.8', '', null])
    eq(fn.addressKey(ip), share.addressKey(ip), 'same address rule as share-card for ' + JSON.stringify(ip));
  } finally { await db.close(); }
  return checks;
}

// Each protection removed in turn: the checks must notice every one.
const SABOTAGE = [
  ['Turnstile not checked', 'const human = await verifyTurnstile(config, request.token, request.submissionId);', "const human = 'ok';"],
  ['Turnstile action not checked (share tokens accepted)', '|| data.action !== TURNSTILE_ACTION', ''],
  ['Turnstile website not checked', '!TURNSTILE_HOSTNAMES.includes(data.hostname) || ', ''],
  ['accuracy confirmation not required', 'if (attested !== true) return null;', ''],
  ['unknown request keys accepted', 'if (Object.keys(body).some(key => !KEYS.includes(key))) return null;', ''],
  ['any category accepted', "if (typeof category !== 'string' || !CATEGORIES.includes(category)) return null;", "if (typeof category !== 'string') return null;"],
  ['raw network address stored', 'const networkHash = await hashAddress(config.salt, network);', "const networkHash = req.headers.get('cf-connecting-ip');"],
  ['report hash same as sharing hash', "enc.encode('report-network:' + key)", "enc.encode('network:' + key)"],
  ['X-Forwarded-For used as a fallback', 'return addressKey(headers.get(TRUSTED_ADDRESS_HEADER));', "return addressKey(headers.get(TRUSTED_ADDRESS_HEADER)) || addressKey((headers.get('x-forwarded-for') || '').split(',')[0]);"],
  ['reports allowed without an address', "if (!network) return finish('address_unavailable', origin);", ''],
  ['address trust assumed without confirmation', "trusted_address_header: get('SHARE_TRUSTED_ADDRESS_HEADER').toLowerCase() === TRUSTED_ADDRESS_HEADER,", 'trusted_address_header: true,'],
  ['IPv6 counted per address', "return 'ipv6:' + six.slice(0, 4)", "return 'ipv6:' + six.slice(0, 8)"],
  ['outcome revealed to the visitor', "return finish('received', origin, stored);", 'return finish(stored, origin, stored);'],
  ['limited reports answer differently', "const RECEIVED = Object.freeze(['stored', 'merged', 'limited',", "const RECEIVED = Object.freeze(['stored', 'merged',"],
  ['alert on every report', "if (due.value !== true) { log({ event: 'alert', result: 'not_due' }); return; }", ''],
  ['report details in the alert', 'subject: ALERT_SUBJECT, text: ALERT_TEXT', 'subject: ALERT_SUBJECT, text: ALERT_TEXT + request.details'],
  ['alert failure fails the report', "} catch { log({ event: 'alert', result: 'failed' }); return; }", "} catch { throw new Error('alert'); }"],
  ['network address sent to Cloudflare', 'idempotency_key: submissionId })', "idempotency_key: submissionId, remoteip: 'x' })"],
  ['missing settings tolerated', 'if (!config.ok) {', 'if (false) {'],
  ['short hash salt accepted', "hash_salt: get('SHARE_HASH_SALT').length >= MIN_SALT_LENGTH,", "hash_salt: get('SHARE_HASH_SALT') !== '',"],
  ['origin not checked', "if (!ALLOWED_ORIGINS.includes(origin)) return finish('forbidden_origin', '');", ''],
  ['database errors shown to the browser', "if (!res.ok) { log({ event: 'database', call: name, status: res.status }); return { ok: false }; }", "if (!res.ok) return { ok: true, value: await res.text() };", "if (!RECEIVED.includes(stored)) return finish('error', origin);", "if (!RECEIVED.includes(stored)) return new Response(JSON.stringify({ status: stored }), { status: 502 });"],
  ['secret key sent as a bearer token', "if (!config.serverKey.startsWith('sb_')) headers.Authorization", 'headers.Authorization'],
  ['oversized requests accepted', 'if (new TextEncoder().encode(text).length > MAX_BODY_BYTES)', 'if (false)'],
  ['report text written to the log', "log({ event: 'report', result, ...(stored ? { stored } : {}) });", "log({ event: 'report', result, stored, body: globalThis.__last });"],
];

(async () => {
  const { rebuild } = await load('scripts/db-rebuild.mjs');
  const share = await load('supabase/functions/share-card/handler.mjs');
  const source = require('node:fs').readFileSync(path.join(root, HANDLER), 'utf8').replace(/\r\n/g, '\n');
  const checks = await suite(await load(HANDLER), rebuild, share);
  console.log(`report-card function: ${checks} checks passed`);
  for (const [label, find, replace, find2, replace2] of SABOTAGE) {
    if (!source.includes(find) || (find2 && !source.includes(find2))) throw new Error('Sabotage target not found: ' + label);
    let broken = source.replace(find, replace);
    if (find2) broken = broken.replace(find2, replace2);
    if (label === 'report text written to the log') broken = broken.replace('const request = validateRequest(body);', 'const request = validateRequest(body); globalThis.__last = text;');
    const mod = await import('data:text/javascript,' + encodeURIComponent(broken));
    let caught = false;
    try { await suite(mod, rebuild, share); } catch { caught = true; }
    assert.ok(caught, 'the checks did not notice: ' + label);
    console.log('detects broken protection: ' + label);
  }
})().catch(error => { console.error(error); process.exit(1); });
