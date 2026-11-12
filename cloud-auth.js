/* Sign-in, account creation, password recovery and account deletion. Cards and connections load from the account.
   Supabase Auth is the authority for passwords, email confirmation and bot protection; rules and wording are in
   auth-core.js. Cloudflare Turnstile tokens are sent with every sign-in, sign-up, reset and resend request, so the
   server's bot protection can be switched on without breaking anything. */
(()=>{'use strict';
const $=id=>document.getElementById(id);if(!$('cloud-auth'))return;
// Without its rules (auth-core.js), the form stays unavailable rather than skipping any check.
const core=window.ValeAuthCore;if(!core){const s=$('cloud-auth-status');if(s)s.textContent='Sign-in is unavailable right now. Please refresh the page.';return}
const DEFAULT_URL='https://jlprxnmdvoloahssjlnu.supabase.co',DEFAULT_KEY='sb_publishable_wxT0A5bByFX67J1ut0F-ZA_xITdxwf_';
const TURNSTILE_SRC='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let client=null,user=null,generation=0,mode='signin',busy=false;
function accountRequest(){return user?{id:user.id,generation}:null}
function current(request){return !!request&&user?.id===request.id&&generation===request.generation}
const msg=(id,value)=>{const el=$(id);if(el)el.textContent=value};
const show=(id,visible)=>{const el=$(id);if(el)el.hidden=!visible};
const redirect=()=>location.origin+location.pathname;

// Cloudflare Turnstile. Loaded only when a sign-in form is used; one check per form; a pass works once.
let turnstileLoad=null;
function loadTurnstile(){
 if(window.turnstile)return Promise.resolve(window.turnstile);
 if(typeof document.createElement!=='function'||!document.head)return Promise.reject(new Error('unavailable'));
 if(!turnstileLoad)turnstileLoad=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=TURNSTILE_SRC;s.async=true;s.onload=()=>window.turnstile?resolve(window.turnstile):reject(new Error('turnstile'));s.onerror=()=>{turnstileLoad=null;reject(new Error('turnstile'))};document.head.append(s)});
 return turnstileLoad;
}
function securityCheck(hostId,statusId){
 const check={id:undefined,token:null,ready:false};
 check.mount=()=>{
  const key=core.siteKey(location.hostname),host=$(hostId);if(!key||!host||check.id!==undefined||check.loading)return;
  check.loading=true;
  loadTurnstile().then(ts=>{check.id=ts.render(host,{sitekey:key,action:'auth',theme:'dark',size:'flexible',callback:t=>{check.token=t},'expired-callback':()=>{check.token=null},'error-callback':()=>{check.token=null}});check.ready=true})
   .catch(()=>{check.loading=false;msg(statusId,'The security check couldn’t load. Check your connection, or try another browser.')});
 };
 check.missing=()=>check.ready&&!check.token;
 check.options=()=>check.token?{captchaToken:check.token}:{};
 check.reset=()=>{check.token=null;if(check.id!==undefined&&window.turnstile){try{window.turnstile.reset(check.id)}catch{}}};
 return check;
}
const authCheck=securityCheck('cloud-auth-check','cloud-auth-status'),deleteCheck=securityCheck('cloud-delete-check','cloud-delete-status');

// One form, four screens: sign in, create an account, reset a password, and "check your email".
const SCREENS={
 signin:{title:'Sign in',intro:'Your card and connections are saved to your account and available on every device.'},
 signup:{title:'Create your account',intro:'Free. Your card and connections are saved to your account and available on every device.'},
 reset:{title:'Reset your password',intro:'Enter your account email and we’ll send you a link to choose a new password.'},
 confirm:{title:'Check your email',intro:'Open the confirmation link we sent you, then come back and sign in. It can take a minute to arrive.'},
};
function setMode(next,{keepMessage=false,mount=true}={}){
 mode=SCREENS[next]?next:'signin';
 msg('account-auth-title',SCREENS[mode].title);msg('account-auth-intro',SCREENS[mode].intro);
 const signup=mode==='signup';
 show('cloud-password-field',mode==='signin'||signup);show('cloud-password-hint',signup);show('cloud-confirm-field',signup);show('cloud-agree-field',signup);
 show('cloud-signin',mode==='signin');show('cloud-signup',signup);show('cloud-reset',mode==='reset');show('cloud-resend',mode==='confirm');
 show('cloud-forgot',mode==='signin');show('cloud-show-signup',mode==='signin');show('cloud-show-signin',mode!=='signin');
 $('cloud-password')?.setAttribute?.('autocomplete',signup?'new-password':'current-password');
 if(!keepMessage)msg('cloud-auth-status','');
 if(mount)authCheck.mount();
}
function setBusy(on){busy=on;for(const id of ['cloud-signin','cloud-signup','cloud-reset','cloud-resend'])if($(id))$(id).disabled=on}
function drawAgreement(){
 const host=$('cloud-agree-text');if(!host||typeof document.createElement!=='function'||!host.replaceChildren)return;
 host.replaceChildren(...core.agreement().parts.map(p=>{if(typeof p==='string')return document.createTextNode(p);const a=document.createElement('a');a.href=p.href;a.target='_blank';a.rel='noopener';a.textContent=p.text;return a}));
}

function setSignedIn(account){
 const prev=user?.id;user=account;
 msg('cloud-session',account?account.email:'Not signed in');
 if($('account-signed-out'))$('account-signed-out').hidden=!!account;
 if($('account-home'))$('account-home').hidden=!account;
 $('cloud-signout').hidden=!account;$('cloud-change-password').hidden=!account;if(!account)$('cloud-new-password').hidden=true;
 if(prev!==account?.id){generation++;if(!account){$('cloud-delete-email').value='';$('cloud-delete-password').value='';$('cloud-delete-understand').checked=false;msg('cloud-delete-status','')}}
 window.dispatchEvent(new CustomEvent('vale-account-ready',{detail:{client,user:account||null}}));
}
async function init(){
 if(!window.supabase?.createClient){msg('cloud-auth-status','VALE Connect couldn’t reach its sign-in service. Check your internet connection and refresh.');return}
 try{
  client=window.supabase.createClient(DEFAULT_URL,DEFAULT_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  let authEventVersion=0;
  client.auth.onAuthStateChange((_event,session)=>{authEventVersion++;setSignedIn(session?.user||null);if(_event==='PASSWORD_RECOVERY')showPasswordForm('Choose a new password to finish signing in.')});
  const initAuthVersion=authEventVersion;const {data,error}=await client.auth.getUser();
  if(authEventVersion===initAuthVersion){if(error&&!/session missing|auth session missing/i.test(error.message))msg('cloud-auth-status',core.message(error));setSignedIn(data?.user||null)}
  // Opened straight onto the Account tab (a Sign in link, or a password manager filling the form): load the check now.
  if(!user&&$('tab-account')&&!$('tab-account').hidden)authCheck.mount();
 }catch(err){msg('cloud-auth-status','Sign-in is unavailable right now. '+core.message(err))}
}

async function signIn(){
 if(!client||busy)return;
 const email=$('cloud-email').value.trim(),password=$('cloud-password').value,bad=core.checkSignIn({email,password});
 if(bad){msg('cloud-auth-status',bad);return}
 if(authCheck.missing()){msg('cloud-auth-status','Complete the security check first.');return}
 setBusy(true);msg('cloud-auth-status','Signing in…');
 try{
  const {error}=await client.auth.signInWithPassword({email,password,options:authCheck.options()});
  if(error){const text=core.message(error,'signin');if(/confirm your email/i.test(text))setMode('confirm',{keepMessage:true});msg('cloud-auth-status',text);return}
  $('cloud-password').value='';msg('cloud-auth-status','');window.ValeApp?.tab('card');
 }catch(err){msg('cloud-auth-status',core.message(err,'signin'))}
 finally{authCheck.reset();setBusy(false)}
}
async function signUp(){
 if(!client||busy)return;
 const email=$('cloud-email').value.trim(),password=$('cloud-password').value;
 const bad=core.checkSignUp({email,password,confirm:$('cloud-password-confirm')?.value??'',agreed:!!$('cloud-agree')?.checked});
 if(bad){msg('cloud-auth-status',bad);return}
 if(authCheck.missing()){msg('cloud-auth-status','Complete the security check first.');return}
 setBusy(true);msg('cloud-auth-status','Creating your account…');
 const agreement=core.agreement();
 try{
  const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:redirect(),data:{agreement_version:agreement.version,agreement_terms:agreement.terms,agreed_at:new Date().toISOString()},...authCheck.options()}});
  $('cloud-password').value='';if($('cloud-password-confirm'))$('cloud-password-confirm').value='';
  if(error){const text=core.message(error,'signup');if(text===core.CHECK_EMAIL)setMode('confirm',{keepMessage:true});msg('cloud-auth-status',text);return}
  if(data?.session){msg('cloud-auth-status','Account created and signed in.');return}
  setMode('confirm',{keepMessage:true});msg('cloud-auth-status',core.CHECK_EMAIL);
 }catch(err){msg('cloud-auth-status',core.message(err,'signup'))}
 finally{authCheck.reset();setBusy(false)}
}
async function sendReset(){
 if(!client||busy)return;
 const email=$('cloud-email').value.trim();if(!email){msg('cloud-auth-status','Enter your email address first.');return}
 if(authCheck.missing()){msg('cloud-auth-status','Complete the security check first.');return}
 setBusy(true);msg('cloud-auth-status','Sending…');
 try{
  const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:redirect(),...authCheck.options()});
  // Only problems that the person can act on are shown; anything else gets the same answer, so it never reveals
  // whether an email has an account.
  const text=error?core.message(error,'reset'):'';
  msg('cloud-auth-status',/security check|Too many|couldn’t reach/.test(text)?text:core.RESET_SENT);
 }catch(err){msg('cloud-auth-status',core.message(err,'reset'))}
 finally{authCheck.reset();setBusy(false)}
}
async function resend(){
 if(!client||busy)return;
 const email=$('cloud-email').value.trim();if(!email){msg('cloud-auth-status','Enter your email address first.');return}
 if(authCheck.missing()){msg('cloud-auth-status','Complete the security check first.');return}
 setBusy(true);msg('cloud-auth-status','Sending…');
 try{
  const {error}=await client.auth.resend({type:'signup',email,options:{emailRedirectTo:redirect(),...authCheck.options()}});
  const text=error?core.message(error,'resend'):'';
  msg('cloud-auth-status',/security check|Too many|couldn’t reach/.test(text)?text:core.RESENT);
 }catch(err){msg('cloud-auth-status',core.message(err,'resend'))}
 finally{authCheck.reset();setBusy(false)}
}

$('cloud-auth').addEventListener('submit',e=>{e.preventDefault();return mode==='signup'?signUp():mode==='reset'?sendReset():mode==='confirm'?resend():signIn()});
$('cloud-auth').addEventListener('focusin',()=>authCheck.mount());
$('cloud-signup').addEventListener('click',()=>signUp());
$('cloud-reset').addEventListener('click',()=>sendReset());
$('cloud-resend')?.addEventListener('click',()=>resend());
$('cloud-forgot')?.addEventListener('click',()=>setMode('reset'));
$('cloud-show-signup')?.addEventListener('click',()=>setMode('signup'));
$('cloud-show-signin')?.addEventListener('click',()=>setMode('signin'));
$('cloud-password-toggle')?.addEventListener('click',()=>{
 const reveal=$('cloud-password').type==='password';
 for(const id of ['cloud-password','cloud-password-confirm'])if($(id))$(id).type=reveal?'text':'password';
 $('cloud-password-toggle').textContent=reveal?'Hide':'Show';$('cloud-password-toggle').setAttribute?.('aria-pressed',String(reveal));
});
window.addEventListener('vale-tab-shown',event=>{if(event.detail?.tab==='account'&&!user)authCheck.mount()});

function showPasswordForm(text){$('cloud-new-password').hidden=false;msg('cloud-auth-status',text);document.querySelector?.('[data-tab="account"]')?.click();$('cloud-new-password-value').focus?.()}
$('cloud-change-password').addEventListener('click',()=>showPasswordForm('Enter your new password.'));
$('cloud-new-password').addEventListener('submit',async e=>{e.preventDefault();if(!client)return;const password=$('cloud-new-password-value').value;const bad=core.checkNewPassword(password,$('cloud-new-password-confirm').value);if(bad){msg('cloud-auth-status',bad);return}const {error}=await client.auth.updateUser({password});$('cloud-new-password-value').value='';$('cloud-new-password-confirm').value='';if(error){msg('cloud-auth-status','Password not changed. '+core.message(error,'password'));return}$('cloud-new-password').hidden=true;msg('cloud-auth-status','Password changed.')});

$('cloud-delete-section')?.addEventListener?.('toggle',()=>{if($('cloud-delete-section').open)deleteCheck.mount()});
$('cloud-delete-account').addEventListener('click',async()=>{
 if(!client||!user)return;
 const email=$('cloud-delete-email').value.trim(),password=$('cloud-delete-password').value,accountEmail=user.email;
 if(email.toLowerCase()!==String(accountEmail).toLowerCase()){msg('cloud-delete-status','Type your account email exactly. Nothing was deleted.');return}
 if(!password){msg('cloud-delete-status','Enter your password. Nothing was deleted.');return}
 // An in-page tick box, not confirm(): some browsers and embedded panes block dialogs, and a blocked confirm() looks like Cancel.
 if(!$('cloud-delete-understand').checked){msg('cloud-delete-status','Tick the box to confirm you understand. Nothing was deleted.');return}
 if(deleteCheck.missing()){msg('cloud-delete-status','Complete the security check first. Nothing was deleted.');return}
 msg('cloud-delete-status','Confirming it’s you…');$('cloud-delete-password').value='';$('cloud-delete-understand').checked=false;
 const {error:signInError}=await client.auth.signInWithPassword({email:accountEmail,password,options:deleteCheck.options()});
 deleteCheck.reset();
 if(signInError){msg('cloud-delete-status',/security check/.test(core.message(signInError))?'The security check didn’t go through. Complete it again. Nothing was deleted.':'That password wasn’t accepted. Nothing was deleted.');return}
 // Card images are files, removed through storage first; the database refuses to delete an account while any remain.
 msg('cloud-delete-status','Removing your card images…');
 try{await window.ValeCards?.removeAllImages?.()}catch(error){msg('cloud-delete-status',(error.message||'Your card images couldn’t be removed.')+' Your account was not deleted.');return}
 const {error}=await client.rpc('delete_my_account',{confirm_email:email});
 if(error){msg('cloud-delete-status',error.message);return}
 await client.auth.signOut({scope:'local'});$('cloud-delete-email').value='';msg('cloud-delete-status','');msg('cloud-auth-status','Your account was deleted. Anything saved only in this browser is still here.');
});
$('cloud-signout').addEventListener('click',async()=>{if(!client||!user)return;const request=accountRequest();const {error}=await client.auth.signOut();if(user&&!current(request))return;msg('cloud-auth-status',error?error.message:'Signed out.')});
drawAgreement();setMode('signin',{mount:false});setSignedIn(null);void init();
})();
