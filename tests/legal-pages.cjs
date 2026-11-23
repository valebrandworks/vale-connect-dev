// The Terms of Service and Privacy Policy pages: they ship no review flags or placeholders, agree with each other and with the product (retention periods
// are read from the database files), make no claim the product can't back up, and are reachable before an account exists. No network.
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const text = f => read(f).replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<tr>/g, ' | ').replace(/<\/t[dh]>/g, ' | ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
const terms = text('terms.html'), privacy = text('privacy.html');

// ---------- Nothing unfinished is published ----------
for (const [name, t] of [['terms.html', terms], ['privacy.html', privacy]]) {
  assert.doesNotMatch(t, /\[[^\]]{0,80}\]/, name + ': no square-bracket placeholder');
  assert.doesNotMatch(t, /attorney|\bTODO\b|NOT PUBLISHED|\(draft|revision \d|lorem/i, name + ': no review flag or draft marker');
  assert.doesNotMatch(read(name), /Development|development|localhost|jlprxnmdvoloahssjlnu|<script/, name + ': no development text and no script');
  assert.match(t, /Effective date: [A-Z][a-z]+ \d{1,2}, 20\d\d/, name + ': an effective date');
  assert.match(read(name), /A product of VALE Brandworks LLC/, name + ': names the company');
  assert.match(read(name), /href="terms\.html"[\s\S]*href="privacy\.html"/, name + ': links to the other legal page');
}

// ---------- Terms: the approved decisions, and nothing the product doesn't do ----------
assert.match(terms, /at least 18, live in the United States/, 'Terms: 18+ and US residency preserved');
assert.match(terms, /State of Indiana/);assert.match(terms, /Elkhart County/);assert.match(terms, /no arbitration clause and no class-action waiver/);
assert.match(terms, /greater of US\$50 or the amount you paid us for VALE Connect in the 12 months/, 'the liability cap is kept');
assert.match(terms, /support@valebrandworks\.com/);
assert.doesNotMatch(terms, /designated agent|Digital Millennium Copyright Act|DMCA/i, 'no claim of a registered copyright agent');
assert.match(terms, /To report a copyright concern, email support@valebrandworks\.com/, 'copyright concerns have a route that does not depend on an agent');
assert.doesNotMatch(terms, /at least 7 days|never confirmed|delete an account that was never/i, 'no automatic cleanup of unconfirmed accounts is announced');
assert.doesNotMatch(terms + privacy, /renewed acceptance|ask you to accept it before you continue|accept (it|them) before you continue/i, 'no renewed-acceptance workflow is claimed');
assert.match(terms, /If you keep using VALE Connect after a change takes effect, you accept the changed Terms/, 'how changes take effect, without a mechanism that does not exist');
assert.match(terms, /Backups are overwritten within about 7 days/);assert.match(terms, /at least 14 days/);
assert.match(terms, /Report this card/, 'the live report process is described');

// ---------- Privacy: accurate about processing, cookies and cleanup ----------
assert.match(privacy, /stored in our database in the United States/);assert.match(privacy, /may be handled in other countries/, 'not "everything stays in the United States"');
assert.doesNotMatch(privacy, /stored and processed in the United States|sets no cookies|uses no cookies|no cookies, analytics or tracking/i, 'no absolute claims about processing location or cookies');
assert.match(privacy, /does not set advertising or tracking cookies and has no advertising or analytics services/);
assert.match(privacy, /may use cookies or similar technologies for their own security and operation/, 'third-party security technologies are not promised away');
assert.match(privacy, /every day/);assert.match(privacy, /whenever sharing is used or you open your notifications/, 'how the sharing cleanup really runs');
assert.match(privacy, /Daily backups kept for 7 days/);assert.match(privacy, /at least 14 days/);assert.match(privacy, /privacy@valebrandworks\.com/);
assert.match(privacy, /18 or older/);assert.match(privacy, /United States/);
assert.match(privacy, /Indiana.s Consumer Data Protection Act, may also give you these rights/, 'voluntary rights, with the law named as a possibility, not a claim');
assert.match(privacy, /Cloudflare[\s\S]*Resend[\s\S]*Supabase|Supabase[\s\S]*Resend[\s\S]*Cloudflare/, 'the providers are named');
assert.match(privacy, /report[^.]*kept for the period in section 5 even after you delete your account/i, 'deleted accounts and report records agree with the Terms');
assert.match(terms, /our record of that report and our decision[^.]*kept for the period in the Privacy Policy even after you delete your account/);

// ---------- Retention periods in the policy equal the ones the database enforces ----------
const shareDb = read('supabase/migrations/20261109020000_add_reciprocal_sharing.sql'), reportDb = read('supabase/migrations/20261114000000_add_card_reports.sql'), authDb = read('supabase/migrations/20261123000000_add_auth_hardening.sql');
const num = (src, name) => { const m = src.match(new RegExp("\\('" + name + "',\\s*(\\d+)\\)")); assert.ok(m, 'setting found: ' + name); return m[1]; };
assert.match(privacy, new RegExp('\\| A share that matched someone you already had \\| ' + num(shareDb, 'duplicate_days') + ' days'));
assert.match(privacy, new RegExp('\\| A share that arrived while you were at your plan.s limit \\| ' + num(shareDb, 'limit_reached_days') + ' days'));
assert.match(privacy, new RegExp('Notifications \\| ' + num(shareDb, 'read_notification_days') + ' days after they.re read, or 1 year if unread'));
assert.equal(num(shareDb, 'unread_notification_days'), '365');
assert.match(privacy, new RegExp('Scrambled codes for sharing \\| ' + num(shareDb, 'attempt_hours') + ' hours'));
assert.match(privacy, new RegExp('Reports we dismissed \\| ' + num(reportDb, 'dismissed_days') + ' days'));
assert.match(privacy, new RegExp('Reports we acted on[^|]*\\| 12 months'));assert.equal(num(reportDb, 'actioned_days'), '365');assert.equal(num(reportDb, 'action_log_days'), '365');assert.equal(num(reportDb, 'block_days'), '365');
assert.match(privacy, new RegExp('Scrambled codes for reports \\| ' + num(reportDb, 'attempt_days') + ' days'));
assert.match(authDb, /interval '90 days'/);assert.match(privacy, /Refused-provider screening log \(domain only\) \| 90 days/);
assert.match(authDb, /current_date - 400/);assert.match(privacy, /Daily statistics \(counts only\) \| About 13 months/);
// The cleanup jobs the policy describes exist: a daily job for reports, one for the screening log and statistics.
assert.match(reportDb, /cron\.schedule\('vale-report-cleanup'/);assert.match(authDb, /cron\.schedule\('vale-auth-daily-stats'/);
assert.match(shareDb, /PERFORM public\.purge_share_history\(NULL\)/, 'sharing records are cleaned when sharing runs');

// ---------- Reachable before an account exists ----------
const index = read('index.html');
assert.match(index, /<p class="footer">[^<]*<a href="terms\.html">Terms<\/a> · <a href="privacy\.html">Privacy<\/a>/, 'the app page footer links both documents (no sign-in needed)');
assert.match(index, /id="cloud-agree-text">I.m 18 or older and live in the United States\. I agree to the <a href="terms\.html"[^>]*>Terms of Service<\/a> and have read the <a href="privacy\.html"[^>]*>Privacy Policy<\/a>\./, 'the sign-up acknowledgement links both');
assert.match(read('p.html'), /<a href="terms\.html">Terms<\/a> · <a href="privacy\.html">Privacy<\/a>/, 'public card pages link both');
assert.match(read('report.html'), /<a href="terms\.html">Terms<\/a> · <a href="privacy\.html">Privacy<\/a>/, 'the report page links both');
assert.doesNotMatch(read('sw.js'), /terms\.html|privacy\.html/, 'nothing to precache: the pages load from the network like the rest of the site');
console.log('PASS: legal pages (no placeholders or review flags; approved Terms decisions preserved; no copyright-agent or renewed-acceptance claim; privacy statements accurate about processing, cookies and cleanup; retention periods equal the database files; both documents linked before sign-up)');
