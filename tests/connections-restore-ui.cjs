const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),restore=require('../connections-restore.js'),exp=require('../connections-export.js');
const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new El());return elements.get(id)};
class El{constructor(){this.value='';this.children=[];this.style={};this.disabled=false;this.textContent=''}append(...n){this.children.push(...n)}replaceChildren(){this.children=[]}querySelectorAll(){const found=[];function scan(e){for(const c of e.children||[]){if(c.type==='checkbox')found.push(c);scan(c)}}scan(this);return found}}
let handlers={},consent=true,records=[],inserts=0,events=0,pending=null,delay=false;
const row={id:'11111111-1111-4111-8111-111111111111',full_name:'Backup Restore Test',business_name:'Development Only',category:'Other',next_step:'Follow up',notes:'Private restore note',history:[{date:'2026-11-02',text:'Private dated note'}]};
const client={from(){return {insert(data){this.data=data;return this},select(){return this},async single(){inserts++;const data={...this.data,id:'22222222-2222-4222-8222-222222222222'};records.push(data);return {data}}}}};
const exporter={fetchAll:async()=>{if(delay)await new Promise(r=>pending=r);return records}};
const context={window:{ValeConnectionRestore:restore,ValeConnectionExport:exporter,addEventListener:(n,f)=>handlers[n]=f,dispatchEvent:()=>events++},document:{getElementById:get,createElement:()=>new El(),createTextNode:text=>({textContent:text})},confirm:()=>consent,Event};
vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/../connections-restore-ui.js','utf8'),context);
const account=user=>handlers['vale-account-ready']({detail:{client,user}}),settle=async()=>{for(let i=0;i<6;i++)await new Promise(r=>setImmediate(r))};
function file(text=exp.file([row],'json').body){get('cloud-restore-file').files=[{size:Buffer.byteLength(text),text:async()=>text}];get('cloud-restore-file').onchange()}
(async()=>{
 assert.equal(get('cloud-restore-preview').disabled,true);account({id:'owner-a',email:'a@example.invalid'});file();await get('cloud-restore-preview').onclick();
 let checks=get('cloud-restore-list').querySelectorAll();assert.equal(checks.length,1);assert.equal(checks[0].checked,false);assert.equal(inserts,0);assert.match(get('cloud-restore-status').textContent,/a@example.invalid/);
 await get('cloud-restore-apply').onclick();assert.equal(inserts,0);checks[0].checked=true;consent=false;await get('cloud-restore-apply').onclick();assert.equal(inserts,0);consent=true;
 await get('cloud-restore-apply').onclick();assert.equal(inserts,1);assert.equal(events,1);assert.equal(records[0].notes,row.notes);assert.deepEqual(records[0].history,row.history);assert.match(get('cloud-restore-status').textContent,/Added 1/);
 file();await get('cloud-restore-preview').onclick();checks=get('cloud-restore-list').querySelectorAll();assert.equal(checks[0].disabled,true);assert.equal(get('cloud-restore-apply').disabled,true);assert.equal(inserts,1);
 file('broken');await get('cloud-restore-preview').onclick();assert.equal(get('cloud-restore-list').children.length,0);assert.equal(inserts,1);assert.match(get('cloud-restore-status').textContent,/not valid JSON/);
 delay=true;file();const request=get('cloud-restore-preview').onclick();await settle();account(null);pending();await request;assert.equal(get('cloud-restore-list').children.length,0);assert.equal(get('cloud-restore-preview').disabled,true);assert.match(get('cloud-restore-status').textContent,/Sign in/);assert.equal(inserts,1);
 console.log('PASS: signed-in file preview only/no automatic selection; explicit selected restore/cancel; notes retained; repeat skipped/disabled; invalid file clears preview without writes; sign-out during preview cancels and clears private state.');
})().catch(e=>{console.error(e);process.exitCode=1});
