const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))};
function harness({deferInitial=false}={}){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',handlers:{},addEventListener(n,f){this.handlers[n]=f}});return elements.get(id)};
 const store=new Map([['vale-connect-dev-v09-card',JSON.stringify({fullName:'Synthetic local card'})]]);let authCallback,initialResolve,pending=null,delay=false,requests=0,writes=[],loaded=0;
 const client={auth:{getUser:()=>deferInitial?new Promise(r=>initialResolve=r):Promise.resolve({data:{user:null}}),onAuthStateChange:fn=>authCallback=fn,signOut:async()=>{authCallback('SIGNED_OUT',null);return {error:null}}},from(table){assert.equal(table,'profiles');return {select(){return this},eq(_k,id){this.id=id;return this},maybeSingle(){requests++;if(delay){delay=false;return new Promise(r=>pending=r)}return Promise.resolve({data:null})},async upsert(row){writes.push(row);return {error:null}}}}};
 const listeners={};const context={window:{supabase:{createClient:()=>client},addEventListener:(n,f)=>listeners[n]=f,dispatchEvent:e=>{if(e.type==='vale-cloud-card-loaded')loaded++}},document:{getElementById:get,addEventListener(){},hidden:false},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},setInterval:()=>1,clearInterval(){},CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts?.detail}},confirm:()=>true,location:{origin:'https://example.invalid',pathname:'/vale-connect-dev/'}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/../cloud-auth.js','utf8'),context);
 return {get,store,listeners,initial:data=>initialResolve(data),account:id=>authCallback(id?'SIGNED_IN':'SIGNED_OUT',id?{user:{id,email:id+'@example.invalid'}}:null),delay:()=>delay=true,resolve:data=>pending(data),writes,requests:()=>requests,loaded:()=>loaded};
}
(async()=>{
 for(const action of ['cloud-load','cloud-sync','cloud-upload']){
  for(const next of [null,'b']){
   const h=harness();await settle();h.account('a');await settle();h.delay();h.get(action).handlers.click();await settle();
   // A second old-account action must not execute under the next account.
   h.get('cloud-upload').handlers.click();h.account(next);h.resolve({data:{full_name:'Synthetic old account',bio:'Old private field'}});await settle();
   assert.equal(h.get('cloud-profile-preview').textContent,'');assert.equal(h.loaded(),0);assert.equal(h.writes.length,0);assert(!h.store.has('vale-connect-dev-v09-baseline-b'));assert.equal(JSON.parse(h.store.get('vale-connect-dev-v09-card')).fullName,'Synthetic local card');
  }
 }
 const h=harness();await settle();h.account('a');await settle();h.delay();h.get('cloud-load').handlers.click();await settle();await h.get('cloud-signout').handlers.click();h.resolve({data:{full_name:'Late old preview'}});await settle();assert.equal(h.get('cloud-profile-preview').textContent,'');
 const ok=harness();await settle();ok.account('a');await settle();ok.delay();ok.get('cloud-load').handlers.click();await settle();ok.resolve({data:{full_name:'Current account'}});await settle();assert.match(ok.get('cloud-profile-preview').textContent,/Current account/);ok.account(null);assert.equal(ok.get('cloud-profile-preview').textContent,'');
 const errors=harness();await settle();errors.account('a');await settle();errors.delay();errors.get('cloud-load').handlers.click();await settle();errors.account(null);errors.resolve({error:Error('Old private error')});await settle();assert(!errors.get('cloud-profile-status').textContent.includes('Old private error'));
 const queued=harness();await settle();queued.account('a');await settle();queued.delay();queued.get('cloud-load').handlers.click();await settle();queued.listeners['vale-card-saved']();queued.account('b');queued.resolve({data:null});await settle();assert.equal(queued.writes.length,0);
 const upload=harness();await settle();upload.account('a');await settle();upload.get('cloud-upload').handlers.click();await settle();assert.equal(upload.writes.length,1);assert.equal(upload.writes[0].id,'a');assert(upload.store.has('vale-connect-dev-v09-baseline-a'));
 const sync=harness();await settle();sync.account('a');await settle();sync.delay();sync.get('cloud-sync').handlers.click();await settle();sync.resolve({data:{full_name:'Current loaded card'}});await settle();assert.equal(sync.loaded(),1);assert.equal(JSON.parse(sync.store.get('vale-connect-dev-v09-card')).fullName,'Current loaded card');
 const auto=harness();await settle();auto.account('a');await settle();auto.listeners['vale-card-saved']();await settle();assert.equal(auto.writes.length,1);assert.equal(auto.writes[0].id,'a');
 for(const next of [null,'b']){const initial=harness({deferInitial:true});initial.account(next);initial.initial({data:{user:{id:'a',email:'a@example.invalid'}}});await settle();assert.equal(initial.get('cloud-session').textContent,next?'Signed in as b@example.invalid':'Not signed in');}
 console.log('PASS: late manual preview/load/upload success or error ignored after sign-out/A→B; queued old-account uploads never write; local card/baselines preserved; explicit/cross-tab sign-out clears preview; current-account preview still works.');
})().catch(e=>{console.error(e);process.exitCode=1});
