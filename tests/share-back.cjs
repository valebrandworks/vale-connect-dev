// "Share your details back" on the public card page: rules, behaviour, security and accessibility.
// Runs share-back-core.js and share-back.js against a small simulated page, with stand-ins for Turnstile, the
// share-card function and the account reader. No network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const core=require(path.join(root,'share-back-core.js'));

// ---------- Rules ----------
assert.equal(core.siteKey('dev.valebrandworks.com'),'0x4AAAAAAF5bZ3cludhKsLJJ','the development site uses its own Turnstile widget');
assert.equal(core.siteKey('localhost'),'1x00000000000000000000AA','this computer uses Cloudflare\'s test key, which the server never accepts');
for(const host of ['valebrandworks.github.io','evil.example','constructor','__proto__',''])assert.equal(core.siteKey(host),null,'no form on '+JSON.stringify(host));
assert.equal(core.consentText('Ana Ruiz'),'By sharing, I agree to send my selected contact information to Ana Ruiz, who can save it in their private VALE Connect connections.','the approved consent wording, with the owner\'s name');
assert.equal(core.CONSENT_VERSION,'2026-11-v1');
let r=core.checkVisitor({full_name:'  Sam Lee ',email:'sam@example.invalid'});assert.deepEqual([r.fields,r.errors],[{full_name:'Sam Lee',email:'sam@example.invalid'},{}]);
assert.ok(core.checkVisitor({email:'a@example.invalid'}).errors.full_name,'a name is required');
assert.ok(core.checkVisitor({full_name:'Sam'}).errors.email,'an email or a phone is required');
assert.deepEqual(core.checkVisitor({full_name:'Sam',phone:'+1 (555) 010-0199'}).errors,{},'a phone alone is enough');
assert.ok(core.checkVisitor({full_name:'Sam',email:'not-an-email'}).errors.email);
assert.ok(core.checkVisitor({full_name:'Sam',phone:'12-34'}).errors.phone);
assert.ok(core.checkVisitor({full_name:'S'.repeat(91),email:'a@example.invalid'}).errors.full_name,'server limits are mirrored');
assert.equal(core.checkVisitor({full_name:'Sam\u0000\u0007 Lee',email:'a@example.invalid'}).fields.full_name,'Sam   Lee','control characters are removed');
const own={id:'c-own',display_name:'Member Person',job_title:'',business_name:'Co',public_email:'m@example.invalid',public_phone:'',website:'',social_links:'a\nb\n',introduction:'private-ish intro'};
assert.deepEqual(core.memberOptions(own).map(o=>o.key),['full_name','business_name','email','social_links'],'only filled-in fields are offered, and never the introduction');
assert.ok(core.checkMember(['email']),'the name is always shared');assert.ok(core.checkMember(['full_name','business_name']),'an email or phone must be ticked');assert.equal(core.checkMember(['full_name','phone']),'');
const vp=core.payload({mode:'visitor',slug:'ana',submissionId:'s1',token:'t1',fields:{full_name:'Sam',email:'a@example.invalid'},note:' hi '});
assert.deepEqual(vp,{mode:'visitor',card:'ana',submission_id:'s1',consent:true,consent_version:'2026-11-v1',turnstile_token:'t1',note:'hi',fields:{full_name:'Sam',email:'a@example.invalid'}});
const mp=core.payload({mode:'member',slug:'ana',submissionId:'s2',token:'t2',cardId:'c-own',memberFields:['full_name','email'],note:''});
assert.deepEqual(Object.keys(mp).sort(),['card','card_id','consent','consent_version','member_fields','mode','note','submission_id','turnstile_token'],'a member share sends field names only, never values');
assert.equal(core.request(vp,'member.jwt').headers.Authorization,undefined,'a visitor share never sends a sign-in, even if one exists');
assert.equal(core.request(mp,'member.jwt').headers.Authorization,'Bearer member.jwt');
for(const status of ['shared','invalid','verification_failed','rate_limited','unavailable','sign_in_required','network','error','not_configured','address_unavailable','forbidden_origin','too_large','whatever']){
 const o=core.outcome(status,'Ana Ruiz');assert.ok(o.text);assert.doesNotMatch(o.text,/already|duplicate|connection(s)? (of|limit)|limit reached|their account|email address of/i,'no answer reveals anything about the owner\'s account: '+status);
}
assert.equal(core.outcome('shared','Ana Ruiz').text,'Your details were sent to Ana.');
assert.match(core.markerValue(new Date('2026-11-09T10:00:00Z')),/^2026-11-09$/,'the device marker holds only a date');

// ---------- Security: what the page code may and may not do ----------
const page=read('p.html'),ui=read('share-back.js'),coreSrc=read('share-back-core.js');
assert.match(page,/client\.rpc\('get_public_card'/);assert.doesNotMatch(page+ui,/from\('public_cards'\)/,'the card being viewed comes only from the public lookup');
assert.doesNotMatch(ui,/\.from\(|\.rpc\(|\.storage\b/,'the form never reads or writes tables, functions or storage directly');
assert.match(ui,/window\.ValeAccountLists\.read\(client,'public_cards',owner,/,'a member\'s own cards come only from the owner-only reader');
assert.doesNotMatch(ui+coreSrc,/innerHTML|outerHTML|insertAdjacentHTML|document\.write/,'typed text is never treated as HTML');
assert.equal((ui.match(/fetch\(/g)||[]).length,1,'one network call');assert.match(ui,/fetch\(core\.FUNCTION_URL,core\.request\(/);
assert.equal(core.FUNCTION_URL,'https://jlprxnmdvoloahssjlnu.supabase.co/functions/v1/share-card','the development share function');
assert.match(ui,/'https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit'/);assert.match(ui,/action:'share-card'/,'the Turnstile action the server requires');
assert.doesNotMatch(ui+coreSrc,/sb_secret|service_role|TURNSTILE_SECRET|SHARE_HASH_SALT/,'no secrets in the page');
assert.match(page,/<script src="share-back-core\.js\?v=\d+"><\/script><script src="share-back\.js\?v=\d+"><\/script>/);
assert.match(page,/accept_shares:data\.accept_shares===true/,'sharing back is offered only when the owner allows it');
assert.match(read('index.html'),/id="multi-accept-shares" type="checkbox" checked/,'owners have a switch, on by default');

// ---------- Behaviour, with a simulated page ----------
const SIMPLE=/^(\.[\w-]+|\[[\w-]+\]|[a-z][a-z0-9]*)$/;
class Node{
 constructor(tag){Object.assign(this,{tagName:tag.toUpperCase(),children:[],parent:null,attrs:{},dataset:{},className:'',_text:'',id:'',type:'',name:'',value:'',checked:false,disabled:false,selected:false,required:false,maxLength:-1,autocomplete:'',inputMode:'',placeholder:'',rows:0,href:'',target:'',rel:'',noValidate:false,src:'',async:false,hidden:false,open:false,onclick:null,onchange:null,onsubmit:null,onload:null,onerror:null})}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('')}set textContent(v){this._text=String(v);this.children=[]}
 append(...nodes){for(const n of nodes){const node=typeof n==='string'?Object.assign(new Node('#text'),{_text:n}):n;if(node.parent)node.remove();node.parent=this;this.children.push(node)}}
 replaceChildren(...nodes){for(const c of this.children)c.parent=null;this.children=[];this.append(...nodes)}
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null}}
 get firstChild(){return this.children[0]||null}get lastChild(){return this.children.at(-1)||null}
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
const byText=(tag,text)=>all(tag).find(n=>n.textContent===text);
const field=id=>doc.getElementById(id);

const storage=new Map(),fetches=[],answers=[],turnstile={renders:[],resets:0,removes:0,render(el,o){this.renders.push(o);return 'w'+this.renders.length},reset(){this.resets++},remove(){this.removes++}};
const listeners={};let session={access_token:'member.jwt.token'};const reads=[];
const ownCards=[{id:'c-member',owner_id:'u-member',card_label:'Work',display_name:'Member Person',job_title:'Designer',business_name:'Studio',public_email:'member@example.invalid',public_phone:'+1 555 010 0222',website:'',social_links:'',published:true,introduction:'secret plans'}];
const window={ValeShareBackCore:null,ValeAccountLists:{read:async(client,table,owner,valid)=>{reads.push({table,owner,valid:valid()});return table==='public_cards'&&owner==='u-member'?ownCards.map(c=>({...c})):[]}},
 turnstile,crypto:globalThis.crypto,localStorage:{getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,String(v))},addEventListener:(n,f)=>listeners[n]=f};
const context={window,document:doc,location:{hostname:'dev.valebrandworks.com'},console,
 fetch:async(url,init)=>{fetches.push({url,init,body:JSON.parse(init.body)});const a=answers.shift();if(a==='throw')throw new TypeError('offline');return {json:async()=>({status:a})}}};
vm.createContext(context);
vm.runInContext(coreSrc,context);vm.runInContext(ui,context);
const host=new Node('div');host.id='shareBack';host.hidden=true;doc.body.append(host);
const client={auth:{getSession:async()=>({data:{session}})}};
const settle=()=>new Promise(r=>setTimeout(r,0));
const card={id:'c-owner',display_name:'Ana Ruiz',accept_shares:true};

(async()=>{
 // A card whose owner turned sharing back off: nothing is shown.
 window.ValeShareBack.mount('shareBack',{card:{...card,accept_shares:false},slug:'ana-ruiz'});
 assert.equal(host.hidden,true,'no form when the owner turned sharing back off');
 // Not offered on any other address (for example the production site).
 context.location.hostname='valebrandworks.github.io';host.replaceChildren();
 window.ValeShareBack.mount('shareBack',{card,slug:'ana-ruiz'});assert.equal(host.hidden,true,'no form on other addresses');
 context.location.hostname='dev.valebrandworks.com';host.replaceChildren();

 // ----- Visitor -----
 window.ValeShareBack.mount('shareBack',{card,slug:'ana-ruiz'});
 assert.equal(host.hidden,false);assert.equal(host.querySelector('h2').textContent,'Share your details with Ana');
 assert.equal(all('form').length,0,'nothing opens or is sent by itself');assert.equal(turnstile.renders.length,0,'Turnstile loads only when the form is opened');
 byText('button','Share my details').onclick();await settle();
 const form=host.querySelector('form');assert.ok(form);assert.equal(form.getAttribute('aria-labelledby'),'share-back-title');assert.equal(doc.activeElement,host.querySelector('h2'),'focus moves to the form heading');
 assert.equal(all('fieldset').length,0,'visitors see no account options');
 assert.equal(turnstile.renders.length,1);assert.equal(turnstile.renders[0].action,'share-card');assert.equal(turnstile.renders[0].sitekey,'0x4AAAAAAF5bZ3cludhKsLJJ');
 // Accessibility: every input has a label; the consent link opens the privacy page.
 for(const input of [...all('input'),...all('textarea'),...all('select')]){if(input.type==='radio'||input.type==='checkbox')assert.ok(input.closest('label'),'wrapped in a label: '+input.id);else assert.ok(all('label').some(l=>l.getAttribute('for')===input.id),'labelled: '+input.id)}
 const consent=field('share-consent');assert.equal(consent.checked,false,'consent is never pre-ticked');
 assert.match(consent.closest('label').textContent,/^By sharing, I agree to send my selected contact information to Ana Ruiz, who can save it in their private VALE Connect connections\. How shared details are handled$/);
 assert.equal(all('a').find(a=>a.textContent==='How shared details are handled').href,'privacy.html');
 assert.equal(field('share-phone').getAttribute('aria-describedby'),'share-phone-hint','the phone hint is linked to its field');
 // Nothing is sent without a name and contact, consent, and a Turnstile pass.
 const submit=()=>form.onsubmit({preventDefault(){}});
 await submit();assert.equal(fetches.length,0);assert.equal(field('share-full_name').getAttribute('aria-invalid'),'true');assert.equal(doc.activeElement,field('share-full_name'),'focus moves to the first problem');
 assert.equal(field('share-full_name-error').textContent,'Enter your name.');assert.equal(field('share-full_name').getAttribute('aria-describedby'),'share-full_name-error');
 field('share-full_name').value='Sam Lee';await submit();assert.ok(field('share-email-error'),'an email or phone is required');assert.equal(fetches.length,0);
 field('share-email').value='sam@example.invalid';await submit();assert.equal(fetches.length,0,'not sent without consent');assert.equal(field('share-consent-error').textContent,'Tick this box to agree before sharing.');
 assert.equal(field('share-phone').getAttribute('aria-describedby'),'share-phone-hint','fixing one problem leaves other fields\' hints in place');
 consent.checked=true;await submit();assert.equal(fetches.length,0,'not sent without a Turnstile pass');assert.match(host.querySelector('.status').textContent,/security check/);assert.equal(host.querySelector('.status').dataset.tone,'error');
 turnstile.renders[0].callback('turnstile-token-1');
 // A network failure keeps the same submission, so retrying can't store a share twice.
 answers.push('throw');await submit();assert.equal(fetches.length,1);assert.match(host.querySelector('.status').textContent,/Couldn’t send/);assert.equal(turnstile.resets,0,'the check is kept for the retry');
 answers.push('verification_failed');await submit();assert.equal(fetches.length,2);assert.equal(fetches[1].body.submission_id,fetches[0].body.submission_id,'the retry reuses the same submission ID');
 assert.equal(turnstile.resets,1,'after a failed check, a fresh one is needed');assert.match(host.querySelector('.status').textContent,/security check/);
 await submit();assert.equal(fetches.length,2,'not sent again until the new check passes');
 turnstile.renders[0].callback('turnstile-token-2');answers.push('rate_limited');await submit();assert.match(host.querySelector('.status').textContent,/try again later/);
 turnstile.renders[0].callback('turnstile-token-3');answers.push('shared');await submit();
 const sent=fetches.at(-1);
 assert.equal(sent.url,'https://jlprxnmdvoloahssjlnu.supabase.co/functions/v1/share-card');assert.equal(sent.init.headers.Authorization,undefined,'a visitor sends no sign-in');
 assert.deepEqual(sent.body,{mode:'visitor',card:'ana-ruiz',submission_id:fetches[0].body.submission_id,consent:true,consent_version:'2026-11-v1',turnstile_token:'turnstile-token-3',note:'',fields:{full_name:'Sam Lee',email:'sam@example.invalid'}});
 assert.equal(host.querySelector('h2').textContent,'Your details were sent to Ana.');assert.equal(doc.activeElement,host.querySelector('h2'),'focus moves to the confirmation');
 assert.equal(all('form').length,0);assert.equal(turnstile.removes,1,'the check is removed after success');
 assert.deepEqual([...storage],[['vale-shared-back:c-owner',new Date().toISOString().slice(0,10)]],'the device remembers only the date, no names or contact details');
 // Duplicate submission from this device: a notice, and sending again needs the whole form again.
 host.replaceChildren();window.ValeShareBack.mount('shareBack',{card,slug:'ana-ruiz'});
 assert.match(host.textContent,/You’ve already shared your details with Ana from this device\./);assert.equal(fetches.length,4,'showing the notice sends nothing');
 byText('button','Share again').onclick();await settle();assert.equal(field('share-consent').checked,false,'sharing again needs consent again');assert.equal(field('share-full_name').value,'','and nothing is filled in automatically');
 byText('button','Cancel').onclick();assert.equal(all('form').length,0);
 // The owner switches sharing off while the page is open: the form closes with a clear message.
 storage.clear();host.replaceChildren();window.ValeShareBack.mount('shareBack',{card,slug:'ana-ruiz'});byText('button','Share my details').onclick();await settle();
 field('share-full_name').value='Sam Lee';field('share-phone').value='+1 555 010 0199';field('share-consent').checked=true;turnstile.renders.at(-1).callback('tok');answers.push('unavailable');
 await host.querySelector('form').onsubmit({preventDefault(){}});assert.equal(host.textContent,'Ana isn’t accepting shared details right now.');
 assert.ok(fetches.at(-1).body.submission_id!==fetches[0].body.submission_id,'a new form gets a new submission ID');

 // ----- Signed-in member -----
 storage.clear();host.replaceChildren();
 listeners['vale-account-ready']({detail:{client,user:{id:'u-member'}}});await settle();
 window.ValeShareBack.mount('shareBack',{card,slug:'ana-ruiz'});
 byText('button','Share my details').onclick();await settle();await settle();
 assert.deepEqual(reads.at(-1),{table:'public_cards',owner:'u-member',valid:true},'a member\'s own cards come from the owner-only reader, for their own account');
 const radios=all('input').filter(i=>i.type==='radio');assert.deepEqual(radios.map(r=>[r.value,r.checked]),[['member',true],['visitor',false]],'members start with their own card');
 const picks=all('input').filter(i=>i.id.startsWith('share-pick-'));
 assert.deepEqual(picks.map(p=>[p.id.slice(11),p.checked,p.disabled]),[['full_name',true,true],['job_title',false,false],['business_name',false,false],['email',false,false],['phone',false,false]],'only the name is ticked; everything else is the member\'s choice');
 assert.doesNotMatch(host.textContent,/secret plans/,'the introduction is never offered');
 field('share-consent').checked=true;turnstile.renders.at(-1).callback('tok-m');
 await host.querySelector('form').onsubmit({preventDefault(){}});assert.match(host.querySelector('.status').textContent,/email or phone/);
 field('share-pick-email').checked=true;answers.push('shared');const before=fetches.length;await host.querySelector('form').onsubmit({preventDefault(){}});
 const m=fetches[before];assert.equal(m.init.headers.Authorization,'Bearer member.jwt.token','a member sends their own sign-in');
 assert.deepEqual([m.body.mode,m.body.card_id,m.body.member_fields,m.body.fields],['member','c-member',['full_name','email'],undefined],'field names only: the server reads the values from the member\'s card');
 assert.doesNotMatch(JSON.stringify(m.body),/member@example\.invalid|Member Person/,'no card values are sent from the page');
 // Expired sign-in: nothing is sent.
 storage.clear();host.replaceChildren();window.ValeShareBack.mount('shareBack',{card,slug:'ana-ruiz'});byText('button','Share my details').onclick();await settle();await settle();
 field('share-pick-phone').checked=true;field('share-consent').checked=true;turnstile.renders.at(-1).callback('tok-x');session=null;const n=fetches.length;
 await host.querySelector('form').onsubmit({preventDefault(){}});assert.equal(fetches.length,n);assert.match(host.querySelector('.status').textContent,/sign-in has expired/);session={access_token:'member.jwt.token'};
 // A member can still type their details instead; then no sign-in is sent.
 radios.length;const typed=all('input').find(i=>i.id==='share-mode-visitor');typed.checked=true;typed.onchange();
 assert.equal(host.querySelector('.share-visitor').hidden,false);assert.equal(host.querySelector('.share-member').hidden,true);
 field('share-full_name').value='Member Typed';field('share-email').value='typed@example.invalid';turnstile.renders.at(-1).callback('tok-y');answers.push('shared');
 await host.querySelector('form').onsubmit({preventDefault(){}});assert.equal(fetches.at(-1).init.headers.Authorization,undefined,'typed details never carry the member\'s sign-in');
 // Viewing your own card: no form.
 host.replaceChildren();window.ValeShareBack.mount('shareBack',{card:{id:'c-member',display_name:'Member Person',accept_shares:true},slug:'member-card'});
 assert.match(host.textContent,/This is your card\./);assert.equal(all('button').length,0);
 // Signing out: back to the visitor experience.
 listeners['vale-account-ready']({detail:{client,user:null}});await settle();storage.clear();host.replaceChildren();window.ValeShareBack.mount('shareBack',{card,slug:'ana-ruiz'});
 byText('button','Share my details').onclick();await settle();assert.equal(all('fieldset').length,0);
 console.log('PASS: share-back rules (consent wording, validation, payloads, sign-in only for members, no owner details revealed); page security (lookup-only card, owner-only reader, one call to the share function, no HTML injection, no secrets); behaviour (off when the owner disables it or on other sites, never automatic, consent and Turnstile required, retry-safe submission IDs, fresh check after each answer, duplicate notice with only a date stored, closes when the owner turns sharing off, member field choice sends names only, expired sign-in sends nothing); accessibility (labels, linked hints and errors, focus on problems and confirmation).');
})().catch(e=>{console.error(e);process.exit(1)});
