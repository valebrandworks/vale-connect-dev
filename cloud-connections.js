/* The Connections tab. The editor is in memory only; browser-only connections are imported from Account. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id),core=window.ValeCloudConnections,local=window.ValeConnections;
 if(!$('cloud-connections')||!core||!local)return;
 let client=null,user=null,rows=[],selected=null,dirty=false,busy=false,epoch=0,timer=null,open=false;
 const ask=(text,options)=>window.ValeAsk?window.ValeAsk(text,options):Promise.resolve(confirm(text));
 const fields=Object.keys(core.fields),message=text=>{$('cloud-contacts-status').textContent=text};
 const values=()=>({...Object.fromEntries(fields.map(k=>[k,$('cloud-'+k).value])),history:selected?structuredClone(selected.history):[]});
 const editing=()=>dirty||!!$('cloud-new-note').value.trim();
 const publish=()=>window.dispatchEvent(new CustomEvent('vale-cloud-connections-loaded',{detail:{rows:[...rows]}}));
 const allowed=feature=>window.ValeUsage?.has?.(feature)!==false;
 // Plan features that aren't included are hidden, not shown locked.
 const shown=feature=>window.ValeUsage?.has?.(feature)===true;
 const discard=async()=>!editing()||await ask('Discard your unsaved changes to this connection?',{confirmLabel:'Discard'});
 function controls(){
  $('cloud-contacts-login').hidden=!!user;$('cloud-contacts-workspace').hidden=!user;
  for(const id of ['cloud-contacts-new','cloud-contacts-review','cloud-contacts-save','cloud-contacts-import','cloud-export-csv','cloud-export-json'])$(id).disabled=busy||!user;
  $('cloud-contacts-note-save').disabled=busy||!user||!selected||dirty;
  $('cloud-contacts-archive').disabled=busy||!user||!selected||dirty;
  $('cloud-contacts-delete').disabled=busy||!user||!selected;
  $('cloud-contacts-archive').textContent=selected?.archived_at?'Restore':'Archive';
  $('cloud-new-note').disabled=busy||!user||!selected;
  for(const input of $('cloud-connection-form').querySelectorAll('input,textarea,select'))input.disabled=busy||!user;
  for(const id of ['cloud-cmetOn','cloud-cmetWhere','cloud-cmetHow','cloud-cintroducedBy'])if(!allowed('meeting_details'))$(id).disabled=true;
  if(!allowed('dated_history')){$('cloud-contacts-note-save').disabled=true;$('cloud-new-note').disabled=true}
  for(const id of ['cloud-contacts-followup','cloud-contacts-category'])$(id).disabled=!allowed('advanced_search');
  for(const el of document.querySelectorAll?.('[data-feature]')||[])el.hidden=!shown(el.dataset.feature);
  // Free searches names only, so the box says so.
  $('cloud-contacts-search').placeholder=shown('advanced_search')?'Search connections':'Search by name';
  const note=window.ValeUsage?.nearLimit?.(window.ValeUsage.usage?.())||'';
  $('cloud-contacts-plan-note').textContent=note;$('cloud-contacts-plan-note').hidden=!note;
  if($('cloud-contacts-editor')){$('cloud-contacts-editor').hidden=!open;$('cloud-contacts-browse').hidden=open}
  if($('cloud-contacts-editor-state'))$('cloud-contacts-editor-state').textContent=selected?(selected.archived_at?'Archived':''):'New connection';
  $('cloud-contacts-archive').hidden=$('cloud-contacts-delete').hidden=!selected;
 }
 function renderHistory(){
  const box=$('cloud-contacts-history');box.replaceChildren();
  for(const entry of (Array.isArray(selected?.history)?selected.history:[])){
   const p=document.createElement('p'),when=new Date(entry.date);p.textContent=(isNaN(when)?String(entry.date||''):when.toLocaleDateString())+' · '+String(entry.text||'');box.append(p);
  }
 }
 function fill(row){
  selected=row?{...row}:null;dirty=false;
  const v=row?core.toLocal(row):{ccategory:'Other',cnext:'Follow up'};
  fields.forEach(k=>{$('cloud-'+k).value=v[k]||''});$('cloud-new-note').value='';renderHistory();controls();renderList();
 }
 function renderList(){
  const list=$('cloud-contacts-list');list.replaceChildren();const showArchived=$('cloud-contacts-view').value==='archived',filters={query:$('cloud-contacts-search').value,category:$('cloud-contacts-category').value,followUp:$('cloud-contacts-followup').value,today:new Date().toLocaleDateString('en-CA'),advanced:allowed('advanced_search')},filtering=!!(String(filters.query).trim()||(filters.advanced&&(filters.category||filters.followUp))),visible=rows.filter(row=>(showArchived?!!row.archived_at:!row.archived_at)&&core.matches(row,filters));$('cloud-contacts-count').textContent=String(visible.length);
  if(!visible.length){const p=document.createElement('p');p.className='muted';p.textContent=filtering?'No connections match your search.':showArchived?'No archived connections.':'No connections yet. Add someone you’ve met, or save a card someone shares with you.';list.append(p)}
  const today=new Date().toLocaleDateString('en-CA');
  for(const row of visible){
   const b=document.createElement('button');b.type='button';b.className='list-row';b.disabled=busy;
   const avatar=document.createElement('span'),who=document.createElement('span'),name=document.createElement('b'),sub=document.createElement('span');
   avatar.className='avatar';avatar.setAttribute('aria-hidden','true');avatar.textContent=String(row.full_name||'').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0].toUpperCase()).join('')||'·';
   who.className='who';name.textContent=row.full_name;
   // Where it came from: someone shared their details from your card, or you've both shared.
   if(row.mutual||row.source==='shared_back'){const tag=document.createElement('span');tag.className='pill public tag';tag.textContent=row.mutual?'Mutual':'Shared';name.append(' ',tag)}
   const due=row.follow_up_on&&row.next_step!=='Completed'&&row.follow_up_on<=today;
   sub.textContent=[row.business_name,row.follow_up_on&&row.next_step!=='Completed'?row.next_step+' · '+row.follow_up_on:''].filter(Boolean).join(' · ');if(due)sub.className='due';
   who.append(name,sub);b.append(avatar,who);
   b.setAttribute('aria-pressed',String(row.id===selected?.id));b.onclick=async()=>{if(await discard()){open=true;fill(row)}};list.append(b);
  }
 }
 async function load(){
  const e=epoch,owner=user.id,data=await core.list(client,owner,()=>e===epoch&&owner===user?.id);if(e!==epoch||owner!==user?.id)return false;
  rows=data;publish();if(selected&&!editing()){const latest=rows.find(r=>r.id===selected.id);if(latest)fill(latest)}renderList();return true;
 }
 async function run(work){
  if(busy||!user)return;const e=epoch;busy=true;controls();renderList();
  try{await work(e)}catch(error){if(e===epoch)message(error.code==='23505'?'This shared connection is already in your cloud list. Refresh to view it.':(error.message||'Cloud request failed.')+' Your current editor values were kept.')}
  finally{if(e===epoch){busy=false;controls();renderList()}}
 }
 function conflict(){message('This connection changed on another device. Nothing was overwritten; your edits are still in the form. Copy them before refreshing the cloud list.')}
 for(const format of ['csv','json'])$('cloud-export-'+format).onclick=()=>{
  if(!user||busy)return;const account=user,api=client;
  void ask('Download the connections saved to '+account.email+'? The file includes private notes and follow-ups. Store it somewhere private.',{confirmLabel:'Download'}).then(ok=>ok&&run(async e=>{
   message('Preparing your saved cloud connections…');
   const exporter=window.ValeConnectionExport,data=await exporter.fetchAll(api,account.id,()=>e===epoch&&user?.id===account.id);
   if(e!==epoch)return;const result=exporter.file(data,format);exporter.download(result);
   message('Downloaded '+result.count+' connections ('+format.toUpperCase()+'). Check your downloads before relying on this backup.');
  }));
 };
 $('cloud-contacts-new').onclick=async()=>{if(await discard()){open=true;fill(null);message('');$('cloud-cname').focus?.()}};
 if($('cloud-contacts-back'))$('cloud-contacts-back').onclick=async()=>{if(await discard()){open=false;fill(null);message('')}};
 $('cloud-connection-form').addEventListener('input',()=>{dirty=true;controls()});
 $('cloud-connection-form').onsubmit=event=>{
  event.preventDefault();if(!user||busy)return;let contact=values();const pendingNote=$('cloud-new-note').value;try{core.payload(contact)}catch(error){message(error.message);return}
  const site=$('cloud-cwebsite').value.trim();if(site&&!local.website(site)){message('Enter a valid website, such as example.com. Your edits were kept.');return}
  void run(async e=>{
   const data=selected?await core.update(client,user.id,selected,contact):await core.create(client,user.id,contact);
   if(e!==epoch)return;if(!data){conflict();return}fill(data);$('cloud-new-note').value=pendingNote;await load();window.ValeUsage?.refresh();if(e===epoch)message('Saved. It’s on all your signed-in devices.');
  });
 };
 $('cloud-contacts-note-save').onclick=()=>{
  const text=$('cloud-new-note').value.trim();if(!selected||!text||dirty||busy)return;
  void run(async e=>{
   const contact={...core.toLocal(selected),history:[...(Array.isArray(selected.history)?selected.history:[]),{date:new Date().toISOString(),text}]};
   const data=await core.update(client,user.id,selected,contact);if(e!==epoch)return;if(!data){message('This connection changed elsewhere. Your dated note is still in its box. Copy it before refreshing.');return}
   fill(data);await load();if(e===epoch)message('Note saved.');
  });
 };
 $('cloud-contacts-archive').onclick=()=>{
  if(!selected||dirty||busy)return;
  const archive=!selected.archived_at;
  void run(async e=>{
   const data=await core.setArchived(client,user.id,selected,archive);if(e!==epoch)return;if(!data){conflict();return}
   fill(data);await load();window.ValeUsage?.refresh();if(e===epoch)message(archive?'Archived. Notes are kept, and it no longer counts toward your active connections.':'Restored to your active connections.');
  });
 };
 for(const id of ['cloud-contacts-view','cloud-contacts-category','cloud-contacts-followup'])$(id).onchange=()=>renderList();
 $('cloud-contacts-search').oninput=()=>renderList();
 $('cloud-contacts-delete').onclick=async()=>{
  if(!selected||busy)return;const target=selected;
  if(!await ask('Permanently delete '+target.full_name+' and all their private notes? Archive instead if you may want them later. This can\'t be undone.',{confirmLabel:'Delete',danger:true}))return;
  if(selected!==target)return;
  void run(async e=>{
   const data=await core.remove(client,user.id,target);if(e!==epoch)return;if(!data){conflict();return}
   open=false;fill(null);await load();window.ValeUsage?.refresh();if(e===epoch)message('Connection deleted.');
  });
 };
 $('cloud-contacts-review').onclick=()=>{void run(async e=>{
  const browser=local.readContacts(localStorage);if(!await load()||e!==epoch)return;
  const box=$('cloud-import-list');box.replaceChildren();
  if(!browser.length){importMessage('This browser has no saved connections to import.');$('cloud-import-panel').hidden=true;return}
  for(const contact of browser){
   const candidate=core.importContact(contact),match=core.duplicate(rows,candidate),label=document.createElement('label'),check=document.createElement('input');
   check.type='checkbox';check.style.width='auto';check.disabled=!!match?.exact;check.contact=candidate;
   label.append(check,document.createTextNode(' '+contact.cname+(contact.cbusiness?' · '+contact.cbusiness:'')+(match?.exact?' — already saved':match?' — possible '+match.reason+' match; selecting imports separately':'')));box.append(label);
  }
  $('cloud-import-panel').hidden=false;importMessage('');
 })};
const importMessage=text=>{if($('import-status'))$('import-status').textContent=text;else message(text)};
 $('cloud-contacts-import').onclick=async()=>{
  const chosen=[...$('cloud-import-list').querySelectorAll('input')].filter(c=>c.checked&&!c.disabled).map(c=>c.contact);
  if(!chosen.length){importMessage('Select at least one connection.');return}
  if(chosen.length>50){importMessage('Import at most 50 connections at a time.');return}
  if(!await ask('Add '+chosen.length+' selected connections to '+user.email+'? Existing connections and notes are kept.',{confirmLabel:'Import'}))return;
  void run(async e=>{
   let added=0,skipped=0,failed=0;const owner=user.id,api=client;
   for(const contact of chosen){
    if(e!==epoch)return;
    if(core.duplicate(rows,contact)?.exact){skipped++;continue}
    try{const row=await core.create(api,owner,contact);if(e!==epoch)return;rows.push(row);added++}
    catch(error){if(error.code==='23505')skipped++;else failed++}
   }
   if(e!==epoch)return;await load();if(e!==epoch)return;
   $('cloud-import-panel').hidden=true;window.ValeUsage?.refresh();importMessage('Imported '+added+'. Already saved: '+skipped+'. Failed: '+failed+'. The browser copies were kept.');window.dispatchEvent(new Event('vale-browser-import-done'));
  });
 };
 function background(){if(user&&!busy&&!editing()&&!document.hidden&&navigator.onLine)void run(async()=>{await load()})}
 window.addEventListener('vale-usage-updated',()=>{controls();renderList()});
 // "Shared with you" asks to open a connection.
 window.addEventListener('vale-open-connection',async event=>{
  const row=rows.find(r=>r.id===event.detail?.id);
  if(!row){message('That connection isn’t in your list any more.');return}
  if(!!row.archived_at!==($('cloud-contacts-view').value==='archived'))$('cloud-contacts-view').value=row.archived_at?'archived':'active';
  if(await discard()){open=true;fill(row);$('cloud-contacts-editor').scrollIntoView?.({block:'start'})}
 });
 window.addEventListener('focus',background);window.addEventListener('online',background);window.addEventListener('vale-cloud-connections-changed',background);document.addEventListener('visibilitychange',()=>{if(!document.hidden)background()});
 window.addEventListener('vale-account-ready',event=>{
  const next=event.detail;if(user?.id===next.user?.id&&client===next.client)return;
  epoch++;if(timer)clearInterval(timer);client=next.client;user=next.user;rows=[];publish();busy=false;selected=null;dirty=false;open=false;
  $('cloud-import-panel').hidden=true;$('cloud-import-list').replaceChildren();fill(null);
  message('');
  if(user){timer=setInterval(background,20000);void run(async()=>{await load()})}
 });
 fill(null);
})();
