// Environment settings (config.js), their isolation, page security (content policy, script integrity, no inline code)
// and the production release builder. No network; nothing is written (the builder is checked in memory).
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const config=require(path.join(root,'config.js'));
const P={url:'https://uhribjaiyuwivzqxusur.supabase.co',key:'sb_publishable_Va2YN7LUG0ZOuwril533WA__PUz_PL_',turnstile:'0x4AAAAAAGMQcyUJYuAxhLXp'};
const D={url:'https://jlprxnmdvoloahssjlnu.supabase.co',key:'sb_publishable_wxT0A5bByFX67J1ut0F-ZA_xITdxwf_',turnstile:'0x4AAAAAAF5bZ3cludhKsLJJ'};
const TEST_KEY='1x00000000000000000000AA';

// ---------- config.js: one environment per exact address ----------
const prod=config.forHost('connect.valebrandworks.com'),dev=config.forHost('dev.valebrandworks.com'),local=config.forHost('localhost');
assert.deepEqual([prod.name,prod.supabaseUrl,prod.publishableKey,prod.turnstileSiteKey,prod.functionsUrl,prod.label],['production',P.url,P.key,P.turnstile,P.url+'/functions/v1',''],'production settings');
assert.deepEqual([dev.name,dev.supabaseUrl,dev.publishableKey,dev.turnstileSiteKey,dev.label],['development',D.url,D.key,D.turnstile,'Development'],'development settings');
assert.deepEqual([local.name,local.supabaseUrl,local.turnstileSiteKey,config.forHost('127.0.0.1').name],['local',D.url,TEST_KEY,'local'],'this computer: development project, Cloudflare test key only');
for(const h of ['valebrandworks.github.io','evil.example','connect.valebrandworks.com.evil.example','evil-connect.valebrandworks.com','CONNECT.valebrandworks.com','constructor','__proto__','toString','',null,undefined,42])
 assert.equal(config.forHost(h),null,'no settings for '+JSON.stringify(h));
assert.notEqual(prod.supabaseUrl,dev.supabaseUrl);assert.notEqual(prod.publishableKey,dev.publishableKey);assert.notEqual(prod.turnstileSiteKey,dev.turnstileSiteKey);
assert.notEqual(prod.storagePrefix,dev.storagePrefix,'production and development browser storage never share names');
assert.ok(!prod.storagePrefix.includes('dev')&&dev.storagePrefix.startsWith(prod.storagePrefix),'production storage has no development wording');
assert.ok(Object.isFrozen(prod)&&Object.isFrozen(config.ENVIRONMENTS)&&Object.isFrozen(config.HOSTS),'settings can\'t be changed by other scripts');
assert.equal(config.functionUrl('connect.valebrandworks.com','share-card'),P.url+'/functions/v1/share-card');assert.equal(config.functionUrl('evil.example','share-card'),null);
// Public values only: no secret-looking value anywhere in the settings.
assert.doesNotMatch(read('config.js'),/sb_secret|service_role|eyJ[A-Za-z0-9_-]{10,}\.|secret[_-]?key\s*[:=]|re_[A-Za-z0-9]{8}|SHARE_HASH_SALT|TURNSTILE_SECRET/,'config.js holds no secrets');
assert.match(read('config.js'),/NOT a security boundary/,'config.js says plainly that it is not a security boundary');

// ---------- No project values written in anywhere else ----------
const siteFiles=fs.readdirSync(root).filter(f=>/\.(html|js|webmanifest)$/.test(f)&&f!=='config.js');
const stripCsp=t=>t.replace(/<meta http-equiv="Content-Security-Policy" content="[^"]*">/,'');
for(const f of siteFiles){
 const text=stripCsp(read(f));
 for(const v of [P.url,D.url,P.key,D.key,P.turnstile,D.turnstile,TEST_KEY,'uhribjaiyuwivzqxusur','jlprxnmdvoloahssjlnu'])assert.ok(!text.includes(v),`${f} has a written-in project value (${v.slice(0,20)}…); it must come from config.js`);
}
for(const f of ['index.html','p.html','report.html','admin.html']){
 const t=read(f),i=t.indexOf('<script src="config.js?v=');
 assert.ok(i>0&&i===t.indexOf('<script'),f+' loads config.js before any other script');
}

// ---------- Browser storage: production and development never share names ----------
function storageKeys(host){
 const ctx={window:{},location:{hostname:host},document:{getElementById:()=>null}};ctx.window.location=ctx.location;ctx.window.document=ctx.document;vm.createContext(ctx);
 for(const f of ['config.js','connections-core.js','import-local.js'])vm.runInContext(read(f),ctx);
 return [ctx.window.ValeConnections.KEY,ctx.window.ValeImport.CARD_KEY];
}
const devKeys=storageKeys('dev.valebrandworks.com'),prodKeys=storageKeys('connect.valebrandworks.com');
assert.ok(devKeys.length>=1&&devKeys.every(k=>k.startsWith('vale-connect-dev-')),'development keys: '+devKeys);
assert.ok(prodKeys.length===devKeys.length&&prodKeys.every(k=>k.startsWith('vale-connect-')&&!k.includes('dev')),'production keys: '+prodKeys);
assert.ok(prodKeys.every(k=>!devKeys.includes(k)),'no shared storage names');

// ---------- Pages: content security policy, script integrity, no inline code ----------
const SRI='integrity="sha384-TcHRA3zBbn+Lexh5n+Oil4guNPOS3rjNDpGRAN46u/s/mB2IZ50ceC6TYDU2yvgK" crossorigin="anonymous"';
for(const f of ['index.html','p.html','report.html','admin.html','privacy.html','offline.html']){
 const t=read(f),m=t.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
 assert.ok(m,f+' has a content security policy');const csp=m[1];
 for(const rule of ["default-src 'none'","base-uri 'none'","form-action 'none'"])assert.ok(csp.includes(rule),f+': '+rule);
 const scriptSrc=(csp.match(/script-src ([^;]+)/)||[])[1]||'';
 assert.doesNotMatch(scriptSrc,/unsafe-inline|unsafe-eval|\*|data:|blob:/,f+': scripts only from listed places, never inline or evaluated');
 assert.doesNotMatch(csp,/https:\/\/\*|\s\*\s|\s\*;/,f+': no wildcard sources');
 assert.doesNotMatch(t,/<script>|<script(?![^>]*\bsrc=)[^>]*>/,f+': no inline script');
 assert.doesNotMatch(t,/\son[a-z]+="/i,f+': no inline event handlers');
 for(const tag of t.match(/<script src="https:[^>]*>/g)||[])assert.ok(tag.includes(SRI)&&tag.includes('supabase-js@2.118.0'),f+': the outside library is pinned and integrity-checked');
}
assert.match(read('p.html'),/A product of VALE Brandworks LLC|a product of VALE Brandworks LLC/);assert.match(read('index.html'),/A product of VALE Brandworks LLC/);
assert.match(read('report.html'),/a product of VALE Brandworks LLC/);assert.match(read('privacy.html'),/A product of VALE Brandworks LLC/);
assert.match(read('index.html'),/<meta name="robots" content="noindex">/,'the app is kept out of search engines until launch');

// ---------- Release builder (in memory) ----------
(async()=>{
 const b=await import(pathToFileURL(path.join(root,'scripts','build-release.mjs')).href);
 const files=b.bundle(),names=[...files.keys()];
 for(const n of names)assert.doesNotMatch(n,/^(tests|scripts|supabase|docs|node_modules|release)\/|^package|^README|^\.|\.cjs$|\.mjs$|\.sql$|\.md$/,'only site files are bundled: '+n);
 for(const need of ['index.html','p.html','report.html','admin.html','config.js','card-page.js','report-page.js','offline.js','sw.js','manifest.webmanifest','CNAME','robots.txt','assets/icons/icon-192.png'])assert.ok(files.has(need),'bundled: '+need);
 assert.equal(files.get('CNAME').toString(),'connect.valebrandworks.com\n');assert.equal(files.get('robots.txt').toString(),'User-agent: *\nDisallow: /\n','search engines kept out until launch');
 // Cloudflare Pages response headers: exact content, HSTS scoped to this host only, no clash with the pages' own policy.
 assert.ok(files.has('_headers'),'the bundle carries the security headers');
 const H=files.get('_headers').toString('utf8');
 assert.equal(H,b.HEADERS);
 assert.deepEqual(H.trimEnd().split('\n'),['/*','  Strict-Transport-Security: max-age=86400','  X-Frame-Options: DENY',"  Content-Security-Policy: frame-ancestors 'none'",'  X-Content-Type-Options: nosniff','  Referrer-Policy: strict-origin-when-cross-origin','  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()','  X-Robots-Tag: noindex, nofollow'],'the approved headers, in order');
 assert.doesNotMatch(H,/includeSubDomains|preload/i,'HSTS covers this host only and is not preloaded');
 assert.equal(H.match(/Content-Security-Policy:.*/g).length,1);assert.doesNotMatch(H,/script-src|connect-src|frame-src|default-src/,'the header adds only frame-ancestors, so Supabase and Turnstile rules stay in each page');
 assert.match(H,/X-Robots-Tag: noindex/,'search engines kept out until launch');
 // A real 404 page: Cloudflare Pages answers unknown paths with the home page and 200 unless a top-level 404.html exists.
 assert.ok(files.has('404.html'),'the bundle carries 404.html');
 const NF=files.get('404.html').toString('utf8');
 assert.equal(NF,b.NOT_FOUND_PAGE);
 assert.match(NF,/<title>Page not found<\/title>/);assert.match(NF,/<h1>Page not found<\/h1>/);
 assert.match(NF,/<meta name="robots" content="noindex,nofollow">/,'the 404 page is kept out of search results');
 assert.doesNotMatch(NF,/<script|\son[a-z]+=|<link|<img|<iframe|src=|javascript:/i,'the 404 page has no script, styles, images or frames');
 assert.match(NF,/default-src 'none'/,'the 404 page has its own strict policy');
 assert.deepEqual([...NF.matchAll(/href="([^"]*)"/g)].map(m=>m[1]),['/'],'its only link is the home page');
 assert.doesNotMatch(NF,/supabase|turnstile|publishable|sb_|0x4|localhost|dev\./i,'no service addresses, keys or development information');
 for(const bad of b.FORBIDDEN)assert.ok(!NF.includes(bad),'404.html keeps a development value: '+bad);
 assert.equal(files.get('_headers').toString('utf8'),b.HEADERS,'the security headers are unchanged by the 404 page');
 for(const bad of b.FORBIDDEN)assert.ok(!H.includes(bad),'_headers keeps a development value: '+bad);
 for(const [n,bytes] of files)if(/\.(html|js|webmanifest|txt)$/.test(n)){const t=bytes.toString('utf8');for(const bad of b.FORBIDDEN)assert.ok(!t.includes(bad),`${n} keeps a development value: ${bad}`)}
 // The bundled settings know production only.
 const ctx={};vm.createContext(ctx);vm.runInContext(files.get('config.js').toString(),ctx);
 assert.deepEqual([Object.keys(ctx.ValeConfig.HOSTS),Object.keys(ctx.ValeConfig.ENVIRONMENTS),ctx.ValeConfig.forHost('connect.valebrandworks.com').supabaseUrl,ctx.ValeConfig.forHost('dev.valebrandworks.com'),ctx.ValeConfig.forHost('localhost')],
  [['connect.valebrandworks.com'],['production'],P.url,null,null],'the production bundle\'s settings know production only');
 for(const f of ['index.html','p.html','report.html','admin.html'])assert.match(files.get(f).toString(),new RegExp('connect-src[^;"]*'+P.url.replace(/\./g,'\\.')),f+': the security policy allows the production project');
 assert.match(files.get('index.html').toString(),/<title>VALE Connect<\/title>/);assert.doesNotMatch(files.get('index.html').toString(),/class="env"/,'no development banner');
 assert.match(files.get('sw.js').toString(),/const CACHE_PREFIX='vale-connect-pwa-';/);assert.match(files.get('manifest.webmanifest').toString(),/"name": "VALE Connect"/);
 // Refusals.
 assert.throws(()=>b.check('x.js','const u="'+D.url+'";'),/development value remains/,'a development address refuses the build');
 assert.throws(()=>b.check('x.js','key '+TEST_KEY),/development value remains/,'the Cloudflare test key refuses the build');
 assert.throws(()=>b.transform('index.html','<title>Other</title>'),/expected text not found/,'a missing replacement refuses the build');
 assert.throws(()=>b.transform('x.js','/* dev-only:start */ a'),/unbalanced/,'an unclosed development block refuses the build');
 assert.equal(b.transform('x.js','a/* dev-only:start */\nsecret dev\n/* dev-only:end */\nb'),'ab','development blocks are removed');
 console.log(`environments: settings, isolation, page security and the release builder checked (${names.length} files in the production bundle)`);
})().catch(e=>{console.error(e);process.exit(1)});
