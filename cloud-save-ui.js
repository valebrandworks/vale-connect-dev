/* Optional private-account destination on a public card; local saving stays available. */
(()=>{
 'use strict';
 const core=window.ValeCloudConnections,local=window.ValeConnections;if(!core||!local)return;
 let client=null,user=null,epoch=0;const widgets=[];
 function mount(hostId,profile,source){const host=document.getElementById(hostId);if(!host)return;const widget={host,profile,source};widgets.push(widget);draw(widget)}
 function draw(widget){
  const {host,profile,source}=widget;host.replaceChildren();
  const note=document.createElement('p'),status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const open=document.createElement('a');open.className='btn alt';open.style.cssText='display:inline-block;padding:12px 16px;margin-top:8px';
  if(!user){note.textContent='Want connections to sync across devices? Sign in through Cloud Account in this browser, then return to this shared card.';open.textContent='Open Cloud Account';open.href=new URL('./?view=account',location.href).href;host.append(note,open);return}
  const account=user,api=client,generation=epoch;
  note.textContent='Save privately to the cloud connections for '+account.email+'. This syncs to your signed-in devices and does not send your details to the card owner.';
  open.textContent='Open my cloud connections';open.href=new URL('./?view=cloud-connections',location.href).href;
  const button=document.createElement('button');button.type='button';button.className='btn';button.textContent='Save to my cloud connections';
  const separate=document.createElement('button');separate.type='button';separate.className='btn alt';separate.textContent='Save as a separate cloud connection';separate.hidden=true;
  for(const b of [button,separate])b.style.cssText='padding:12px 16px;border-radius:10px;margin:6px 6px 6px 0;cursor:pointer';
  let busy=false;
  function duplicate(match){button.disabled=true;separate.hidden=match.exact;status.textContent=match.exact?'Already saved in your private cloud connections. Existing details and notes were kept.':'A possible cloud match was found by '+match.reason+'. Nothing changed. Review your cloud list, or explicitly save a separate entry.'}
  async function save(asSeparate){
   if(busy||generation!==epoch)return;busy=true;button.disabled=true;separate.disabled=true;
   try{
    const contact=local.candidate(profile,source),rows=await core.list(api,account.id);if(generation!==epoch)return;
    const match=core.duplicate(rows,contact);if(match&&(match.exact||!asSeparate)){duplicate(match);return}
    if(!confirm('Save '+contact.cname+' privately to the cloud account '+account.email+(asSeparate?' as a separate entry':'')+'? This will sync to your signed-in devices.'))return;
    if(generation!==epoch)return;
    await core.create(api,account.id,contact);if(generation!==epoch)return;
    status.textContent='Saved privately to your cloud connections. Open them on any device signed into this account.';button.textContent='Saved to cloud connections';button.disabled=true;separate.hidden=true;
    window.dispatchEvent(new Event('vale-cloud-connections-changed'));
   }catch(error){if(generation===epoch){status.textContent=error.code==='23505'?'This shared card is already saved in your cloud list. Existing notes were kept.':error.message||'Cloud save failed. Sign in and check your connection, then try again.';if(error.code!=='23505')button.disabled=false}}
   finally{busy=false;separate.disabled=false;if(generation===epoch&&!status.textContent)button.disabled=false}
  }
  button.onclick=()=>save(false);separate.onclick=()=>save(true);host.append(note,button,separate,status,open);
 }
 window.addEventListener('vale-account-ready',event=>{const next=event.detail;if(user?.id===next.user?.id&&client===next.client)return;epoch++;client=next.client;user=next.user;for(const widget of widgets)draw(widget)});
 window.ValeCloudSave={mount};
})();
