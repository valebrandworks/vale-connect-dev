// "Report this card": the page's rules, its security, and its behaviour on a small simulated page, with stand-ins for
// Turnstile and the report-card function. No network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const core=require(path.join(root,'report-core.js'));
const handlerSrc=read('supabase/functions/report-card/handler.mjs'),migration=read('supabase/migrations/20261114000000_add_card_reports.sql');

// ---------- Rules match the server ----------
const serverCategories=JSON.parse(handlerSrc.match(/export const CATEGORIES = Object\.freeze\((\[[^\]]+\])\)/)[1].replace(/'/g,'"'));
assert.deepEqual(core.CATEGORY_KEYS,serverCategories,'the same categories as the server function, in order');
const dbCategories=migration.match(/category text NOT NULL CHECK \(category IN \(([^)]+)\)\)/)[1].split(',').map(s=>s.trim().replace(/'/g,''));
assert.deepEqual(core.CATEGORY_KEYS,dbCategories,'and as the database');
assert.deepEqual(core.CATEGORIES.map(c=>c[1]),['Impersonation or fake identity','Scam or fraud','Spam','Harassment or hate','Sexual or violent content','Someone’s personal information','Copyright or trademark','Something else'],'the approved category names');
assert.equal(core.LIMITS.details,Number(handlerSrc.match(/MAX_DETAILS = (\d+)/)[1]));assert.equal(core.LIMITS.email,Number(handlerSrc.match(/MAX_EMAIL = (\d+)/)[1]));
const serverKeys=JSON.parse(handlerSrc.match(/const KEYS = Object\.freeze\((\[[^\]]+\])\)/)[1].replace(/'/g,'"'));
const sample=core.payload({slug:'ana-ruiz',submissionId:'s1',token:'t1',category:'spam',details:' Line one\r\nLine two\u0007 ',email:' a@example.invalid '});
assert.deepEqual(Object.keys(sample).sort(),[...serverKeys].sort(),'the page sends exactly the fields the server accepts');
assert.deepEqual(sample,{card:'ana-ruiz',submission_id:'s1',category:'spam',details:'Line one\nLine two',email:'a@example.invalid',attested:true,turnstile_token:'t1'},'text is cleaned, line breaks kept');
assert.equal(core.request(sample).headers.Authorization,undefined,'a report never sends a sign-in');
assert.deepEqual(core.check({category:'spam',attested:true}).errors,{},'a reason and the confirmation are enough');
assert.ok(core.check({attested:true}).errors.category,'a reason is required');assert.ok(core.check({category:'rude',attested:true}).errors.category,'only known reasons');
assert.ok(core.check({category:'spam'}).errors.attested,'the accuracy confirmation is required');
assert.ok(core.check({category:'spam',attested:'true'}).errors.attested,'only a real tick counts');
assert.ok(core.check({category:'spam',attested:true,details:'x'.repeat(1001)}).errors.details);assert.deepEqual(core.check({category:'spam',attested:true,details:'x'.repeat(1000)}).errors,{});
assert.ok(core.check({category:'spam',attested:true,email:'nope'}).errors.email);assert.deepEqual(core.check({category:'spam',attested:true,email:''}).errors,{},'email is optional');
for(const host of ['valebrandworks.github.io','evil.example','constructor','__proto__',''])assert.equal(core.siteKey(host),null,'no form on '+JSON.stringify(host));
for(const bad of ['Ana','a b','ab','-ana','ana-','x'.repeat(61),null,'../x'])assert.equal(core.slugOk(bad),false,'invalid card link refused: '+bad);
assert.equal(core.outcome('received').text,'Thanks. We’ve received your report and will review it.');
for(const status of ['received','invalid','verification_failed','too_large','network','error','not_configured','address_unavailable','forbidden_origin','limited','blocked','stored','merged','whatever']){
 const o=core.outcome(status);assert.ok(o.text);assert.doesNotMatch(o.text,/blocked|limit|already|merged|duplicate|owner|account/i,'no answer reveals what happened to the report: '+status);
}
assert.equal(core.counter('abc'),'3 / 1,000');

// ---------- Security: what the page code may and may not do ----------
const page=read('report.html'),ui=read('report.js'),coreSrc=read('report-core.js'),card=read('p.html');
assert.match(page,/client\.rpc\('get_public_card',\{card_slug:slug\}\)/,'the card comes only from the public lookup');
assert.match(page,/auth:\{persistSession:false,autoRefreshToken:false\}/,'the report page never uses or keeps a sign-in');
assert.match(page,/<meta name="referrer" content="no-referrer">/,'the report page sends no referrer');
assert.doesNotMatch(page+ui,/from\('|\.storage\b|getSession|access_token/,'no tables, storage or sign-in');
assert.doesNotMatch(ui,/\.rpc\(/,'the form calls no database functions');
assert.doesNotMatch(ui+coreSrc+page,/innerHTML|outerHTML|insertAdjacentHTML|document\.write/,'typed text is never treated as HTML');
assert.equal((ui.match(/fetch\(/g)||[]).length,1,'one network call');assert.match(ui,/fetch\(core\.FUNCTION_URL,core\.request\(/);
assert.equal(core.FUNCTION_URL,'https://jlprxnmdvoloahssjlnu.supabase.co/functions/v1/report-card','the development report function');
assert.match(ui,/'https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit'/);assert.match(ui,/action:'report-card'/,'the Turnstile action the server requires');
assert.doesNotMatch(ui+coreSrc+page,/sb_secret|service_role|TURNSTILE_SECRET|SHARE_HASH_SALT|re_[A-Za-z0-9]/,'no secrets in the page');
assert.match(page,/<script src="report-core\.js\?v=\d+"><\/script><script src="report\.js\?v=\d+"><\/script>/);
assert.match(card,/<span id="report-link-wrap" hidden> · <a id="report-link" href="report\.html">Report this card<\/a><\/span>/,'a discreet link in the card footer, hidden until the card loads');
assert.match(card,/\$\('report-link'\)\.href='report\.html\?u='\+encodeURIComponent\(slug\);\$\('report-link-wrap'\)\.hidden=false;/,'the link is shown only once a public card has loaded');
assert.ok(card.indexOf("$('report-link-wrap').hidden=false")>card.indexOf("if(!data){$('status').textContent='This card is not available.';return}"),'never for a card that isn\'t available');

// ---------- Behaviour, with a simulated page ----------
const SIMPLE=/^(\.[\w-]+|\[[\w-]+\]|[a-z][a-z0-9]*)$/;
class Node{
 constructor(tag){Object.assign(this,{tagName:tag.toUpperCase(),children:[],parent:null,attrs:{},dataset:{},className:'',_text:'',id:'',type:'',name:'',value:'',checked:false,disabled:false,required:false,maxLength:-1,autocomplete:'',inputMode:'',placeholder:'',rows:0,href:'',target:'',rel:'',noValidate:false,src:'',async:false,hidden:false,onclick:null,onchange:null,onsubmit:null,onload:null,onerror:null})}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('')}set textContent(v){this._text=String(v);this.children=[]}
 append(...nodes){for(const n of nodes){const node=typeof n==='string'?Object.assign(new Node('#text'),{_text:n}):n;if(node.parent)node.remove();node.parent=this;this.children.push(node)}}
 replaceChildren(...nodes){for(const c of this.children)c.parent=null;this.children=[];this.append(...nodes)}
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null}}
 get firstChild(){return this.children[0]||null}
 get isConnected(){let n=this;while(n.parent)n=n.parent;return n===doc.body||n===doc.head}
 setAttribute(k,v){this.attrs[k]=String(v);if(k==='id')this.id=String(v)}getAttribute(k){return k in this.attrs?this.attrs[k]:null}removeAttribute(k){delete this.attrs[k]}hasAttribute(k){return k in this.attrs}
 matches(sel){assert.match(sel,SIMPLE,'selector supported by the test page: '+sel);if(sel[0]==='.')return this.className.split(/\s+/).includes(sel.slice(1));if(sel[0]==='[')return this.hasAttribute(sel.slice(1,-1));return this.tagName===sel.toUpperCase()}
 querySelectorAll(sel){const out=[];const walk=n=>{for(const c of n.children){if(c.matches&&c.tagName!=='#TEXT'&&c.matches(sel))out.push(c);walk(c)}};walk(this);return out}
 querySelector(sel){return this.querySelectorAll(sel)[0]||null}
 closest(sel){let n=this;while(n&&n.tagName!=='#TEXT'){if(n.matches(sel))return n;n=n.parent}return null}
 focus(){doc.activeElement=this}
}
const doc={head:new Node('head'),body:new Node('body'),activeElement:null,createElement:t=>new Node(t),getElementById(id){const find=n=>{for(const c of n.children){if(c.id===id)return c;const f=find(c);if(f)return f}return null};return find(doc.body)}};
const all=sel=>doc.body.querySelectorAll(sel);
const field=id=>doc.getElementById(id);
const fetches=[],answers=[],turnstile={renders:[],resets:0,removes:0,render(el,o){this.renders.push(o);return 'w'+this.renders.length},reset(){this.resets++},remove(){this.removes++}};
const window={ValeReportCore:null,turnstile,crypto:globalThis.crypto};
const context={window,document:doc,location:{hostname:'dev.valebrandworks.com'},console,
 fetch:async(url,init)=>{fetches.push({url,init,body:JSON.parse(init.body)});const a=answers.shift();if(a==='throw')throw new TypeError('offline');return {json:async()=>({status:a})}}};
vm.createContext(context);vm.runInContext(coreSrc,context);vm.runInContext(ui,context);
const host=new Node('section');host.id='report';doc.body.append(host);
const settle=()=>new Promise(r=>setTimeout(r,0));

(async()=>{
 // Not offered on any other address (for example the production site), or for a bad card link.
 context.location.hostname='valebrandworks.github.io';window.ValeReport.mount('report',{slug:'ana-ruiz',card:{display_name:'Ana Ruiz'}});
 assert.equal(all('form').length,0,'no form on other addresses');assert.equal(turnstile.renders.length,0);
 context.location.hostname='dev.valebrandworks.com';window.ValeReport.mount('report',{slug:'Bad Slug',card:{display_name:'Ana Ruiz'}});assert.equal(all('form').length,0,'no form for an invalid card link');

 window.ValeReport.mount('report',{slug:'ana-ruiz',card:{display_name:'Ana Ruiz'}});await settle();
 const form=host.querySelector('form');assert.ok(form);assert.equal(form.getAttribute('aria-labelledby'),'report-title');
 assert.equal(doc.activeElement,host.querySelector('h1'),'focus moves to the heading');
 assert.match(host.textContent,/You’re reporting the card of Ana Ruiz\. The card’s owner is never told who reported it\./);
 assert.match(host.textContent,/If someone is in immediate danger, call 911/,'emergencies are pointed to the police first');
 assert.equal(fetches.length,0,'nothing is sent by itself');
 assert.equal(turnstile.renders.length,1);assert.equal(turnstile.renders[0].action,'report-card');assert.equal(turnstile.renders[0].sitekey,'0x4AAAAAAF5bZ3cludhKsLJJ');
 const radios=all('input').filter(i=>i.type==='radio');assert.deepEqual(radios.map(r=>r.value),core.CATEGORY_KEYS,'every approved reason is offered');assert.ok(radios.every(r=>!r.checked),'no reason is pre-selected');
 for(const input of [...all('input'),...all('textarea')]){if(input.type==='radio'||input.type==='checkbox')assert.ok(input.closest('label'),'wrapped in a label: '+input.id);else assert.ok(all('label').some(l=>l.getAttribute('for')===input.id),'labelled: '+input.id)}
 const attest=field('report-attest');assert.equal(attest.checked,false,'the confirmation is never pre-ticked');
 assert.equal(all('a').find(a=>a.textContent==='Privacy').href,'privacy.html');
 assert.equal(all('a').find(a=>a.textContent==='Back to the card').href,'p.html?u=ana-ruiz');
 // The copyright note appears only for that reason.
 const ipNote=all('p').find(p=>/copyright or trademark complaints/.test(p.textContent));assert.equal(ipNote.hidden,true);
 const ip=radios.find(r=>r.value==='ip');ip.checked=true;ip.onchange();assert.equal(ipNote.hidden,false);ip.checked=false;ip.onchange();assert.equal(ipNote.hidden,true);
 // The explanation counter.
 field('report-details').value='Hello';field('report-details').oninput();assert.equal(field('report-details-hint').textContent,'Optional. 5 / 1,000');

 const submit=()=>form.onsubmit({preventDefault(){}});
 field('report-details').value='';
 await submit();assert.equal(fetches.length,0,'not sent without a reason');assert.equal(field('report-category-error').textContent,'Choose what’s wrong with this card.');assert.equal(doc.activeElement,radios[0],'focus moves to the reasons');
 radios.find(r=>r.value==='scam').checked=true;
 field('report-email').value='not-an-email';await submit();assert.equal(fetches.length,0);assert.ok(field('report-email-error'),'a bad email is caught');assert.equal(doc.activeElement,field('report-email'));
 assert.equal(field('report-email').getAttribute('aria-describedby'),'report-email-hint report-email-error','the error is linked alongside the hint');
 field('report-email').value='';field('report-details').value='x'.repeat(1001);await submit();assert.equal(fetches.length,0);assert.ok(field('report-details-error'));
 field('report-details').value='They asked me for a deposit.';await submit();assert.equal(fetches.length,0,'not sent without the confirmation');assert.equal(field('report-attested-error').textContent,'Tick this box to confirm before sending.');
 assert.equal(field('report-details').getAttribute('aria-describedby'),'report-details-hint','fixing a problem restores the field\'s hint');
 attest.checked=true;await submit();assert.equal(fetches.length,0,'not sent without a Turnstile pass');assert.match(host.querySelector('.status').textContent,/security check/);
 turnstile.renders[0].callback('tok-1');
 answers.push('throw');await submit();assert.equal(fetches.length,1);assert.match(host.querySelector('.status').textContent,/Couldn’t send/);assert.equal(turnstile.resets,0,'the check is kept for a retry after a lost connection');
 answers.push('verification_failed');await submit();assert.equal(fetches[1].body.submission_id,fetches[0].body.submission_id,'a retry reuses the same submission ID, so nothing is stored twice');
 assert.equal(turnstile.resets,1,'after a failed check, a fresh one is needed');await submit();assert.equal(fetches.length,2,'not sent again until the new check passes');
 turnstile.renders[0].callback('tok-2');answers.push('not_configured');await submit();assert.match(host.querySelector('.status').textContent,/support@valebrandworks\.com/,'an outage points to the support email');
 turnstile.renders[0].callback('tok-3');answers.push('received');await submit();
 const sent=fetches.at(-1);
 assert.equal(sent.url,core.FUNCTION_URL);assert.equal(sent.init.headers.Authorization,undefined,'no sign-in is sent');
 assert.deepEqual(sent.body,{card:'ana-ruiz',submission_id:fetches[0].body.submission_id,category:'scam',details:'They asked me for a deposit.',email:'',attested:true,turnstile_token:'tok-3'});
 assert.equal(host.querySelector('h1').textContent,'Thanks. We’ve received your report and will review it.');assert.equal(doc.activeElement,host.querySelector('h1'),'focus moves to the confirmation');
 assert.equal(all('form').length,0);assert.equal(turnstile.removes,1,'the check is removed after sending');
 // A new visit gets a new submission ID.
 window.ValeReport.mount('report',{slug:'ana-ruiz',card:{display_name:'Ana Ruiz'}});await settle();
 radios.length;all('input').find(i=>i.value==='spam').checked=true;field('report-attest').checked=true;turnstile.renders.at(-1).callback('tok-4');answers.push('received');
 await host.querySelector('form').onsubmit({preventDefault(){}});assert.notEqual(fetches.at(-1).body.submission_id,fetches[0].body.submission_id,'a new report gets a new ID');
 console.log('PASS: report rules match the server and database (reasons, sizes, exact fields); every accepted report gets the same answer; page security (public lookup only, no sign-in, one call to the report function, no HTML injection, no secrets); link shown only on loaded public cards; behaviour (other sites refused, nothing automatic, reason, confirmation and Turnstile required, retry-safe IDs, fresh check after each answer); accessibility (labels, linked hints and errors, focus).');
})().catch(e=>{console.error(e);process.exit(1)});
