const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.argv[2]||path.resolve(__dirname,'..');
const tools=require(path.join(path.resolve(root),'cards-core.js'));
const editor={fullName:'Test, Person',company:'VALE Brandworks',bio:'Line 1\nLine 2',socials:'Site | https://example.invalid'};
assert.equal(tools.toEditor(tools.toRow(editor)).company,'VALE Brandworks');
assert.match(tools.vcard(editor),/FN:Test\\, Person/);
assert.match(tools.vcard(editor),/NOTE:Line 1\\nLine 2/);
assert.ok(tools.validate('', 'good-slug',editor));assert.ok(tools.validate('Card','Bad Slug',editor));assert.ok(tools.validate('Card','good-slug',{}));assert.equal(tools.validate('Card','good-slug',editor),'');
class Element{
 constructor(id){this.id=id;this.value='';this.children=[];this.handlers={};this.hidden=false;this.disabled=false;this.attrs={};this.textContent=''}
 append(...nodes){this.children.push(...nodes)}replaceChildren(...nodes){this.children=nodes}
 setAttribute(k,v){this.attrs[k]=v}removeAttribute(k){delete this[k];delete this.attrs[k]}
 addEventListener(k,fn){this.handlers[k]=fn}querySelectorAll(){return [...elements.values()].filter(x=>x.id.startsWith('multi-'))}
 querySelector(tag){return this.children.find(x=>x.tag===tag)||null}
 getContext(){return {fillRect(){}}}toDataURL(){return 'data:image/png;base64,test'}click(){}
}
const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,new Element(id));return elements.get(id)};
let rows=[],eventHandlers={},confirmCount=0;
class Query{
 constructor(){this.verb='select';this.filters=[]}
 select(){return this}eq(k,v){this.filters.push([k,v]);return this}order(){return this}range(from,to){this.start=from;this.end=to;return this}
 insert(payload){this.verb='insert';this.payload=payload;return this}update(payload){this.verb='update';this.payload=payload;return this}
 single(){return this.execute()}maybeSingle(){return this.execute()}
 then(resolve,reject){return this.execute().then(resolve,reject)}
 async execute(){
  if(this.verb==='insert'){
   const row={id:require('node:crypto').randomUUID(),revision:0,...this.payload};rows.push(row);return {data:{...row},error:null};
  }
  const found=rows.filter(row=>this.filters.every(([k,v])=>row[k]===v));
  if(this.verb==='update'){if(!found.length)return {data:null,error:null};Object.assign(found[0],this.payload);return {data:{...found[0]},error:null}}
  return {data:found.slice(this.start||0,Math.min((this.end??found.length)+1,(this.start||0)+73)).map(r=>({...r})),count:found.length,error:null};
 }
}
const client={from:()=>new Query()};
const context={window:{ValeAccountLists:require(path.join(path.resolve(root),'account-lists.js')),ValeCardTools:tools,ValeQR:class{addData(){}make(){}getModuleCount(){return 21}isDark(){return true}},addEventListener:(k,fn)=>{eventHandlers[k]=fn}},document:{getElementById:get,createElement:tag=>Object.assign(new Element(''),{tag})},location:{href:'https://example.invalid/vale-connect-dev/'},URL,crypto:require('node:crypto').webcrypto,confirm:()=>{confirmCount++;return true},console};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'cards.js'),'utf8'),context);
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve))};
const fill=(label,name)=>{get('multi-label').value=label;get('multi-slug').value=label.toLowerCase().replace(/ /g,'-');get('multi-fullName').value=name;get('multi-company').value=label;get('cards-form').handlers.input()};
async function save(){get('cards-form').onsubmit({preventDefault(){}});await settle()}
(async()=>{
 assert.equal(get('cards-workspace').hidden,true);
 eventHandlers['vale-account-ready']({detail:{client,user:{id:'owner-a'}}});await settle();
 assert.equal(get('cards-workspace').hidden,false);
 fill('VALE Brandworks','Synthetic A');await save();
 assert.equal(rows.length,1);assert.equal(rows[0].published,false);assert.equal(rows[0].owner_id,'owner-a');
 assert.equal(get('cards-public-link').hidden,true);
 get('cards-new').onclick();fill('VALE Connect','Synthetic B');await save();
 assert.equal(rows.length,2);assert.notEqual(rows[0].id,rows[1].id);assert.equal(rows[1].published,false);
 get('cards-publish').onclick();await settle();
 assert.equal(rows[1].published,true);assert.match(get('cards-public-link').href,/p\.html\?u=vale-connect$/);assert.equal(get('cards-qr-download').disabled,false);
 get('cards-publish').onclick();await settle();assert.equal(rows[1].published,false);assert.equal(get('cards-public-link').hidden,true);
 // Another session updates the selected row after it was loaded.
 rows[1].revision++;rows[1].display_name='Other session';
 get('multi-fullName').value='Stale edit';get('cards-form').handlers.input();await save();
 assert.equal(rows[1].display_name,'Other session');assert.equal(get('multi-fullName').value,'Stale edit');assert.match(get('cards-status').textContent,/changed in another session/);
 get('cards-refresh').onclick();await settle();assert.equal(get('multi-fullName').value,'Other session');
 eventHandlers['vale-account-ready']({detail:{client,user:{id:'owner-b'}}});await settle();
 assert.equal(get('multi-fullName').value,'');assert.match(get('cards-list').children[0].textContent,/No saved cards/);
 eventHandlers['vale-account-ready']({detail:{client,user:null}});await settle();assert.equal(get('cards-workspace').hidden,true);
 rows=Array.from({length:1003},(_,i)=>({id:'large-'+String(i).padStart(5,'0'),owner_id:'owner-a',card_label:'Card '+i,published:false}));eventHandlers['vale-account-ready']({detail:{client,user:{id:'owner-a'}}});await settle();assert.equal(get('cards-list').children.length,1003);
 console.log('PASS: field conversion/VCF/validation; two drafts for one owner; separate IDs; explicit publish/unpublish and QR; stale revision preserves edits; refresh reload; account switch/sign-out clear manager.');
})().catch(e=>{console.error(e);process.exitCode=1});
