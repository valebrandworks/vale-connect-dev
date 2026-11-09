// The card editor's photo flow: staged uploads, saving, replacing, removing, cancelling, making private and deleting.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.argv[2]||path.resolve(__dirname,'..');
const tools=require(path.join(path.resolve(root),'cards-core.js'));
const CARD='11111111-1111-4111-8111-111111111111',OWNER='owner-a',P=n=>CARD+'/photo-'+String(n).padStart(16,'0')+'.webp';
class Element{
 constructor(id){this.id=id;this.value='';this.children=[];this.handlers={};this.hidden=false;this.disabled=false;this.checked=false;this.readOnly=false;this.open=false;this.attrs={};this.dataset={};this.textContent='';this.width=560;this.files=null}
 append(...n){this.children.push(...n)}replaceChildren(...n){this.children=n}setAttribute(k,v){this.attrs[k]=v}
 addEventListener(k,fn){(this.handlers[k]||=[]).push(fn)}fire(k,e={}){for(const fn of this.handlers[k]||[])fn(e)}
 querySelectorAll(){return []}focus(){}click(){}getBoundingClientRect(){return {width:280}}setPointerCapture(){}
}
const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id)};
let rows=[{id:CARD,owner_id:OWNER,card_label:'My card',slug:'ana-1',display_name:'Ana',published:true,revision:1,updated_at:'1',appearance:'charcoal',photo_path:P(0),logo_path:null}];
let consent=true,n=0;const log=[],removed=[],uploads=[],privateCalls=[];
class Query{
 constructor(){this.verb='select';this.filters=[]}
 select(){return this}eq(k,v){this.filters.push([k,v]);return this}order(){return this}range(a,b){this.start=a;this.end=b;return this}
 update(p){this.verb='update';this.payload=p;return this}delete(){this.verb='delete';return this}insert(p){this.verb='insert';this.payload=p;return this}
 single(){return this.execute()}maybeSingle(){return this.execute()}then(a,b){return this.execute().then(a,b)}
 async execute(){
  const found=rows.filter(r=>this.filters.every(([k,v])=>r[k]===v));
  if(this.verb==='update'){log.push({update:{...this.payload}});if(!found.length)return {data:null,error:null};Object.assign(found[0],this.payload);return {data:{...found[0]},error:null}}
  if(this.verb==='delete'){log.push('delete');if(!found.length)return {data:null,error:null};rows=rows.filter(r=>r!==found[0]);return {data:{id:found[0].id},error:null}}
  return {data:found.slice(this.start||0,(this.end??found.length)+1).map(r=>({...r})),count:found.length,error:null};
 }
}
let files=[P(0)];
const images={
 upload:async(_c,card,kind,blob,ext)=>{const p=P(++n);uploads.push(p);files.push(p);return p},
 remove:async(_c,paths)=>{removed.push(...paths);files=files.filter(f=>!paths.includes(f))},
 objectUrl:async(_c,p)=>'blob:'+p,listCard:async()=>files.map(p=>({path:p,created:0})),
 makePrivate:async(_c,owner,card,edits)=>{privateCalls.push({card:{...card},edits});const r=rows.find(x=>x.id===card.id);Object.assign(r,edits,{published:false,revision:r.revision+1});return {ok:true,changed:true,card:{...r}}},
 finishPrivate:async(_c,card)=>({ok:true,card}),sweep:async()=>0,contactPhoto:async()=>'',blobOf:async()=>null
};
const crop={MAX_ZOOM:4,check:()=>'',decode:async()=>({width:800,height:600,close(){}}),state:()=>({zoom:1}),pan:s=>s,zoomTo:s=>s,draw(){},encode:async()=>({blob:{size:1},ext:'webp'})};
const view={PRESETS:['charcoal'],preset:v=>v||'charcoal',initials:()=>'A',web:s=>s,render:(data,o={})=>Object.assign(new Element('rendered'),{photoUrl:o.photoUrl})};
const handlers={};
const context={window:{ValeAccountLists:require(path.join(path.resolve(root),'account-lists.js')),ValeCardTools:tools,ValeCardView:view,ValeCardImages:images,ValePhotoCrop:crop,ValeUsage:{usage:()=>({max_cards:1}),refresh(){}},ValeApp:{tab(){}},addEventListener:(k,fn)=>{handlers[k]=fn},dispatchEvent(){}},
 document:{getElementById:get,createElement:()=>new Element('made'),createTextNode:t=>({textContent:t}),querySelectorAll:()=>[],querySelector:()=>null,addEventListener(){},hidden:false},
 confirm:()=>consent,URL:{createObjectURL:()=>'blob:local',revokeObjectURL(){}},CustomEvent:class{constructor(t,o){this.type=t;this.detail=o?.detail}},Event:class{constructor(t){this.type=t}},crypto:{randomUUID:()=>'abcdef12-3456'},navigator:{onLine:true}};
context.window.window=context.window;vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'cards.js'),'utf8'),context);
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r))};
const choose=async()=>{get('card-photo-input').files=[{size:1000,type:'image/jpeg'}];get('card-photo-input').fire('change');await settle();get('card-photo-use').onclick();await settle()};
const save=async()=>{get('card-editor').onsubmit({preventDefault(){}});await settle()};
const row=()=>rows[0];
(async()=>{
 handlers['vale-account-ready']({detail:{client:{from:()=>new Query()},user:{id:OWNER}}});await settle();
 assert.equal(get('card-preview').children[0].photoUrl,'blob:'+P(0),'the saved photo shows on the card screen');
 // Choosing a photo uploads a private, unattached file; nothing about the card changes until Save card.
 get('card-edit').onclick();assert.equal(get('card-photo-choose').hidden,false);await settle();
 await choose();assert.deepEqual(uploads,[P(1)]);assert.equal(row().photo_path,P(0));assert.equal(get('card-editor-preview').children[0].photoUrl,'blob:local');assert.match(get('cards-status').textContent,/Save card/);
 // Choosing again replaces the staged file, and the first staged upload is removed.
 await choose();assert.deepEqual(uploads,[P(1),P(2)]);assert.deepEqual(removed,[P(1)]);
 // Cancelling the editor discards the staged upload; the card keeps its photo.
 get('card-cancel').onclick();await settle();assert.deepEqual(removed,[P(1),P(2)]);assert.equal(row().photo_path,P(0));assert.equal(get('card-editor').hidden,true);
 // Replace and save: the new photo is attached in the guarded update, then the old file is removed.
 get('card-edit').onclick();await settle();await choose();await save();
 assert.equal(row().photo_path,P(3));assert.ok(removed.includes(P(0)),'old photo removed after saving');assert.ok(!removed.includes(P(3)));assert.equal(row().revision,2);
 // A save that loses to another device keeps the staged photo for a retry and changes nothing.
 get('card-edit').onclick();await settle();await choose();row().revision=9;await save();
 assert.equal(row().photo_path,P(3));assert.ok(!removed.includes(P(4)),'staged photo kept for retry');assert.match(get('cards-status').textContent,/another device/);
 row().revision=2;get('card-cancel').onclick();await settle();assert.ok(removed.includes(P(4)));
 // Removing the photo: saved as no photo, then the file is removed.
 get('card-edit').onclick();await settle();get('card-photo-remove').onclick();await settle();assert.equal(get('card-editor-preview').children[0].photoUrl,null);
 assert.equal(row().photo_path,P(3),'not removed until saved');await save();assert.equal(row().photo_path,null);assert.ok(removed.includes(P(3)));
 // Making a public card private with a new photo: the photo is saved first, then the whole card is made private (images renamed).
 get('card-edit').onclick();await settle();await choose();get('multi-published').checked=false;await save();
 assert.equal(privateCalls.length,1);assert.equal(privateCalls[0].card.photo_path,P(5),'rotation includes the new photo');assert.equal('photo_path' in privateCalls[0].edits,false);assert.equal(row().published,false);
 // Deleting a card with a photo: detached and its files removed first, then the card is deleted.
 get('card-edit').onclick();await settle();get('card-delete-understand').checked=true;log.length=0;get('cards-delete').onclick();await settle();
 assert.deepEqual(log[0],{update:log[0].update});assert.equal(log[0].update.photo_path,null);assert.ok(removed.includes(P(5)));assert.equal(log.at(-1),'delete');assert.equal(rows.length,0);
 // New cards can't take a photo until saved.
 get('card-create').onclick();assert.equal(get('card-photo-choose').hidden,true);assert.match(get('card-photo-note').textContent,/Save your card first/);
 console.log('PASS: photo staged privately until Save card; replacing removes the earlier staged upload; cancel discards it; saving attaches the new photo and removes the old; conflicts keep the staged photo; removal; unpublishing with a new photo renames it too; card deletion removes images first; new cards save before adding a photo.');
})().catch(e=>{console.error(e);process.exitCode=1});
