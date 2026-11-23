/* Environment settings for the VALE Connect pages, chosen by the exact web address.
   Every value here is PUBLIC by design: a Supabase project address, its publishable key (safe in a browser because
   row-level security and server-side checks decide what anyone can do) and Cloudflare Turnstile SITE keys.
   Secrets (Turnstile secret keys, hash salts, service keys, email keys) never belong here or anywhere in this repository.
   This is NOT a security boundary. It only stops a page from talking to the wrong project by mistake, and gives a copy
   of the site on any other address nothing to connect to. Access is decided by the database (RLS, grants, server-side
   functions) and the server functions (Turnstile, origin checks, rate limits), independently of this file. */
(function(root){
 'use strict';
 const ENVIRONMENTS=Object.freeze({
  production:Object.freeze({name:'production',label:'',supabaseUrl:'https://uhribjaiyuwivzqxusur.supabase.co',
   publishableKey:'sb_publishable_Va2YN7LUG0ZOuwril533WA__PUz_PL_',turnstileSiteKey:'0x4AAAAAAGMQcyUJYuAxhLXp',storagePrefix:'vale-connect-',backupEnvironment:'production',backupPrefix:'vale-connect-cloud-connections-',signupOpen:false,requireCurrentPassword:true}),
  /* dev-only:start */
  development:Object.freeze({name:'development',label:'Development',supabaseUrl:'https://jlprxnmdvoloahssjlnu.supabase.co',
   publishableKey:'sb_publishable_wxT0A5bByFX67J1ut0F-ZA_xITdxwf_',turnstileSiteKey:'0x4AAAAAAF5bZ3cludhKsLJJ',storagePrefix:'vale-connect-dev-',backupEnvironment:'development',backupPrefix:'vale-dev-cloud-connections-',signupOpen:true,requireCurrentPassword:true}),
  // This computer only: the development project with Cloudflare's published TEST site key, whose tokens the server never accepts.
  local:Object.freeze({name:'local',label:'Local',supabaseUrl:'https://jlprxnmdvoloahssjlnu.supabase.co',
   publishableKey:'sb_publishable_wxT0A5bByFX67J1ut0F-ZA_xITdxwf_',turnstileSiteKey:'1x00000000000000000000AA',storagePrefix:'vale-connect-dev-',backupEnvironment:'development',backupPrefix:'vale-dev-cloud-connections-',signupOpen:true,requireCurrentPassword:true}),
  /* dev-only:end */
 });
 const HOSTS=Object.freeze({'connect.valebrandworks.com':'production',
  /* dev-only:start */
  'dev.valebrandworks.com':'development','localhost':'local','127.0.0.1':'local',
  /* dev-only:end */
 });
 // The settings for an exact hostname, or null for any other address.
 function forHost(hostname){
  const name=typeof hostname==='string'&&Object.hasOwn(HOSTS,hostname)?HOSTS[hostname]:null;
  if(!name)return null;
  const env=ENVIRONMENTS[name];
  return Object.freeze({...env,functionsUrl:env.supabaseUrl+'/functions/v1'});
 }
 const functionUrl=(hostname,name)=>{const env=forHost(hostname);return env?env.functionsUrl+'/'+name:null};
 // Which backups a web address may export and restore: its environment name and file-name prefix, or null for any other address.
 // Backups are tied to the environment chosen here (by the exact hostname), never to anything inside a backup file.
 const backupFor=hostname=>{const env=forHost(hostname);return env?Object.freeze({environment:env.backupEnvironment,prefix:env.backupPrefix}):null};
 const api={ENVIRONMENTS,HOSTS,forHost,functionUrl,backupFor};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValeConfig=api;
})(typeof window!=='undefined'?window:globalThis);
