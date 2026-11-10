// "Shared with you" in the Connections tab: wording, security, behaviour and accessibility.
// Runs shared-inbox-core.js and shared-inbox.js against a small simulated page and a stand-in database client.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const core=require(path.join(root,'shared-inbox-core.js'));
const ui=read('shared-inbox.js'),coreSrc=read('shared-inbox-core.js'),conn=read('cloud-connections.js'),html=read('index.html');

// ---------- Rules ----------
const now=new Date('2026-11-10T12:00:00Z');
assert.equal(core.when('2026-11-10T11:59:40Z',now),'Just now');assert.equal(core.when('2026-11-10T11:00:00Z',now),'1 hour ago');assert.equal(core.when('2026-11-09T10:00:00Z',now),'Yesterday');assert.equal(core.when('2026-11-01T10:00:00Z',now),'1 Nov');
const shares=[
 {id:'s1',card_id:'c1',outcome:'added',shared:{full_name:'Sam Lee',business_name:'Studio',email:'sam@example.invalid',phone:'+1 555 0100'},note:'Great to meet you',created_at:'2026-11-10T11:00:00Z',last_shared_at:'2026-11-10T11:00:00Z',repeat_count:1,connection_id:'k1'},
 {id:'s2',card_id:'c1',outcome:'duplicate',shared:{full_name:'Ana Ruiz',email:'ana@example.invalid'},note:'',created_at:'2026-11-09T10:00:00Z',last_shared_at:'2026-11-10T09:00:00Z',repeat_count:2,connection_id:'k2'},
 {id:'s3',card_id:'c2',outcome:'limit_reached',shared:{full_name:'Lee Park',phone:'+1 555 0101',social_links:'a\nb'},note:'',created_at:'2026-11-08T10:00:00Z',last_shared_at:'2026-11-08T10:00:00Z',repeat_count:1,connection_id:null},
];
const notes=[{id:'n1',kind:'share_added',share_id:'s1',read_at:null},{id:'n2',kind:'share_duplicate',share_id:'s2',read_at:null},{id:'n3',kind:'share_limit',share_id:'s3',read_at:'2026-11-08T11:00:00Z'},{id:'n4',kind:'mutual',share_id:'s1',read_at:null}];
let items=core.items(shares,notes,{connections:[{id:'k1',mutual:true},{id:'k2'}],cards:[{id:'c1',card_label:'Work'},{id:'c2',card_label:'Personal'}],now});
assert.deepEqual(items.map(i=>i.id),['s1','s2','s3'],'newest first');
assert.deepEqual(items.map(i=>[i.unread,i.unreadIds]),[[true,['n1','n4']],[true,['n2']],[false,[]]]);
assert.equal(core.unreadCount(items),2,'counts shares with something new, not notifications');
assert.deepEqual(items.map(i=>i.actions),[['open'],['open-existing','add-separate'],['add-separate']]);
assert.equal(items[0].mutual,true);assert.match(items[0].status,/both shared/);
assert.equal(items[0].via,'Work','the card is named when the owner has several');
assert.equal(items[1].repeats,2);assert.match(items[1].status,/may already have this person/);
assert.match(items[2].status,/connection limit/);assert.deepEqual(items[2].details,[['Phone','+1 555 0101'],['Links','2 links']]);
assert.equal(core.items(shares,notes,{cards:[{id:'c1'}],now})[0].via,'','no card name with only one card');
assert.equal(core.items([{id:'x',outcome:'added',shared:{},created_at:'2026-11-10T11:00:00Z'}],[],{now})[0].name,'Someone');

// ---------- Security ----------
assert.doesNotMatch(ui+coreSrc,/innerHTML|outerHTML|insertAdjacentHTML|document\.write/,'shared text is never treated as HTML');
assert.deepEqual([...ui.matchAll(/client\.from\('([a-z_]+)'\)/g)].map(m=>m[1]).sort(),['card_shares','notifications'],'reads only the owner\'s share records and notifications');
for(const m of ui.matchAll(/client\.from\('[a-z_]+'\)\.([a-z]+)\(/g))assert.equal(m[1],'select','never writes to tables directly');
assert.equal((ui.match(/\.eq\('owner_id',owner\)/g)||[]).length,2,'both reads are limited to the signed-in owner');
assert.deepEqual([...ui.matchAll(/client\.rpc\('([a-z_]+)'/g)].map(m=>m[1]).sort(),['add_shared_as_connection','mark_notifications_read'],'acts only through the database\'s own functions');
assert.match(conn,/row\.mutual\?'Mutual':'Shared'/,'the connections list labels shared and mutual connections');
assert.match(conn,/addEventListener\('vale-open-connection'/);
assert.match(html,/<section id="shared-inbox" class="panel inbox" aria-labelledby="shared-inbox-title" hidden><\/section>/);
assert.match(html,/<script src="shared-inbox-core\.js\?v=\d+"><\/script><script src="shared-inbox\.js\?v=\d+"><\/script>/);

// ---------- Behaviour, with a simulated page ----------
const SIMPLE=/^(\.[\w-]+|\[[\w-]+(="[\w-]+")?\]|[a-z][a-z0-9]*)$/;
class Node{
 constructor(tag){Object.assign(this,{tagName:tag.toUpperCase(),children:[],parent:null,attrs:{},dataset:{},className:'',_text:'',id:'',type:'',disabled:false,hidden:false,open:false,onclick:null})}
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('')}set textContent(v){this._text=String(v);this.children=[]}
 append(...nodes){for(const n of nodes){const node=typeof n==='string'?Object.assign(new Node('#text'),{_text:n}):n;if(node.parent)node.remove();node.parent=this;this.children.push(node)}}
 replaceChildren(...nodes){for(const c of this.children)c.parent=null;this.children=[];this.append(...nodes)}
 remove(){if(this.parent){this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null}}
 setAttribute(k,v){this.attrs[k]=String(v);if(k==='id')this.id=String(v)}getAttribute(k){return k in this.attrs?this.attrs[k]:null}removeAttribute(k){delete this.attrs[k]}hasAttribute(k){return k in this.attrs}
 matches(sel){assert.match(sel,SIMPLE,'selector supported: '+sel);if(sel[0]==='.')return this.className.split(/\s+/).includes(sel.slice(1));if(sel[0]==='['){const m=sel.match(/^\[([\w-]+)(?:="([\w-]+)")?\]$/);const v=m[1].startsWith('data-')?this.dataset[m[1].slice(5)]:this.getAttribute(m[1]);return m[2]===undefined?v!==undefined&&v!==null:v===m[2]}return this.tagName===sel.toUpperCase()}
 querySelectorAll(sel){const out=[];const walk=n=>{for(const c of n.children){if(c.tagName!=='#TEXT'&&c.matches(sel))out.push(c);walk(c)}};walk(this);return out}
 querySelector(sel){return this.querySelectorAll(sel)[0]||null}
}
const body=new Node('body'),doc={body,hidden:false,createElement:t=>new Node(t),getElementById:id=>{const find=n=>{for(const c of n.children){if(c.id===id)return c;const f=find(c);if(f)return f}return null};return find(body)},querySelector:sel=>body.querySelector(sel),addEventListener(){}};
const tab=new Node('button');tab.dataset.tab='connections';tab.append('Connections');body.append(tab);
const host=new Node('section');host.id='shared-inbox';host.hidden=true;body.append(host);
const listeners={},events=[],reads=[],rpcs=[];let rpcError=null,askAnswer=true,asks=[];
const db={shares:structuredClone(shares),notes:structuredClone(notes)};
class Query{constructor(t){this.t=t;this.filters=[]}select(c){this.cols=c;return this}eq(k,v){this.filters.push([k,v]);return this}order(){return this}limit(n){this.n=n;return this}
 then(res,rej){reads.push({table:this.t,filters:this.filters,cols:this.cols});if(this.filters.some(([k,v])=>k==='owner_id'&&v==='owner-2'))return Promise.resolve({data:null,error:{message:'offline'}}).then(res,rej);const data=this.t==='notifications'?db.notes:db.shares;return Promise.resolve({data:structuredClone(data),error:null}).then(res,rej)}}
const client={from:t=>new Query(t),rpc:async(name,args)=>{rpcs.push([name,args]);if(rpcError)return {error:rpcError};if(name==='mark_notifications_read')for(const n of db.notes)if(!n.read_at&&(args.p_ids===null||args.p_ids.includes(n.id)))n.read_at='now';if(name==='add_shared_as_connection'){const s=db.shares.find(x=>x.id===args.p_share_id);s.outcome='owner_added';s.connection_id='k9'}return {error:null}}};
const window={ValeSharedInboxCore:null,ValeAccountLists:{read:async(c,table,owner)=>{assert.equal(table,'public_cards');assert.ok(['owner-1','owner-2'].includes(owner));return [{id:'c1',card_label:'Work'},{id:'c2',card_label:'Personal'}]}},
 ValeAsk:async(text)=>{asks.push(text);return askAnswer},addEventListener:(n,f)=>listeners[n]=f,dispatchEvent:e=>events.push([e.type,e.detail])};
const context={window,document:doc,console,Date,setInterval:()=>1,clearInterval(){},CustomEvent:class{constructor(t,o){this.type=t;this.detail=o?.detail}},Event:class{constructor(t){this.type=t}}};
vm.createContext(context);vm.runInContext(coreSrc,context);vm.runInContext(ui,context);
const same=(a,b,m)=>assert.equal(JSON.stringify(a),JSON.stringify(b),m);
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(r=>setTimeout(r,0))};
const buttons=()=>host.querySelectorAll('button'),button=t=>buttons().find(b=>b.textContent===t);

(async()=>{
 assert.equal(host.hidden,true,'hidden before sign-in');assert.equal(tab.querySelector('.nav-badge'),null);
 listeners['vale-account-ready']({detail:{client,user:{id:'owner-1'}}});await settle();
 assert.deepEqual(reads.filter(r=>r.table!=='public_cards').map(r=>[r.table,r.filters]),[['notifications',[['owner_id','owner-1']]],['card_shares',[['owner_id','owner-1']]]],'reads only the owner\'s own records');
 assert.equal(host.hidden,false);assert.equal(host.querySelector('h2').textContent,'Shared with you2 new');assert.equal(host.querySelector('h2').id,'shared-inbox-title');
 assert.equal(tab.querySelector('.nav-badge').textContent,'2');assert.equal(tab.getAttribute('aria-label'),'Connections, 2 new','the count is announced, not only shown');
 const lis=host.querySelectorAll('li');assert.equal(lis.length,3);
 assert.match(lis[0].textContent,/^SLNew: Sam LeeMutualStudio · via Work · /);assert.match(lis[0].textContent,/“Great to meet you”/);assert.ok(lis[0].className.includes('unread'));
 assert.equal(lis[2].className,'inbox-item','read items look read');
 assert.match(lis[1].textContent,/shared 2 times/);
 // Open: asks the Connections list to open it, and marks this share's notifications read.
 lis[0].querySelector('button').onclick();await settle();
 same(events.at(-1),['vale-open-connection',{id:'k1'}]);same(rpcs.at(-1),['mark_notifications_read',{p_ids:['n1','n4']}]);
 assert.equal(tab.querySelector('.nav-badge').textContent,'1');
 // Add as a separate connection: confirmed first; cancelling does nothing.
 askAnswer=false;let li=host.querySelectorAll('li')[1];li.querySelectorAll('button').find(b=>b.textContent==='Add as separate connection').onclick();await settle();
 assert.match(asks.at(-1),/^Add Ana Ruiz as a separate connection\? Any existing connection stays as it is\.$/);assert.equal(rpcs.filter(r=>r[0]==='add_shared_as_connection').length,0,'nothing happens without confirmation');
 askAnswer=true;li=host.querySelectorAll('li')[1];li.querySelectorAll('button').find(b=>b.textContent==='Add as separate connection').onclick();await settle();
 same(rpcs.find(r=>r[0]==='add_shared_as_connection'),['add_shared_as_connection',{p_share_id:'s2'}]);
 assert.ok(events.some(e=>e[0]==='vale-cloud-connections-changed'),'the Connections list reloads');assert.match(host.querySelector('.status').textContent,/Added Ana Ruiz to your connections\./);
 assert.match(host.querySelectorAll('li')[1].textContent,/You added this as a separate connection\./);assert.equal(tab.querySelector('.nav-badge'),null,'nothing new left');assert.equal(tab.getAttribute('aria-label'),null);
 // A refusal from the database (for example the plan's limit) is shown as it is.
 rpcError={message:'Your Free plan includes 1,000 active connections.'};li=host.querySelectorAll('li')[2];li.querySelectorAll('button').find(b=>b.textContent==='Add as separate connection').onclick();await settle();
 assert.match(host.querySelector('.status').textContent,/Free plan includes/);rpcError=null;
 // Mark all as read.
 db.notes.push({id:'n5',kind:'share_added',share_id:'s3',read_at:null});await window.ValeSharedInbox.refresh();await settle();
 assert.equal(tab.querySelector('.nav-badge').textContent,'1');button('Mark all as read').onclick();await settle();
 same(rpcs.at(-1),['mark_notifications_read',{p_ids:null}]);assert.equal(button('Mark all as read'),undefined);
 // Many shares: five shown, then all.
 for(let i=0;i<4;i++)db.shares.push({id:'m'+i,card_id:'c1',outcome:'added',shared:{full_name:'Many '+i},created_at:'2026-11-01T10:00:00Z',last_shared_at:'2026-11-01T10:00:00Z',connection_id:'km'+i});
 await window.ValeSharedInbox.refresh();await settle();assert.equal(host.querySelectorAll('li').length,5);button('Show all 7').onclick();assert.equal(host.querySelectorAll('li').length,7);
 // Switching straight to another account: nothing from the first account is shown, even if loading fails.
 listeners['vale-account-ready']({detail:{client,user:{id:'owner-2'}}});await settle();
 assert.equal(host.querySelectorAll('li').length,0);assert.doesNotMatch(host.textContent,/Sam Lee|Ana Ruiz|Many/);assert.match(host.textContent,/Couldn’t load/);assert.equal(tab.querySelector('.nav-badge'),null);
 // Then signing out: nothing remains.
 listeners['vale-account-ready']({detail:{client,user:null}});await settle();assert.equal(host.hidden,true);assert.equal(host.children.length,0);assert.equal(tab.querySelector('.nav-badge'),null);
 // Text from a share is shown as text.
 db.shares=[{id:'x1',card_id:'c1',outcome:'added',shared:{full_name:'<img src=x onerror=alert(1)>'},note:'<b>hi</b>',created_at:'2026-11-10T11:00:00Z',last_shared_at:'2026-11-10T11:00:00Z',connection_id:'kx'}];db.notes=[];
 listeners['vale-account-ready']({detail:{client,user:{id:'owner-1'}}});await settle();
 assert.match(host.querySelector('li').textContent,/<img src=x onerror=alert\(1\)>/);assert.equal(host.querySelectorAll('img').length,0);
 console.log('PASS: shared-with-you wording (outcomes, mutual, repeats, card names, relative dates); security (own records only, reads only, database functions only, no HTML injection); behaviour (count on the Connections tab, open marks read, confirmed add-separate reloads the list, database refusals shown, mark all read, show all, cleared on sign-out); accessibility (announced count, labelled section, "New" for screen readers).');
})().catch(e=>{console.error(e);process.exit(1)});
