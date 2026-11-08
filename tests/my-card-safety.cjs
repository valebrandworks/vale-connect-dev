// An unreadable saved My Card is never replaced without the user's explicit choice.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const CARD='vale-connect-dev-v09-card',settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))};
const UNREADABLE=['{corrupt','[]','null','"text"','7'];

function browserSave(raw,consent){
 const start=html.indexOf('function storedContacts()'),end=html.indexOf('function txt(v)');assert.ok(start>0&&end>start);
 const data=new Map(raw===null?[]:[[CARD,raw]]),elements=new Map(),prompts=[];
 const context={localStorage:{getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,v)},window:{ValeConnections:{readContacts:()=>[]}},alert(){},confirm:m=>{prompts.push(m);return consent},structuredClone,KEY:CARD,CKEY:'contacts',UNREADABLE_CONTACTS:'x',$:id=>{if(!elements.has(id))elements.set(id,{textContent:''});return elements.get(id)}};
 vm.createContext(context);vm.runInContext(html.slice(start,end),context);
 return {saved:context.save(CARD,{fullName:'Synthetic New'}),stored:data.get(CARD),prompts,message:context.$('save-message').textContent};
}
for(const raw of UNREADABLE){
 const refused=browserSave(raw,false);
 assert.equal(refused.saved,false,raw);assert.equal(refused.stored,raw);assert.equal(refused.prompts.length,1);assert.match(refused.message,/Nothing was replaced/);
 const accepted=browserSave(raw,true);
 assert.equal(accepted.saved,true,raw);assert.equal(JSON.parse(accepted.stored).fullName,'Synthetic New');
}
for(const raw of [null,JSON.stringify({fullName:'Synthetic Old'})]){const normal=browserSave(raw,false);assert.equal(normal.saved,true);assert.equal(normal.prompts.length,0)}

function signedIn(raw,remote,consent){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',handlers:{},addEventListener(n,f){this.handlers[n]=f}});return elements.get(id)};
 const store=new Map([[CARD,raw]]),writes=[];let auth,loaded=0;
 const client={auth:{getUser:async()=>({data:{user:null}}),onAuthStateChange:fn=>auth=fn},from(){return {select(){return this},eq(){return this},maybeSingle:async()=>({data:remote}),upsert:async row=>{writes.push(row);return {error:null}}}}};
 const listeners={},context={window:{supabase:{createClient:()=>client},addEventListener:(n,f)=>listeners[n]=f,dispatchEvent:e=>{if(e.type==='vale-cloud-card-loaded')loaded++}},document:{getElementById:get,addEventListener(){},hidden:false},localStorage:{getItem:k=>store.has(k)?store.get(k):null,setItem:(k,v)=>store.set(k,v)},setInterval:()=>1,clearInterval(){},CustomEvent:class{constructor(type,o){this.type=type;this.detail=o?.detail}},confirm:()=>consent,location:{origin:'https://example.invalid',pathname:'/'}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'cloud-auth.js'),'utf8'),context);
 return {get,store,writes,loaded:()=>loaded,signIn:()=>auth('SIGNED_IN',{user:{id:'a',email:'a@example.invalid'}})};
}
(async()=>{
 const remote={full_name:'Synthetic Cloud Card'};
 for(const raw of UNREADABLE){
  const h=signedIn(raw,remote,false);await settle();h.signIn();await settle();
  assert.equal(h.store.get(CARD),raw,'background check must not replace it');assert.equal(h.loaded(),0);assert.equal(h.writes.length,0);assert.match(h.get('cloud-profile-status').textContent,/could not be read/);
  h.get('cloud-sync').handlers.click();await settle();assert.equal(h.store.get(CARD),raw,'declined load must not replace it');
  const yes=signedIn(raw,remote,true);await settle();yes.signIn();await settle();yes.get('cloud-sync').handlers.click();await settle();assert.equal(JSON.parse(yes.store.get(CARD)).fullName,'Synthetic Cloud Card','explicit load replaces it');assert.equal(yes.writes.length,0);
 }
 const blank=signedIn(JSON.stringify({}),remote,false);await settle();blank.signIn();await settle();assert.equal(JSON.parse(blank.store.get(CARD)).fullName,'Synthetic Cloud Card','a readable empty card still loads from the cloud');
 console.log('PASS: unreadable My Card kept unless the user explicitly replaces it, signed out and signed in; message shown; no cloud write; normal saving and cloud loading unchanged.');
})().catch(error=>{console.error(error.message);process.exitCode=1});
