/* Brings older data into the account: a card saved only in this browser, the earlier account profile,
   and browser-only connections. Nothing is added or replaced without the person choosing it. */
(function(root){
 'use strict';
 const CARD_KEY='vale-connect-dev-v09-card',BASELINE_PREFIX='vale-connect-dev-v09-baseline-';
 const FIELDS=['fullName','jobTitle','company','phone','email','website','bio','socials'];
 const normalize=c=>Object.fromEntries(FIELDS.map(k=>[k,String(c?.[k]??'').trim()]));
 const signature=c=>JSON.stringify(normalize(c));
 function readBrowserCard(storage){
  let raw;try{raw=storage.getItem(CARD_KEY)}catch{return null}
  if(raw===null)return null;
  try{const v=JSON.parse(raw);return v&&typeof v==='object'&&!Array.isArray(v)&&String(v.fullName||'').trim()?normalize(v):null}catch{return null}
 }
 const fromProfile=d=>d&&String(d.full_name||'').trim()?normalize({fullName:d.full_name,jobTitle:d.job_title,company:d.business_name,phone:d.phone,email:d.email,website:d.website,bio:d.bio,socials:d.social_links}):null;
 // Which older copies still need a decision. Copies identical to a card already in the account are "saved".
 function plan(sources,cards){
  const existing=new Set(cards.map(signature)),seen=new Set(),out=[];
  for(const source of sources){
   if(!source.values)continue;const sig=signature(source.values);if(seen.has(sig))continue;seen.add(sig);
   out.push({...source,saved:existing.has(sig)});
  }
  return out;
 }
 function removeBaselines(storage){
  try{const keys=[];for(let i=0;i<storage.length;i++){const k=storage.key(i);if(k&&k.startsWith(BASELINE_PREFIX))keys.push(k)}keys.forEach(k=>storage.removeItem(k))}catch{}
 }
 const api={readBrowserCard,fromProfile,plan,signature,removeBaselines,CARD_KEY};
 if(typeof module!=='undefined'&&module.exports){module.exports=api;return}
 root.ValeImport=api;

 const $=id=>document.getElementById(id),doc=root.document;if(!$('import-section'))return;
 const ask=(text,options)=>root.ValeAsk?root.ValeAsk(text,options):Promise.resolve(confirm(text));
 const tools=root.ValeCardTools;
 let client=null,user=null,epoch=0,profile=null,cards=null,clearOnSignOut=false;
 const status=text=>{$('import-status').textContent=text};
 function browserConnections(){try{return root.ValeConnections.readContacts(localStorage).length}catch{return 0}}
 function render(){
  const list=$('import-card-list');list.replaceChildren();
  if(!user||cards===null){$('import-section').hidden=true;return}
  const browser=readBrowserCard(localStorage),items=plan([{from:'browser',values:browser},{from:'profile',values:profile}],cards);
  const browserSaved=!!browser&&items.some(i=>i.from==='browser'&&i.saved);clearOnSignOut=browserSaved;
  for(const item of items){
   if(item.saved&&item.from!=='browser')continue;
   const row=doc.createElement('div');row.className='note';row.style.marginTop='10px';
   const title=doc.createElement('b');title.textContent=item.values.fullName;
   const sub=doc.createElement('div');sub.className='muted';sub.textContent=[[item.values.jobTitle,item.values.company].filter(Boolean).join(' · '),item.from==='browser'?'Saved in this browser':'From your earlier account profile'].filter(Boolean).join(' — ');
   const actions=doc.createElement('div');actions.className='actions';
   const b=doc.createElement('button');b.type='button';b.className='btn';
   if(item.saved){
    sub.textContent+='. Already in your card.';b.textContent='Remove from this browser';
    b.onclick=async()=>{if(!await ask('Remove the copy of your card saved in this browser? Your card in your account isn’t affected.',{confirmLabel:'Remove'}))return;if(signature(readBrowserCard(localStorage))!==signature(item.values))return render();try{localStorage.removeItem(CARD_KEY)}catch{}removeBaselines(localStorage);status('Removed from this browser.');render()};
   }else{
    b.textContent=cards.length?'Review and use for my card':'Use for my card';
    b.onclick=()=>{status(cards.length?'Your card’s details were filled in from this copy. Nothing is saved until you choose Save card.':'');root.ValeCards?.prefill(item.values)};
   }
   actions.append(b);row.append(title,sub,actions);list.append(row);
  }
  const count=browserConnections();$('import-connections').hidden=!count;$('import-connections-count').textContent=count?count+(count===1?' connection is':' connections are')+' saved only in this browser.':'';
  $('import-section').hidden=!list.childElementCount&&!count;
 }
 async function loadProfile(e){
  try{const {data,error}=await client.from('profiles').select('full_name,job_title,business_name,phone,email,website,bio,social_links').eq('id',user.id).maybeSingle();if(e!==epoch)return;profile=error?null:fromProfile(data)}catch{if(e===epoch)profile=null}
  render();
 }
 root.addEventListener('vale-card-selected',event=>{if(!event.detail.loaded){cards=null;render();return}cards=(root.ValeCards?.list()||[]).map(c=>tools.toEditor(c));render()});
 root.addEventListener('vale-browser-import-done',render);
 root.addEventListener('vale-account-ready',event=>{
  const next=event.detail;if(user?.id===next.user?.id&&client===next.client)return;
  // Signing out: drop this browser's copy of the card only if it's safely in the account, and old sync bookkeeping.
  if(user&&!next.user){if(clearOnSignOut){try{localStorage.removeItem(CARD_KEY)}catch{}}removeBaselines(localStorage)}
  epoch++;client=next.client;user=next.user;profile=null;cards=null;clearOnSignOut=false;status('');render();
  if(user)void loadProfile(epoch);
 });
})(typeof window!=='undefined'?window:globalThis);
