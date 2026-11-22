// Builds the production website bundle from this repository. Changes nothing outside the output folder.
//   node scripts/build-release.mjs [outDir]     (default: release/production)
// The bundle holds only the site's files (no tests, scripts, database files, docs or packages). Development-only parts
// (between /* dev-only:start */ and /* dev-only:end */, and the replacements below) are removed or swapped for production
// values. The build REFUSES to finish if any development address, key, label or Cloudflare test key would remain, or if a
// production value is missing. It never reads or writes secrets: every value it handles is public by design.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const config = require(path.join(repo, 'config.js'));
const prod = config.ENVIRONMENTS.production, dev = config.ENVIRONMENTS.development, local = config.ENVIRONMENTS.local;
export const DOMAIN = 'connect.valebrandworks.com';

// Site files only: pages, scripts, styles, the app manifest, images and the QR library's licence.
const SITE = name => /\.(html|js|css|webmanifest)$/.test(name);
const EXTRA = ['QR_LICENSE.txt'];
export function siteFiles() {
  const top = fs.readdirSync(repo, { withFileTypes: true }).filter(e => e.isFile() && (SITE(e.name) || EXTRA.includes(e.name))).map(e => e.name);
  const walk = dir => fs.readdirSync(path.join(repo, dir), { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name).split(path.sep).join('/')]);
  return [...top, ...walk('assets')].sort();
}

// Response headers for Cloudflare Pages (its `_headers` file), applied to every page of the production site.
// - HSTS: one day to start (raise only after launch checks), for this exact host only: no includeSubDomains, no preload.
// - frame-ancestors / X-Frame-Options stop other websites from framing the site. The page's own policy (a meta tag in each
//   page, which allows Supabase and Turnstile) is not repeated here, so the two never conflict.
// - X-Robots-Tag keeps search engines out until launch, in addition to robots.txt and each page's robots tag. REMOVE THIS
//   LINE AT LAUNCH (a reviewed change) once the site is meant to be indexed.
export const HEADERS = [
  '/*',
  '  Strict-Transport-Security: max-age=86400',
  '  X-Frame-Options: DENY',
  "  Content-Security-Policy: frame-ancestors 'none'",
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()',
  '  X-Robots-Tag: noindex, nofollow',
  '',
].join('\n');

// Cloudflare Pages treats a site with no top-level 404.html as a single-page app and answers every unknown path with the home
// page and HTTP 200. This page makes unknown paths a real 404. Static: no script, no styles, no links to other files (it is
// served at whatever path was asked for), its own strict policy, and kept out of search results.
export const NOT_FOUND_PAGE = [
  '<!doctype html>',
  '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
  '<meta name="robots" content="noindex,nofollow">',
  `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; base-uri 'none'; form-action 'none'">`,
  '<title>Page not found</title></head>',
  '<body><h1>Page not found</h1><p>This page does not exist.</p><p><a href="/">VALE Connect home</a></p></body></html>',
  '',
].join('\n');

// Exact replacements, each of which must match (a missed one fails the build instead of shipping development text).
const REPLACE = {
  'index.html': [['<title>VALE Connect — Development</title>', '<title>VALE Connect</title>'], ['content="VALE Dev"', 'content="VALE Connect"'],
    [/<span class="env" title="Development build \d+">DEVELOPMENT<\/span>/, '']],
  'p.html': [['content="VALE Dev"', 'content="VALE Connect"']],
  'offline.html': [['VALE Connect Development — Offline', 'VALE Connect — Offline'], ['alt="VALE Connect development app"', 'alt="VALE Connect app"'],
    [/VALE Connect · Development · Build \d+/, 'VALE Connect']],
  'privacy.html': [['Development draft.', 'Draft.']],
  'manifest.webmanifest': [['"name": "VALE Connect Development"', '"name": "VALE Connect"'], ['"short_name": "VALE Dev"', '"short_name": "VALE Connect"'],
    ['"description": "VALE Connect development app: profiles, cards and professional connections."', '"description": "VALE Connect: digital business cards and professional connections. A product of VALE Brandworks LLC."']],
  'sw.js': [['/* Development scope only. Cache', '/* Cache'], ["const CACHE_PREFIX='vale-connect-dev-pwa-';", "const CACHE_PREFIX='vale-connect-pwa-';"],
    ["const RETIRED_SCOPE_PATH='/vale-connect-dev/';", 'const RETIRED_SCOPE_PATH=null;']],
  'connections-core.js': [["||'vale-connect-dev-';", "||'" + prod.storagePrefix + "';"]],
  'import-local.js': [["||'vale-connect-dev-';", "||'" + prod.storagePrefix + "';"]],
};

// Anything here in the output fails the build.
export const FORBIDDEN = [dev.supabaseUrl, dev.publishableKey, dev.turnstileSiteKey, local.turnstileSiteKey, 'jlprxnmdvoloahssjlnu', 'dev.valebrandworks.com',
  'localhost', '127.0.0.1', 'vale-connect-dev', 'DEVELOPMENT', 'Development', 'VALE Dev', 'dev-only', 'sb_secret_', 'service_role', 'SUPABASE_SERVICE'];

/** @param {string} name @param {string} text */
export function transform(name, text) {
  let out = text.replace(/\/\* dev-only:start \*\/[\s\S]*?\/\* dev-only:end \*\/\n?/g, '');
  if (/dev-only:/.test(out)) throw new Error(`${name}: unbalanced dev-only markers`);
  // Pages that talk to the project name it in their security policy; pages that don't (offline, privacy) have none.
  if (name.endsWith('.html')) out = out.split(dev.supabaseUrl).join(prod.supabaseUrl);
  for (const [from, to] of REPLACE[name] || []) {
    const count = typeof from === 'string' ? out.split(from).length - 1 : (out.match(new RegExp(from.source, 'g')) || []).length;
    if (count === 0) throw new Error(`${name}: expected text not found: ${from}`);
    if (typeof from !== 'string' && count !== 1) throw new Error(`${name}: ${from} matched ${count} times`);
    out = typeof from === 'string' ? out.split(from).join(to) : out.replace(from, to);
  }
  return out;
}

/** @param {string} name @param {string} text */
export function check(name, text) {
  for (const bad of FORBIDDEN) if (text.includes(bad)) throw new Error(`${name}: development value remains: ${bad}`);
  return text;
}

// The whole bundle in memory: published name -> bytes. Reads only; writes nothing.
export function bundle() {
  if (!prod.turnstileSiteKey || !/^0x4[A-Za-z0-9_-]{10,}$/.test(prod.turnstileSiteKey)) throw new Error('The production Turnstile site key is missing.');
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(prod.supabaseUrl) || !/^sb_publishable_/.test(prod.publishableKey)) throw new Error('Production project settings are missing.');
  const out = new Map();
  for (const name of siteFiles()) {
    const bytes = fs.readFileSync(path.join(repo, name));
    out.set(name, /\.(html|js|css|webmanifest|txt)$/.test(name) ? Buffer.from(check(name, transform(name, bytes.toString('utf8'))), 'utf8') : bytes);
  }
  // The custom domain (kept for a GitHub Pages fallback; Cloudflare Pages ignores it), the security headers, and search engines kept out until launch.
  out.set('CNAME', Buffer.from(DOMAIN + '\n'));
  out.set('robots.txt', Buffer.from('User-agent: *\nDisallow: /\n'));
  out.set('_headers', Buffer.from(check('_headers', HEADERS), 'utf8'));
  out.set('404.html', Buffer.from(check('404.html', NOT_FOUND_PAGE), 'utf8'));
  const cfg = out.get('config.js').toString('utf8');
  for (const need of [prod.supabaseUrl, prod.publishableKey, prod.turnstileSiteKey, DOMAIN]) if (!cfg.includes(need)) throw new Error('config.js lacks a production value');
  return out;
}

// Writes the bundle and a checksum record (the source commit, and whether the working folder was clean).
export function build(target) {
  const files = bundle(), manifest = [];
  fs.rmSync(target, { recursive: true, force: true });
  for (const [name, bytes] of files) {
    const dst = path.join(target, name);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, bytes);
    manifest.push(`${crypto.createHash('sha256').update(bytes).digest('hex')}  ${name}`);
  }
  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).stdout.trim();
  const clean = spawnSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).stdout.trim() === '';
  manifest.sort((a, b) => a.slice(66).localeCompare(b.slice(66)));
  const record = `VALE Connect production bundle\nsource commit: ${commit}${clean ? '' : ' (WORKING FOLDER HAD UNCOMMITTED CHANGES: not for release)'}\nfiles: ${manifest.length}\n\n${manifest.join('\n')}\n`;
  fs.writeFileSync(target + '.sha256.txt', record);
  return { files: manifest.length, commit, clean, record: target + '.sha256.txt' };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const target = path.resolve(process.argv[2] || path.join(repo, 'release', 'production'));
  const r = build(target);
  console.log(`built ${r.files} files into ${path.relative(repo, target)} from ${r.commit.slice(0, 7)}${r.clean ? '' : ' (uncommitted changes: not for release)'}; checksums: ${path.relative(repo, r.record)}`);
}
