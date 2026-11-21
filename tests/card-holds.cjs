// A card hidden after a review: what its owner sees on the Card tab (reason, explanation, how to appeal), and that
// nothing offers to publish it. Never who reported it. Mock database; no network.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const holds=require(path.join(root,'card-holds.js')),reportCore=require(path.join(root,'report-core.js'));
const migration=read('supabase/migrations/20261114000000_add_card_reports.sql');

// ---------- Wording ----------
assert.deepEqual(Object.entries(holds.REASONS),reportCore.CATEGORIES.map(([k,label])=>[k,label]),'the same reasons as the report page');
assert.equal(holds.reason('constructor'),'A breach of VALE Connect’s rules');
assert.equal(holds.appealHref('ana-ruiz-1a2b3c'),'mailto:support@valebrandworks.com?subject=Appeal%3A%20hidden%20card%20ana-ruiz-1a2b3c');
const n=holds.notice({card_id:'c1',hidden_at:'2026-11-21T12:00:00Z',category:'impersonation',owner_message:' Looks like another business.\u0007 '},{slug:'ana-ruiz-1a2b3c'});
assert.equal(n.title,'This card was hidden after a review');assert.equal(n.reason,'Reason: Impersonation or fake identity.');assert.equal(n.message,'Looks like another business.');
assert.match(n.effect,/^Since November 21, 2026, people who open its link or QR code see that it isn’t available, and it can’t be published\./);
assert.match(n.appeal,/you can appeal\. Email support@valebrandworks\.com/);assert.match(n.appeal,/\(ana-ruiz-1a2b3c\)/);assert.match(n.appeal,/A person will review your appeal and reply\./);
assert.doesNotMatch(Object.values(n).join(' '),/reporter|reported by|network|email address of/i,'nothing about who reported it');
assert.match(migration,/RETURNS TABLE \(card_id uuid, hidden_at timestamptz, category text, owner_message text\)/,'the owner can only receive these four fields');
assert.match(migration,/To appeal, email support@valebrandworks\.com\./,'the database’s refusal also says how to appeal');
assert.equal(holds.byCard([{card_id:'a'},null,{card_id:1}]).size,1);
const lift=holds.lifted();assert.equal(lift.title,'Restriction lifted');assert.match(lift.text,/It’s still private: nobody can see it until you publish it again\./);
assert.deepEqual([...holds.liftedByCard([{id:'n1',kind:'card_restored',card_id:'c',read_at:null},{id:'n2',kind:'card_restored',card_id:'c',read_at:null},{id:'n3',kind:'card_restored',card_id:'c',read_at:'2026-11-21'},{id:'n4',kind:'card_hidden',card_id:'c'},{id:'n5',kind:'card_restored',card_id:null}])],[['c',['n1','n2']]],'only unread "restriction lifted" notices count');

// ---------- The Card tab ----------
function run(src,{rpcError=false}={}){
 class Element{
  constructor(id){this.id=id;this.value='';this.children=[];this.handlers={};this.hidden=false;this.disabled=false;this.checked=false;this.readOnly=false;this.attrs={};this.dataset={};this._text='';this.className='';this.href=''}
  get textContent(){return this._text+this.children.map(c=>c.textContent).join(' ')}set textContent(v){this._text=String(v);this.children=[]}
  append(...nodes){this.children.push(...nodes)}replaceChildren(...nodes){assert.ok(nodes.every(Boolean),'no empty children');this.children=nodes}
  setAttribute(k,v){this.attrs[k]=v}addEventListener(k,fn){(this.handlers[k]||=[]).push(fn)}
  querySelectorAll(){return []}focus(){}
 }
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id)};
 const tables={notifications:[{id:'n1',owner_id:'o1',kind:'card_restored',card_id:'c3',read_at:null},{id:'n2',owner_id:'o1',kind:'card_restored',card_id:'c2',read_at:null},
  {id:'n3',owner_id:'o1',kind:'card_restored',card_id:'c3',read_at:'2026-11-20T00:00:00Z'},{id:'n4',owner_id:'o1',kind:'share_added',card_id:null,read_at:null}]};
 let rows=[{id:'c1',owner_id:'o1',slug:'ana-ruiz-1a2b3c',card_label:'My card',display_name:'Ana Ruiz',published:false,revision:3,updated_at:'1'},
  {id:'c2',owner_id:'o1',slug:'ana-two-2b3c4d',card_label:'Second',display_name:'Ana Two',published:true,revision:1,updated_at:'2'},
  {id:'c3',owner_id:'o1',slug:'ana-three-3c4d5e',card_label:'Third',display_name:'Ana Three',published:false,revision:2,updated_at:'3'}];
 tables.public_cards=rows;
 const rpcs=[];
 class Query{constructor(table){this.table=table;this.filters=[]}select(){return this}eq(k,v){this.filters.push([k,v]);return this}order(){return this}range(a,b){this.a=a;this.b=b;return this}
  then(res,rej){const found=(tables[this.table]||[]).filter(r=>this.filters.every(([k,v])=>r[k]===v));return Promise.resolve({data:found.map(r=>({...r})),count:found.length,error:null}).then(res,rej)}}
 const client={from:table=>new Query(table),rpc:async(fn,args)=>{rpcs.push([fn,JSON.parse(JSON.stringify(args??null))]);if(fn==='mark_notifications_read'){for(const n of tables.notifications)if(args.p_ids.includes(n.id))n.read_at='now';return {data:args.p_ids.length,error:null}}return rpcError?{data:null,error:{message:'boom'}}:{data:[{card_id:'c1',hidden_at:'2026-11-21T12:00:00Z',category:'scam',owner_message:'Asked visitors for payment details.'}],error:null}},
  storage:{from:()=>({list:async()=>({data:[],error:null}),remove:async()=>({data:[],error:null})})}};
 const handlers={};
 const view={PRESETS:['charcoal'],preset:()=>'charcoal',render:()=>new Element('rendered')};
 const context={window:{ValeCardHolds:holds,ValeCardTools:require(path.join(root,'cards-core.js')),ValeCardView:view,ValeAccountLists:require(path.join(root,'account-lists.js')),ValeUsage:{usage:()=>({max_cards:3}),refresh(){}},
  addEventListener:(k,fn)=>{handlers[k]=fn},dispatchEvent(){}},
  document:{getElementById:get,createElement:t=>new Element(t),createTextNode:t=>({textContent:t}),addEventListener(){},hidden:false,querySelectorAll:()=>[],querySelector:()=>null},
  CustomEvent:class{constructor(t,o){this.type=t;this.detail=o?.detail}},Event:class{constructor(t){this.type=t}},crypto:{randomUUID:()=>'abcdef12-3456'},navigator:{onLine:true},URL:{revokeObjectURL(){}}};
 context.window.window=context.window;vm.createContext(context);vm.runInContext(src,context);
 return {get,rpcs,handlers,client,tables,select:label=>get('card-switcher').children.find(b=>b.textContent===label).onclick()};
}
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))};
async function behaviour(src){
 const t=run(src);t.handlers['vale-account-ready']({detail:{client:t.client,user:{id:'o1'}}});await settle();
 assert.deepEqual(t.rpcs,[['get_my_card_holds',null],['mark_notifications_read',{p_ids:['n2']}]],'hidden cards are read; a card already published again has its notice marked read');
 const box=t.get('card-hold-notice');
 assert.equal(t.get('card-visibility').textContent,'Hidden after a review');assert.equal(box.hidden,false);
 assert.match(box.textContent,/This card was hidden after a review/);assert.match(box.textContent,/Reason: Scam or fraud\./);
 assert.match(box.textContent,/Message from VALE Connect: Asked visitors for payment details\./);assert.match(box.textContent,/you can appeal/);
 assert.equal(box.children.find(c=>c.textContent==='Email an appeal').href,'mailto:support@valebrandworks.com?subject=Appeal%3A%20hidden%20card%20ana-ruiz-1a2b3c');
 assert.equal(t.get('card-publish-row').hidden,true,'nothing offers to publish a hidden card');assert.equal(t.get('card-share-row').hidden,true);
 t.get('card-edit').onclick();assert.equal(t.get('card-public-field').hidden,true,'the editor doesn’t offer to make it public');assert.equal(t.get('multi-published').checked,false);assert.equal(box.hidden,true,'the notice steps aside while editing');
 // Another card of the same owner is unaffected.
 t.get('card-cancel').onclick();await settle();t.select('Second');
 assert.equal(t.get('card-visibility').textContent,'Public');assert.equal(box.hidden,true);
 // A card whose restriction was lifted: still private, the owner is told, and can publish it when ready.
 t.select('Third');
 assert.equal(t.get('card-visibility').textContent,'Private · restriction lifted');assert.equal(box.hidden,false);assert.equal(box.dataset.kind,'lifted');
 assert.match(box.textContent,/Restriction lifted/);assert.match(box.textContent,/still private: nobody can see it until you publish it again/);
 assert.doesNotMatch(box.textContent,/appeal|Reason:/,'not the hidden-card notice');
 assert.equal(t.get('card-publish-row').hidden,false,'publishing is offered again');assert.equal(t.get('card-share-row').hidden,true,'not shareable until published');
 box.children.find(c=>c.textContent==='Dismiss').onclick();await settle();
 assert.deepEqual(t.rpcs.at(-1),['mark_notifications_read',{p_ids:['n1']}],'dismissing marks only its own unread notice read');
 assert.equal(box.hidden,true);assert.equal(t.get('card-visibility').textContent,'Private draft · only you can see it');
 assert.equal(t.tables.public_cards.find(c=>c.id==='c3').published,false,'the page never publishes it on its own');
 // If the holds can't be read, nothing breaks (the database still refuses to publish a hidden card).
 const u=run(src,{rpcError:true});u.handlers['vale-account-ready']({detail:{client:u.client,user:{id:'o1'}}});await settle();
 assert.equal(u.get('card-visibility').textContent,'Private draft · only you can see it');assert.equal(u.get('card-hold-notice').hidden,true);
}
const SABOTAGE=[
 ['holds never read',"if(holdTools&&typeof client.rpc==='function'){","if(false){"],
 ['publish offered for a hidden card',"$('card-publish-row').hidden=!!selected.published||!!held;","$('card-publish-row').hidden=!!selected.published;"],
 ['editor offers to publish a hidden card',"$('card-public-field').hidden=!row||holds.has(row.id);","$('card-public-field').hidden=!row;"],
 ['no notice',"  box.hidden=false;\n","  box.hidden=true;\n"],
 ['restriction-lifted notice never shown',"liftedIds=!held&&!selected.published?lifted.get(selected.id)||null:null","liftedIds=null"],
 ['dismissing doesn’t mark the notice read',"const {error}=await client.rpc('mark_notifications_read',{p_ids:ids});","const error=null;"],
 ['a published card keeps its notice unread',"for(const row of cards)if(row.published&&lifted.has(row.id))void dismissLifted(row.id);",""],
 ['notices never read',"try{const {data:notes,error}=await client.from('notifications')","try{const {data:notes,error}={data:[],error:null};void client.from('notifications')"],
 ['notice left on another card',"  if(!selected||isEditing)renderHold(null);","  if(false)renderHold(null);"],
];
(async()=>{
 const src=read('cards.js');
 await behaviour(src);
 for(const [label,find,replace] of SABOTAGE){
  assert.ok(src.includes(find),'sabotage target not found: '+label);
  let failed=false;try{await behaviour(src.replace(find,replace))}catch{failed=true}
  assert.ok(failed,'a broken protection went unnoticed: '+label);
 }
 const index=read('index.html');
 assert.match(index,/<div id="card-hold-notice" class="note hold-notice" role="status" hidden><\/div>/);
 assert.match(index,/<script src="card-holds\.js\?v=\d+"><\/script><script src="cards\.js\?v=\d+"><\/script>/,'loaded before the Card tab');
 console.log('hidden-card notice: checks passed; '+SABOTAGE.length+' of '+SABOTAGE.length+' broken protections caught');
})().catch(e=>{console.error(e);process.exit(1)});
