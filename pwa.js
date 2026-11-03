/* Install/update UI only. Does not read profile values, passwords or storage. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id);
 if(!$('pwa-panel')||!location.pathname.startsWith('/vale-connect-dev/'))return;
 let promptEvent=null,registration=null,reloadRequested=false,installed=false;
 const install=$('pwa-install'),help=$('pwa-help'),update=$('pwa-update'),status=$('pwa-status');
 const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 const shared=new URLSearchParams(location.search).has('card');
 function network(){
  $('pwa-network').hidden=navigator.onLine;
  install.hidden=shared||installed||isStandalone();
  if(isStandalone())status.textContent='App mode · VALE Connect Development';
 }
 function showUpdate(){if(registration?.waiting){update.hidden=false;status.textContent='An update is ready. Save edits before updating.'}}
 network();window.addEventListener('online',network);window.addEventListener('offline',network);
 window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();promptEvent=event;network()});
 window.addEventListener('appinstalled',()=>{promptEvent=null;installed=true;install.hidden=true;help.open=false;status.textContent='VALE Connect Development installed.'});
 install.onclick=async()=>{
  if(promptEvent){
   const event=promptEvent;promptEvent=null;
   try{await event.prompt();const choice=await event.userChoice;status.textContent=choice.outcome==='accepted'?'Installation requested. Check your device to finish.':'You can install later from your browser menu.'}
   catch{help.open=true;status.textContent='Use the installation steps below.'}
  }else{help.open=true;status.textContent='Use your browser’s install or Add to Home Screen option.'}
 };
 update.onclick=()=>{
  if(!registration?.waiting)return;
  if(!navigator.onLine){status.textContent='Reconnect before applying an update.';return}
  if(!confirm('Save any card or note edits before updating. Reload VALE Connect now?'))return;
  reloadRequested=true;registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});
 };
 if(!('serviceWorker' in navigator)){status.textContent='Installation options depend on this browser. Open the guide below.';return}
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(reloadRequested){reloadRequested=false;location.reload()}});
 navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(reg=>{
  registration=reg;showUpdate();
  navigator.serviceWorker.ready.then(()=>{if(!reg.waiting)status.textContent=isStandalone()?'App mode · VALE Connect Development':'App setup ready · Offline connection screen available.'});
  reg.addEventListener('updatefound',()=>{
   const worker=reg.installing;
   worker?.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)showUpdate()});
  });
  window.addEventListener('focus',()=>{if(navigator.onLine)void reg.update().catch(()=>{})});
 }).catch(()=>{status.textContent='App setup could not finish. Stay online and refresh to try again.'});
})();

