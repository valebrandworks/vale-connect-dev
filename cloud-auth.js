/* Sign-in, password and account deletion. Cards and connections load from the account; nothing syncs by hand. */
(()=>{'use strict';
const $=id=>document.getElementById(id);if(!$('cloud-auth'))return;
const DEFAULT_URL='https://jlprxnmdvoloahssjlnu.supabase.co',DEFAULT_KEY='sb_publishable_wxT0A5bByFX67J1ut0F-ZA_xITdxwf_';
let client=null,user=null,generation=0;
function accountRequest(){return user?{id:user.id,generation}:null}
function current(request){return !!request&&user?.id===request.id&&generation===request.generation}
const msg=(id,value)=>{const el=$(id);if(el)el.textContent=value};
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
  if(authEventVersion===initAuthVersion){if(error&&!/session missing|auth session missing/i.test(error.message))msg('cloud-auth-status',error.message);setSignedIn(data?.user||null)}
 }catch(err){msg('cloud-auth-status','Sign-in is unavailable right now: '+err.message)}
}
$('cloud-auth').addEventListener('submit',async e=>{e.preventDefault();if(!client)return;msg('cloud-auth-status','Signing in…');try{const {error}=await client.auth.signInWithPassword({email:$('cloud-email').value.trim(),password:$('cloud-password').value});msg('cloud-auth-status',error?'Sign in failed: '+error.message:'');if(!error){$('cloud-password').value='';window.ValeApp?.tab('card')}}catch(err){msg('cloud-auth-status','Sign in failed: '+err.message)}});
function showPasswordForm(text){$('cloud-new-password').hidden=false;msg('cloud-auth-status',text);document.querySelector?.('[data-tab="account"]')?.click();$('cloud-new-password-value').focus?.()}
$('cloud-change-password').addEventListener('click',()=>showPasswordForm('Enter your new password.'));
$('cloud-reset').addEventListener('click',async()=>{if(!client)return;const email=$('cloud-email').value.trim();if(!email){msg('cloud-auth-status','Enter your email address first.');return}msg('cloud-auth-status','Sending…');const {error}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin+location.pathname});msg('cloud-auth-status',error&&/rate|limit|seconds/i.test(error.message)?'Too many requests. Please wait a few minutes and try again.':'If that email has an account, a reset link is on its way. Check your inbox and spam folder.')});
$('cloud-new-password').addEventListener('submit',async e=>{e.preventDefault();if(!client)return;const password=$('cloud-new-password-value').value;if(password.length<8){msg('cloud-auth-status','Use at least 8 characters.');return}if(password!==$('cloud-new-password-confirm').value){msg('cloud-auth-status','Those passwords don’t match.');return}const {error}=await client.auth.updateUser({password});$('cloud-new-password-value').value='';$('cloud-new-password-confirm').value='';if(error){msg('cloud-auth-status','Password not changed: '+error.message);return}$('cloud-new-password').hidden=true;msg('cloud-auth-status','Password changed.')});
$('cloud-delete-account').addEventListener('click',async()=>{
 if(!client||!user)return;
 const email=$('cloud-delete-email').value.trim(),password=$('cloud-delete-password').value,accountEmail=user.email;
 if(email.toLowerCase()!==String(accountEmail).toLowerCase()){msg('cloud-delete-status','Type your account email exactly. Nothing was deleted.');return}
 if(!password){msg('cloud-delete-status','Enter your password. Nothing was deleted.');return}
 // An in-page tick box, not confirm(): some browsers and embedded panes block dialogs, and a blocked confirm() looks like Cancel.
 if(!$('cloud-delete-understand').checked){msg('cloud-delete-status','Tick the box to confirm you understand. Nothing was deleted.');return}
 msg('cloud-delete-status','Confirming it’s you…');$('cloud-delete-password').value='';$('cloud-delete-understand').checked=false;
 const {error:signInError}=await client.auth.signInWithPassword({email:accountEmail,password});
 if(signInError){msg('cloud-delete-status','That password wasn’t accepted. Nothing was deleted.');return}
 // Card images are files, removed through storage first; the database refuses to delete an account while any remain.
 msg('cloud-delete-status','Removing your card images…');
 try{await window.ValeCards?.removeAllImages?.()}catch(error){msg('cloud-delete-status',(error.message||'Your card images couldn’t be removed.')+' Your account was not deleted.');return}
 const {error}=await client.rpc('delete_my_account',{confirm_email:email});
 if(error){msg('cloud-delete-status',error.message);return}
 await client.auth.signOut({scope:'local'});$('cloud-delete-email').value='';msg('cloud-delete-status','');msg('cloud-auth-status','Your account was deleted. Anything saved only in this browser is still here.');
});
$('cloud-signup').addEventListener('click',async()=>{if(!client)return;const email=$('cloud-email').value.trim(),password=$('cloud-password').value;if(!email||!password){msg('cloud-auth-status','Enter an email and password first.');return}if(password.length<8){msg('cloud-auth-status','Use a password of at least 8 characters.');return}try{const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}});msg('cloud-auth-status',error?'Registration failed: '+error.message:data?.session?'Account created and signed in.':'Check your email for a confirmation link, then return and sign in.')}catch(err){msg('cloud-auth-status',err.message)}$('cloud-password').value=''});
$('cloud-signout').addEventListener('click',async()=>{if(!client||!user)return;const request=accountRequest();const {error}=await client.auth.signOut();if(user&&!current(request))return;msg('cloud-auth-status',error?error.message:'Signed out.')});
setSignedIn(null);void init();
})();
