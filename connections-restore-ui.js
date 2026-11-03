/* Local file preview first; only selected rows are sent to the signed-in account. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id),restore=window.ValeConnectionRestore,exporter=window.ValeConnectionExport;
 if(!$('cloud-restore')||!restore||!exporter)return;
 let client=null,user=null,epoch=0,busy=false,entries=[];
 const status=text=>{$('cloud-restore-status').textContent=text};
 function controls(){for(const id of ['cloud-restore-file','cloud-restore-preview','cloud-restore-clear'])$(id).disabled=busy||!user;$('cloud-restore-apply').disabled=busy||!user||!entries.some(x=>!x.match?.exact);for(const c of $('cloud-restore-list').querySelectorAll('input'))c.disabled=busy||!!c.entry?.match?.exact;}
 function clear(){entries=[];$('cloud-restore-list').replaceChildren();$('cloud-restore-file').value='';$('cloud-restore-summary').textContent='';controls()}
 function render(data){
  entries=data;const list=$('cloud-restore-list');list.replaceChildren();let saved=0,possible=0;
  for(const entry of entries){
   if(entry.match?.exact)saved++;else if(entry.match)possible++;
   const item=document.createElement('div'),label=document.createElement('label'),check=document.createElement('input'),detail=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');
   check.type='checkbox';check.checked=false;check.style.width='auto';check.entry=entry;
   const state=entry.match?.exact?'Already present or repeated in file — skipped; existing notes kept':entry.match?'Possible '+entry.match.reason+' match — select only to add a separate connection':'New connection — select to restore';
   label.append(check,document.createTextNode(' '+entry.row.full_name+(entry.row.business_name?' · '+entry.row.business_name:'')+' — '+state));
   summary.textContent='Review saved details and notes';pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';pre.textContent=JSON.stringify(entry.row,null,2);detail.append(summary,pre);item.append(label,detail);list.append(item);
  }
  $('cloud-restore-summary').textContent=entries.length+' in backup; '+saved+' already present/repeated; '+possible+' possible matches. Nothing is selected or imported automatically.';controls();
 }
 $('cloud-restore-clear').onclick=()=>{if(!busy){clear();status('Preview cleared. No cloud data was deleted.')}};
 $('cloud-restore-file').onchange=()=>{entries=[];$('cloud-restore-list').replaceChildren();$('cloud-restore-summary').textContent='';status('File selected. Click Preview backup to validate it and check existing connections.');controls()};
 $('cloud-restore-preview').onclick=async()=>{
  if(busy||!user)return;const file=$('cloud-restore-file').files?.[0];if(!file){status('Choose a VALE development JSON backup first.');return}
  const e=epoch,account=user,api=client;busy=true;entries=[];$('cloud-restore-list').replaceChildren();$('cloud-restore-summary').textContent='';controls();
  try{
   if(file.size>restore.MAX_BYTES)throw Error('Choose a backup no larger than 10 MB.');
   const text=await file.text();if(e!==epoch)return;
   const backup=restore.parse(text);status('Checking the saved cloud list. No backup data has been imported.');
   const rows=await exporter.fetchAll(api,account.id,()=>e===epoch);if(e!==epoch)return;
   render(restore.preview(backup.records,rows));status('Preview for '+account.email+'. Review details, then select only missing connections you want to add. Existing details and notes will not be replaced.');
  }catch(error){if(e===epoch)status(error.message||'Could not preview this backup. Nothing was imported.')}
  finally{if(e===epoch){busy=false;controls()}}
 };
 $('cloud-restore-apply').onclick=async()=>{
  if(busy||!user)return;
  const chosen=[...$('cloud-restore-list').querySelectorAll('input')].filter(c=>c.checked&&!c.disabled).map(c=>c.entry.row);
  if(!chosen.length){status('Select at least one new connection in the preview.');return}
  if(chosen.length>50){status('Restore at most 50 selected connections at a time.');return}
  const e=epoch,account=user,api=client;
  if(!confirm('Add '+chosen.length+' selected backup connections, including private notes, to '+account.email+'? Possible matches will be separate entries. Existing connections and notes will not be overwritten.'))return;
  busy=true;controls();
  try{
   const rows=await exporter.fetchAll(api,account.id,()=>e===epoch);if(e!==epoch)return;
   const result=await restore.restore(api,account.id,chosen,rows,()=>e===epoch);if(e!==epoch)return;
   // Clear the preview after a write attempt; a fresh preview is required before retry.
   clear();status('Added '+result.added+'; already present '+result.skipped+'; failed '+result.failed+'. '+(result.stopped?'Stopped after a failed request; preview the file again to check what was saved. ':'')+'Existing notes and browser contacts were kept.');
   window.dispatchEvent(new Event('vale-cloud-connections-changed'));
  }catch(error){if(e===epoch)status((error.message||'Restore could not start.')+' Preview again before retrying. Existing connections were not overwritten.')}
  finally{if(e===epoch){busy=false;controls()}}
 };
 window.addEventListener('vale-account-ready',event=>{const next=event.detail;if(user?.id===next.user?.id&&client===next.client)return;epoch++;client=next.client;user=next.user;busy=false;clear();status(user?'Choose a development JSON backup to preview for '+user.email+'.':'Sign in to preview or restore cloud connections.');});
 clear();status('Sign in to preview or restore cloud connections.');
})();
