// The share-card Edge Function, run against an in-memory database built from this repository (PGlite), with
// stand-ins for Cloudflare Turnstile and Supabase Auth. No network: every outside call goes to the fakes below.
// Covers successful sharing, invalid requests, abuse attempts, authorization failures and missing settings.
const path = require('node:path'), assert = require('node:assert/strict'), { pathToFileURL } = require('node:url');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const load = rel => import(pathToFileURL(path.join(root, rel)).href);

const ORIGIN = 'https://dev.valebrandworks.com', URL_BASE = 'https://jlprxnmdvoloahssjlnu.supabase.co';
const SECRETS = { turnstile: 'turnstile-secret-SYNTHETIC', salt: 'salt-SYNTHETIC-0123456789abcdef-0123456789', key: 'sb_secret_SYNTHETICKEY_0123', publishable: 'sb_publishable_SYNTHETIC_0123' };
const ENV = { TURNSTILE_SECRET_KEY: SECRETS.turnstile, SHARE_HASH_SALT: SECRETS.salt, SUPABASE_URL: URL_BASE, SUPABASE_SECRET_KEYS: JSON.stringify({ default: SECRETS.key }), SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: SECRETS.publishable }), SHARE_TRUSTED_ADDRESS_HEADER: 'cf-connecting-ip' };
const ID = { owner: '0a000000-0000-4000-8000-000000000001', member: '0a000000-0000-4000-8000-000000000002', other: '0a000000-0000-4000-8000-000000000003' };
const CARD = { owner: '0c000000-0000-4000-8000-000000000001', member: '0c000000-0000-4000-8000-000000000002', other: '0c000000-0000-4000-8000-000000000003', closed: '0c000000-0000-4000-8000-000000000004', draft: '0c000000-0000-4000-8000-000000000005', busy: '0c000000-0000-4000-8000-000000000006', spoof: '0c000000-0000-4000-8000-000000000007' };
const JWTS = { 'member.jwt.token': ID.member, 'owner.jwt.token': ID.owner };
const uuid = () => crypto.randomUUID();

const HANDLER = 'supabase/functions/share-card/handler.mjs';

// Runs every check against one version of the handler. Throws at the first failed check.
async function suite(fn, rebuild) {
  let checks = 0;
  const ok = (value, label) => { assert.ok(value, label); checks++; };
  const eq = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
  const db = await rebuild(root);
  try {
  await db.exec(`
    INSERT INTO auth.users(id, email) VALUES ('${ID.owner}', 'o@example.invalid'), ('${ID.member}', 'm@example.invalid'), ('${ID.other}', 'x@example.invalid');
    INSERT INTO public.public_cards(id, owner_id, slug, display_name, business_name, public_email, public_phone, published) VALUES
     ('${CARD.owner}', '${ID.owner}', 'owner-card', 'Owner Synthetic', 'Owner Co', 'owner@example.invalid', '', true),
     ('${CARD.member}', '${ID.member}', 'member-card', 'Member Synthetic', 'Member Co', 'member-card@example.invalid', '+1 555 010 0222', true),
     ('${CARD.other}', '${ID.other}', 'other-card', 'Other Synthetic', '', 'other@example.invalid', '', true),
     ('${CARD.closed}', '${ID.other}', 'closed-card', 'Closed Synthetic', '', '', '', true),
     ('${CARD.draft}', '${ID.other}', 'draft-card', 'Draft Synthetic', '', '', '', false),
     ('${CARD.busy}', '${ID.other}', 'busy-card', 'Busy Synthetic', '', '', '', true),
     ('${CARD.spoof}', '${ID.other}', 'spoof-card', 'Spoof Synthetic', '', '', '', true);
    UPDATE public.public_cards SET accept_shares = false WHERE id = '${CARD.closed}';`);

  // The outside world. Each Turnstile token name decides what Cloudflare answers.
  const calls = [], logs = [];
  let dbFails = false;
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
      if (token === 'fail') return respond(200, { success: false, 'error-codes': ['invalid-input-response'] });
      if (token === 'wrong-host') return respond(200, { success: true, hostname: 'evil.example', action: fn.TURNSTILE_ACTION });
      if (token === 'wrong-action') return respond(200, { success: true, hostname: 'dev.valebrandworks.com', action: 'login' });
      if (token === 'pass') return respond(200, { success: true, hostname: 'dev.valebrandworks.com', action: fn.TURNSTILE_ACTION });
      return respond(200, { success: false, 'error-codes': ['invalid-input-response'] });
    }
    if (url === URL_BASE + '/auth/v1/user') {
      assert.equal(headers.get('apikey'), SECRETS.publishable, 'Auth is called with the low-privilege publishable key, not the secret key');
      const user = JWTS[(headers.get('authorization') || '').replace(/^Bearer /, '')];
      return user ? respond(200, { id: user, aud: 'authenticated' }) : respond(401, { msg: 'invalid JWT' });
    }
    if (url === URL_BASE + '/rest/v1/rpc/record_share') {
      if (dbFails) return respond(500, { message: 'internal detail that must not reach the browser' });
      const p = JSON.parse(init.body);
      await db.exec('SET ROLE service_role');
      try {
        const r = await db.query('SELECT public.record_share($1, $2, $3, $4, $5::jsonb, $6::text[], $7, $8, $9, $10) AS r',
          [p.p_card_slug, p.p_submission_id, p.p_consented, p.p_consent_version, p.p_fields === null ? null : JSON.stringify(p.p_fields), p.p_member_fields, p.p_sharer_user_id, p.p_sharer_card_id, p.p_network_hash, p.p_note]);
        return respond(200, r.rows[0].r);
      } catch (error) { return respond(400, { message: error.message }); }
      finally { await db.exec('RESET ROLE'); }
    }
    throw new Error('Unexpected outside call: ' + url);
  }

  const handlerFor = env => fn.createShareHandler({ env: name => env[name], fetch: fakeFetch, log: entry => logs.push(JSON.stringify(entry)) });
  const handle = handlerFor(ENV);
  const post = async (body, { origin = ORIGIN, auth, ip = '203.0.113.7', xff, extra = {}, raw, type = 'application/json', h = handle } = {}) => {
    const headers = { 'Content-Type': type };
    if (origin) headers.Origin = origin;
    if (auth) headers.Authorization = auth;
    if (ip) headers['cf-connecting-ip'] = ip;
    if (xff) headers['x-forwarded-for'] = xff;
    Object.assign(headers, extra);
    const before = calls.length;
    const res = await h(new Request(URL_BASE + '/functions/v1/share-card', { method: 'POST', headers, body: raw ?? JSON.stringify(body) }));
    const data = await res.json();
    return { status: res.status, answer: data.status, data, res, outside: calls.slice(before).map(c => c.url) };
  };
  const visitor = (over = {}) => ({ mode: 'visitor', card: 'owner-card', submission_id: uuid(), consent: true, consent_version: '2026-11-v1', turnstile_token: 'pass', note: '', fields: { full_name: 'Visitor Synthetic', email: 'visitor@example.invalid' }, ...over });
  const member = (over = {}) => ({ mode: 'member', card: 'owner-card', submission_id: uuid(), consent: true, consent_version: '2026-11-v1', turnstile_token: 'pass', card_id: CARD.member, member_fields: ['full_name', 'email'], ...over });
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  const count = async (table, where = 'true', params) => (await one(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params)).n;

  // ---- Successful sharing ----
  const first = visitor();
  let r = await post(first);
  eq([r.status, r.answer], [200, 'shared'], 'a visitor can share');
  eq(r.outside, [fn.SITEVERIFY_URL, URL_BASE + '/rest/v1/rpc/record_share'], 'Turnstile is checked before the database is called');
  eq(r.res.headers.get('access-control-allow-origin'), ORIGIN, 'the allowed page can read the answer');
  let share = await one(`SELECT * FROM public.card_shares WHERE submission_id = $1`, [first.submission_id]);
  eq([share.outcome, share.sharer_user_id, share.consent_version], ['added', null, '2026-11-v1'], 'the share is recorded as a new connection, with its consent version');
  ok(await count('public.connections', `owner_id = '${ID.owner}' AND source = 'shared_back' AND email = 'visitor@example.invalid'`) === 1, 'the owner gets the connection');
  ok(await count('public.notifications', `owner_id = '${ID.owner}' AND kind = 'share_added'`) === 1, 'the owner gets a notification');
  const turnstileCall = calls.find(c => c.url === fn.SITEVERIFY_URL);
  eq(new URLSearchParams(turnstileCall.body).get('idempotency_key'), first.submission_id, 'Turnstile is told the submission ID, so a retry is safe');
  ok(!new URLSearchParams(turnstileCall.body).has('remoteip'), 'the network address is not sent to Cloudflare');

  // The network address: only its salted hash is stored, nowhere in plain form.
  const expectedHash = await fn.hashAddress(SECRETS.salt, 'ipv4:203.0.113.7');
  ok(/^[0-9a-f]{64}$/.test(expectedHash), 'the network hash is a 64-character HMAC');
  ok(await count('public.share_attempts', 'network_hash = $1', [expectedHash]) === 1, 'the attempt is counted under the hash');
  const everything = JSON.stringify((await db.query(`SELECT (SELECT json_agg(t) FROM public.share_attempts t) a, (SELECT json_agg(t) FROM public.card_shares t) s, (SELECT json_agg(t) FROM public.connections t) c, (SELECT json_agg(t) FROM public.notifications t) n`)).rows);
  ok(!everything.includes('203.0.113.7'), 'the raw network address is stored nowhere');
  ok(await fn.hashAddress('another-salt-0123456789abcdef-0123456789', 'ipv4:203.0.113.7') !== expectedHash, 'the hash depends on the secret salt');

  r = await post(first);
  eq(r.answer, 'shared', 'sending the same submission again answers shared');
  ok(await count('public.card_shares', 'submission_id = $1', [first.submission_id]) === 1, 'and stores nothing twice');

  r = await post(visitor({ fields: { full_name: 'Someone Else', email: 'VISITOR@example.invalid' } }));
  eq(r.answer, 'shared', 'a share matching an existing connection still answers shared');
  ok(await count('public.card_shares', `owner_id = '${ID.owner}' AND outcome = 'duplicate'`) === 1, 'but is kept as a duplicate for review, not a new connection');

  // A member shares their own saved card; the values come from the database, not the request.
  r = await post(member(), { auth: 'Bearer member.jwt.token', ip: '198.51.100.20' });
  eq([r.status, r.answer], [200, 'shared'], 'a signed-in member can share their card');
  eq(r.outside, [fn.SITEVERIFY_URL, URL_BASE + '/auth/v1/user', URL_BASE + '/rest/v1/rpc/record_share'], 'the member\'s sign-in is checked with Supabase Auth');
  share = await one(`SELECT * FROM public.card_shares WHERE sharer_user_id = $1`, [ID.member]);
  eq([share.sharer_card_id, share.shared.email, share.shared.full_name, share.shared.phone], [CARD.member, 'member-card@example.invalid', 'Member Synthetic', undefined], 'only the ticked fields are shared, read from the member\'s own card');

  r = await post(member({ card: 'member-card', card_id: CARD.owner }), { auth: 'Bearer owner.jwt.token', ip: '198.51.100.21' });
  eq(r.answer, 'shared', 'the owner shares back');
  ok(await count('public.connections', 'mutual') === 2, 'both people now have a mutual connection');

  // ---- Invalid requests: refused before Turnstile or the database is called ----
  const invalid = [
    ['consent not given', visitor({ consent: false })],
    ['consent missing', (({ consent, ...rest }) => rest)(visitor())],
    ['consent as text', visitor({ consent: 'true' })],
    ['no email or phone', visitor({ fields: { full_name: 'No Contact' } })],
    ['no name', visitor({ fields: { email: 'a@example.invalid' } })],
    ['unknown field', visitor({ fields: { full_name: 'A', email: 'a@example.invalid', password: 'x' } })],
    ['social links from a visitor', visitor({ fields: { full_name: 'A', email: 'a@example.invalid', social_links: 'x' } })],
    ['field too long', visitor({ fields: { full_name: 'A'.repeat(91), email: 'a@example.invalid' } })],
    ['field not text', visitor({ fields: { full_name: ['A'], email: 'a@example.invalid' } })],
    ['unknown top-level key', visitor({ owner_id: ID.other })],
    ['member user ID smuggled in', visitor({ sharer_user_id: ID.member })],
    ['bad submission ID', visitor({ submission_id: 'not-a-uuid' })],
    ['bad card link', visitor({ card: '../owner' })],
    ['bad consent version', visitor({ consent_version: 'v1; DROP' })],
    ['note too long', visitor({ note: 'n'.repeat(301) })],
    ['no Turnstile token', visitor({ turnstile_token: '' })],
    ['unknown mode', visitor({ mode: 'admin' })],
    ['member mode with typed values', member({ fields: { full_name: 'A', email: 'a@example.invalid' } })],
    ['member field not allowed', member({ member_fields: ['full_name', 'introduction'] })],
    ['member fields without the name', member({ member_fields: ['email'] })],
    ['member field repeated', member({ member_fields: ['full_name', 'full_name'] })],
    ['member card ID invalid', member({ card_id: 'x' })],
  ];
  for (const [label, body] of invalid) {
    r = await post(body, { auth: 'Bearer member.jwt.token' });
    eq([r.status, r.answer, r.outside], [400, 'invalid', []], 'refused: ' + label);
  }
  for (const [label, raw, type] of [['not JSON', '{"mode":', 'application/json'], ['a list', '[]', 'application/json'], ['null', 'null', 'application/json'], ['form data', 'mode=visitor', 'application/x-www-form-urlencoded']]) {
    r = await post(null, { raw, type });
    eq([r.status, r.answer, r.outside], [400, 'invalid', []], 'refused: ' + label);
  }
  r = await post(null, { raw: JSON.stringify(visitor({ note: '' })).replace('"note":""', '"note":"' + 'x'.repeat(12001) + '"') });
  eq([r.status, r.answer, r.outside], [413, 'too_large', []], 'refused: oversized request');

  // ---- Authorization failures ----
  r = await post(member());
  eq([r.status, r.answer, r.outside], [401, 'sign_in_required', []], 'a member share without a sign-in is refused before Turnstile');
  r = await post(member(), { auth: 'Bearer sb_publishable_notauser' });
  eq([r.status, r.answer, r.outside], [401, 'sign_in_required', []], 'the publishable key is not a sign-in');
  r = await post(member(), { auth: 'Bearer forged.jwt.token' });
  eq([r.status, r.answer], [401, 'sign_in_required'], 'a sign-in token Supabase Auth rejects is refused');
  ok(!r.outside.includes(URL_BASE + '/rest/v1/rpc/record_share'), 'and the database is never called');
  r = await post(member({ card_id: CARD.other }), { auth: 'Bearer member.jwt.token', ip: '198.51.100.30' });
  eq([r.status, r.answer], [400, 'invalid'], 'a member can\'t share someone else\'s card');
  ok(await count('public.card_shares', 'sharer_card_id = $1', [CARD.other]) === 0, 'and nothing is stored');
  r = await post(member({ card: 'member-card' }), { auth: 'Bearer member.jwt.token', ip: '198.51.100.31' });
  eq(r.answer, 'invalid', 'a member can\'t share with their own card');
  const asVisitor = visitor({ card: 'other-card', fields: { full_name: 'Typed Name', email: 'typed@example.invalid' } });
  r = await post(asVisitor, { auth: 'Bearer member.jwt.token', ip: '198.51.100.32' });
  eq(r.answer, 'shared', 'a visitor-form share from a signed-in browser works');
  eq((await one('SELECT sharer_user_id FROM public.card_shares WHERE submission_id = $1', [asVisitor.submission_id])).sharer_user_id, null, 'but is never linked to the account (no member privileges from a visitor form)');

  // ---- Abuse attempts ----
  for (const [token, status, answer, label] of [['fail', 403, 'verification_failed', 'failed Turnstile'], ['wrong-host', 403, 'verification_failed', 'a Turnstile token from another website'], ['wrong-action', 403, 'verification_failed', 'a Turnstile token from another form'], ['made-up', 403, 'verification_failed', 'a made-up Turnstile token'], ['down', 502, 'error', 'Turnstile unreachable']]) {
    r = await post(visitor({ turnstile_token: token }));
    eq([r.status, r.answer, r.outside], [status, answer, [fn.SITEVERIFY_URL]], 'refused without touching the database: ' + label);
  }
  for (const [origin, label] of [['https://evil.example', 'another website'], ['', 'no origin'], ['http://dev.valebrandworks.com', 'plain http'], ['https://dev.valebrandworks.com.evil.example', 'a look-alike address']]) {
    r = await post(visitor(), { origin });
    eq([r.status, r.answer, r.outside, r.res.headers.get('access-control-allow-origin')], [403, 'forbidden_origin', [], null], 'refused: ' + label);
  }
  r = await post(visitor({ card: 'closed-card' }), { ip: '198.51.100.40' });
  eq([r.status, r.answer], [404, 'unavailable'], 'a card that doesn\'t accept shares is refused');
  r = await post(visitor({ card: 'draft-card' }), { ip: '198.51.100.41' });
  eq([r.status, r.answer], [404, 'unavailable'], 'a private draft card is refused');
  r = await post(visitor({ card: 'no-such-card' }), { ip: '198.51.100.42' });
  eq([r.status, r.answer], [404, 'unavailable'], 'an unknown card is refused');

  // Rate limits (from share_limits): 5 per hour from one network to one card.
  const busy = n => visitor({ card: 'busy-card', fields: { full_name: 'Flood ' + n, email: `flood${n}@example.invalid` } });
  const answers = [];
  for (let n = 1; n <= 6; n++) answers.push((await post(busy(n), { ip: '192.0.2.50' })).answer);
  eq(answers, ['shared', 'shared', 'shared', 'shared', 'shared', 'rate_limited'], 'a sixth share within the hour from one network is limited');
  r = await post(busy(7), { ip: '192.0.2.50', xff: '10.9.8.7' });
  eq([r.status, r.answer], [429, 'rate_limited'], 'a made-up X-Forwarded-For does not get around the limit');
  for (const [name, value] of [['x-real-ip', '10.1.1.1'], ['true-client-ip', '10.1.1.2'], ['forwarded', 'for=10.1.1.3'], ['x-client-ip', '10.1.1.4'], ['fastly-client-ip', '10.1.1.5']]) {
    r = await post(busy(7), { ip: '192.0.2.50', extra: { [name]: value } });
    eq(r.answer, 'rate_limited', 'a made-up ' + name + ' header does not get around the limit');
  }
  const rotated = [];
  for (let n = 1; n <= 6; n++) rotated.push((await post(busy(20 + n), { ip: '2001:db8:aa:bb:' + n + '::' + n })).answer);
  eq(rotated, ['shared', 'shared', 'shared', 'shared', 'shared', 'rate_limited'], 'rotating IPv6 addresses within one /64 network does not get around the limit');
  r = await post(busy(30), { ip: '::ffff:192.0.2.50' });
  eq(r.answer, 'rate_limited', 'the same IPv4 address written in IPv6 form is the same network');
  // Without the trusted header there is no address, so no share at all: a spoofed X-Forwarded-For can't stand in.
  for (const [label, opts] of [['only X-Forwarded-For', { ip: '', xff: '192.0.2.99' }], ['only X-Real-IP', { ip: '', extra: { 'x-real-ip': '192.0.2.99' } }], ['no address header', { ip: '' }],
    ['two addresses in the trusted header', { ip: '192.0.2.99, 192.0.2.98' }], ['a malformed address', { ip: 'not-an-address' }], ['an address with a zone', { ip: 'fe80::1%eth0' }], ['a bracketed address', { ip: '[2001:db8::1]' }]]) {
    r = await post(busy(40), opts);
    eq([r.status, r.answer, r.outside], [503, 'address_unavailable', []], 'refused before Turnstile or the database: ' + label);
  }
  r = await post(busy(8), { ip: '192.0.2.51' });
  eq(r.answer, 'shared', 'another network can still share with that card');
  // The same email twice a day per card, even from different networks.
  const sameContact = n => visitor({ card: 'spoof-card', fields: { full_name: 'Same ' + n, email: 'same@example.invalid' } });
  eq([(await post(sameContact(1), { ip: '192.0.2.60' })).answer, (await post(sameContact(2), { ip: '192.0.2.61' })).answer, (await post(sameContact(3), { ip: '192.0.2.62' })).answer],
    ['shared', 'shared', 'rate_limited'], 'one email address is limited per card even across networks');

  // ---- Missing or broken settings: every share refused, nothing called ----
  const without = (name, value) => { const env = { ...ENV }; if (value === undefined) delete env[name]; else env[name] = value; return env; };
  for (const [label, env] of [
    ['no Turnstile secret', without('TURNSTILE_SECRET_KEY')], ['blank Turnstile secret', without('TURNSTILE_SECRET_KEY', '  ')],
    ['no hash salt', without('SHARE_HASH_SALT')], ['hash salt too short', without('SHARE_HASH_SALT', 'short')],
    ['no server key', without('SUPABASE_SECRET_KEYS')], ['unreadable server keys', without('SUPABASE_SECRET_KEYS', '{not json')],
    ['no publishable key', without('SUPABASE_PUBLISHABLE_KEYS')], ['secret key given as the publishable key', without('SUPABASE_PUBLISHABLE_KEYS', JSON.stringify({ default: SECRETS.key }))],
    ['address trust not confirmed', without('SHARE_TRUSTED_ADDRESS_HEADER')], ['an untrusted address header named', without('SHARE_TRUSTED_ADDRESS_HEADER', 'x-forwarded-for')],
    ['Supabase address elsewhere', without('SUPABASE_URL', 'https://evil.example')],
    ['no Supabase address', without('SUPABASE_URL')], ['Supabase address not https', without('SUPABASE_URL', 'http://jlprxnmdvoloahssjlnu.supabase.co')],
  ]) {
    r = await post(visitor(), { h: handlerFor(env) });
    eq([r.status, r.answer, r.outside], [503, 'not_configured', []], 'refused: ' + label);
  }
  r = await post(visitor({ turnstile_token: 'secret-rejected' }));
  eq([r.status, r.answer], [503, 'not_configured'], 'a Turnstile secret that Cloudflare rejects refuses the share');
  dbFails = true;
  r = await post(visitor({ fields: { full_name: 'Db Down', email: 'dbdown@example.invalid' } }), { ip: '192.0.2.70' });
  dbFails = false;
  eq([r.status, r.data], [502, { status: 'error' }], 'a database failure answers only "error", with no details');

  // Server key handling: new keys in apikey only; the legacy JWT key also in Authorization.
  const rpcCalls = calls.filter(c => c.url.endsWith('/rpc/record_share'));
  ok(rpcCalls.every(c => c.headers.get('apikey') === SECRETS.key && !c.headers.has('authorization')), 'the new secret key is sent only in the apikey header');
  const legacy = handlerFor({ ...without('SUPABASE_SECRET_KEYS'), SUPABASE_SERVICE_ROLE_KEY: 'legacy.service.jwt' });
  const before = calls.length;
  await post(visitor({ fields: { full_name: 'Legacy', email: 'legacy@example.invalid' } }), { h: legacy, ip: '192.0.2.80' }).catch(() => {});
  const legacyCall = calls.slice(before).find(c => c.url.endsWith('/rpc/record_share'));
  eq([legacyCall.headers.get('apikey'), legacyCall.headers.get('authorization')], ['legacy.service.jwt', 'Bearer legacy.service.jwt'], 'the legacy service_role key is also sent as a bearer token');

  // ---- Other methods and the settings check ----
  const call = async (method, headers = {}, h = handle) => { const res = await h(new Request(URL_BASE + '/functions/v1/share-card', { method, headers })); return { res, text: method === 'OPTIONS' && res.status === 204 ? '' : await res.text() }; };
  let c = await call('OPTIONS', { Origin: ORIGIN });
  eq([c.res.status, c.res.headers.get('access-control-allow-origin'), c.res.headers.get('access-control-allow-methods')], [204, ORIGIN, 'POST, OPTIONS'], 'the allowed page passes the browser\'s preflight');
  c = await call('OPTIONS', { Origin: 'https://evil.example' });
  eq([c.res.status, c.res.headers.get('access-control-allow-origin')], [403, null], 'other websites fail the preflight');
  c = await call('PUT', { Origin: ORIGIN });
  eq(c.res.status, 405, 'other methods are refused');
  for (const headers of [{}, { 'cf-connecting-ip': '203.0.113.99' }, { Origin: ORIGIN }]) {
    c = await call('GET', headers);
    eq(c.res.status, 405, 'there is no public settings check (GET is refused)');
    ok(![SECRETS.turnstile, SECRETS.salt, SECRETS.key, SECRETS.publishable, '203.0.113.99', 'checks', 'hash_salt', 'network_source'].some(v => c.text.includes(v)), 'and a GET reveals no settings, values or address');
  }
  c = await call('GET', {}, handlerFor(without('SHARE_HASH_SALT')));
  eq([c.res.status, c.text.includes('hash_salt')], [405, false], 'not even when a setting is missing');
  const configLogs = logs.filter(l => l.startsWith('{"event":"config"'));
  ok(configLogs.some(l => l.includes('"trusted_address_header"')) && configLogs.some(l => l.includes('"hash_salt"')), 'missing settings are named in the internal function log');

  // ---- Logs: outcome words only ----
  const logText = logs.join('\n');
  ok(logs.length > 20 && logs.every(l => /^\{"event":"(share|config|database)"/.test(l)), 'every log line is a short outcome record');
  ok(!['example.invalid', 'Synthetic', '203.0.113', '198.51.100', '192.0.2', expectedHash, SECRETS.turnstile, SECRETS.salt, SECRETS.key, 'jwt.token', 'internal detail'].some(s => logText.includes(s)),
    'logs contain no names, contact details, addresses, hashes, tokens or secrets');

  // ---- Pure checks ----
  eq(fn.networkKey(new Headers({ 'cf-connecting-ip': 'not an ip', 'x-forwarded-for': '2001:db8::1', 'x-real-ip': '192.0.2.1' })), null, 'a malformed trusted header is not replaced by other headers');
  eq(fn.networkKey(new Headers({ 'x-forwarded-for': '192.0.2.1' })), null, 'X-Forwarded-For alone gives no address');
  for (const [text, key] of [['192.0.2.1', 'ipv4:192.0.2.1'], ['192.0.02.1', null], ['256.1.1.1', null], ['2001:DB8:1:2::9', 'ipv6:2001:db8:1:2::/64'], ['2001:db8:1:2:ffff:ffff:ffff:ffff', 'ipv6:2001:db8:1:2::/64'],
    ['::ffff:192.0.2.1', 'ipv4:192.0.2.1'], ['1::2::3', null], ['1:2:3:4:5:6:7:8:9', null], ['::ffff:999.1.1.1', null], ['', null], ['192.0.2.1,192.0.2.2', null]]) eq(fn.addressKey(text), key, 'address ' + JSON.stringify(text));
  eq(await fn.hashAddress(SECRETS.salt, null), null, 'no address, no hash');

  return checks;
  } finally { await db.close(); }
}

// Each protection removed in turn: the checks must notice every one.
const SABOTAGE = [
  ['Turnstile not checked', "const human = await verifyTurnstile(config, request.token, request.submissionId);", "const human = 'ok';"],
  ['Turnstile website and form not checked', "if (!TURNSTILE_HOSTNAMES.includes(data.hostname) || data.action !== TURNSTILE_ACTION) return 'verification_failed';", ''],
  ['member sign-in not verified', 'const member = await memberId(config, jwt);', "const member = { result: 'ok', id: '0a000000-0000-4000-8000-000000000002' };"],
  ['consent not checked', 'if (consent !== true) return null;', ''],
  ['unknown request keys accepted', 'if (Object.keys(body).some(key => !TOP_LEVEL[mode].includes(key))) return null;', ''],
  ['raw network address stored', 'const networkHash = await hashAddress(config.salt, network);', "const networkHash = req.headers.get('cf-connecting-ip');"],
  ['X-Forwarded-For trusted first', 'return addressKey(headers.get(TRUSTED_ADDRESS_HEADER));', "return addressKey((headers.get('x-forwarded-for') || '').split(',')[0]) || addressKey(headers.get(TRUSTED_ADDRESS_HEADER));"],
  ['X-Forwarded-For used as a fallback', 'return addressKey(headers.get(TRUSTED_ADDRESS_HEADER));', "return addressKey(headers.get(TRUSTED_ADDRESS_HEADER)) || addressKey((headers.get('x-forwarded-for') || '').split(',')[0]);"],
  ['shares allowed without an address', "if (!network) return finish('address_unavailable', origin, '');", ''],
  ['address trust assumed without confirmation', "trusted_address_header: get('SHARE_TRUSTED_ADDRESS_HEADER').toLowerCase() === TRUSTED_ADDRESS_HEADER,", 'trusted_address_header: true,'],
  ['IPv6 counted per address, not per network', "return 'ipv6:' + six.slice(0, 4)", "return 'ipv6:' + six.slice(0, 8)"],
  ['a list of addresses accepted', "if (!value || value.includes(',') || value.includes(' ')) return null;", "if (!value) return null; if (value.includes(',')) return addressKey(value.split(',')[0]);"],
  ['secret key used for the sign-in check', 'headers: { apikey: config.publicKey, Authorization', 'headers: { apikey: config.serverKey, Authorization'],
  ['public settings check', "    if (req.method === 'OPTIONS') {", "    if (req.method === 'GET') return reply('ok', '', { checks: config.checks }); if (req.method === 'OPTIONS') {"],
  ['network address sent to Cloudflare', 'idempotency_key: submissionId })', "idempotency_key: submissionId, remoteip: 'x' })"],
  ['missing settings tolerated', 'if (!config.ok) {', 'if (false) {'],
  ['short hash salt accepted', "hash_salt: get('SHARE_HASH_SALT').length >= MIN_SALT_LENGTH,", "hash_salt: get('SHARE_HASH_SALT') !== '',"],
  ['origin not checked', "if (!ALLOWED_ORIGINS.includes(origin)) return finish('forbidden_origin', '', '');", ''],
  ['database errors shown to the browser', "if (!res.ok) { log({ event: 'database', status: res.status }); return 'error'; }", 'if (!res.ok) return await res.text();'],
  ['secret key sent as a bearer token', "if (!config.serverKey.startsWith('sb_')) headers.Authorization", 'headers.Authorization'],
  ['oversized requests accepted', 'if (new TextEncoder().encode(text).length > MAX_BODY_BYTES)', 'if (false)'],
];

(async () => {
  const { rebuild } = await load('scripts/db-rebuild.mjs');
  const source = require('node:fs').readFileSync(path.join(root, HANDLER), 'utf8').replace(/\r\n/g, '\n');
  const checks = await suite(await load(HANDLER), rebuild);
  console.log(`share-card function: ${checks} checks passed`);
  for (const [label, find, replace] of SABOTAGE) {
    if (!source.includes(find)) throw new Error('Sabotage target not found: ' + label);
    const broken = await import('data:text/javascript,' + encodeURIComponent(source.replace(find, replace)));
    let caught = false;
    try { await suite(broken, rebuild); } catch { caught = true; }
    assert.ok(caught, 'the checks did not notice: ' + label);
    console.log('detects broken protection: ' + label);
  }
})().catch(error => { console.error(error); process.exit(1); });
