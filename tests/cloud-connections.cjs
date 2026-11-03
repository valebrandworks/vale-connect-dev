const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../cloud-connections-core.js'),local=require('../connections-core.js');
const contact={id:'local-1',cname:'Test Person',cemail:'test@example.invalid',cnotes:'Private notes',history:[{date:'Today',text:'Keep me'}]};
assert.equal(core.duplicate([{id:'one',full_name:'Other Person',source_identity:null}],contact),null);
const imported=core.importContact(contact);assert.equal(imported.source_identity,'local:local-1');assert.deepEqual(imported.history,contact.history);imported.history[0].text='Changed';assert.equal(contact.history[0].text,'Keep me');
assert.equal(core.payload({...contact,owner_id:'wrong',cwebsite:'javascript:alert(1)'}).owner_id,undefined);assert.equal(core.payload({...contact,cwebsite:'javascript:alert(1)'}).website,'');assert.throws(()=>core.payload({cname:' '}));
let records=[],filters=[],operation='',body;
const api={from(table){assert.equal(table,'connections');filters=[];return this},select(){return this},eq(k,v){filters.push([k,v]);return this},order(){return this},range(){assert.deepEqual(filters,[['owner_id','owner-a']]);return Promise.resolve({data:records,count:records.length})},insert(row){operation='insert';body=row;return this},update(row){operation='update';body=row;return this},single(){return Promise.resolve({data:{...body,id:'cloud-1',revision:0}})},maybeSingle(){return Promise.resolve({data:null})}};
class El{constructor(){this.children=[];this.style={};this.textContent='';this.disabled=false;this.hidden=false}append(...items){this.children.push(...items)}replaceChildren(){this.children=[]}setAttribute(){}}
(async()=>{
 await core.list(api,'owner-a');await core.create(api,'owner-a',core.importContact(contact));assert.equal(operation,'insert');assert.equal(body.owner_id,'owner-a');assert.equal(body.source_identity,'local:local-1');assert.deepEqual(body.history,contact.history);
 assert.equal(await core.update(api,'owner-a',{id:'cloud-1',revision:4},contact),null);assert.equal(body.revision,5);assert.deepEqual(filters,[['id','cloud-1'],['owner_id','owner-a'],['revision',4]]);
 const host=new El(),handlers={};let consent=false,writes=0;
 const fake={list:async()=>records,duplicate:core.duplicate,create:async()=>{writes++;return {id:'saved'}}};
 const context={window:{ValeCloudConnections:fake,ValeConnections:local,addEventListener:(n,f)=>handlers[n]=f,dispatchEvent(){}},document:{getElementById:()=>host,createElement:()=>new El()},location:{href:'https://example.invalid/vale-connect-dev/p.html?u=test'},URL,Event,confirm:()=>consent};
 vm.createContext(context);vm.runInContext(fs.readFileSync(__dirname+'/../cloud-save-ui.js','utf8'),context);
 context.window.ValeCloudSave.mount('host',{fullName:'Test Person',email:'test@example.invalid'},{cardId:'card-1'});assert.match(host.children[0].textContent,/Sign in/);assert.equal(writes,0);
 handlers['vale-account-ready']({detail:{client:api,user:{id:'owner-a',email:'a@example.invalid'}}});let button=host.children[1];await button.onclick();assert.equal(writes,0);assert.equal(button.disabled,false);
 consent=true;await button.onclick();assert.equal(writes,1);assert.equal(button.disabled,true);
 records=[{id:'cloud-1',full_name:'Test Person',source_identity:'card:card-1',notes:'Keep notes'}];context.window.ValeCloudSave.mount('host',{fullName:'Test Person'},{cardId:'card-1'});await host.children[1].onclick();assert.equal(writes,1);assert.match(host.children[3].textContent,/Already saved/);
 handlers['vale-account-ready']({detail:{client:api,user:null}});assert.match(host.children[0].textContent,/Sign in/);
 console.log('PASS: owner-scoped queries; revision-conditional updates; stable import identity; preserved history; missing identities do not match; safe links; sign-in gate; explicit cloud consent/cancel; exact duplicate keeps notes; sign-out clears widget.');
})().catch(e=>{console.error(e);process.exitCode=1});
