/* Navigation, the Share tab, and older long-format card links. Cards themselves live in cards.js. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id),view=window.ValeCardView,tools=window.ValeCardTools;
 const TABS=['card','share','connections','account'];
 let current={card:null,signedIn:false};

 function tab(name){
  if(!TABS.includes(name))name='card';
  for(const t of TABS)$('tab-'+t).hidden=t!==name;
  document.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.tab===name)));
  window.scrollTo?.({top:0});
  window.dispatchEvent(new CustomEvent('vale-tab-shown',{detail:{tab:name}}));
 }
 document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>tab(b.dataset.tab)));
 document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>tab(b.dataset.go)));

 function cardURL(card){const url=new URL('p.html',location.href);url.search='';url.hash='';url.searchParams.set('u',card.slug);return url.href}
 function drawQR(host,text){
  host.replaceChildren();
  if(typeof window.ValeQR!=='function'){host.textContent='QR code unavailable. Refresh to try again.';return null}
  const qr=new window.ValeQR(-1,1);qr.addData(text);qr.make();
  const n=qr.getModuleCount(),scale=8,canvas=document.createElement('canvas');canvas.width=canvas.height=(n+8)*scale;
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#111317';
  for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(qr.isDark(y,x))ctx.fillRect((x+4)*scale,(y+4)*scale,scale,scale);
  canvas.setAttribute('role','img');canvas.setAttribute('aria-label','QR code that opens this card');host.append(canvas);return canvas;
 }
 function download(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),2000)}
 function saveContact(values,slug){download((slug||'vale-connect-contact')+'.vcf',new Blob([tools.vcard(values)],{type:'text/vcard;charset=utf-8'}))}

 // Share tab: only a saved, public card has a link.
 function renderShare(){
  const card=current.card,ready=!!card?.published;
  $('share-ready').hidden=!ready;$('share-none').hidden=ready;$('share-status').textContent='';
  if(!ready){
   $('share-none-text').textContent=!current.signedIn?'Sign in and create your card to get your link and QR code.':!card?'Create your card first. Then its link and QR code appear here.':'Your card is private. Edit it and turn on Public to share it.';
   $('share-go-card').textContent=card?'Edit card':'Go to my card';
   return;
  }
  const url=cardURL(card);$('share-name').textContent=card.display_name;$('share-url').textContent=url.replace(/^https:\/\//,'');drawQR($('share-qr'),url);
 }
 $('share-go-card').addEventListener('click',()=>{if(current.card&&!current.card.published)window.ValeCards?.edit()});
 $('share-copy').onclick=async()=>{if(!current.card?.published)return;const url=cardURL(current.card);try{await navigator.clipboard.writeText(url);$('share-status').textContent='Link copied.'}catch{$('share-status').textContent=url}};
 $('share-native').onclick=async()=>{
  if(!current.card?.published)return;const url=cardURL(current.card);
  if(navigator.share){try{await navigator.share({title:current.card.display_name+' · VALE Connect',url})}catch{}}
  else $('share-copy').click();
 };
 $('share-qr-save').onclick=()=>{const canvas=$('share-qr').querySelector('canvas');if(!canvas||!current.card)return;canvas.toBlob(blob=>blob&&download(current.card.slug+'-qr.png',blob))};
 $('share-vcf').onclick=()=>{if(current.card)saveContact(tools.toEditor(current.card),current.card.slug)};
 $('card-vcf').onclick=()=>{if(current.card)saveContact(tools.toEditor(current.card),current.card.slug)};
 $('card-share').onclick=()=>tab('share');
 window.addEventListener('vale-card-selected',event=>{current=event.detail;renderShare()});

 // Older links carry the whole card in the address (?card=...). They keep working, read-only.
 function decoded(s){const b=atob(s.replace(/-/g,'+').replace(/_/g,'/'));return JSON.parse(new TextDecoder().decode(Uint8Array.from(b,c=>c.charCodeAt(0))))}
 const param=new URLSearchParams(location.search).get('card');
 if(param!==null){
  $('app').hidden=true;$('nav').hidden=true;$('publicView').hidden=false;
  try{
   const raw=decoded(param);if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('invalid');
   const data=Object.fromEntries(Object.keys(tools.fields).map(k=>[k,String(raw[k]??'').slice(0,3000)]));
   if(!data.fullName.trim())throw Error('invalid');
   $('publicCard').replaceChildren(view.render(data));document.title=data.fullName+' · VALE Connect';
   $('savePublic').onclick=()=>saveContact(data);
   window.ValeCloudSave?.mount('publicCloudSave',data,{url:location.href});
  }catch{$('publicCard').textContent='This card link is damaged or incomplete. Ask its owner to share it again.';$('savePublic').hidden=true;$('publicCloudSave').hidden=true}
 }else{
  const v=new URLSearchParams(location.search).get('view');
  tab(v==='cloud-connections'?'connections':v);
 }
 window.ValeApp={tab,drawQR,cardURL,saveContact};
})();
