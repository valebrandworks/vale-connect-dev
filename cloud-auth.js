(()=>{'use strict';
const $=id=>document.getElementById(id);if(!$('cloud-config'))return;
const DEFAULT_URL='https://jlprxnmdvoloahssjlnu.supabase.co',DEFAULT_KEY='sb_publishable_wxT0A5bByFX67J1ut0F-ZA_xITdxwf_';
const CARD_KEY='vale-connect-dev-v09-card', FIELDS=['fullName','jobTitle','company','phone','email','website','bio','socials'];
const COLUMNS='full_name,business_name,email,phone,website,job_title,bio,social_links';
let client=null,user=null,interval=null,operation=Promise.resolve(),generation=0,saveRevision=0,saveBlocked=false;
// All reads and writes run in one queue; no check can race an in-flight save.
function enqueue(work){const next=operation.catch(()=>{}).then(work);operation=next.catch(()=>{});return next}
const msg=(id,value)=>{const el=$(id);if(el)el.textContent=value};
function status(value){msg('cloud-profile-status',value);msg('card-sync-status','Cloud sync: '+value)}
function readCard(){try{return JSON.parse(localStorage.getItem(CARD_KEY)||'{}')}catch{return {}}}
function normalize(c){return Object.fromEntries(FIELDS.map(k=>[k,String(c?.[k]||'').trim()]))}
function signature(c){return JSON.stringify(normalize(c))}
function fromCloud(d){return normalize({fullName:d.full_name,jobTitle:d.job_title,company:d.business_name,phone:d.phone,email:d.email,website:d.website,bio:d.bio,socials:d.social_links})}
function toCloud(c,id){return {id,full_name:c.fullName||null,job_title:c.jobTitle||null,business_name:c.company||null,phone:c.phone||null,email:c.email||null,website:c.website||null,bio:c.bio||null,social_links:c.socials||''}}
function baselineKey(){return 'vale-connect-dev-v09-baseline-'+user.id}
function getBaseline(){return localStorage.getItem(baselineKey())} // Baseline is already a serialized signature; never JSON.parse it.
function setBaseline(c){localStorage.setItem(baselineKey(),signature(c))}
// Privacy-preserving diagnostics: names of changed fields, not their values.
const diagLog=[];
function diag(label,local,remote,base,extra=''){
  const ls=signature(local),rs=remote?signature(remote):null;
  let bs=base;
  let baseFields=null;
  try{if(typeof base==='string')baseFields=normalize(JSON.parse(base))}catch{}
  const differences=remote?FIELDS.filter(k=>normalize(local)[k]!==normalize(remote)[k]):[];
  const baselineVsCloud=baseFields&&remote?FIELDS.filter(k=>baseFields[k]!==normalize(remote)[k]):[];
  const baselineVsLocal=baseFields?FIELDS.filter(k=>baseFields[k]!==normalize(local)[k]):[];
  const item=`${new Date().toLocaleTimeString()} ${label} | local=cloud:${ls===rs} | baseline=${base===null?'missing':'present'} | baseline=cloud:${bs===rs} | baseline=local:${bs===ls} | local/cloud fields: ${differences.join(',')||'none'} | baseline/cloud fields: ${baselineVsCloud.join(',')||'none'} | baseline/local fields: ${baselineVsLocal.join(',')||'none'}${extra?' | '+extra:''}`;
  diagLog.unshift(item);if(diagLog.length>14)diagLog.length=14;
  msg('cloud-sync-diagnostics',diagLog.join('\n\n'));
}
function applyCloud(c){localStorage.setItem(CARD_KEY,JSON.stringify(c));setBaseline(c);saveBlocked=false;window.dispatchEvent(new CustomEvent('vale-cloud-card-loaded',{detail:c}))}
function setSignedIn(account){const prev=user?.id;user=account;msg('cloud-session',account?'Signed in as '+account.email:'Not signed in');$('cloud-signout').hidden=!account;for(const id of ['cloud-upload','cloud-load','cloud-sync'])$(id).disabled=!account;if(prev!==account?.id){saveBlocked=false;generation++;if(interval)clearInterval(interval);interval=null;if(account){interval=setInterval(()=>{if(!document.hidden)void checkCloud()},20000);void checkCloud()}else status('Not signed in; saved on this device only.')}window.dispatchEvent(new CustomEvent('vale-account-ready',{detail:{client,user:account||null}}))}
async function fetchCloud(accountId){const {data,error}=await client.from('profiles').select(COLUMNS).eq('id',accountId).maybeSingle();if(error)throw error;return data?fromCloud(data):null}
function checkCloud(){const requestedRevision=saveRevision;return enqueue(async()=>{if(!client||!user||requestedRevision!==saveRevision||saveBlocked)return;const id=user.id,gen=generation;try{const remote=await fetchCloud(id);if(!user||user.id!==id||generation!==gen||requestedRevision!==saveRevision)return;const local=normalize(readCard()),base=getBaseline(),ls=signature(local),rs=remote?signature(remote):null;diag('Background check',local,remote,base);
if(!remote){status(local.fullName?'No cloud card found. Save Card to upload.':'No cloud card saved yet.');return}
if(ls===rs){setBaseline(remote);saveBlocked=false;status('Up to date ✓');return}
if(!local.fullName){applyCloud(remote);status('Updated from cloud ✓');return}
if(base!==null&&ls===base&&rs!==base){applyCloud(remote);status('Updated from cloud ✓');return}
if(base!==null&&rs===base&&ls!==base){status('Unsynced local changes. Click Save Card to upload.');return}
status('Two versions differ. Nothing overwritten. Choose which version to keep in Cloud Account.');
}catch(err){status('Cloud check failed: '+(err.message||err))}})}
function saveCloud(automatic=false){const requestedRevision=saveRevision;return enqueue(async()=>{if(!client||!user){status('Not signed in; saved on this device only.');return false}const id=user.id,gen=generation;try{const local=normalize(readCard());if(!local.fullName){status('Enter your name and save your card first.');return false}status('Saving…');const remote=await fetchCloud(id);if(!user||user.id!==id||generation!==gen)return false;const base=getBaseline();const ls=signature(local),rs=remote?signature(remote):null;diag('Save attempt',local,remote,base, 'revision='+requestedRevision);
// The baseline is the last confirmed shared card. A local save is allowed only if
// the cloud is still at that baseline (or is already equal to our local card).
if(automatic&&!saveBlocked&&remote&&rs!==ls&&(base===null||rs!==base)){
  saveBlocked=true;
  status('Save paused: cloud and this device differ. Your edit is safe on this device. Click Save Card again to review an overwrite confirmation.');
  return false;
}
if(automatic&&saveBlocked&&remote&&rs!==ls){
  // This path is reached on a subsequent explicit Save Card, not on a timer.
  if(!confirm('The cloud card differs from this device. Replace the cloud card with your current saved card? Changes on another device may be lost.')){
    status('Save cancelled. Your local card is unchanged.');return false;
  }
}
const {error}=await client.from('profiles').upsert(toCloud(local,id),{onConflict:'id'});if(error)throw error;
if(!user||user.id!==id||generation!==gen)return false;
setBaseline(local);saveBlocked=false;diag('Upload confirmed',local,local,getBaseline());
if(requestedRevision!==saveRevision){status('Newer local changes pending…');return true}
status('Saved to cloud ✓');return true
}catch(err){status('Cloud save failed: '+(err.message||err));return false}})}
window.addEventListener('vale-card-saved',()=>{saveRevision++;diagLog.unshift(new Date().toLocaleTimeString()+' Save Card clicked; queued cloud upload.');msg('cloud-sync-diagnostics',diagLog.join('\n\n'));void saveCloud(true)});
window.addEventListener('focus',()=>void checkCloud());document.addEventListener('visibilitychange',()=>{if(!document.hidden)void checkCloud()});
async function init(){if(!window.supabase?.createClient){status('Supabase library could not load. Check internet connection.');return}try{client=window.supabase.createClient(DEFAULT_URL,DEFAULT_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});$('cloud-url').value=DEFAULT_URL;$('cloud-key').value=DEFAULT_KEY;const {data,error}=await client.auth.getUser();if(error&&!/session missing|auth session missing/i.test(error.message))msg('cloud-auth-status',error.message);setSignedIn(data?.user||null);client.auth.onAuthStateChange((_event,session)=>setSignedIn(session?.user||null));msg('cloud-config-status','Cloud connection ready.')}catch(err){status('Cloud initialization failed: '+err.message)}}
$('cloud-diagnostics-refresh').addEventListener('click',()=>{diagLog.unshift(new Date().toLocaleTimeString()+' Manual diagnostic requested');msg('cloud-sync-diagnostics',diagLog.join('\n\n'));void checkCloud()});
$('cloud-config').addEventListener('submit',e=>{e.preventDefault();status('Cloud connection is configured for VALE Connect. No changes required.')});
$('cloud-auth').addEventListener('submit',async e=>{e.preventDefault();if(!client)return;msg('cloud-auth-status','Signing in…');try{const {error}=await client.auth.signInWithPassword({email:$('cloud-email').value.trim(),password:$('cloud-password').value});msg('cloud-auth-status',error?'Sign in failed: '+error.message:'Signed in successfully.');if(!error)$('cloud-password').value=''}catch(err){msg('cloud-auth-status','Sign in failed: '+err.message)}});
$('cloud-signup').addEventListener('click',async()=>{if(!client)return;const email=$('cloud-email').value.trim(),password=$('cloud-password').value;if(!email||!password){msg('cloud-auth-status','Enter an email and password first.');return}try{const {data,error}=await client.auth.signUp({email,password,options:{emailRedirectTo:location.origin+location.pathname}});msg('cloud-auth-status',error?'Registration failed: '+error.message:data?.session?'Account created and signed in.':'Check your email for a confirmation link, then return and sign in.')}catch(err){msg('cloud-auth-status',err.message)}$('cloud-password').value=''});
$('cloud-signout').addEventListener('click',async()=>{if(!client)return;const {error}=await client.auth.signOut();msg('cloud-auth-status',error?error.message:'Signed out.');$('cloud-profile-preview').textContent=''});
$('cloud-upload').addEventListener('click',()=>void enqueue(async()=>{if(!user)return;const id=user.id;try{const remote=await fetchCloud(id),local=normalize(readCard());if(remote&&signature(remote)!==signature(local)&&!confirm('Replace the cloud card with this device’s card? Changes from another device may be lost.'))return;status('Saving…');const {error}=await client.from('profiles').upsert(toCloud(local,id),{onConflict:'id'});if(error)throw error;setBaseline(local);saveBlocked=false;status('Saved to cloud ✓')}catch(err){status('Cloud save failed: '+err.message)}}));
$('cloud-load').addEventListener('click',()=>void enqueue(async()=>{if(!user)return;try{const {data,error}=await client.from('profiles').select(COLUMNS+',created_at').eq('id',user.id).maybeSingle();if(error)throw error;$('cloud-profile-preview').textContent=data?JSON.stringify(data,null,2):'';status(data?'Cloud profile displayed below.':'No cloud profile found.')}catch(err){status('Cloud profile load failed: '+err.message)}}));
$('cloud-sync').addEventListener('click',()=>void enqueue(async()=>{if(!user)return;try{const remote=await fetchCloud(user.id);if(!remote){status('No cloud card found.');return}if(signature(remote)!==signature(readCard())&&!confirm('Replace this device’s card with the cloud card? Any unsynced local changes will be lost. Contacts are not affected.'))return;applyCloud(remote);saveRevision++;status('Cloud card loaded ✓')}catch(err){status('Cloud load failed: '+err.message)}}));
setSignedIn(null);void init();
})();
