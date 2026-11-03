/* Cloud editor is in memory only. Browser-local connections remain separate and unchanged. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id),core=window.ValeCloudConnections,local=window.ValeConnections;
 if(!$('cloud-connections')||!core||!local)return;
 let client=null,user=null,rows=[],selected=null,dirty=false,busy=false,epoch=0,timer=null;
 const fields=Object.keys(core.fields),message=text=>{$('cloud-contacts-status').textContent=text};
 const values=()=>({...Object.fromEntries(fields.map(k=>[k,$('cloud-'+k).value])),history:selected?structuredClone(selected.history):[]});
 const editing=()=>dirty||!!$('cloud-new-note').value.trim();
 const discard=()=>!editing()||confirm('Discard unsaved edits in the cloud connection editor? Saved connections will not be deleted.');
 function controls(){
  $('cloud-contacts-login').hidden=!!user;$('cloud-contacts-workspace').hidden=!user;
  for(const id of ['cloud-contacts-new','cloud-contacts-refresh','cloud-contacts-review','cloud-contacts-save','cloud-contacts-import','cloud-export-csv','cloud-export-json'])$(id).disabled=busy||!user;
  $('cloud-contacts-note-save').disabled=busy||!user||!selected||dirty;
  $('cloud-new-note').disabled=busy||!user||!selected;
  for(const input of $('cloud-connection-form').querySelectorAll('input,textarea,select'))input.disabled=busy||!user;
 }
 function renderHistory(){
  const box=$('cloud-contacts-history');box.replaceChildren();
  for(const entry of (Array.isArray(selected?.history)?selected.history:[])){
   const p=document.createElement('p');p.textContent=String(entry.date||'')+' · '+String(entry.text||'');box.append(p);
  }
 }
 function fill(row){
  selected=row?{...row}:null;dirty=false;
  const v=row?core.toLocal(row):{ccategory:'Other',cnext:'Follow up'};
  fields.forEach(k=>{$('cloud-'+k).value=v[k]||''});$('cloud-new-note').value='';renderHistory();controls();renderList();
 }
 function renderList(){
  const list=$('cloud-contacts-list');list.replaceChildren();$('cloud-contacts-count').textContent=String(rows.length);
  if(!rows.length){const p=document.createElement('p');p.textContent='No cloud connections yet. Add one or review browser imports.';list.append(p)}
  for(const row of rows){
   const b=document.createElement('button');b.type='button';b.className='btn alt';b.disabled=busy;
   b.textContent=row.full_name+(row.business_name?' · '+row.business_name:'')+' · '+row.next_step+(row.follow_up_on?' · '+row.follow_up_on:'');
   b.setAttribute('aria-pressed',String(row.id===selected?.id));b.onclick=()=>{if(discard())fill(row)};list.append(b);
  }
 }
 async function load(){
  const e=epoch,owner=user.id,data=await core.list(client,owner,()=>e===epoch&&owner===user?.id);if(e!==epoch||owner!==user?.id)return false;
  rows=data;if(selected&&!editing()){const latest=rows.find(r=>r.id===selected.id);if(latest)fill(latest)}renderList();return true;
 }
 async function run(work){
  if(busy||!user)return;const e=epoch;busy=true;controls();renderList();
  try{await work(e)}catch(error){if(e===epoch)message(error.code==='23505'?'This shared connection is already in your cloud list. Refresh to view it.':(error.message||'Cloud request failed.')+' Your current editor values were kept.')}
  finally{if(e===epoch){busy=false;controls();renderList()}}
 }
 function conflict(){message('This connection changed on another device. Nothing was overwritten; your edits are still in the form. Copy them before refreshing the cloud list.')}
 for(const format of ['csv','json'])$('cloud-export-'+format).onclick=()=>{
  if(!user||busy)return;const account=user,api=client;
  if(!confirm('Download saved cloud connections for '+account.email+'? The file includes private notes and follow-ups. Unsaved edits are not included. Store it somewhere private.'))return;
  void run(async e=>{
   message('Preparing your saved cloud connections…');
   const exporter=window.ValeConnectionExport,data=await exporter.fetchAll(api,account.id,()=>e===epoch&&user?.id===account.id);
   if(e!==epoch)return;const result=exporter.file(data,format);exporter.download(result);
   message('Download requested for '+result.count+' cloud connections ('+format.toUpperCase()+'). Check your downloads before relying on this backup. Unsaved edits were kept in the editor.');
  });
 };
 $('cloud-contacts-new').onclick=()=>{if(discard()){fill(null);message('New private cloud connection.')}};
 $('cloud-contacts-refresh').onclick=()=>{if(discard())void run(async e=>{dirty=false;$('cloud-new-note').value='';if(await load()&&e===epoch)message('Cloud list refreshed.');})};
 $('cloud-connection-form').addEventListener('input',()=>{dirty=true;controls()});
 $('cloud-connection-form').onsubmit=event=>{
  event.preventDefault();if(!user||busy)return;let contact=values();const pendingNote=$('cloud-new-note').value;try{core.payload(contact)}catch(error){message(error.message);return}
  void run(async e=>{
   const data=selected?await core.update(client,user.id,selected,contact):await core.create(client,user.id,contact);
   if(e!==epoch)return;if(!data){conflict();return}fill(data);$('cloud-new-note').value=pendingNote;await load();if(e===epoch)message('Private cloud connection saved. It will appear on your other signed-in devices.');
  });
 };
 $('cloud-contacts-note-save').onclick=()=>{
  const text=$('cloud-new-note').value.trim();if(!selected||!text||dirty||busy)return;
  void run(async e=>{
   const contact={...core.toLocal(selected),history:[...(Array.isArray(selected.history)?selected.history:[]),{date:new Date().toISOString(),text}]};
   const data=await core.update(client,user.id,selected,contact);if(e!==epoch)return;if(!data){message('This connection changed elsewhere. Your dated note is still in its box. Copy it before refreshing.');return}
   fill(data);await load();if(e===epoch)message('Dated note saved privately to your cloud connection.');
  });
 };
 $('cloud-contacts-review').onclick=()=>{void run(async e=>{
  const browser=local.readContacts(localStorage);if(!await load()||e!==epoch)return;
  const box=$('cloud-import-list');box.replaceChildren();
  if(!browser.length){message('This browser has no local connections to import.');$('cloud-import-panel').hidden=true;return}
  for(const contact of browser){
   const candidate=core.importContact(contact),match=core.duplicate(rows,candidate),label=document.createElement('label'),check=document.createElement('input');
   check.type='checkbox';check.style.width='auto';check.disabled=!!match?.exact;check.contact=candidate;
   label.append(check,document.createTextNode(' '+contact.cname+(contact.cbusiness?' · '+contact.cbusiness:'')+(match?.exact?' — already saved':match?' — possible '+match.reason+' match; selecting imports separately':'')));box.append(label);
  }
  $('cloud-import-panel').hidden=false;message('Choose only the browser connections you want in '+user.email+'. Possible matches import separately; existing notes are not merged.');
 })};
 $('cloud-contacts-import').onclick=()=>{
  const chosen=[...$('cloud-import-list').querySelectorAll('input')].filter(c=>c.checked&&!c.disabled).map(c=>c.contact);
  if(!chosen.length){message('Select at least one browser connection.');return}
  if(chosen.length>50){message('Import at most 50 connections at a time.');return}
  if(!confirm('Import '+chosen.length+' selected browser connections into the private cloud list for '+user.email+'? Possible matches will be separate entries. Existing cloud notes and browser copies will be kept.'))return;
  void run(async e=>{
   let added=0,skipped=0,failed=0;const owner=user.id,api=client;
   for(const contact of chosen){
    if(e!==epoch)return;
    if(core.duplicate(rows,contact)?.exact){skipped++;continue}
    try{const row=await core.create(api,owner,contact);if(e!==epoch)return;rows.push(row);added++}
    catch(error){if(error.code==='23505')skipped++;else failed++}
   }
   if(e!==epoch)return;await load();if(e!==epoch)return;
   $('cloud-import-panel').hidden=true;message('Imported '+added+'; already saved '+skipped+'; failed '+failed+'. Browser originals and existing cloud notes were kept.');
  });
 };
 function background(){if(user&&!busy&&!editing()&&!document.hidden&&navigator.onLine)void run(async()=>{await load()})}
 window.addEventListener('focus',background);window.addEventListener('online',background);window.addEventListener('vale-cloud-connections-changed',background);document.addEventListener('visibilitychange',()=>{if(!document.hidden)background()});
 window.addEventListener('vale-account-ready',event=>{
  const next=event.detail;if(user?.id===next.user?.id&&client===next.client)return;
  epoch++;if(timer)clearInterval(timer);client=next.client;user=next.user;rows=[];busy=false;selected=null;dirty=false;
  $('cloud-import-panel').hidden=true;$('cloud-import-list').replaceChildren();fill(null);
  message(user?'Loading private cloud connections…':'Sign in through Cloud Account to use private cloud connections. Browser connections above are unchanged.');
  if(user){timer=setInterval(background,20000);void run(async e=>{if(await load()&&e===epoch)message('Private cloud list ready. Add a connection or review browser imports.');})}
 });
 fill(null);message('Sign in through Cloud Account to use private cloud connections.');
})();
