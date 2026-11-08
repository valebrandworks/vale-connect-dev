// The Card tab: one card on Free, several on plans that allow them, with a mock database.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.argv[2]||path.resolve(__dirname,'..');
const tools=require(path.join(path.resolve(root),'cards-core.js'));
const editor={fullName:'Test, Person',company:'VALE Brandworks',bio:'Line 1\nLine 2',socials:'Site | https://example.invalid'};
assert.equal(tools.toEditor(tools.toRow(editor)).company,'VALE Brandworks');
assert.match(tools.vcard(editor),/FN:Test\\, Person/);
assert.match(tools.vcard(editor),/NOTE:Line 1\\nLine 2/);
assert.ok(tools.validate('', 'good-slug',editor));assert.ok(tools.validate('Card','Bad Slug',editor));assert.ok(tools.validate('Card','good-slug',{}));assert.equal(tools.validate('Card','good-slug',editor),'');
class Element{
 constructor(id){this.id=id;this.value='';this.children=[];this.handlers={};this.hidden=false;this.disabled=false;this.checked=false;this.readOnly=false;this.open=false;this.attrs={};this.dataset={};this.textContent='';this.className=''}
 append(...nodes){this.children.push(...nodes)}replaceChildren(...nodes){this.children=nodes}
 setAttribute(k,v){this.attrs[k]=v}addEventListener(k,fn){(this.handlers[k]||=[]).push(fn)}fire(k,e={}){for(const fn of this.handlers[k]||[])fn(e)}
 querySelectorAll(){return [...elements.values()].filter(x=>x.id.startsWith('multi-')||x.id.startsWith('card')||x.id.startsWith('cards'))}focus(){}
}
const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id)};
let rows=[],handlers={},events=[],usage={max_cards:1},consent=true,inserts=[];
class Query{
 constructor(){this.verb='select';this.filters=[]}
 select(){return this}eq(k,v){this.filters.push([k,v]);return this}order(){return this}range(from,to){this.start=from;this.end=to;return this}
 insert(payload){this.verb='insert';this.payload=payload;return this}update(payload){this.verb='update';this.payload=payload;return this}delete(){this.verb='delete';return this}
 single(){return this.execute()}maybeSingle(){return this.execute()}
 then(resolve,reject){return this.execute().then(resolve,reject)}
 async execute(){
  if(this.verb==='insert'){
   inserts.push({...this.payload});
   // Same rule as the database's enforce_card_rules(): every new card starts as a private draft.
   if(this.payload.published!==false)return {data:null,error:{message:'New cards start as private drafts. Save it first, then publish.'}};
   if(rows.filter(r=>r.owner_id===this.payload.owner_id).length>=(usage.max_cards??Infinity))return {data:null,error:{message:'Your Free plan includes 1 card.'}};
   const row={id:require('node:crypto').randomUUID(),revision:0,updated_at:String(rows.length),...this.payload};rows.push(row);return {data:{...row},error:null};
  }
  const found=rows.filter(row=>this.filters.every(([k,v])=>row[k]===v));
  if(this.verb==='update'){if(!found.length)return {data:null,error:null};Object.assign(found[0],this.payload);return {data:{...found[0]},error:null}}
  if(this.verb==='delete'){if(!found.length)return {data:null,error:null};rows=rows.filter(r=>r!==found[0]);return {data:{id:found[0].id},error:null}}
  return {data:found.slice(this.start||0,(this.end??found.length)+1).map(r=>({...r})),count:found.length,error:null};
 }
}
const client={from:()=>new Query()};
const view={render:data=>Object.assign(new Element('rendered'),{data}),web:s=>/^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(String(s).replace(/^https?:\/\//,''))?'https://'+s:null};
const context={window:{ValeAccountLists:require(path.join(path.resolve(root),'account-lists.js')),ValeCardTools:tools,ValeCardView:view,ValeUsage:{usage:()=>usage,refresh(){}},ValeApp:{tab(){}},
 addEventListener:(k,fn)=>{handlers[k]=fn},dispatchEvent:e=>events.push(e)},document:{getElementById:get,createElement:()=>new Element('made'),addEventListener(){},hidden:false},
 confirm:()=>consent,CustomEvent:class{constructor(t,o){this.type=t;this.detail=o?.detail}},Event:class{constructor(t){this.type=t}},crypto:{randomUUID:()=>'abcdef12-3456'},navigator:{onLine:true}};
context.window.window=context.window;
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'cards.js'),'utf8'),context);
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve))};
const type=(id,value)=>{get(id).value=value;get(id).fire('input');get('card-editor').fire('input')};
async function save(){get('card-editor').onsubmit({preventDefault(){}});await settle()}
const lastSelected=()=>events.filter(e=>e.type==='vale-card-selected').pop().detail;
(async()=>{
 assert.equal(get('card-signed-out').hidden,false);
 handlers['vale-account-ready']({detail:{client,user:{id:'owner-a'}}});await settle();
 // Free, no card yet: one clear way to start.
 assert.equal(get('card-empty').hidden,false);assert.equal(get('card-home').hidden,true);
 get('card-create').onclick();assert.equal(get('card-editor').hidden,false);assert.equal(get('card-label-field').hidden,true,'Free never sees card names');
 assert.equal(get('multi-published').checked,false,'new cards start private');assert.equal(get('card-public-field').hidden,true,'no Public option before the first save');assert.equal(get('card-draft-note').hidden,false);assert.equal(get('card-delete-section').hidden,true);
 type('multi-fullName','Ana Ruiz');assert.equal(get('multi-slug').value,'ana-ruiz-abcdef','link name follows the name until edited');
 type('multi-website','not a website');await save();assert.equal(rows.length,0);assert.match(get('cards-status').textContent,/website/);
 type('multi-website','example.com');await save();
 assert.equal(rows.length,1);assert.equal(rows[0].owner_id,'owner-a');assert.equal(rows[0].card_label,'My card');assert.equal(rows[0].slug,'ana-ruiz-abcdef');
 assert.equal(inserts.at(-1).published,false,'the insert itself asks for a private draft, as the database requires');assert.equal(rows[0].published,false);
 assert.match(get('cards-status').textContent,/Draft saved/);
 // The card itself is the screen, with Share beneath it. No switcher or second card on Free.
 assert.equal(get('card-editor').hidden,true);assert.equal(get('card-home').hidden,false);assert.equal(get('card-preview').children[0].data.fullName,'Ana Ruiz');
 assert.match(get('card-visibility').textContent,/Private draft/);assert.equal(get('card-publish-row').hidden,false);assert.equal(get('card-share-row').hidden,true,'Share appears only once published');
 assert.equal(get('card-switcher').hidden,true);assert.equal(get('cards-new').hidden,true);
 // Publishing is a separate, confirmed step; cancelling changes nothing.
 consent=false;await get('card-publish').onclick();await settle();assert.equal(rows[0].published,false);
 consent=true;await get('card-publish').onclick();await settle();assert.equal(rows[0].published,true);assert.equal(rows[0].revision,1);
 assert.equal(get('card-visibility').textContent,'Public');assert.equal(get('card-publish-row').hidden,true);assert.equal(get('card-share-row').hidden,false);assert.match(get('cards-status').textContent,/Published/);
 assert.equal(lastSelected().card.slug,'ana-ruiz-abcdef');assert.equal(lastSelected().loaded,true);
 // Editing keeps the link name fixed and is guarded by the card's revision.
 get('card-edit').onclick();assert.equal(get('multi-slug').readOnly,true);assert.equal(get('card-delete-section').hidden,false);
 type('multi-company','Delta');get('multi-published').checked=false;await save();
 assert.equal(get('card-public-field').hidden,false,'existing cards can be made private again');
 assert.equal(rows[0].business_name,'Delta');assert.equal(rows[0].published,false);assert.equal(rows[0].revision,2);assert.match(get('card-visibility').textContent,/Private/);
 get('card-edit').onclick();rows[0].revision=9;rows[0].display_name='Other device';type('multi-fullName','Stale edit');await save();
 assert.equal(rows[0].display_name,'Other device');assert.equal(get('multi-fullName').value,'Stale edit');assert.equal(get('card-editor').hidden,false);assert.match(get('cards-status').textContent,/another device/);
 rows[0].revision=2;
 // Imported details fill the editor for review; nothing is saved until Save.
 const before=JSON.stringify(rows);context.window.ValeCards.prefill({fullName:'Imported Name',jobTitle:'',company:'',phone:'',email:'',website:'',bio:'',socials:''});
 assert.equal(get('multi-fullName').value,'Imported Name');assert.equal(JSON.stringify(rows),before);assert.match(get('cards-status').textContent,/Review/);
 // Deleting needs the tick box.
 get('cards-delete').onclick();await settle();assert.equal(rows.length,1);assert.match(get('cards-status').textContent,/Tick the box/);
 get('card-delete-understand').checked=true;get('cards-delete').onclick();await settle();assert.equal(rows.length,0);assert.equal(get('card-empty').hidden,false);
 // Plans with more cards get a switcher and card names, from the same screen.
 usage={max_cards:3};handlers['vale-usage-updated']();
 get('card-create').onclick();assert.equal(get('card-label-field').hidden,false);type('multi-label','Work');type('multi-fullName','Ana Work');get('multi-published').checked=true;await save();assert.equal(rows.at(-1).published,false,'a ticked box never publishes a brand-new card');
 assert.equal(get('cards-new').hidden,false);get('cards-new').onclick();type('multi-label','Personal');type('multi-fullName','Ana Home');await save();
 assert.equal(rows.length,2);assert.equal(get('card-switcher').hidden,false);assert.equal(get('card-switcher').children.length,2);
 get('card-switcher').children.find(b=>b.textContent==='Work').onclick();assert.equal(lastSelected().card.card_label,'Work');
 // Another account never sees these cards; signing out empties the screen.
 handlers['vale-account-ready']({detail:{client,user:{id:'owner-b'}}});await settle();assert.equal(get('card-empty').hidden,false);assert.equal(lastSelected().card,null);
 handlers['vale-account-ready']({detail:{client,user:null}});await settle();assert.equal(get('card-signed-out').hidden,false);assert.equal(get('multi-fullName').value,'');
 console.log('PASS: field conversion/VCF/validation; new cards are inserted as private drafts (database rule mirrored); publishing is a separate confirmed step; Share appears once public; fixed link; revision-guarded edits keep stale text; import fills the editor without saving; tick-box deletion; multi-card switcher on larger plans; accounts kept apart.');
})().catch(e=>{console.error(e);process.exitCode=1});
