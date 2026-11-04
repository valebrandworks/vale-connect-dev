// Password reset, password change, archive controls and the public card lookup, with a mock client.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))};
function harness(result={error:null}){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,handlers:{},addEventListener(n,f){this.handlers[n]=f}});return elements.get(id)};
 const calls={reset:[],update:[]};let auth,clicked=0;
 const client={auth:{getUser:async()=>({data:{user:null}}),onAuthStateChange:fn=>auth=fn,resetPasswordForEmail:async(email,o)=>{calls.reset.push({email,...o});return result},updateUser:async u=>{calls.update.push(u);return result}},from(){return {select(){return this},eq(){return this},maybeSingle:async()=>({data:null})}}};
 const context={window:{supabase:{createClient:()=>client},addEventListener(){},dispatchEvent(){}},document:{getElementById:get,addEventListener(){},hidden:false,querySelector:()=>({click(){clicked++}})},localStorage:{getItem:()=>null,setItem(){}},setInterval:()=>1,clearInterval(){},CustomEvent:class{constructor(t,o){this.type=t;this.detail=o?.detail}},confirm:()=>true,location:{origin:'https://dev.valebrandworks.com',pathname:'/'}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'cloud-auth.js'),'utf8'),context);
 return {get,calls,clicked:()=>clicked,event:(name,user)=>auth(name,user?{user}:null)};
}
(async()=>{
 let h=harness();await settle();
 await h.get('cloud-reset').handlers.click();assert.match(h.get('cloud-auth-status').textContent,/Enter your email/);assert.equal(h.calls.reset.length,0);
 h.get('cloud-email').value='synthetic@example.invalid';await h.get('cloud-reset').handlers.click();
 assert.equal(h.calls.reset[0].email,'synthetic@example.invalid');assert.equal(h.calls.reset[0].redirectTo,'https://dev.valebrandworks.com/');
 const sent=h.get('cloud-auth-status').textContent;assert.match(sent,/If that email has an account/);
 // The answer must not reveal whether an account exists.
 const missing=harness({error:{message:'User not found'}});await settle();missing.get('cloud-email').value='synthetic@example.invalid';await missing.get('cloud-reset').handlers.click();assert.equal(missing.get('cloud-auth-status').textContent,sent);
 // A recovery link opens the new password form on the account tab.
 h=harness();await settle();h.get('cloud-new-password').hidden=true;h.event('PASSWORD_RECOVERY',{id:'a',email:'a@example.invalid'});assert.equal(h.get('cloud-new-password').hidden,false);assert.equal(h.clicked(),1);
 const form=h.get('cloud-new-password'),submit=()=>form.handlers.submit({preventDefault(){}});
 h.get('cloud-new-password-value').value='short';await submit();assert.equal(h.calls.update.length,0);assert.match(h.get('cloud-auth-status').textContent,/at least 8/);
 h.get('cloud-new-password-value').value='Synthetic-Pass-1';h.get('cloud-new-password-confirm').value='Different-Pass-1';await submit();assert.equal(h.calls.update.length,0);assert.match(h.get('cloud-auth-status').textContent,/match/);
 h.get('cloud-new-password-confirm').value='Synthetic-Pass-1';await submit();assert.equal(h.calls.update[0].password,'Synthetic-Pass-1');assert.equal(form.hidden,true);assert.equal(h.get('cloud-new-password-value').value,'');assert.match(h.get('cloud-auth-status').textContent,/Password changed/);
 // Change password is only offered when signed in; short sign-up passwords are refused.
 h=harness();await settle();assert.equal(h.get('cloud-change-password').hidden,true);h.event('SIGNED_IN',{id:'a',email:'a@example.invalid'});assert.equal(h.get('cloud-change-password').hidden,false);h.event('SIGNED_OUT',null);assert.equal(h.get('cloud-change-password').hidden,true);
 h.get('cloud-email').value='synthetic@example.invalid';h.get('cloud-password').value='short';await h.get('cloud-signup').handlers.click();assert.match(h.get('cloud-auth-status').textContent,/at least 8/);
 // Public card page uses the lookup, never the table.
 const page=fs.readFileSync(path.join(root,'p.html'),'utf8');assert.match(page,/client\.rpc\('get_public_card'/);assert.doesNotMatch(page,/from\('public_cards'\)/);
 // Archived connections leave the totals, and the core sends a guarded update.
 const core=require(path.join(root,'cloud-connections-core.js'));
 assert.equal(core.overview([],[{next_step:'Follow up',archived_at:'2026-01-01'},{next_step:'Follow up'}],'2026-11-04').count,1);
 let body,filters=[];const api={from(){return this},update(b){body=b;return this},eq(k,v){filters.push([k,v]);return this},select(){return this},maybeSingle:async()=>({data:{id:'c'},error:null})};
 await core.setArchived(api,'o',{id:'c',revision:4},true);assert.ok(body.archived_at);assert.equal(body.revision,5);assert.deepEqual(filters,[['id','c'],['owner_id','o'],['revision',4]]);
 filters=[];await core.setArchived(api,'o',{id:'c',revision:5},false);assert.equal(body.archived_at,null);
 assert.ok(require(path.join(root,'connections-export.js')).columns.includes('archived_at'));
 console.log('PASS: password reset without revealing accounts; recovery and change-password forms; sign-up length; public card lookup; archive and restore.');
})().catch(error=>{console.error(error);process.exitCode=1});
