/* Save a shared card to the viewer's own connections. Needs an account; visitors can still download the contact. */
(()=>{
 'use strict';
 const core=window.ValeCloudConnections,local=window.ValeConnections;if(!core||!local)return;
 let client=null,user=null,epoch=0;const widgets=[];
 const ask=(text,options)=>window.ValeAsk?window.ValeAsk(text,options):Promise.resolve(confirm(text));
 function mount(hostId,profile,source){const host=document.getElementById(hostId);if(!host)return;const widget={host,profile,source};widgets.push(widget);draw(widget)}
 function draw(widget){
  const {host,profile,source}=widget;host.replaceChildren();
  const note=document.createElement('p'),status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const open=document.createElement('a');open.className='btn';
  if(!user){note.textContent='Have a VALE Connect account? Sign in to save this card to your connections.';note.className='muted';open.textContent='Sign in';open.href=new URL('./?view=account',location.href).href;host.append(note,open);return}
  const account=user,api=client,generation=epoch;
  note.textContent='Save to your private connections ('+account.email+'). The card’s owner isn’t notified.';note.className='muted';
  open.textContent='Open my connections';open.href=new URL('./?view=connections',location.href).href;open.className='btn ghost';
  const button=document.createElement('button');button.type='button';button.className='btn primary';button.textContent='Save to my connections';
  const separate=document.createElement('button');separate.type='button';separate.className='btn';separate.textContent='Save as a separate connection';separate.hidden=true;
  const row=document.createElement('div');row.className='actions';
  let busy=false;
  function duplicate(match){button.disabled=true;separate.hidden=match.exact;status.textContent=match.exact?'Already in your connections. Your notes were kept.':'You may already have this person (same '+match.reason+'). Nothing changed. Check your connections, or save them as a separate connection.'}
  async function save(asSeparate){
   if(busy||generation!==epoch)return;busy=true;button.disabled=true;separate.disabled=true;
   try{
    const contact=local.candidate(profile,source),rows=await core.list(api,account.id,()=>generation===epoch);if(generation!==epoch)return;
    const match=core.duplicate(rows,contact);if(match&&(match.exact||!asSeparate)){duplicate(match);return}
    if(asSeparate&&!await ask('Save '+contact.cname+' as a separate connection?',{confirmLabel:'Save'}))return;
    if(generation!==epoch)return;
    await core.create(api,account.id,contact);if(generation!==epoch)return;
    status.textContent='Saved to your connections.';button.textContent='Saved';button.disabled=true;separate.hidden=true;
    window.dispatchEvent(new Event('vale-cloud-connections-changed'));
   }catch(error){if(generation===epoch){status.textContent=error.code==='23505'?'Already in your connections. Your notes were kept.':error.message||'Couldn’t save. Check your connection and try again.';if(error.code!=='23505')button.disabled=false}}
   finally{busy=false;separate.disabled=false;if(generation===epoch&&!status.textContent)button.disabled=false}
  }
  button.onclick=()=>save(false);separate.onclick=()=>save(true);row.append(button,separate,open);host.append(note,row,status);
 }
 window.addEventListener('vale-account-ready',event=>{const next=event.detail;if(user?.id===next.user?.id&&client===next.client)return;epoch++;client=next.client;user=next.user;for(const widget of widgets)draw(widget)});
 window.ValeCloudSave={mount};
})();
