/* Sign-in, account creation, password recovery and account deletion. Cards and connections load from the account.
   Supabase Auth is the authority for passwords, email confirmation and bot protection; rules and wording are in
   auth-core.js. Cloudflare Turnstile tokens are sent with every sign-in, sign-up, reset and resend request, so the
   server's bot protection can be switched on without breaking anything. */
(()=>{'use strict';
const $=id=>document.getElementById(id);if(!$('cloud-auth'))return;
// Without its rules (auth-core.js), the form stays unavailable rather than skipping any check.
const core=window.ValeAuthCore;if(!core){const s=$('cloud-auth-status');if(s)s.textContent='Sign-in is unavailable right now. Please refresh the page.';return}
// This web address's project (config.js). Any other address gets no project at all.
const ENV=window.ValeConfig?.forHost(location.hostname)||null;
// Where sign-ups are closed (config.js), the page offers no "Create an account" form and says accounts are by invitation.
// Cosmetic only, NOT a security control: the server (Supabase Auth, sign-ups disabled) refuses sign-ups regardless.
const signupOpen=ENV?.signupOpen!==false;
// Whether changing a password asks for the current one (config.js; must match the server's "Require current password" setting).
// Not asked in the password-reset flow, where the person has just proved they own the email address instead.
const currentPasswordRequired=ENV?.requireCurrentPassword===true;
// A password-reset link signs the person in without a password, so no current password can be asked for. That state is remembered in memory only,
// for one user and for at most the reset link's lifetime (one hour); it ends on sign-out, on any other sign-in or user, on a successful change and
// when it expires. The server's own "require current password" setting still decides what is accepted, so a stale state can never skip it.
const RECOVERY_MS=60*60*1000;
let recovery=null;
const recoveryActive=()=>!!recovery&&!!user&&recovery.userId===user.id&&Date.now()-recovery.at<RECOVERY_MS;
const endRecovery=()=>{recovery=null};
const TURNSTILE_SRC='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let client=null,user=null,generation=0,mode='signin',busy=false;
function accountRequest(){return user?{id:user.id,generation}:null}
function current(request){return !!request&&user?.id===request.id&&generation===request.generation}
const msg=(id,value)=>{const el=$(id);if(el)el.textContent=value};
let stepUp=null;   // {factorId} while the authenticator code is being asked for during a password change
const showStepUp=on=>{show('cloud-mfa-field',on);if($('cloud-mfa-code'))$('cloud-mfa-code').value='';if(!on)stepUp=null};
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
 mode=SCREENS[next]&&!(next==='signup'&&!signupOpen)?next:'signin';
 msg('account-auth-title',SCREENS[mode].title);msg('account-auth-intro',SCREENS[mode].intro);
 const signup=mode==='signup';
 show('cloud-password-field',mode==='signin'||signup);show('cloud-password-hint',signup);show('cloud-confirm-field',signup);show('cloud-agree-field',signup);
 show('cloud-signin',mode==='signin');show('cloud-signup',signup);show('cloud-reset',mode==='reset');show('cloud-resend',mode==='confirm');
 show('cloud-forgot',mode==='signin');show('cloud-show-signup',mode==='signin'&&signupOpen);show('cloud-invite-note',mode==='signin'&&!signupOpen);show('cloud-show-signin',mode!=='signin');
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
  if(!ENV){msg('cloud-auth-status','This isn’t a VALE Connect address, so sign-in is unavailable here.');return}
  client=window.supabase.createClient(ENV.supabaseUrl,ENV.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  let authEventVersion=0;
  client.auth.onAuthStateChange((_event,session)=>{authEventVersion++;setSignedIn(session?.user||null);if(_event==='SIGNED_OUT'||!session?.user||(recovery&&recovery.userId!==session.user.id))endRecovery();if(_event==='PASSWORD_RECOVERY'&&session?.user){recovery={userId:session.user.id,at:Date.now()};showPasswordForm('Choose a new password to finish signing in.')}});
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
  endRecovery();$('cloud-password').value='';msg('cloud-auth-status','');window.ValeApp?.tab('card');
 }catch(err){msg('cloud-auth-status',core.message(err,'signin'))}
 finally{authCheck.reset();setBusy(false)}
}
async function signUp(){
 if(!client||busy||!signupOpen)return;
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

async function signOutOthers(){
 try{
  const {data}=await client.auth.getSession(),token=data?.session?.access_token;
  if(!token)return false;
  const res=await fetch(ENV.supabaseUrl+'/auth/v1/logout?scope=others',{method:'POST',headers:{apikey:ENV.publishableKey,Authorization:'Bearer '+token}});
  return res.status===204;
 }catch{return false}
}
function showPasswordForm(text){showStepUp(false);const ask=currentPasswordRequired&&!recoveryActive();show('cloud-current-field',ask);if($('cloud-current-password'))$('cloud-current-password').value='';$('cloud-new-password').hidden=false;msg('cloud-auth-status',text);document.querySelector?.('[data-tab="account"]')?.click();$('cloud-new-password-value').focus?.()}
$('cloud-change-password').addEventListener('click',()=>showPasswordForm('Enter your new password.'));
$('cloud-new-password').addEventListener('submit',async e=>{
 e.preventDefault();if(!client)return;
 const password=$('cloud-new-password-value').value,ask=currentPasswordRequired&&!recoveryActive(),current=ask?($('cloud-current-password')?.value??''):'';
 show('cloud-current-field',ask);   // decided again now: the reset state may have ended since the form was opened
 const bad=core.checkNewPassword(password,$('cloud-new-password-confirm').value,{current,requireCurrent:ask});if(bad){msg('cloud-auth-status',bad);return}
 if(stepUp){
  const code=core.cleanAuthenticatorCode($('cloud-mfa-code')?.value);
  const badCode=core.checkAuthenticatorCode(code);if(badCode){msg('cloud-auth-status',badCode);return}
  const {error:mfaError}=await client.auth.mfa.challengeAndVerify({factorId:stepUp.factorId,code});
  if($('cloud-mfa-code'))$('cloud-mfa-code').value='';
  if(mfaError){msg('cloud-auth-status',core.message(mfaError,'mfa'));return}   // the typed passwords stay; try the code again
  showStepUp(false);
 }
 const {error}=await client.auth.updateUser(ask?{password,current_password:current}:{password});
 if(error&&core.needsStepUp(error)&&!stepUp){
  const {data:factorData}=await client.auth.mfa.listFactors();const factor=(factorData?.totp||[]).find(f=>f.status==='verified');
  if(factor){stepUp={factorId:factor.id};show('cloud-mfa-field',true);msg('cloud-auth-status',core.STEP_UP_ASK);$('cloud-mfa-code')?.focus?.();return}   // the typed passwords stay, so nothing is retyped and the recovery is not restarted
 }
 for(const id of ['cloud-new-password-value','cloud-new-password-confirm','cloud-current-password'])if($(id))$(id).value='';
 if(error){msg('cloud-auth-status','Password not changed. '+core.message(error,'password'));return}
 $('cloud-new-password').hidden=true;showStepUp(false);endRecovery();
 // Other devices and browsers are signed out, so a changed password also ends any session someone else may be holding.
 // Other devices: asked of the server directly, because supabase-js reports success even when the server answers 401, 403 or 404 to this request.
 // Only the server's "no content" answer (204) counts. Refresh tokens of the other sessions are revoked; an access token already issued keeps
 // working until it expires (up to an hour, Supabase cannot revoke it earlier), which the message says.
 const others=await signOutOthers();
 msg('cloud-auth-status',others?core.OTHERS_SIGNED_OUT:core.OTHERS_NOT_SIGNED_OUT);
});

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
 if(error){msg('cloud-delete-status',/^P0001$/.test(String(error.code||''))&&error.message?error.message:'Your account couldn’t be deleted. Nothing was deleted. Please try again.');return}
 await client.auth.signOut({scope:'local'});$('cloud-delete-email').value='';msg('cloud-delete-status','');msg('cloud-auth-status','Your account was deleted. Anything saved only in this browser is still here.');
});
$('cloud-signout').addEventListener('click',async()=>{if(!client||!user)return;const request=accountRequest();const {error}=await client.auth.signOut();if(user&&!current(request))return;msg('cloud-auth-status',error?'Couldn’t sign out. Please try again.':'Signed out.')});
drawAgreement();setMode('signin',{mount:false});setSignedIn(null);void init();
})();
