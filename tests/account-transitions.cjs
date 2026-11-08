// Account switching, sign-out cleanup of older browser data, and safe import decisions, with mock clients.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))};
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
class El{constructor(id=''){this.id=id;this.value='';this.textContent='';this.hidden=false;this.disabled=false;this.checked=false;this.children=[];this.handlers={};this.dataset={};this.style={};this.className=''}
 append(...n){this.children.push(...n)}replaceChildren(...n){this.children=[...n]}setAttribute(){}addEventListener(k,f){this.handlers[k]=f}querySelectorAll(){return []}get childElementCount(){return this.children.length}focus(){}}
function dom(){const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new El(id));return elements.get(id)};return {get,document:{getElementById:get,createElement:()=>new El(),createTextNode:t=>({textContent:t}),addEventListener(){},hidden:false}}}
function storage(entries){const m=new Map(entries);return {map:m,getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),key:i=>[...m.keys()][i]??null,get length(){return m.size}}}

async function signInOrder(){
 // A slow first "who is signed in?" answer never overrides a newer sign-in or sign-out.
 for(const next of [null,'b']){
  const {get,document}=dom();let authCallback,resolveInitial;
  const client={auth:{getUser:()=>new Promise(r=>resolveInitial=r),onAuthStateChange:fn=>authCallback=fn}};
  const context={window:{supabase:{createClient:()=>client},addEventListener(){},dispatchEvent(){}},document,CustomEvent:class{constructor(t,o){this.type=t;this.detail=o?.detail}},location:{origin:'https://dev.valebrandworks.com',pathname:'/'}};
  vm.createContext(context);vm.runInContext(read('cloud-auth.js'),context);
  authCallback(next?'SIGNED_IN':'SIGNED_OUT',next?{user:{id:next,email:next+'@example.invalid'}}:null);
  resolveInitial({data:{user:{id:'a',email:'a@example.invalid'}}});await settle();
  assert.equal(get('cloud-session').textContent,next?'b@example.invalid':'Not signed in');
 }
}

function importRules(){
 const imp=require(path.join(root,'import-local.js'));
 const card={fullName:'Ana Ruiz',jobTitle:'Founder',company:'Delta',phone:'',email:'ana@example.invalid',website:'delta.example',bio:'',socials:''};
 assert.equal(imp.readBrowserCard(storage([[imp.CARD_KEY,'{broken']])),null,'unreadable copies are ignored, not replaced');
 assert.equal(imp.readBrowserCard(storage([[imp.CARD_KEY,JSON.stringify({fullName:'  '})]])),null,'a blank card is not offered');
 assert.deepEqual(imp.readBrowserCard(storage([[imp.CARD_KEY,JSON.stringify({...card,extra:'x'})]])),card);
 const profile=imp.fromProfile({full_name:'Ana Ruiz',job_title:'Founder',business_name:'Delta',email:'ana@example.invalid',website:'delta.example',social_links:''});
 // The browser copy and the earlier profile are the same card: offered once. Matching a saved card marks it saved.
 let items=imp.plan([{from:'browser',values:card},{from:'profile',values:profile}],[]);
 assert.equal(items.length,1);assert.equal(items[0].saved,false);
 items=imp.plan([{from:'browser',values:card}],[{...card,website:' delta.example '}]);assert.equal(items[0].saved,true,'whitespace differences still count as the same card');
 items=imp.plan([{from:'browser',values:{...card,company:'Other'}}],[card]);assert.equal(items[0].saved,false,'a different card is never treated as saved');
 assert.equal(imp.plan([{from:'browser',values:null}],[]).length,0);
}

async function signOutCleanup(){
 const imp=require(path.join(root,'import-local.js'));
 const tools=require(path.join(root,'cards-core.js'));
 const local={fullName:'Ana Ruiz',jobTitle:'',company:'',phone:'',email:'',website:'',bio:'',socials:''};
 for(const inAccount of [true,false]){
  const {get,document}=dom();get('import-section');
  const store=storage([[imp.CARD_KEY,JSON.stringify(local)],['vale-connect-dev-v09-baseline-a','{"fullName":"Ana Ruiz"}'],['vale-connect-dev-v09-contacts','[]']]);
  const listeners={},row=tools.toRow(inAccount?local:{...local,fullName:'Someone Else'});
  const client={from(){return {select(){return this},eq(){return this},maybeSingle:async()=>({data:null})}}};
  const context={window:{addEventListener:(n,f)=>listeners[n]=f,ValeCardTools:tools,ValeCards:{list:()=>[row]},ValeConnections:{readContacts:()=>[]}},document,localStorage:store,JSON};
  context.window.window=context.window;context.window.document=document;vm.createContext(context);vm.runInContext(read('import-local.js'),context);
  listeners['vale-account-ready']({detail:{client,user:{id:'a'}}});await settle();
  listeners['vale-card-selected']({detail:{loaded:true}});
  const offered=get('import-card-list').children;assert.equal(get('import-section').hidden,false);assert.equal(offered.length,1);
  assert.equal(offered[0].children[2].children[0].textContent,inAccount?'Remove from this browser':'Review and use for my card',inAccount?'a copy already in the account can only be removed':'a different card is offered for review, never saved automatically');
  listeners['vale-account-ready']({detail:{client,user:null}});
  assert.equal(store.map.has(imp.CARD_KEY),!inAccount,inAccount?'a browser copy already in the account is removed at sign-out':'a browser copy not in the account is kept');
  assert.equal(store.map.has('vale-connect-dev-v09-baseline-a'),false,'old sync bookkeeping is removed at sign-out');
  assert.equal(store.map.has('vale-connect-dev-v09-contacts'),true,'browser connections are never removed at sign-out');
 }
}

async function cardSwitching(){
 // A slow card list for account A never appears after switching to account B.
 const {get,document}=dom();const listeners={},events=[];let pending=[];
 const tools=require(path.join(root,'cards-core.js')),view={render:()=>new El(),web:s=>s};
 const lists={read:(_c,_t,owner)=>new Promise(r=>pending.push({owner,r}))};
 const context={window:{addEventListener:(n,f)=>listeners[n]=f,dispatchEvent:e=>events.push(e),ValeCardTools:tools,ValeCardView:view,ValeAccountLists:lists},document,CustomEvent:class{constructor(t,o){this.type=t;this.detail=o?.detail}},crypto:{randomUUID:()=>'00000000-0000'},navigator:{onLine:true},Event:class{constructor(t){this.type=t}}};
 context.window.window=context.window;vm.createContext(context);vm.runInContext(read('cards.js'),context);
 listeners['vale-account-ready']({detail:{client:{},user:{id:'a'}}});await settle();
 listeners['vale-account-ready']({detail:{client:{},user:{id:'b'}}});await settle();
 pending.find(p=>p.owner==='a').r([{id:'card-a',owner_id:'a',card_label:'A',slug:'aaa-1',display_name:'Old account',published:true,revision:0,updated_at:'1'}]);await settle();
 assert.equal(context.window.ValeCards.current(),null,'old account card ignored');
 pending.find(p=>p.owner==='b').r([]);await settle();
 assert.equal(get('card-empty').hidden,false,'new account with no card sees Create my card');
 assert.equal(get('card-home').hidden,true);
 const last=events.filter(e=>e.type==='vale-card-selected').pop();assert.equal(last.detail.card,null);assert.equal(last.detail.loaded,true);
 listeners['vale-account-ready']({detail:{client:{},user:null}});
 assert.equal(get('card-signed-out').hidden,false);assert.equal(get('multi-fullName').value,'','editor is emptied at sign-out');
}

(async()=>{
 await signInOrder();importRules();await signOutCleanup();await cardSwitching();
 console.log('PASS: late sign-in answers ignored; older browser card offered once, never when already saved; sign-out removes only copies safely in the account and old sync bookkeeping; card lists never cross accounts; editor cleared at sign-out.');
})().catch(e=>{console.error(e);process.exitCode=1});
