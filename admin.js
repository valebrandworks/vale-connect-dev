/* Private report review (admin.html). Not linked from anywhere, and it shows nothing to anyone who isn't a listed
   platform admin signed in with two-step verification. That is enforced by the database on every request
   (vale_private.require_admin); this page only follows the database's answers. Rules and wording live in
   admin-core.js. Report data is kept in memory only, never stored in the browser. */
(()=>{
 'use strict';
 const core=window.ValeAdminCore;if(!core||typeof document==='undefined')return;
 const SUPABASE_URL='https://jlprxnmdvoloahssjlnu.supabase.co',SUPABASE_KEY='sb_publishable_wxT0A5bByFX67J1ut0F-ZA_xITdxwf_';
 const $=id=>document.getElementById(id);
 const el=(tag,props={},...children)=>{const node=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(v===undefined||v===null)continue;if(k==='class')node.className=v;else if(k==='text')node.textContent=v;else if(k in node&&!k.startsWith('aria'))node[k]=v;else node.setAttribute(k,v)}node.append(...children.filter(c=>c!==null&&c!==undefined&&c!==false));return node};
 const host=$('admin'),loading=$('admin-status');
 const state={client:null,filter:'',reports:[],more:false,current:null,idle:null,epoch:0};

 function show(...nodes){loading.hidden=true;host.hidden=false;host.replaceChildren(...nodes.filter(Boolean));host.querySelector('h1')?.focus()}
 const title=text=>el('h1',{tabindex:'-1',text});
 const status=()=>el('p',{class:'status',role:'status','aria-live':'polite'});
 const say=(node,text,tone='')=>{node.textContent=text;if(tone)node.dataset.tone=tone;else delete node.dataset.tone};
 const forget=()=>{state.reports=[];state.current=null;state.more=false;state.epoch++};

 // ---------- Who may see this page ----------
 function signedOut(note=''){
  stopIdle();forget();
  show(title('Sign in first'),note?el('p',{class:'note',text:note}):null,
   el('p',{class:'muted',text:'Sign in to VALE Connect on this device, then come back to this page.'}),
   el('div',{class:'actions'},el('a',{class:'btn primary',href:'./',text:'Go to VALE Connect'})));
 }
 function denied(){
  stopIdle();forget();
  show(title('Not available'),el('p',{class:'muted',text:'This page isn’t available for your account.'}),el('div',{class:'actions'},el('a',{class:'btn',href:'./',text:'Go to VALE Connect'})));
 }
 function broken(text){show(title('Something went wrong'),el('p',{class:'muted',text}),el('div',{class:'actions'},el('button',{class:'btn',type:'button',text:'Try again',onclick:()=>void check()})))}
 async function fail(error,where){
  const g=core.gate(error);
  if(g==='mfa')return mfa();
  if(g==='denied')return denied();
  if(where)say(where,core.errorText(error),'error');else broken(core.errorText(error));
 }

 // A first, harmless request. Only the database decides: admin with two-step sign-in, admin without it, or no one.
 async function check(){
  const {error}=await state.client.rpc('admin_list_reports',{p_status:'new',p_limit:1,p_offset:0});
  const g=core.gate(error);
  if(g==='ok'){startIdle();return list(true)}
  if(g==='mfa')return mfa();
  if(g==='denied')return denied();
  broken(core.errorText(error));
 }

 // ---------- Two-step sign-in (an authenticator app) ----------
 async function mfa(){
  stopIdle();forget();
  const [aal,factors]=await Promise.all([state.client.auth.mfa.getAuthenticatorAssuranceLevel(),state.client.auth.mfa.listFactors()]);
  if(aal.error||factors.error)return broken('Couldn’t check your two-step sign-in. Try again.');
  const verified=(factors.data?.totp||[]).filter(f=>f.status==='verified');
  const step=core.mfaStep(aal.data||{},verified);
  // Already verified, but the database still asked: the sign-in is out of date.
  if(step==='ok')return signedOut('Your sign-in is out of date. Sign out of VALE Connect, sign in again, then reopen this page.');
  if(step==='challenge')return challenge(verified[0]);
  return enroll(factors.data?.all||[]);
 }
 function codeForm(factorId,intro){
  const input=el('input',{id:'admin-code',name:'code',inputMode:'numeric',autocomplete:'one-time-code',maxLength:7,placeholder:'123456'});
  const note=status();
  const verify=el('button',{class:'btn primary',type:'submit',text:'Verify'});
  const form=el('form',{class:'share-form',noValidate:true},
   el('div',{class:'share-field'},el('label',{for:'admin-code',text:'6-digit code from your authenticator app'}),input),
   el('div',{class:'actions'},verify),note);
  let sending=false;
  form.onsubmit=async event=>{
   event.preventDefault();if(sending)return;
   const code=String(input.value||'').replace(/\s+/g,'');
   if(!core.codeOk(code)){say(note,'Enter the 6-digit code.','error');input.focus();return}
   sending=true;verify.disabled=true;say(note,'Checking…');
   const {error}=await state.client.auth.mfa.challengeAndVerify({factorId,code});
   sending=false;verify.disabled=false;
   if(error){input.value='';say(note,'That code didn’t work. Use the newest code in your authenticator app.','error');input.focus();return}
   void check();
  };
  return [intro,form].filter(Boolean);
 }
 function challenge(factor){
  show(title('Two-step sign-in'),...codeForm(factor.id,el('p',{class:'muted',text:'Moderation needs a code from your authenticator app each time you sign in.'})),signOutRow());
 }
 function enroll(allFactors){
  const note=status();
  const start=el('button',{class:'btn primary',type:'button',text:'Set up an authenticator app'});
  const area=el('div',{class:'admin-enroll'});
  start.onclick=async()=>{
   start.disabled=true;say(note,'Preparing…');
   // An unfinished setup from earlier is removed first, so a fresh code can be issued.
   for(const f of allFactors)if(f.factor_type==='totp'&&f.status==='unverified')await state.client.auth.mfa.unenroll({factorId:f.id});
   const {data,error}=await state.client.auth.mfa.enroll({factorType:'totp',friendlyName:'VALE Connect moderation'});
   if(error||!data?.id){start.disabled=false;say(note,'Couldn’t start the setup. Try again.','error');return}
   say(note,'');start.remove();
   const qr=String(data.totp?.qr_code||'');
   area.replaceChildren(...[
    el('p',{class:'muted',text:'1. Scan this code with your authenticator app (for example Microsoft Authenticator, Google Authenticator or 1Password).'}),
    qr.startsWith('data:image/svg+xml')?el('img',{class:'admin-qr',src:qr,alt:'Setup code for your authenticator app'}):null,
    el('p',{class:'hint'},'Can’t scan it? Enter this key in the app instead: ',el('code',{class:'admin-secret',text:String(data.totp?.secret||'')})),
    el('p',{class:'muted',text:'2. Enter the code the app shows.'}),
    ...codeForm(data.id,null)].filter(Boolean));
  };
  show(title('Set up two-step sign-in'),
   el('p',{class:'muted',text:'Moderation needs two-step sign-in: your password, plus a code from an authenticator app on your phone.'}),
   el('p',{class:'note',text:'Keep the key private. Anyone with it can create your codes.'}),
   el('div',{class:'actions'},start),area,note,signOutRow());
 }

 // ---------- Report list ----------
 async function list(reset){
  const e=state.epoch;
  if(reset){state.reports=[];state.more=false}
  const {data,error}=await state.client.rpc('admin_list_reports',{p_status:state.filter||null,p_limit:core.LIMITS.page,p_offset:state.reports.length});
  if(e!==state.epoch)return;
  if(error)return fail(error);
  const rows=Array.isArray(data)?data:[];
  state.reports=state.reports.concat(rows);state.more=rows.length===core.LIMITS.page;state.current=null;
  renderList();
 }
 function flags(r){
  return el('span',{class:'admin-flags'},
   el('span',{class:'pill'+(core.isOpen(r)?' public':''),text:core.statusLabel(r.status)}),
   r.card_hidden?el('span',{class:'pill',text:'Card hidden'}):null,
   r.legal_hold?el('span',{class:'pill',text:'Legal hold'}):null,
   r.reporter_blocked?el('span',{class:'pill',text:'Network blocked'}):null);
 }
 function renderList(){
  const chips=el('div',{class:'chips',role:'group','aria-label':'Show reports'});
  for(const [key,label] of core.FILTERS){
   const b=el('button',{type:'button',class:'btn'+(key===state.filter?' primary':''),text:label});
   b.setAttribute('aria-pressed',String(key===state.filter));
   b.onclick=()=>{if(state.filter===key)return;state.filter=key;state.epoch++;void list(true)};
   chips.append(b);
  }
  const rows=el('div',{class:'admin-list'});
  for(const r of state.reports){
   const name=String(r.card_snapshot?.display_name||'').trim()||'Unnamed card';
   const times=r.repeat_count>1?' · reported '+r.repeat_count+' times':'';
   rows.append(el('button',{type:'button',class:'list-row admin-row',onclick:()=>void open(r.id)},
    el('span',{class:'who'},el('b',{text:core.categoryLabel(r.category)+' · '+name}),el('span',{text:r.card_slug+' · '+core.when(r.created_at)+times})),flags(r)));
  }
  if(!state.reports.length)rows.append(el('p',{class:'muted center',text:'No reports here.'}));
  const more=state.more?el('div',{class:'actions'},el('button',{class:'btn ghost block',type:'button',text:'Show more',onclick:()=>void list(false)})):null;
  show(title('Report review'),chips,rows,more,signOutRow());
 }

 // ---------- One report ----------
 // The newest copy of one report, by its id (admin_get_report), however many reports there are.
 async function fresh(id){
  const {data,error}=await state.client.rpc('admin_get_report',{p_report_id:id});
  if(error)return {error};
  const rows=Array.isArray(data)?data:[];
  return {report:rows.length===1&&rows[0].id===id?rows[0]:null};
 }
 async function open(id){
  const e=++state.epoch;
  const [found,history]=await Promise.all([fresh(id),state.client.rpc('admin_report_history',{p_report_id:id})]);
  if(e!==state.epoch)return;
  if(found.error)return fail(found.error);
  if(history.error)return fail(history.error);
  if(!found.report){state.epoch++;return list(true)}
  state.current=found.report;
  const i=state.reports.findIndex(r=>r.id===id);if(i>=0)state.reports[i]=found.report;
  renderDetail(found.report,Array.isArray(history.data)?history.data:[]);
 }
 const row=(label,value)=>value===''||value===null||value===undefined?null:el('div',{},el('dt',{text:label}),el('dd',{text:String(value)}));
 function renderDetail(r,history){
  const back=el('button',{class:'btn ghost',type:'button',text:'← All reports',onclick:()=>{state.epoch++;void list(true)}});
  const facts=el('dl',{class:'admin-facts'},
   row('First reported',core.when(r.created_at)),
   row('Times reported',r.repeat_count>1?r.repeat_count+' (identical reports from the same network are merged)':1),
   r.repeat_count>1?row('Last reported',core.when(r.last_reported_at)):null,
   row('Reports about this card',r.reports_on_card),
   r.closed_at?row('Closed',core.when(r.closed_at)):null);
  const explanation=String(r.details||'').trim();
  const reportBox=el('section',{class:'panel admin-box','aria-label':'Report'},
   el('h2',{text:'Report'}),facts,
   el('h3',{text:'Explanation'}),explanation?el('p',{class:'admin-text',text:explanation}):el('p',{class:'muted',text:'No explanation given.'}));
  // The reporter: an email only if they left one (deleted when the report closes), and counts. Never a network or address.
  const reporter=el('section',{class:'panel admin-box','aria-label':'Reporter'},el('h2',{text:'Reporter'}),
   r.reporter_email?el('p',{},'Email, for replying only: ',el('a',{href:'mailto:'+encodeURIComponent(r.reporter_email).replace(/%40/g,'@'),text:r.reporter_email})):el('p',{class:'muted',text:core.isOpen(r)?'No email left.':'No email kept (removed when the report closed).'}),
   el('p',{class:'muted',text:r.reporter_dismissed>0?'Earlier reports from the same network that were dismissed: '+r.reporter_dismissed+'.':'No dismissed reports from the same network.'}),
   r.reporter_blocked?el('p',{class:'note',text:'This network is blocked from reporting.'}):null,
   el('p',{class:'hint',text:'Reporters are never identified. The card’s owner is never told who reported it.'}));
  const changes=core.cardRows(r);
  const table=el('div',{class:'admin-compare'});
  for(const c of changes)table.append(el('div',{class:'admin-compare-row'+(c.changed?' changed':'')},
   el('b',{text:c.label}),el('span',{},el('span',{class:'admin-k',text:'As reported: '}),c.reported||'—'),
   c.current===null?null:el('span',{},el('span',{class:'admin-k',text:c.changed?'Now (changed): ':'Now: '}),c.current||'—')));
  const card=el('section',{class:'panel admin-box','aria-label':'Card'},el('h2',{text:'Card'}),
   el('p',{},el('b',{text:core.cardState(r)}),' · ',el('span',{class:'muted',text:r.card_slug})),
   table,
   r.card_published&&!r.card_hidden?el('p',{},el('a',{href:'p.html?u='+encodeURIComponent(r.card_slug),target:'_blank',rel:'noopener noreferrer',text:'Open the public card'})):null);
  const actions=el('section',{class:'panel admin-box','aria-label':'Decisions'},el('h2',{text:'Decisions'}));
  const buttons=el('div',{class:'admin-buttons'});
  const formArea=el('div',{});
  for(const a of core.actions(r)){
   const spec=core.ACTIONS[a];
   buttons.append(el('button',{type:'button',class:'btn'+(spec.danger?' danger':''),text:spec.label,onclick:()=>{formArea.replaceChildren(actionForm(a,r,()=>{formArea.replaceChildren();buttons.hidden=false}));buttons.hidden=true;formArea.querySelector('textarea')?.focus()}}));
  }
  actions.append(buttons,formArea);
  const log=el('ol',{class:'admin-history'});
  for(const h of history){const line=core.historyLine(h);log.append(el('li',{},el('b',{text:line.title}),el('span',{class:'muted small',text:' · '+line.when+' · '+line.by}),line.note?el('p',{class:'admin-text',text:line.note}):null))}
  const trail=el('section',{class:'panel admin-box','aria-label':'Audit trail'},el('h2',{text:'Audit trail'}),history.length?log:el('p',{class:'muted',text:'No decisions yet.'}));
  show(el('div',{class:'actions'},back),title(core.categoryLabel(r.category)),flags(r),reportBox,card,reporter,actions,trail,signOutRow());
 }

 // Every decision: a note (and, to hide a card, the owner's explanation), then a confirmation, then the database.
 function actionForm(action,report,close){
  const spec=core.ACTIONS[action];
  const note=status();
  const ownerInput=spec.owner?el('textarea',{id:'admin-owner-message',rows:4,maxLength:core.LIMITS.ownerMessage,placeholder:'For example: This card appears to impersonate another business.'}):null;
  const noteInput=el('textarea',{id:'admin-note',rows:3,maxLength:core.LIMITS.note});
  const submit=el('button',{type:'submit',class:'btn '+(spec.danger?'danger':'primary'),text:spec.label});
  const cancel=el('button',{type:'button',class:'btn',text:'Cancel',onclick:close});
  const form=el('form',{class:'share-form admin-form',noValidate:true},
   el('h3',{text:spec.label}),
   ownerInput?el('div',{class:'share-field'},el('label',{for:'admin-owner-message',text:'Explanation for the card’s owner'}),ownerInput,
    el('p',{class:'hint',text:'They’ll see this with the reason ('+core.categoryLabel(report.category)+') and how to appeal. Don’t mention the reporter.'})):null,
   el('div',{class:'share-field'},el('label',{for:'admin-note',text:spec.noteLabel}),noteInput,el('p',{class:'hint',text:'Kept in the audit trail. Only admins see it.'})),
   el('div',{class:'actions two'},cancel,submit),note);
  let sending=false;
  form.onsubmit=async event=>{
   event.preventDefault();if(sending)return;
   const n=core.checkNote(noteInput.value,!spec.optional);
   const m=spec.owner?core.checkOwnerMessage(ownerInput.value):{value:'',error:''};
   if(m.error){say(note,m.error,'error');ownerInput.focus();return}
   if(n.error){say(note,n.error,'error');noteInput.focus();return}
   if(spec.confirm&&!await window.ValeAsk(spec.confirm,{confirmLabel:spec.label,danger:!!spec.danger})){say(note,'Nothing was changed.');return}
   sending=true;submit.disabled=true;cancel.disabled=true;say(note,'Saving…');
   const [fn,args]=core.call(action,report,{note:n.value,ownerMessage:m.value});
   const {error}=await state.client.rpc(fn,args);
   sending=false;submit.disabled=false;cancel.disabled=false;
   if(error)return fail(error,note);
   void open(report.id);
  };
  return form;
 }

 // ---------- Signing out ----------
 function signOutRow(){return el('div',{class:'actions admin-signout'},el('button',{class:'btn ghost',type:'button',text:'Sign out',onclick:()=>void signOut('')}))}
 async function signOut(note){
  stopIdle();forget();
  try{await state.client.auth.signOut({scope:'local'})}catch{}
  signedOut(note);
 }
 const ACTIVITY=['pointerdown','keydown','touchstart','scroll'];
 const nudge=()=>{if(state.idle===null)return;clearTimeout(state.idle);state.idle=setTimeout(()=>void signOut('You were signed out after '+core.IDLE_MINUTES+' minutes without activity.'),core.IDLE_MINUTES*60000)};
 function startIdle(){if(state.idle!==null)return;state.idle=0;for(const k of ACTIVITY)document.addEventListener(k,nudge,{passive:true});nudge()}
 function stopIdle(){if(state.idle===null)return;clearTimeout(state.idle);state.idle=null;for(const k of ACTIVITY)document.removeEventListener(k,nudge)}

 async function start(){
  if(!window.supabase?.createClient){say(loading,'This page can’t load right now. Try again later.');return}
  state.client=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
  try{
   const {data}=await state.client.auth.getSession();
   if(!data?.session)return signedOut();
   await check();
  }catch(e){broken('This page can’t load right now. Check your connection and try again.')}
 }
 window.ValeAdmin={start};
 void start();
})();
