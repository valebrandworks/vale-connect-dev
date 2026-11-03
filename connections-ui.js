/* Public-view save control. No authentication required; no cloud write or reciprocal sharing. */
(()=>{
 'use strict';
 const core=window.ValeConnections;
 function mount(hostId,profile,source={}){
  const host=document.getElementById(hostId);if(!host||!core)return;
  host.replaceChildren();
  const note=document.createElement('p');note.textContent='Save a copy to VALE Connections in this browser. No sign-in required. Connections stay on this device/browser; they do not sync to your account.';
  const save=document.createElement('button');save.type='button';save.className='btn';save.textContent='Save to VALE Connections';
  const separate=document.createElement('button');separate.type='button';separate.className='btn alt';separate.textContent='Save as a separate connection';separate.hidden=true;
  const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  const open=document.createElement('a');open.href=new URL('./?view=connections',location.href).href;open.textContent='Open my VALE Connections';open.className='btn alt';
  for(const button of [save,separate])button.style.cssText='padding:12px 16px;border-radius:10px;cursor:pointer;margin:6px 6px 6px 0';
  open.style.cssText='display:inline-block;padding:12px 16px;margin-top:10px';
  const actions=document.createElement('div');actions.append(save,separate);host.append(note,actions,status,open);
  let busy=false;
  function duplicate(result){
   save.disabled=true;separate.hidden=result.exact;
   status.textContent=result.exact?'Already saved to VALE Connections in this browser. Existing details and notes were kept.':'A possible match was found by '+result.reason+'. Nothing was changed. Open your connections to review it, or choose to save a separate entry.';
  }
  function check(){try{const found=core.inspect(localStorage,profile,source);if(found)duplicate(found)}catch(error){status.textContent=error.message;save.disabled=true}}
  async function perform(asSeparate){
   if(busy)return;busy=true;save.disabled=true;separate.disabled=true;
   try{
    const work=async()=>{
     const found=core.inspect(localStorage,profile,source);
     if(found&&(found.exact||!asSeparate)){duplicate(found);return}
     const name=core.candidate(profile,source).cname;
     if(!confirm('Save '+name+' to VALE Connections in this browser'+(asSeparate?' as a separate entry':'')+'? This does not sync to another device or send your details to the card owner.'))return;
     const result=core.save(localStorage,profile,source,{separate:asSeparate});
     if(result.status==='duplicate'){duplicate(result);return}
     save.textContent='Saved to VALE Connections';separate.hidden=true;
     status.textContent='Saved in this browser only. Open my VALE Connections here to view it. Other browsers or installed apps may use separate storage.';
     window.dispatchEvent(new Event('vale-connections-updated'));
    };
    if(navigator.locks?.request)await navigator.locks.request('vale-connect-dev-contacts',work);else await work();
   }catch(error){status.textContent=error.message||'Connection could not be saved.'}
   finally{busy=false;separate.disabled=false;try{save.disabled=!!core.inspect(localStorage,profile,source)}catch{save.disabled=true}}
  }
  save.onclick=()=>perform(false);separate.onclick=()=>perform(true);check();
 }
 window.ValeConnectionUI={mount};
})();

