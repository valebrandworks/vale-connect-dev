// Account forms: sign-in, create account, password reset, resend confirmation and account deletion, with Cloudflare
// Turnstile and a stand-in Supabase client. Rules, behaviour, security and accessibility. No network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const core=require(path.join(root,'auth-core.js'));
const same=(a,b,m)=>assert.equal(JSON.stringify(a),JSON.stringify(b),m);

// ---------- Rules ----------
assert.equal(core.PASSWORD_MIN,10,'the same minimum as the server');
assert.equal(core.checkSignIn({email:'a@example.invalid',password:'abc123'}),'','older, shorter passwords still sign in');
assert.match(core.checkSignIn({email:'nope',password:'x'}),/email/);assert.match(core.checkSignIn({email:'a@example.invalid',password:''}),/password/);
assert.match(core.checkNewPassword('123456789','123456789'),/at least 10 characters/);assert.match(core.checkNewPassword('1234567890','1234567891'),/match/);assert.equal(core.checkNewPassword('correct horse','correct horse'),'');
assert.match(core.checkSignUp({email:'a@example.invalid',password:'long enough pass',confirm:'long enough pass',agreed:false}),/Privacy Policy/);
assert.equal(core.checkSignUp({email:'a@example.invalid',password:'long enough pass',confirm:'long enough pass',agreed:true}),'');
same(core.agreement(null),{parts:['I have read and accept the ',{text:'Privacy Policy',href:'privacy.html'},'.'],version:'2026-11-v1',terms:false},'privacy acknowledgment now');
assert.deepEqual(core.agreement('terms.html').parts.filter(p=>typeof p!=='string').map(p=>p.href),['terms.html','privacy.html'],'Terms are added by setting one value');
assert.equal(core.TERMS_URL,null,'no Terms page linked until it exists');
const m=(e,c)=>core.message({message:e},c);
assert.match(m('Invalid login credentials','signin'),/don’t match/);assert.doesNotMatch(m('Invalid login credentials','signin'),/no account|not found|unknown/i,'never says which part was wrong');
assert.match(m('Email not confirmed','signin'),/Confirm your email/);
assert.equal(m('User already registered','signup'),core.CHECK_EMAIL,'sign-up never reveals that an email already has an account');
assert.match(m('captcha protection: request disallowed (captcha verification process failed)'),/security check/);
assert.match(m('For security purposes, you can only request this after 52 seconds.'),/Too many attempts/);
assert.match(m('email rate limit exceeded'),/Too many attempts/);
assert.match(m('Signups not allowed for this instance','signup'),/aren’t open yet/);
assert.match(m('Password should be at least 10 characters.','signup'),/at least 10 characters/);
assert.match(m('Password is known to be weak and easy to guess, please choose a different one.','signup'),/data breach/);
assert.match(m('Failed to fetch'),/couldn’t reach/);assert.equal(m('Something odd'),'Something went wrong. Please try again.');
assert.equal(core.siteKey('dev.valebrandworks.com'),'0x4AAAAAAF5bZ3cludhKsLJJ');assert.equal(core.siteKey('valebrandworks.github.io'),null);assert.equal(core.siteKey('__proto__'),null);

// ---------- Security of the page code ----------
const auth=read('cloud-auth.js'),html=read('index.html');
assert.doesNotMatch(auth+read('auth-core.js'),/sb_secret|service_role|TURNSTILE_SECRET|SHARE_HASH_SALT/,'no secrets in the page');
assert.doesNotMatch(auth,/innerHTML|outerHTML|insertAdjacentHTML/,'no HTML injection');
assert.match(html,/<script src="auth-core\.js\?v=\d+"><\/script><script src="cloud-auth\.js\?v=\d+"><\/script>/,'rules load before the form');
assert.doesNotMatch(html.slice(html.indexOf('id="cloud-auth"'),html.indexOf('id="cloud-new-password"')),/minlength="[0-9]"/,'the sign-in box no longer refuses older short passwords');
assert.match(html,/id="cloud-new-password-value" type="password" autocomplete="new-password" minlength="10"/);
for(const id of ['cloud-email','cloud-password','cloud-password-confirm','cloud-agree','cloud-new-password-value','cloud-new-password-confirm'])assert.match(html,new RegExp('<label[^>]*for="'+id+'"'),'labelled: '+id);
assert.match(html,/id="cloud-auth-status" role="status" aria-live="polite"/);assert.match(html,/id="cloud-password-toggle" aria-pressed="false" aria-controls="cloud-password"/);

// ---------- Behaviour, with a simulated page ----------
class El{constructor(id='',tag='div'){Object.assign(this,{id,tagName:tag,value:'',textContent:'',hidden:false,disabled:false,checked:false,open:false,type:tag==='input'?'text':'',attrs:{},handlers:{},children:[]})}
 addEventListener(n,f){this.handlers[n]=f}setAttribute(k,v){this.attrs[k]=String(v)}getAttribute(k){return this.attrs[k]??null}replaceChildren(...n){this.children=n}append(...n){this.children.push(...n)}focus(){}}
function page({turnstile=true,host='dev.valebrandworks.com',accountOpen=false}={}){
 const els=new Map(),get=id=>{if(!els.has(id))els.set(id,new El(id,'input'));return els.get(id)};
 for(const id of ['cloud-password','cloud-password-confirm'])get(id).type='password';
 get('tab-account').hidden=!accountOpen;
 for(const id of ['cloud-signup','cloud-reset','cloud-resend','cloud-show-signin','cloud-password-hint','cloud-confirm-field','cloud-agree-field','cloud-new-password'])get(id).hidden=true;
 const calls=[],answers={},events={},ts={renders:[],resets:0,render(el,o){this.renders.push({el:el.id,...o});return 'w'+this.renders.length},reset(){this.resets++}};
 const answer=name=>answers[name]?.shift()||{data:{},error:null};
 let authFn;
 const client={auth:{getUser:async()=>({data:{user:null}}),onAuthStateChange:f=>authFn=f,
  signInWithPassword:async c=>{calls.push(['signIn',c]);return answer('signIn')},signUp:async c=>{calls.push(['signUp',c]);return answer('signUp')},
  resetPasswordForEmail:async(e,o)=>{calls.push(['reset',{email:e,...o}]);return answer('reset')},resend:async c=>{calls.push(['resend',c]);return answer('resend')},
  updateUser:async u=>{calls.push(['update',u]);return answer('update')},signOut:async()=>({error:null})},rpc:async(n,a)=>{calls.push([n,a]);return {error:null}}};
 const window={supabase:{createClient:()=>client},addEventListener:(n,f)=>events[n]=f,dispatchEvent(){},ValeApp:{tab:t=>calls.push(['tab',t])},ValeCards:{removeAllImages:async()=>{}}};
 if(turnstile)window.turnstile=ts;
 const document={getElementById:get,createElement:t=>new El('',t),createTextNode:t=>({textContent:t}),head:new El('head'),querySelector:()=>null,addEventListener(){}};
 const context={window,document,location:{hostname:host,origin:'https://'+host,pathname:'/'},CustomEvent:class{constructor(t,o){this.type=t;this.detail=o?.detail}},Date,console};
 vm.createContext(context);vm.runInContext(read('auth-core.js'),context);vm.runInContext(read('cloud-auth.js'),context);
 return {get,calls,answers,ts,events,auth:(e,u)=>authFn(e,u?{user:u}:null),status:()=>get('cloud-auth-status').textContent,
  submit:()=>get('cloud-auth').handlers.submit({preventDefault(){}}),click:id=>get(id).handlers.click()};
}
const settle=()=>new Promise(r=>setTimeout(r,0));
const shown=(p,ids)=>Object.fromEntries(ids.map(id=>[id,!p.get(id).hidden]));

(async()=>{
 // Sign-in screen first; the security check loads only when the form is used.
 let p=page();await settle();
 assert.equal(p.get('account-auth-title').textContent,'Sign in');
 same(shown(p,['cloud-signin','cloud-signup','cloud-reset','cloud-resend','cloud-forgot','cloud-show-signup','cloud-show-signin','cloud-confirm-field','cloud-agree-field']),{'cloud-signin':true,'cloud-signup':false,'cloud-reset':false,'cloud-resend':false,'cloud-forgot':true,'cloud-show-signup':true,'cloud-show-signin':false,'cloud-confirm-field':false,'cloud-agree-field':false});
 assert.equal(p.ts.renders.length,0,'no Turnstile until someone uses the form');
 p.get('cloud-auth').handlers.focusin();await settle();
 assert.equal(p.ts.renders.length,1);same([p.ts.renders[0].el,p.ts.renders[0].sitekey,p.ts.renders[0].action],['cloud-auth-check','0x4AAAAAAF5bZ3cludhKsLJJ','auth']);
 p.get('cloud-auth').handlers.focusin();await settle();assert.equal(p.ts.renders.length,1,'rendered once');
 const opened=page({accountOpen:true});await settle();assert.equal(opened.ts.renders.length,1,'opened straight onto the Account tab: the check loads at once');
 // Sign in: needs the check, then sends its token; an older short password is accepted.
 p.get('cloud-email').value=' Owner@example.invalid ';p.get('cloud-password').value='abc123';
 await p.submit();assert.equal(p.calls.length,0);assert.match(p.status(),/Complete the security check/);
 p.ts.renders[0].callback('tok-1');await p.submit();
 same(p.calls[0],['signIn',{email:'Owner@example.invalid',password:'abc123',options:{captchaToken:'tok-1'}}]);
 assert.equal(p.ts.resets,1,'a pass works once: a fresh check after every request');same(p.calls.at(-1),['tab','card']);assert.equal(p.get('cloud-password').value,'');
 // Friendly errors; an unconfirmed email moves to the resend screen.
 p.ts.renders[0].callback('tok-2');p.answers.signIn=[{error:{message:'Invalid login credentials'}}];p.get('cloud-password').value='wrong-one';await p.submit();
 assert.match(p.status(),/don’t match/);assert.equal(p.get('account-auth-title').textContent,'Sign in');
 p.ts.renders[0].callback('tok-3');p.answers.signIn=[{error:{message:'Email not confirmed'}}];await p.submit();
 assert.equal(p.get('account-auth-title').textContent,'Check your email');assert.equal(p.get('cloud-resend').hidden,false);assert.match(p.status(),/Confirm your email/);
 p.ts.renders[0].callback('tok-4');await p.click('cloud-resend');
 same(p.calls.at(-1),['resend',{type:'signup',email:'Owner@example.invalid',options:{emailRedirectTo:'https://dev.valebrandworks.com/',captchaToken:'tok-4'}}]);assert.equal(p.status(),core.RESENT);
 // Create an account: its own screen, with show/hide, confirmation and the agreement.
 p=page();await settle();p.get('cloud-show-signup').handlers.click();await settle();
 assert.equal(p.get('account-auth-title').textContent,'Create your account');assert.equal(p.ts.renders.length,1,'switching screens loads the check');
 same(shown(p,['cloud-signin','cloud-signup','cloud-password-hint','cloud-confirm-field','cloud-agree-field','cloud-forgot','cloud-show-signin']),{'cloud-signin':false,'cloud-signup':true,'cloud-password-hint':true,'cloud-confirm-field':true,'cloud-agree-field':true,'cloud-forgot':false,'cloud-show-signin':true});
 assert.equal(p.get('cloud-password').getAttribute('autocomplete'),'new-password','password managers offer a new password');
 const agree=p.get('cloud-agree-text').children;assert.equal(agree.map(c=>c.textContent).join(''),'I have read and accept the Privacy Policy.');
 same([agree[1].href,agree[1].target,agree[1].rel],['privacy.html','_blank','noopener']);
 assert.equal(p.get('cloud-agree').checked,false,'never pre-ticked');
 p.get('cloud-password-toggle').handlers.click();same([p.get('cloud-password').type,p.get('cloud-password-confirm').type,p.get('cloud-password-toggle').textContent,p.get('cloud-password-toggle').getAttribute('aria-pressed')],['text','text','Hide','true']);
 p.get('cloud-password-toggle').handlers.click();same([p.get('cloud-password').type,p.get('cloud-password-toggle').textContent],['password','Show']);
 p.ts.renders[0].callback('tok-s');p.get('cloud-email').value='new@example.invalid';
 p.get('cloud-password').value='nine char';p.get('cloud-password-confirm').value='nine char';await p.submit();assert.match(p.status(),/at least 10 characters/);assert.equal(p.calls.length,0);
 p.get('cloud-password').value='long enough pass';p.get('cloud-password-confirm').value='long enough pasx';await p.submit();assert.match(p.status(),/match/);
 p.get('cloud-password-confirm').value='long enough pass';await p.submit();assert.match(p.status(),/Privacy Policy/);assert.equal(p.calls.length,0,'nothing is sent without the agreement');
 p.get('cloud-agree').checked=true;await p.submit();
 const su=p.calls[0];assert.equal(su[0],'signUp');same([su[1].email,su[1].password,su[1].options.emailRedirectTo,su[1].options.captchaToken,su[1].options.data.agreement_version,su[1].options.data.agreement_terms],['new@example.invalid','long enough pass','https://dev.valebrandworks.com/','tok-s','2026-11-v1',false]);
 assert.ok(!Number.isNaN(Date.parse(su[1].options.data.agreed_at)),'when they agreed is recorded');
 assert.equal(p.get('account-auth-title').textContent,'Check your email');assert.equal(p.status(),core.CHECK_EMAIL);same([p.get('cloud-password').value,p.get('cloud-password-confirm').value],['','']);
 // Sign-up never reveals an existing account; the server's refusals read plainly.
 p=page();await settle();p.get('cloud-show-signup').handlers.click();await settle();p.ts.renders[0].callback('t');Object.assign(p.get('cloud-email'),{value:'taken@example.invalid'});p.get('cloud-password').value=p.get('cloud-password-confirm').value='long enough pass';p.get('cloud-agree').checked=true;
 p.answers.signUp=[{error:{message:'User already registered'}}];await p.submit();assert.equal(p.status(),core.CHECK_EMAIL);
 p.get('cloud-show-signup').handlers.click();p.ts.renders[0].callback('t2');p.get('cloud-password').value=p.get('cloud-password-confirm').value='long enough pass';p.answers.signUp=[{error:{message:'Signups not allowed for this instance'}}];await p.submit();assert.match(p.status(),/aren’t open yet/);
 // Double taps send once.
 p=page();await settle();p.get('cloud-auth').handlers.focusin();await settle();p.ts.renders[0].callback('t');p.get('cloud-email').value='a@example.invalid';p.get('cloud-password').value='pw';
 let release;p.answers.signIn=[new Promise(r=>release=r)];const one=p.submit(),two=p.submit();release({error:null});await one;await two;assert.equal(p.calls.filter(c=>c[0]==='signIn').length,1);
 // Password reset: its own screen; the answer never reveals whether an account exists.
 p=page();await settle();p.get('cloud-forgot').handlers.click();await settle();assert.equal(p.get('account-auth-title').textContent,'Reset your password');assert.equal(p.get('cloud-password-field').hidden,true);
 p.get('cloud-email').value='someone@example.invalid';await p.submit();assert.match(p.status(),/Complete the security check/);
 p.ts.renders[0].callback('tok-r');p.answers.reset=[{error:{message:'User not found'}}];await p.submit();
 same(p.calls[0],['reset',{email:'someone@example.invalid',redirectTo:'https://dev.valebrandworks.com/',captchaToken:'tok-r'}]);assert.equal(p.status(),core.RESET_SENT);
 p.ts.renders[0].callback('tok-r2');p.answers.reset=[{error:{message:'captcha verification process failed'}}];await p.submit();assert.match(p.status(),/security check/,'a failed check is worth saying');
 p.get('cloud-show-signin').handlers.click();assert.equal(p.get('account-auth-title').textContent,'Sign in');
 // A new password follows the server's minimum.
 p.get('cloud-new-password-value').value='123456789';p.get('cloud-new-password-confirm').value='123456789';await p.get('cloud-new-password').handlers.submit({preventDefault(){}});assert.match(p.status(),/at least 10/);assert.ok(!p.calls.some(c=>c[0]==='update'));
 // Deleting an account: its password re-check carries its own security check.
 p=page();await settle();p.auth('SIGNED_IN',{id:'u1',email:'Owner@example.invalid'});await settle();
 p.get('cloud-delete-section').open=true;p.get('cloud-delete-section').handlers.toggle();await settle();
 const d=p.ts.renders.find(r=>r.el==='cloud-delete-check');assert.ok(d,'the delete section has its own check');
 Object.assign(p.get('cloud-delete-email'),{value:'owner@example.invalid'});p.get('cloud-delete-password').value='pw';p.get('cloud-delete-understand').checked=true;
 await p.click('cloud-delete-account');assert.match(p.get('cloud-delete-status').textContent,/security check.*Nothing was deleted/);assert.ok(!p.calls.some(c=>c[0]==='signIn'));
 d.callback('tok-d');p.get('cloud-delete-understand').checked=true;await p.click('cloud-delete-account');
 same(p.calls.find(c=>c[0]==='signIn'),['signIn',{email:'Owner@example.invalid',password:'pw',options:{captchaToken:'tok-d'}}]);assert.ok(p.calls.some(c=>c[0]==='delete_my_account'));
 // No security check where Turnstile isn't available: requests go without a token and the server decides.
 p=page({turnstile:false,host:'valebrandworks.github.io'});await settle();p.get('cloud-auth').handlers.focusin();p.get('cloud-email').value='a@example.invalid';p.get('cloud-password').value='pw';await p.submit();
 same(p.calls[0],['signIn',{email:'a@example.invalid',password:'pw',options:{}}]);
 console.log('PASS: account rules (10-character minimum like the server, older passwords still sign in, agreement with Terms ready, plain messages that never reveal accounts); page security (no secrets, no HTML injection, rules load first); behaviour (screens, Turnstile only when used and on every sign-in, sign-up, reset, resend and delete re-check, fresh check after each request, show/hide, confirmation, agreement required and recorded, resend after an unconfirmed sign-in, double taps send once); accessibility (labels, live status, toggle state).');
})().catch(e=>{console.error(e);process.exit(1)});
