// Private report review (admin.html): the rules match the database, the page's security, and its behaviour on a
// simulated page with a stand-in database that refuses exactly as vale_private.require_admin does. Then each
// protection is broken on purpose, and the checks must notice. No network.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const migration=read('supabase/migrations/20261114000000_add_card_reports.sql');
const core=require(path.join(root,'admin-core.js'));
const reportCore=require(path.join(root,'report-core.js'));

// ---------- Rules match the database ----------
const list=re=>migration.match(re)[1].split(',').map(s=>s.trim().replace(/'/g,''));
assert.deepEqual(core.STATUSES.map(s=>s[0]),list(/status text NOT NULL DEFAULT 'new' CHECK \(status IN \(([^)]+)\)\)/),'the database’s statuses');
assert.deepEqual(Object.keys(core.ACTION_LABELS).sort(),list(/action text NOT NULL CHECK \(action IN \(([^)]+)\)\)/).sort(),'a label for every audit-trail action');
assert.deepEqual(Object.keys(core.CATEGORY_LABELS),reportCore.CATEGORY_KEYS,'the report page’s categories');
assert.equal(core.categoryLabel('ip'),'Copyright or trademark');assert.equal(core.categoryLabel('__proto__'),'Unknown reason');assert.equal(core.statusLabel('constructor'),'Unknown');
assert.match(migration,/IF length\(v\) > 2000 THEN RAISE EXCEPTION 'Keep the note under 2,000 characters\.'/);assert.equal(core.LIMITS.note,2000);
assert.match(migration,/IF length\(msg\) NOT BETWEEN 1 AND 500 THEN/);assert.equal(core.LIMITS.ownerMessage,500);
assert.ok(core.checkNote('  ').error,'decisions need a note');assert.equal(core.checkNote('  ',false).error,'','except where optional');
assert.ok(core.checkNote('x'.repeat(2001)).error);assert.equal(core.checkNote(' ok\u0007 ').value,'ok');
assert.ok(core.checkOwnerMessage('').error,'hiding needs an explanation for the owner');assert.ok(core.checkOwnerMessage('x'.repeat(501)).error);assert.equal(core.checkOwnerMessage('x'.repeat(500)).error,'');
assert.equal(core.gate(null),'ok');
assert.equal(core.gate({code:'42501',hint:'mfa_required',message:'Moderation needs two-step sign-in.'}),'mfa','only a listed admin is asked for two-step sign-in');
assert.equal(core.gate({code:'42501',message:'Not authorized.'}),'denied');assert.equal(core.gate({code:'42501',message:'permission denied for function admin_list_reports'}),'denied');
assert.equal(core.gate({code:'08006',message:'boom'}),'error');
assert.equal(core.mfaStep({currentLevel:'aal2'}),'ok');assert.equal(core.mfaStep({currentLevel:'aal1',nextLevel:'aal2'}),'challenge');assert.equal(core.mfaStep({currentLevel:'aal1',nextLevel:'aal1'},[]),'enroll');
assert.equal(core.codeOk('123456'),true);assert.equal(core.codeOk('123 456'),true);assert.equal(core.codeOk('12345'),false);assert.equal(core.codeOk('abcdef'),false);
assert.equal(core.errorText({code:'P0001',message:'That card is already hidden.'}),'That card is already hidden.','the database’s own wording');
assert.match(core.errorText({code:'XX000',message:'internal detail: relation vale_private.x'}),/Something went wrong/,'never internal details');
const open={id:'r',status:'new',card_id:'c',card_current:{},card_hidden:false,legal_hold:false,reporter_blocked:false};
assert.deepEqual(core.actions(open),['reviewing','dismissed','action_taken','hide','legal_hold','block','note']);
assert.deepEqual(core.actions({...open,status:'dismissed',card_hidden:true,legal_hold:true,reporter_blocked:true}),['reopen','restore','release_hold','unblock','note']);
assert.ok(!core.actions({...open,card_current:null}).includes('hide'),'a deleted card can’t be hidden');
for(const a of core.actions(open).concat(core.actions({...open,status:'dismissed',card_hidden:true,legal_hold:true,reporter_blocked:true}))){
 assert.ok(core.ACTIONS[a]?.label,'wording for '+a);
 const [fn]=core.call(a,open,{note:'n',ownerMessage:'m'});assert.match(migration,new RegExp('CREATE FUNCTION public\\.'+fn+'\\('),'a real admin function: '+fn);
}
assert.deepEqual(core.call('hide',open,{note:'n',ownerMessage:'m'}),['admin_hide_card',{p_report_id:'r',p_owner_message:'m',p_note:'n'}]);
assert.deepEqual(core.call('restore',open,{note:'n'}),['admin_restore_card',{p_card_id:'c',p_note:'n'}]);
for(const a of ['hide','dismissed','action_taken','reopen','restore','legal_hold','release_hold','block','unblock'])assert.ok(core.ACTIONS[a].confirm,'a confirmation before '+a);
assert.ok(core.ACTIONS.hide.owner&&core.ACTIONS.hide.danger,'hiding asks for the owner’s explanation');
assert.deepEqual(core.cardRows({card_snapshot:{display_name:'A',website:'x.com'},card_current:{display_name:'B',website:'x.com'}}),[{label:'Name',reported:'A',current:'B',changed:true},{label:'Website',reported:'x.com',current:'x.com',changed:false}]);
assert.equal(core.cardState({card_id:null}),'Deleted by its owner');
assert.deepEqual(core.historyLine({action:'status',from_status:'new',to_status:'dismissed',note:'n',admin_email:'a@x.invalid',created_at:'2026-11-21T10:00:00Z'}).title,'Status changed: New → Dismissed');
assert.equal(core.historyLine({action:'note',admin_email:null}).by,'A former admin');

// ---------- Security: what the page may and may not do ----------
const page=read('admin.html'),ui=read('admin.js'),coreSrc=read('admin-core.js');
assert.match(page,/<meta name="robots" content="noindex,nofollow">/,'not listed by search engines');
assert.match(page,/<meta name="referrer" content="no-referrer">/,'no referrer leaves the page');
const csp=page.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
for(const rule of ["default-src 'none'","script-src 'self' https://cdn.jsdelivr.net","connect-src https://jlprxnmdvoloahssjlnu.supabase.co","base-uri 'none'","form-action 'none'"])assert.ok(csp.includes(rule),'content policy: '+rule);
assert.doesNotMatch(csp,/unsafe-inline|unsafe-eval/,'no inline or evaluated scripts');
assert.doesNotMatch(page,/<script>|<script [^>]*>[^<]/,'no inline scripts');assert.doesNotMatch(page,/ style="/,'no inline styles');
assert.match(page,/<script src="config\.js\?v=\d+"><\/script><script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2\.118\.0\/dist\/umd\/supabase\.js" integrity="sha384-[A-Za-z0-9+\/=]+" crossorigin="anonymous"><\/script><script src="ui-ask\.js\?v=\d+"><\/script><script src="report-core\.js\?v=\d+"><\/script><script src="admin-core\.js\?v=\d+"><\/script><script src="admin\.js\?v=\d+"><\/script>/);
assert.doesNotMatch(ui+coreSrc+page,/innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|new Function/,'text is never treated as HTML or code');
assert.doesNotMatch(ui+coreSrc,/localStorage|sessionStorage|indexedDB|caches\./,'report data is never stored in the browser');
assert.doesNotMatch(ui,/\.from\(|\.storage\b|functions\.invoke/,'no tables, files or server functions: admin functions only');
const rpcs=[...ui.matchAll(/\.rpc\(('[a-z_]+'|fn)/g)].map(m=>m[1]);
assert.deepEqual([...new Set(rpcs)].sort(),["'admin_auth_overview'","'admin_get_report'","'admin_list_reports'","'admin_report_history'",'fn'].sort(),'only admin functions are called');
assert.ok(ui.includes("rpc('admin_get_report',{p_report_id:id})"),'one report is opened by its id');assert.doesNotMatch(ui,/p_limit:200/,'never by scanning the list');
assert.doesNotMatch(ui+coreSrc,/network_hash|card_owner_id|owner_id|dedupe_key|submission_id/,'the page never asks for or shows who reported, or who owns the card');
assert.doesNotMatch(ui+coreSrc+page,/sb_secret|service_role|TURNSTILE_SECRET|SHARE_HASH_SALT|re_[A-Za-z0-9]{6}/,'no secrets');
for(const f of ['index.html','p.html','report.html','privacy.html','sw.js','manifest.webmanifest','app.js','cards.js'])assert.doesNotMatch(read(f),/admin\.html|admin\.js|admin-core/,'not linked from '+f);

// ---------- Behaviour ----------
const SIMPLE=/^(\.[\w-]+|[a-z][a-z0-9]*)$/;
function scenario(sources,setup={}){
 class Node{
  constructor(tag){Object.assign(this,{tagName:tag.toUpperCase(),children:[],parent:null,attrs:{},dataset:{},className:'',_text:'',id:'',type:'',name:'',value:'',checked:false,disabled:false,maxLength:-1,autocomplete:'',inputMode:'',placeholder:'',rows:0,href:'',target:'',rel:'',noValidate:false,src:'',hidden:false,onclick:null,onsubmit:null})}
  get textContent(){return this._text+this.children.map(c=>c.textContent).join('')}set textContent(v){this._text=String(v);this.children=[]}
  append(...nodes){for(const n of nodes){assert.ok(n!==null&&n!==undefined,'no empty children');const node=typeof n==='string'?Object.assign(new Node('#text'),{_text:n}):n;if(node.parent)node.remove();node.parent=this;this.children.push(node)}}
  replaceChildren(...nodes){for(const c of this.children)c.parent=null;this.children=[];this.append(...nodes)}
  remove(){if(this.parent){this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null}}
  setAttribute(k,v){this.attrs[k]=String(v);if(k==='id')this.id=String(v)}getAttribute(k){return k in this.attrs?this.attrs[k]:null}
  matches(sel){assert.match(sel,SIMPLE,'selector supported by the test page: '+sel);if(sel[0]==='.')return this.className.split(/\s+/).includes(sel.slice(1));return this.tagName===sel.toUpperCase()}
  querySelectorAll(sel){const out=[];const walk=n=>{for(const c of n.children){if(c.tagName!=='#TEXT'&&c.matches(sel))out.push(c);walk(c)}};walk(this);return out}
  querySelector(sel){return this.querySelectorAll(sel)[0]||null}
  focus(){doc.activeElement=this}
 }
 const listeners={};
 const doc={body:new Node('body'),activeElement:null,createElement:t=>new Node(t),
  getElementById(id){const find=n=>{for(const c of n.children){if(c.id===id)return c;const f=find(c);if(f)return f}return null};return find(doc.body)},
  addEventListener(k,fn){(listeners[k]||=new Set()).add(fn)},removeEventListener(k,fn){listeners[k]?.delete(fn)}};
 const loading=new Node('p');loading.id='admin-status';const host=new Node('section');host.id='admin';host.hidden=true;doc.body.append(loading,host);

 // Stand-in database and Auth. The admin check is the same as vale_private.require_admin.
 const sim={session:true,admin:true,aal:'aal1',factors:[],calls:[],asks:[],askAnswer:true,clientOptions:null,timers:[],fail:null,filler:0,...setup};
 const reports=[
  {id:'r1',card_id:'c1',card_slug:'ana-ruiz-1a2b3c',card_snapshot:{display_name:'Ana Ruiz',website:'ana.example'},card_current:{display_name:'Ana Ruiz',website:'ana-new.example'},card_published:true,card_hidden:false,
   category:'impersonation',details:'Pretends to be <b>my</b> company.',reporter_email:'reporter@example.invalid',status:'new',repeat_count:2,legal_hold:false,created_at:'2026-11-20T10:00:00Z',last_reported_at:'2026-11-21T10:00:00Z',closed_at:null,reports_on_card:1,reporter_dismissed:0,reporter_blocked:false,
   network_hash:'f'.repeat(64),card_owner_id:'owner-secret-id'},
  {id:'r2',card_id:'c2',card_slug:'bo-lee-9z8y7x',card_snapshot:{display_name:'Bo Lee'},card_current:{display_name:'Bo Lee'},card_published:true,card_hidden:false,
   category:'spam',details:'',reporter_email:null,status:'dismissed',repeat_count:1,legal_hold:false,created_at:'2026-11-19T10:00:00Z',last_reported_at:'2026-11-19T10:00:00Z',closed_at:'2026-11-19T12:00:00Z',reports_on_card:1,reporter_dismissed:3,reporter_blocked:false},
 ];
 for(let i=0;i<sim.filler;i++)reports.push({id:'f'+i,card_id:'cf',card_slug:'filler-card-000000',card_snapshot:{display_name:'Filler'},card_current:{display_name:'Filler'},card_published:true,card_hidden:false,category:'spam',details:'',reporter_email:null,status:'new',repeat_count:1,legal_hold:false,created_at:'2026-01-01T00:00:'+String(i%60).padStart(2,'0')+'.'+String(i).padStart(3,'0')+'Z',last_reported_at:'2026-01-01T00:00:00Z',closed_at:null,reports_on_card:sim.filler,reporter_dismissed:0,reporter_blocked:false});
 const history={r1:[{created_at:'2026-11-21T11:00:00Z',action:'note',from_status:null,to_status:null,note:'Checked the website.',admin_email:'admin@example.invalid'}]};
 const err=(code,message,hint)=>({data:null,error:{code,message,hint}});
 const log=(report,action,note,extra={})=>{(history[report.id]||=[]).push({created_at:'2026-11-21T12:00:00Z',action,note,admin_email:'admin@example.invalid',from_status:null,to_status:null,...extra})};
 const client={
  auth:{
   getSession:async()=>({data:{session:sim.session?{access_token:'x'}:null},error:null}),
   signOut:async o=>{sim.calls.push(['signOut',o]);sim.session=false;return {error:null}},
   mfa:{
    getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:sim.aal,nextLevel:sim.factors.some(f=>f.status==='verified')?'aal2':sim.aal},error:null}),
    listFactors:async()=>({data:{all:sim.factors.slice(),totp:sim.factors.filter(f=>f.status==='verified')},error:null}),
    unenroll:async({factorId})=>{sim.calls.push(['unenroll',factorId]);sim.factors=sim.factors.filter(f=>f.id!==factorId);return {error:null}},
    enroll:async o=>{sim.calls.push(['enroll',o]);sim.factors.push({id:'f-new',factor_type:'totp',status:'unverified'});return {data:{id:'f-new',totp:{qr_code:'data:image/svg+xml;utf-8,<svg></svg>',secret:'JBSWY3DPEHPK3PXP'}},error:null}},
    challengeAndVerify:async({factorId,code})=>{sim.calls.push(['verify',factorId,code]);if(code!=='123456')return {data:null,error:{message:'Invalid TOTP code entered'}};sim.factors.find(f=>f.id===factorId).status='verified';sim.aal='aal2';return {data:{},error:null}},
   },
  },
  rpc:async(fn,args)=>{
   sim.calls.push([fn,args]);
   if(!sim.session)return err('42501','permission denied for function '+fn);
   if(!sim.admin)return err('42501','Not authorized.');
   if(sim.aal!=='aal2')return err('42501','Moderation needs two-step sign-in. Sign in with your authenticator code and try again.','mfa_required');
   if(sim.fail)return err('P0001',sim.fail);
   const r=reports.find(x=>x.id===args.p_report_id)||reports.find(x=>x.card_id===args.p_card_id);
   if(fn!=='admin_list_reports'&&fn!=='admin_report_history'&&fn!=='admin_get_report'&&fn!=='admin_auth_overview'&&!r)return err('P0001','Report not found.');
   const note=String(args.p_note??'').trim(),closing=['dismissed','action_taken'].includes(args.p_status);
   switch(fn){
    case 'admin_auth_overview':return {data:sim.overview||{now:{new_users:2,confirmed_users:5,unconfirmed_pending:1,confirmation_emails_seen:3,recovery_emails_seen:1,hook_blocked:1,hook_errors:0,purge_candidates:0,share_accepted:4,share_refused:1,report_accepted:1,report_refused:0},history:[{day:'2026-11-22',new_users:2,confirmation_emails_seen:3,recovery_emails_seen:1,hook_blocked:1}],hook_recent:[{at:'2026-11-22T10:00:00Z',kind:'blocked',domain:'mailinator.com'}],purge_runs:[{ran_at:'2026-11-22T04:00:00Z',kind:'purge_dry_run',days:7,candidates:0,deleted:0}]},error:null};
    case 'admin_get_report':return {data:reports.filter(x=>x.id===args.p_report_id).map(x=>({...x})),error:null};
    case 'admin_list_reports':{args={...args,p_limit:Math.min(Math.max(args.p_limit,1),200)};const rows=reports.filter(x=>!args.p_status||x.status===args.p_status).sort((a,b)=>(['new','reviewing'].includes(b.status)-['new','reviewing'].includes(a.status))||a.created_at.localeCompare(b.created_at));return {data:rows.slice(args.p_offset,args.p_offset+args.p_limit).map(x=>({...x})),error:null}}
    case 'admin_report_history':return {data:(history[args.p_report_id]||[]).map(x=>({...x})),error:null};
    case 'admin_set_report_status':if(closing&&!note)return err('P0001','Add a short note explaining the decision.');log(r,'status',note,{from_status:r.status,to_status:args.p_status});r.status=args.p_status;r.closed_at=closing?'2026-11-21T12:00:00Z':null;if(closing)r.reporter_email=null;return {data:null,error:null};
    case 'admin_add_note':if(!note)return err('P0001','Add a short note explaining the decision.');log(r,'note',note);return {data:null,error:null};
    case 'admin_hide_card':if(!note)return err('P0001','Add a short note explaining the decision.');if(!String(args.p_owner_message||'').trim())return err('P0001','Write a short explanation for the card owner (up to 500 characters).');
     if(r.card_hidden)return err('P0001','That card is already hidden.');r.card_hidden=true;r.card_published=false;log(r,'hide_card',note);if(['new','reviewing'].includes(r.status)){log(r,'status','Card hidden.',{from_status:r.status,to_status:'action_taken'});r.status='action_taken';r.closed_at='x';r.reporter_email=null}return {data:null,error:null};
    case 'admin_restore_card':if(!note)return err('P0001','Add a short note explaining the decision.');r.card_hidden=false;r.card_published=false;log(r,'restore_card',note);return {data:null,error:null};
    case 'admin_set_legal_hold':if(!note)return err('P0001','Add a short note explaining the decision.');r.legal_hold=args.p_hold;log(r,args.p_hold?'legal_hold':'release_hold',note);return {data:null,error:null};
    case 'admin_block_reporter':if(!note)return err('P0001','Add a short note explaining the decision.');r.reporter_blocked=args.p_block;log(r,args.p_block?'block_reporter':'unblock_reporter',note);return {data:null,error:null};
    default:return err('42883','unknown function');
   }
  },
 };
 const window={supabase:{createClient:(url,key,options)=>{sim.clientOptions={url,key,options};return client}},ValeAsk:async(text,options)=>{sim.asks.push({text,options});return sim.askAnswer}};
 const context={window,document:doc,location:{hostname:'dev.valebrandworks.com'},console,setTimeout:(fn,ms)=>{sim.timers.push({fn,ms});return sim.timers.length},clearTimeout:id=>{if(sim.timers[id-1])sim.timers[id-1].fn=null}};
 window.window=window;vm.createContext(context);vm.runInContext(require('node:fs').readFileSync(require('node:path').join(root,'config.js'),'utf8'),context);
 vm.runInContext(read('report-core.js'),context);vm.runInContext(sources.core,context);vm.runInContext(sources.ui,context);

 const settle=async()=>{for(let i=0;i<12;i++)await new Promise(r=>setImmediate(r))};
 const text=()=>host.hidden?loading.textContent:host.textContent;
 const heading=()=>host.querySelector('h1')?.textContent;
 const button=label=>{const b=host.querySelectorAll('button').find(x=>x.textContent===label);assert.ok(b,'button "'+label+'" on "'+heading()+'"');return b};
 const hasButton=label=>host.querySelectorAll('button').some(x=>x.textContent===label);
 const click=async label=>{button(label).onclick();await settle()};
 const submit=async()=>{const f=host.querySelectorAll('form').pop();await f.onsubmit({preventDefault(){}});await settle()};
 const fill=(id,value)=>{doc.getElementById(id).value=value};
 const rpcCalls=name=>JSON.parse(JSON.stringify(sim.calls.filter(c=>c[0]===name)));
 const statusText=()=>host.querySelectorAll('.status').map(s=>s.textContent).join(' ');
 return {sim,reports,history,listeners,settle,text,heading,button,hasButton,click,submit,fill,rpcCalls,statusText,host,doc,
  restart:async()=>{sim.calls=[];vm.runInContext('window.ValeAdmin.start()',context);await settle()}};
}

async function behaviour(sources){
 // Signed out: nothing is requested from the database.
 let t=scenario(sources,{session:false});await t.settle();
 assert.equal(t.heading(),'Sign in first');assert.equal(t.sim.calls.length,0,'no requests without a sign-in');
 assert.deepEqual(JSON.parse(JSON.stringify(t.sim.clientOptions.options)),{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}},'shares the app’s sign-in; never reads tokens from the address');
 assert.equal(t.sim.clientOptions.url,'https://jlprxnmdvoloahssjlnu.supabase.co','the development project');

 // Signed in, not an admin: one refused request, nothing shown, no two-step setup offered.
 t=scenario(sources,{admin:false});await t.settle();
 assert.equal(t.heading(),'Not available');assert.equal(t.sim.calls.length,1);assert.doesNotMatch(t.text(),/Ana|report|two-step|authenticator/i,'a non-admin learns nothing');

 // An admin without two-step sign-in set up: setup, a wrong code, then the right one.
 t=scenario(sources,{factors:[{id:'f-old',factor_type:'totp',status:'unverified'}]});await t.settle();
 assert.equal(t.heading(),'Set up two-step sign-in');assert.doesNotMatch(t.text(),/Ana Ruiz/,'no report data before two-step sign-in');
 await t.click('Set up an authenticator app');
 assert.deepEqual(t.rpcCalls('unenroll'),[['unenroll','f-old']],'an unfinished earlier setup is removed first');
 assert.deepEqual(t.rpcCalls('enroll')[0][1],{factorType:'totp',friendlyName:'VALE Connect moderation'});
 assert.equal(t.host.querySelector('img').src,'data:image/svg+xml;utf-8,<svg></svg>');assert.match(t.text(),/JBSWY3DPEHPK3PXP/,'a key for manual entry');
 t.fill('admin-code','12');await t.submit();assert.match(t.statusText(),/6-digit code/);assert.equal(t.rpcCalls('verify').length,0,'a short code isn’t sent');
 t.fill('admin-code','654321');await t.submit();assert.match(t.statusText(),/didn’t work/);assert.equal(t.heading(),'Set up two-step sign-in');
 t.fill('admin-code','123 456');await t.submit();
 assert.deepEqual(t.rpcCalls('verify').pop(),['verify','f-new','123456']);assert.equal(t.heading(),'Report review','reviewing starts after two-step sign-in');

 // An admin with an authenticator: asked for a code.
 t=scenario(sources,{factors:[{id:'f1',factor_type:'totp',status:'verified'}]});await t.settle();
 assert.equal(t.heading(),'Two-step sign-in');assert.equal(t.rpcCalls('enroll').length,0);
 t.fill('admin-code','123456');await t.submit();assert.equal(t.heading(),'Report review');

 // Verified: the list. Open reports first; only report and card details, never who reported or owns the card.
 t=scenario(sources,{aal:'aal2',factors:[{id:'f1',factor_type:'totp',status:'verified'}]});await t.settle();
 assert.equal(t.heading(),'Report review');
 const rows=t.host.querySelectorAll('.admin-row');assert.equal(rows.length,2);
 assert.match(rows[0].textContent,/Impersonation or fake identity · Ana Ruiz/);assert.match(rows[0].textContent,/reported 2 times/);assert.match(rows[0].textContent,/New/);
 assert.doesNotMatch(t.text(),/ffffffff|owner-secret-id|reporter@/,'no network code, owner or reporter email in the list');
 await t.click('Dismissed');assert.deepEqual(t.rpcCalls('admin_list_reports').pop()[1],{p_status:'dismissed',p_limit:50,p_offset:0});assert.equal(t.host.querySelectorAll('.admin-row').length,1);
 await t.click('All');

 // One report.
 t.host.querySelectorAll('.admin-row')[0].onclick();await t.settle();
 assert.equal(t.heading(),'Impersonation or fake identity');
 assert.match(t.text(),/Pretends to be <b>my<\/b> company\./,'the explanation is shown as text');
 assert.match(t.text(),/reporter@example\.invalid/,'the reporter’s email, for replying');assert.doesNotMatch(t.text(),/ffffffff|owner-secret-id/,'never the network code or the owner');
 assert.match(t.text(),/Now \(changed\): ana-new\.example/,'changes since the report');assert.match(t.text(),/Checked the website\..*|admin@example\.invalid/);
 assert.ok(t.host.querySelectorAll('a').some(a=>a.href==='p.html?u=ana-ruiz-1a2b3c'&&a.rel==='noopener noreferrer'&&a.target==='_blank'));
 assert.ok(t.host.querySelectorAll('a').some(a=>a.href==='mailto:reporter@example.invalid'));
 for(const label of ['Mark as reviewing','Dismiss','Close as action taken','Hide card','Place legal hold','Block reporting network','Add note'])assert.ok(t.hasButton(label),label);
 assert.ok(!t.hasButton('Lift restriction'),'nothing to restore');

 // Marking as reviewing needs no note and no confirmation.
 await t.click('Mark as reviewing');await t.submit();
 assert.deepEqual(t.rpcCalls('admin_set_report_status').pop()[1],{p_report_id:'r1',p_status:'reviewing',p_note:''});assert.equal(t.sim.asks.length,0);assert.equal(t.reports[0].status,'reviewing');

 // Hiding: the owner's explanation, a note, then a confirmation. Nothing is sent before all three.
 await t.click('Hide card');
 await t.submit();assert.match(t.statusText(),/explanation the card’s owner will see/);
 t.fill('admin-owner-message','This card appears to impersonate another business.');await t.submit();assert.match(t.statusText(),/Add a short note/);
 assert.equal(t.rpcCalls('admin_hide_card').length,0,'nothing sent without both');
 t.fill('admin-note','Compared with the real company site.');t.sim.askAnswer=false;await t.submit();
 assert.equal(t.sim.asks.length,1);assert.match(t.sim.asks[0].text,/^Hide this card\?/);assert.equal(t.sim.asks[0].options.danger,true);
 assert.equal(t.rpcCalls('admin_hide_card').length,0,'cancelling sends nothing');assert.match(t.statusText(),/Nothing was changed/);
 t.sim.askAnswer=true;await t.submit();
 assert.deepEqual(t.rpcCalls('admin_hide_card'),[['admin_hide_card',{p_report_id:'r1',p_owner_message:'This card appears to impersonate another business.',p_note:'Compared with the real company site.'}]]);
 assert.match(t.text(),/Hidden after review/);assert.match(t.text(),/Card hidden/);assert.match(t.text(),/Status changed: Reviewing → Action taken/,'the audit trail');
 assert.doesNotMatch(t.text(),/reporter@example\.invalid/,'the reporter’s email is gone once closed');
 assert.ok(t.hasButton('Lift restriction')&&!t.hasButton('Hide card'));

 // Database refusals are shown in its own words; nothing else changes.
 t.sim.fail='That card isn’t hidden.';await t.click('Lift restriction');t.fill('admin-note','Appeal accepted.');await t.submit();
 assert.match(t.statusText(),/That card isn’t hidden\./);t.sim.fail=null;await t.submit();
 assert.deepEqual(t.rpcCalls('admin_restore_card').pop()[1],{p_card_id:'c1',p_note:'Appeal accepted.'});assert.match(t.sim.asks.pop().text,/^Lift the restriction on this card\? It stays private until its owner chooses to publish it again\./);
 assert.match(t.text(),/Private \(not public until its owner publishes it\)/);assert.match(t.text(),/Restriction lifted/,'the audit trail');

 // Legal hold and blocking, each with a note and confirmation.
 await t.click('Place legal hold');t.fill('admin-note','Requested by counsel.');await t.submit();
 assert.deepEqual(t.rpcCalls('admin_set_legal_hold').pop()[1],{p_report_id:'r1',p_hold:true,p_note:'Requested by counsel.'});assert.ok(t.hasButton('Release legal hold'));
 await t.click('Block reporting network');await t.submit();assert.equal(t.rpcCalls('admin_block_reporter').length,0,'a block needs a note');
 t.fill('admin-note','Repeated false reports.');await t.submit();
 assert.deepEqual(t.rpcCalls('admin_block_reporter').pop()[1],{p_report_id:'r1',p_block:true,p_note:'Repeated false reports.'});assert.equal(t.sim.asks.pop().options.danger,true);
 assert.match(t.text(),/This network is blocked from reporting/);

 // Two-step sign-in expires mid-review: back to the code, and the report leaves the page.
 t.sim.aal='aal1';await t.click('Add note');t.fill('admin-note','x');await t.submit();
 assert.equal(t.heading(),'Two-step sign-in');assert.doesNotMatch(t.text(),/Ana Ruiz|impersonate|Requested by counsel/,'report data is cleared');

 // A report past the first 200 opens, and stays open after a decision (it was lost when found by scanning the list).
 t=scenario(sources,{aal:'aal2',filler:250});await t.settle();
 for(let i=0;i<5;i++)await t.click('Show more');
 const far=t.host.querySelectorAll('.admin-row').find(r=>/Ana Ruiz/.test(r.textContent));assert.ok(far,'the report appears after Show more');
 assert.ok(t.host.querySelectorAll('.admin-row').indexOf(far)>=200,'test setup: past the first 200');
 far.onclick();await t.settle();assert.equal(t.heading(),'Impersonation or fake identity','opens a report past the first 200');
 assert.deepEqual(t.rpcCalls('admin_get_report').pop()[1],{p_report_id:'r1'});
 await t.click('Mark as reviewing');await t.submit();
 assert.equal(t.heading(),'Impersonation or fake identity','stays open after a decision');assert.match(t.text(),/Status changed: New → Reviewing/);
 // A report deleted on schedule meanwhile: the database’s own answer is shown, and nothing changes.
 t.reports.splice(t.reports.findIndex(r=>r.id==='r1'),1);await t.click('Add note');t.fill('admin-note','x');await t.submit();
 assert.match(t.statusText(),/Report not found./);

 // Inactivity: signed out on this device after 15 minutes.
 t=scenario(sources,{aal:'aal2'});await t.settle();
 const timer=t.sim.timers.filter(x=>x.fn).pop();assert.equal(timer.ms,15*60000);
 assert.ok(['pointerdown','keydown','touchstart','scroll'].every(k=>t.listeners[k]?.size===1),'activity keeps the page open');
 timer.fn();await t.settle();
 assert.deepEqual(t.rpcCalls('signOut').pop(),['signOut',{scope:'local'}]);assert.equal(t.heading(),'Sign in first');assert.match(t.text(),/15 minutes without activity/);
 assert.ok(['pointerdown','keydown'].every(k=>!t.listeners[k]?.size),'the timer stops once signed out');
 // Sign-up overview: counts only, thresholds explained in plain words, errors handled, no addresses.
 t=scenario(sources,{aal:'aal2'});await t.settle();await t.click('Sign-up overview');
 assert.equal(t.heading(),'Sign-up overview');assert.match(t.text(),/New accounts today: 2/);assert.match(t.text(),/Refused a new account from mailinator\.com/);assert.match(t.text(),/Dry run: 0 would be deleted/);
 assert.doesNotMatch(t.text(),/@|example\.invalid/,'no email addresses on the overview');assert.doesNotMatch(t.text(),/free email plan allows/,'no warning at low volume');
 assert.deepEqual(t.rpcCalls('admin_auth_overview').length,1);await t.click('Back to reports');assert.equal(t.heading(),'Report review');
 t=scenario(sources,{aal:'aal2'});t.sim.overview={now:{confirmation_emails_seen:70,recovery_emails_seen:12,hook_errors:2,purge_candidates:3},history:[],hook_recent:[],purge_runs:[{ran_at:'2026-11-22T04:00:00Z',kind:'purge_started',days:7,candidates:3,deleted:0}]};await t.settle();await t.click('Sign-up overview');
 assert.match(t.text(),/About 82 sign-up and reset emails/);assert.match(t.text(),/used up/);assert.match(t.text(),/internal error/);assert.match(t.text(),/3 sign-up\(s\) were never confirmed/);assert.match(t.text(),/Started a deletion batch of 3/,'a started batch is not shown as a dry run');
 t=scenario(sources,{aal:'aal2'});await t.settle();t.sim.fail='Nope.';await t.click('Sign-up overview');assert.match(t.text(),/Nope\./,'a database message is shown plainly');
 t=scenario(sources,{aal:'aal2'});t.sim.overview='garbage';await t.settle();await t.click('Sign-up overview');assert.equal(t.heading(),'Sign-up overview','odd data does not break the page');
 // The sign-out button.
 t=scenario(sources,{aal:'aal2'});await t.settle();await t.click('Sign out');assert.deepEqual(t.rpcCalls('signOut').pop(),['signOut',{scope:'local'}]);assert.equal(t.heading(),'Sign in first');
}

// ---------- Each protection, broken on purpose, must be caught ----------
const SABOTAGE=[
 ['no confirmation before a decision','ui',"if(spec.confirm&&!await window.ValeAsk(","if(false&&!await window.ValeAsk("],
 ['hiding without an owner explanation','core',"if(!v)return {value:v,error:'Write the explanation","if(false)return {value:v,error:'Write the explanation"],
 ['decisions without a note','core',"if(required&&!v)return","if(false&&!v)return"],
 ['two-step sign-in treated as "not allowed"','core',"if(error.code==='42501'&&error.hint==='mfa_required')return 'mfa';",""],
 ['non-admins offered two-step setup','core',"if(error.code==='42501'&&error.hint==='mfa_required')return 'mfa';","if(error.code==='42501')return 'mfa';"],
 ['no inactivity sign-out','ui',"state.idle=setTimeout(()=>void signOut(","state.idle=setTimeout(()=>void 0&&signOut("],
 ['the network code shown','ui',"row('Reports about this card',r.reports_on_card),","row('Reports about this card',r.reports_on_card),row('Network',r.network_hash),"],
 ['the owner’s explanation swapped for the note','core',"p_owner_message:ownerMessage","p_owner_message:note"],
 ['restore offered for a visible card','core',"if(report.card_hidden)out.push('restore');else if","out.push('restore');if"],
 ['sign-in read from the address','ui',"detectSessionInUrl:false","detectSessionInUrl:true"],
 ['wrong codes sent anyway','core',"/^\\d{6}$/.test(","/^\\d{2,}$/.test("],
 ['a report found by scanning the first 200','ui',"state.client.rpc('admin_get_report',{p_report_id:id})","state.client.rpc('admin_list_reports',{p_status:null,p_limit:200,p_offset:0}).then(r=>r.error?r:{data:(r.data||[]).filter(x=>x.id===id)})"],
 ['lifting promises the card is public again','core',"It stays private until its owner chooses to publish it again.","It becomes public again at once."],
 ['signing out of every device','ui',"signOut({scope:'local'})","signOut({scope:'global'})"],
 ['no warning when the email allowance is nearly used','core',"if(sent>=EMAIL_WARN_AT)","if(false)"],
 ['an internal filter error not shown','core',"if(num(n.hook_errors)>0)","if(false)"],
];
(async()=>{
 const sources={core:coreSrc,ui};
 await behaviour(sources);
 let caught=0;
 for(const [label,file,find,replace] of SABOTAGE){
  const src=sources[file];assert.ok(src.includes(find),'sabotage target not found: '+label);
  const broken={...sources,[file]:src.replace(find,replace)};
  let failed=false;try{await behaviour(broken)}catch{failed=true}
  // The page's own rules are checked through the module too, as the tests above do with the real file.
  if(!failed&&file==='core'){const m={exports:{}};try{new Function('module','require','globalThis',broken.core)(m,require,{ValeReportCore:reportCore});const c=m.exports;
   assert.ok(c.checkNote('  ').error);assert.ok(c.checkOwnerMessage('').error);assert.equal(c.gate({code:'42501',hint:'mfa_required'}),'mfa');assert.equal(c.gate({code:'42501',message:'Not authorized.'}),'denied');}catch{failed=true}}
  assert.ok(failed,'a broken protection went unnoticed: '+label);caught++;
 }
 console.log('admin page: behaviour checks passed; '+caught+' of '+SABOTAGE.length+' broken protections caught');
})().catch(e=>{console.error(e);process.exit(1)});
