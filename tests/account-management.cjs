// Usage display, account deletion, connection deletion and the archived view, with mock clients.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const settle=async()=>{for(let i=0;i<10;i++)await new Promise(r=>setImmediate(r))};

async function usage(){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{textContent:''});return elements.get(id)};const handlers={};let pending=[];
 const context={window:{addEventListener:(n,f)=>handlers[n]=f},document:{getElementById:get}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'membership.js'),'utf8'),context);
 const row={plan_name:'Free',max_cards:1,max_active_connections:5,card_count:0,active_connection_count:3,archived_connection_count:0};
 let featureList=['advanced_search'];const client={rpc:name=>{if(name==='get_my_features')return Promise.resolve({data:featureList});assert.equal(name,'get_my_usage');return new Promise(r=>pending.push(r))}};
 handlers['vale-account-ready']({detail:{client,user:{id:'a'}}});pending.shift()({data:[row]});await settle();
 for(const id of ['usage-overview','cards-usage','cloud-contacts-usage','account-usage'])assert.equal(get(id).textContent,'Free plan · 0 of 1 cards · 3 of 5 active connections');
 const refresh=context.window.ValeUsage.refresh;assert.equal(context.window.ValeUsage.has('advanced_search'),true);assert.equal(context.window.ValeUsage.has('reminders'),false);
 void refresh();pending.shift()({data:[{...row,card_count:4,active_connection_count:5,archived_connection_count:2}]});await settle();
 assert.match(get('account-usage').textContent,/4 of 1 cards · 5 of 5 active connections · 2 archived/);assert.match(get('account-usage').textContent,/reached your cards and active connections limit; existing items stay available/);
 void refresh();pending.shift()({data:[{...row,plan_name:'Plus',max_cards:3,max_active_connections:null,card_count:3,active_connection_count:40}]});await settle();
 assert.match(get('account-usage').textContent,/Plus plan · 3 of 3 cards · 40 active connections \(unlimited\) — you've reached your cards limit/);
 // A late answer for a signed-out account never appears, and errors just hide the line.
 void refresh();const late=pending.shift();handlers['vale-account-ready']({detail:{client:null,user:null}});assert.equal(context.window.ValeUsage.has('reminders'),undefined);assert.equal(get('account-usage').textContent,'');late({data:[row]});await settle();assert.equal(get('account-usage').textContent,'');
 handlers['vale-account-ready']({detail:{client,user:{id:'b'}}});pending.shift()({error:{message:'x'}});await settle();assert.equal(get('account-usage').textContent,'');
}

async function accountDeletion(){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',hidden:false,handlers:{},addEventListener(n,f){this.handlers[n]=f}});return elements.get(id)};
 let order=[],signInError=null,rpcError=null,consent=true,auth;
 const client={auth:{getUser:async()=>({data:{user:null}}),onAuthStateChange:fn=>auth=fn,signInWithPassword:async c=>{order.push('signin:'+c.email);return {error:signInError}},signOut:async o=>{order.push('signout:'+o?.scope);return {error:null}}},rpc:async(n,a)=>{order.push(n+':'+a.confirm_email);return {error:rpcError}},from(){return {select(){return this},eq(){return this},maybeSingle:async()=>({data:null})}}};
 const context={window:{supabase:{createClient:()=>client},addEventListener(){},dispatchEvent(){}},document:{getElementById:get,addEventListener(){},hidden:false},localStorage:{getItem:()=>null,setItem(){}},setInterval:()=>1,clearInterval(){},CustomEvent:class{constructor(t,o){this.type=t;this.detail=o?.detail}},confirm:()=>consent,location:{origin:'https://dev.valebrandworks.com',pathname:'/'}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'cloud-auth.js'),'utf8'),context);await settle();
 const click=()=>get('cloud-delete-account').handlers.click(),status=()=>get('cloud-delete-status').textContent;
 await click();assert.equal(order.length,0,'nothing while signed out');
 auth('SIGNED_IN',{user:{id:'a',email:'Owner@example.invalid'}});await settle();
 get('cloud-delete-email').value='wrong@example.invalid';get('cloud-delete-password').value='Synthetic-1';await click();assert.equal(order.length,0);assert.match(status(),/Type your account email/);
 get('cloud-delete-email').value='owner@example.invalid';get('cloud-delete-password').value='';await click();assert.equal(order.length,0);assert.match(status(),/password/i);
 get('cloud-delete-password').value='Synthetic-1';consent=false;await click();assert.equal(order.length,0);assert.match(status(),/Nothing was deleted/);consent=true;
 signInError={message:'bad'};await click();assert.deepEqual(order,['signin:Owner@example.invalid']);assert.match(status(),/Nothing was deleted/);assert.equal(get('cloud-delete-password').value,'');signInError=null;order=[];
 get('cloud-delete-password').value='Synthetic-1';rpcError={message:'Please sign in again.'};await click();assert.deepEqual(order,['signin:Owner@example.invalid','delete_my_account:owner@example.invalid']);assert.match(status(),/Please sign in again/);rpcError=null;order=[];
 get('cloud-delete-password').value='Synthetic-1';await click();assert.deepEqual(order,['signin:Owner@example.invalid','delete_my_account:owner@example.invalid','signout:local']);assert.match(get('cloud-auth-status').textContent,/account was deleted/);
}

async function connections(){
 const core=require(path.join(root,'cloud-connections-core.js')),local=require(path.join(root,'connections-core.js'));
 class El{constructor(id=''){this.id=id;this.value='';this.children=[];this.style={};this.handlers={};this.hidden=false;this.disabled=false;this.textContent=''}append(...n){this.children.push(...n)}replaceChildren(){this.children=[]}setAttribute(){}addEventListener(k,f){this.handlers[k]=f}querySelectorAll(){return []}}
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new El(id));return elements.get(id)};
 let records=[{id:'r1',owner_id:'a',full_name:'Active Person',revision:0,next_step:'Follow up'},{id:'r2',owner_id:'a',full_name:'Old Person',revision:0,next_step:'Follow up',archived_at:'2026-01-01T00:00:00Z'}],events={},consent=true,refreshed=0;
 const fake={...core,list:async()=>records.map(x=>structuredClone(x)),remove:async(_c,_o,current)=>{const i=records.findIndex(x=>x.id===current.id&&x.revision===current.revision);if(i<0)return null;records.splice(i,1);return {id:current.id}},setArchived:async(_c,_o,current,archived)=>{const row=records.find(x=>x.id===current.id);row.archived_at=archived?'2026-11-04T00:00:00Z':null;row.revision++;return structuredClone(row)}};
 const context={window:{ValeCloudConnections:fake,ValeConnections:local,ValeUsage:{refresh:()=>{refreshed++}},addEventListener:(n,f)=>events[n]=f,dispatchEvent(){}},CustomEvent:function(t,o){this.type=t;this.detail=o.detail},document:{getElementById:get,createElement:()=>new El(),createTextNode:t=>({textContent:t}),addEventListener(){},hidden:false},localStorage:{getItem:()=>'[]'},navigator:{onLine:true},setInterval:()=>1,clearInterval(){},structuredClone,confirm:()=>consent};
 vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'cloud-connections.js'),'utf8'),context);
 events['vale-account-ready']({detail:{client:{},user:{id:'a',email:'a@example.invalid'}}});await settle();
 const list=()=>get('cloud-contacts-list').children.map(x=>x.textContent);
 assert.deepEqual(list(),['Active Person · Follow up']);assert.equal(get('cloud-contacts-count').textContent,'1');
 get('cloud-contacts-view').value='archived';get('cloud-contacts-view').onchange();assert.deepEqual(list(),['Archived · Old Person · Follow up']);assert.equal(get('cloud-contacts-count').textContent,'1');
 assert.equal(get('cloud-contacts-delete').disabled,true,'nothing selected');
 get('cloud-contacts-list').children[0].onclick();assert.equal(get('cloud-contacts-archive').textContent,'Restore connection');assert.equal(get('cloud-contacts-delete').disabled,false);
 consent=false;get('cloud-contacts-delete').onclick();await settle();assert.equal(records.length,2,'cancel keeps it');consent=true;
 get('cloud-contacts-archive').onclick();await settle();assert.equal(records.find(x=>x.id==='r2').archived_at,null);assert.equal(refreshed>0,true);assert.deepEqual(list(),['No archived connections.']);
 get('cloud-contacts-view').value='active';get('cloud-contacts-view').onchange();assert.equal(list().length,2);
 get('cloud-contacts-list').children.find(x=>x.textContent.startsWith('Old')).onclick();const before=refreshed;get('cloud-contacts-delete').onclick();await settle();assert.equal(records.length,1);assert.equal(refreshed>before,true);assert.equal(get('cloud-cname').value,'');assert.match(get('cloud-contacts-status').textContent,/deleted/i);
 get('cloud-contacts-list').children[0].onclick();records[0].revision=9;get('cloud-contacts-delete').onclick();await settle();assert.equal(records.length,1,'a changed record is not deleted');assert.match(get('cloud-contacts-status').textContent,/changed on another device/);
}

function cards(){
 const source=fs.readFileSync(path.join(root,'cards.js'),'utf8');
 assert.match(source,/\.delete\(\)\.eq\('id',selected\.id\)\.eq\('owner_id',user\.id\)\.eq\('revision',selected\.revision\)/);
 assert.match(source,/public link and QR codes will stop working/);
}

(async()=>{
 await usage();await accountDeletion();await connections();cards();
 const gate=fs.readFileSync(path.join(root,'supabase/inspection/launch_gate.sql'),'utf8').replace(/--.*$/gm,'').trim();
 assert.equal(gate.split(';').filter(s=>s.trim()).length,1);assert.match(gate,/^SELECT\b/);
 const core=require(path.join(root,'cloud-connections-core.js'));
 const row={full_name:'Ana Ruiz',business_name:'Delta',notes:'banner',category:'Customer',next_step:'Follow up',follow_up_on:'2020-01-01'};
 assert.equal(core.matches(row,{query:'ana',advanced:false}),true,'Free can search names');assert.equal(core.matches(row,{query:'delta',advanced:false}),false,'Free search is names only');assert.equal(core.matches(row,{category:'Partner',advanced:false}),true,'Free ignores filters');assert.equal(core.matches(row,{query:'delta'}),true,'Plus searches everything');
 console.log('PASS: plan and usage display; account deletion needs email, password and confirmation; connection deletion with conflict protection; archived view; card deletion guard; read-only launch gate.');
})().catch(error=>{console.error(error);process.exitCode=1});
