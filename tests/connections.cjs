const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=process.argv[2]||path.resolve(__dirname,'..');
const core=require(path.join(path.resolve(root),'connections-core.js'));
function storage(initial=null){let raw=initial,writes=0;return {getItem:key=>{assert.equal(key,core.KEY);return raw},setItem:(key,value)=>{assert.equal(key,core.KEY);raw=value;writes++},raw:()=>raw,writes:()=>writes}}
const person={fullName:'Test Person',company:'Example Company',email:'Person@example.invalid',phone:'+1 (555) 010-1234',bio:'Shared introduction',jobTitle:'Tester',website:'https://example.invalid',socials:'Site | https://example.invalid'};
const source={cardId:'11111111-1111-4111-8111-111111111111',url:'https://example.invalid/vale-connect-dev/p.html?u=test'};
let s=storage();let first=core.save(s,person,source,{idFactory:()=> 'new-1'});assert.equal(first.status,'saved');assert.equal(first.record.cname,'Test Person');assert.equal(first.record.cnotes,'Shared introduction');assert.equal(first.record.cnext,'Follow up');
let existing=JSON.parse(s.raw());existing[0].cnotes='Private follow-up note';existing[0].history=[{date:'Today',text:'Keep this note'}];s=storage(JSON.stringify(existing));
let again=core.save(s,{...person,email:'changed@example.invalid'},source);assert.equal(again.status,'duplicate');assert.equal(again.exact,true);assert.equal(s.writes(),0);assert.equal(JSON.parse(s.raw())[0].cnotes,'Private follow-up note');
const manual={id:'existing',cname:'Other name',cbusiness:'Other company',cemail:' PERSON@EXAMPLE.INVALID ',cnotes:'Private note',history:[{text:'Preserve'}]};
s=storage(JSON.stringify([manual]));let possible=core.save(s,person,source);assert.equal(possible.status,'duplicate');assert.equal(possible.reason,'email address');assert.equal(s.writes(),0);
core.save(s,person,source,{separate:true,idFactory:()=> 'separate-1'});assert.equal(JSON.parse(s.raw()).length,2);assert.deepEqual(JSON.parse(s.raw())[1],manual);assert.equal(core.save(s,person,source,{separate:true}).status,'duplicate');
s=storage(JSON.stringify([{id:'phone',cphone:'+1 555-010-1234'}]));assert.equal(core.inspect(s,{...person,email:''},{}).reason,'phone number');
s=storage(JSON.stringify([{id:'name',cname:'  TEST   Person ',cbusiness:'example COMPANY'}]));assert.equal(core.inspect(s,{...person,email:'',phone:''},{}).reason,'name and company');assert.equal(core.inspect(s,{...person,company:'Different',email:'',phone:''},{}),null);
s=storage();core.save(s,person,{}, {idFactory:()=> 'snapshot'});assert.equal(core.save(s,person,{}).status,'duplicate');
for(const raw of ['broken','{}','[null]','["bad"]']){s=storage(raw);assert.throws(()=>core.save(s,person,source),/could not be read/);assert.equal(s.raw(),raw);assert.equal(s.writes(),0)}
assert.throws(()=>core.save(storage(),{fullName:{}},source),/valid name/);
const blocked=storage();blocked.setItem=()=>{throw Error('quota')};assert.throws(()=>core.save(blocked,person,source),/unavailable or full/);assert.equal(blocked.raw(),null);
assert.equal(core.candidate({...person,website:'javascript:alert(1)'},{url:'javascript:alert(1)'}).cwebsite,'');
assert.equal(core.candidate(person,{url:'javascript:alert(1)'}).source_url,'');

class Element{constructor(tag){this.tag=tag;this.children=[];this.style={};this.attrs={};this.hidden=false;this.disabled=false;this.textContent=''}append(...nodes){this.children.push(...nodes)}replaceChildren(){this.children=[]}setAttribute(k,v){this.attrs[k]=v}}
const host=new Element('div');let consent=false,confirms=0,events=0,lockCalls=0;
s=storage();const context={window:{ValeConnections:core,dispatchEvent:()=>events++},document:{getElementById:()=>host,createElement:tag=>new Element(tag)},localStorage:s,location:{href:source.url},navigator:{locks:{request:async(name,work)=>{assert.equal(name,'vale-connect-dev-contacts');lockCalls++;return work()}}},URL,Event,confirm:()=>{confirms++;return consent}};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'connections-ui.js'),'utf8'),context);
function controls(){return {save:host.children[1].children[0],separate:host.children[1].children[1],status:host.children[2],open:host.children[3]}}
(async()=>{
 context.window.ValeConnectionUI.mount('host',person,source);let ui=controls();
 assert.match(host.children[0].textContent,/No sign-in required/);assert.match(ui.open.href,/\?view=connections$/);
 assert.equal(s.writes(),0);await ui.save.onclick();assert.equal(s.writes(),0);assert.equal(confirms,1);assert.equal(ui.save.disabled,false);
 consent=true;await ui.save.onclick();assert.equal(s.writes(),1);assert.equal(events,1);assert.equal(ui.save.disabled,true);assert.match(ui.status.textContent,/this browser only/);
 context.window.ValeConnectionUI.mount('host',person,source);ui=controls();assert.equal(ui.save.disabled,true);assert.equal(ui.separate.hidden,true);assert.match(ui.status.textContent,/Already saved/);assert.equal(s.writes(),1);
 context.localStorage=storage(JSON.stringify([manual]));context.window.ValeConnectionUI.mount('host',person,source);ui=controls();assert.equal(ui.separate.hidden,false);assert.match(ui.status.textContent,/possible match/);await ui.separate.onclick();assert.equal(JSON.parse(context.localStorage.raw()).length,2);assert.deepEqual(JSON.parse(context.localStorage.raw())[1],manual);
 assert(lockCalls>=3);
 console.log('PASS: explicit local save/cancel; stable-card and snapshot duplicates; email/phone/name-company matches; separate-entry choice; existing notes/history preservation; corrupt/full storage protection; safe links; no-sign-in messaging and scoped lock.');
})().catch(e=>{console.error(e);process.exitCode=1});

