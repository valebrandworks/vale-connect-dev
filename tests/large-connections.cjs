// Unlimited connections: a large list is shown 200 at a time, search covers every connection, and a pause from the
// database's rate limit on new connections stops restore and import cleanly with a clear message.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const core=require(path.join(root,'cloud-connections-core.js')),local=require(path.join(root,'connections-core.js')),restore=require(path.join(root,'connections-restore.js'));
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))};

// ---------- The rate-limit pause is recognised ----------
const pause={message:'New connections are paused for now: this account added 1000 connections in the last hour. Nothing you saved was lost. Try again later.',hint:'connection_rate_limit',code:'P0001'};
assert.equal(core.isRateLimit(pause),true);assert.equal(core.isRateLimit({message:'New connections are paused for now: x'}),true);
assert.equal(core.isRateLimit({message:'Your Free plan includes 5 active connections.'}),false);assert.equal(core.isRateLimit(null),false);

class El{constructor(id=''){this.id=id;this.value='';this.children=[];this.style={};this.handlers={};this.hidden=false;this.disabled=false;this.textContent='';this.className='';this.attrs={}}
 append(...n){this.children.push(...n)}replaceChildren(...n){this.children=[...n]}setAttribute(k,v){this.attrs[k]=v}addEventListener(k,f){this.handlers[k]=f}querySelectorAll(){return []}scrollIntoView(){}}

(async()=>{
 // ---------- A restore pauses cleanly at the rate limit, and a later run adds only the rest ----------
 const records=Array.from({length:6},(_,i)=>({id:'00000000-0000-4000-8000-00000000000'+i,full_name:'Restored '+i,category:'Other',next_step:'Follow up',history:[]}));
 let calls=0;const saved=[];
 const realCreate=core.create;core.create=async(_c,owner,contact)=>{calls++;if(calls===4)throw pause;const row={...contact,id:'r'+calls,owner_id:owner};saved.push(row);return row};
 let result=await restore.restore({},'owner',records,[]);
 assert.deepEqual([result.added,result.failed,result.stopped],[3,0,true]);assert.equal(result.paused,pause.message,'the pause is reported, not counted as a failure');
 calls=10;result=await restore.restore({},'owner',records,saved.map(r=>({...r})));
 assert.deepEqual([result.added,result.skipped,result.stopped||false],[3,3,false],'running again later skips what was restored and adds the rest');
 core.create=realCreate;
 const ui=fs.readFileSync(path.join(root,'connections-restore-ui.js'),'utf8');
 assert.match(ui,/result\.paused\?result\.paused\+' To restore the rest later, preview the same file again: connections already restored are recognised and skipped\. '/,'the restore screen explains how to continue');
 const cc=fs.readFileSync(path.join(root,'cloud-connections.js'),'utf8');
 assert.match(cc,/else if\(core\.isRateLimit\?\.\(error\)\)\{paused=error\.message;break\}/,'browser import stops at a pause instead of counting failures');
 assert.match(cc,/setInterval\(background,60000\)/,'large lists reload once a minute, not every 20 seconds');

 // ---------- A large list: 200 at a time, search across all ----------
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new El(id));return elements.get(id)};
 get('cloud-contacts-view').value='active';
 const rows=Array.from({length:450},(_,i)=>({id:'c'+i,owner_id:'a',full_name:'Person '+String(i).padStart(3,'0'),business_name:i===449?'Needle Studio':'Co',revision:0,next_step:'Follow up',category:'Other',history:[]}));
 const events={};
 const fake={...core,list:async()=>rows.map(r=>({...r}))};
 const context={window:{ValeCloudConnections:fake,ValeConnections:local,ValeUsage:{has:()=>true,refresh(){}},addEventListener:(n,f)=>events[n]=f,dispatchEvent(){}},CustomEvent:function(t,o){this.type=t;this.detail=o?.detail},Event:function(t){this.type=t},
  document:{getElementById:get,createElement:()=>new El(),createTextNode:t=>({textContent:t}),addEventListener(){},hidden:false},localStorage:{getItem:()=>'[]'},navigator:{onLine:true},setInterval:()=>1,clearInterval(){},structuredClone,confirm:()=>true};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'cloud-connections.js'),'utf8'),context);
 events['vale-account-ready']({detail:{client:{},user:{id:'a',email:'a@example.invalid'}}});await settle();
 const list=get('cloud-contacts-list'),people=()=>list.children.filter(c=>c.className==='list-row'),more=()=>list.children.find(c=>c.id==='cloud-contacts-more');
 assert.equal(get('cloud-contacts-count').textContent,'450','the count covers every connection');
 assert.equal(people().length,200,'the first 200 are drawn');assert.equal(more().textContent,'Show 200 more of 250 remaining');
 more().onclick();assert.equal(people().length,400);assert.equal(more().textContent,'Show 50 more of 50 remaining');
 more().onclick();assert.equal(people().length,450);assert.equal(more(),undefined,'no button once all are shown');
 // Search reaches connections that aren't drawn, and a new search starts again at 200.
 get('cloud-contacts-search').value='Needle';get('cloud-contacts-search').oninput();
 assert.equal(get('cloud-contacts-count').textContent,'1');assert.equal(people().length,1);assert.equal(people()[0].children[1].children[0].textContent,'Person 449','search found a connection beyond the first 200');
 get('cloud-contacts-search').value='Person';get('cloud-contacts-search').oninput();assert.equal(people().length,200,'a new search starts again at 200');assert.equal(get('cloud-contacts-count').textContent,'450');
 console.log('PASS: rate-limit pause recognised; restore stops cleanly and a later run adds only the rest; import stops instead of counting failures; large lists draw 200 at a time with "Show more"; search and counts cover every connection; refresh once a minute.');
})().catch(e=>{console.error(e);process.exit(1)});
