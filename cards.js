/* The Card tab. Cards live in the account (public_cards); the database enforces each plan's card limit. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id),tools=window.ValeCardTools,view=window.ValeCardView;
 if(!$('card-editor')||!tools||!view)return;
 const ask=(text,options)=>window.ValeAsk?window.ValeAsk(text,options):Promise.resolve(confirm(text));
 const fields=Object.keys(tools.fields);
 let client=null,user=null,cards=[],selected=null,editing=null,dirty=false,busy=false,epoch=0,loaded=false;
 const message=text=>{$('cards-status').textContent=text};
 const maxCards=()=>{const u=window.ValeUsage?.usage?.();return u&&u.max_cards!==null&&u.max_cards!==undefined?Number(u.max_cards):null};
 const multi=()=>cards.length>1||(maxCards()!==null?maxCards()>1:false);
 function slugFrom(name){return (String(name).toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40)||'card')+'-'+crypto.randomUUID().slice(0,6)}

 function announce(){window.dispatchEvent(new CustomEvent('vale-card-selected',{detail:{card:selected?{...selected}:null,signedIn:!!user,cards:cards.length,loaded}}))}
 function render(){
  const signedOut=!user,empty=!!user&&loaded&&!cards.length,isEditing=editing!==null;
  $('card-signed-out').hidden=!signedOut;
  $('card-loading').hidden=signedOut||loaded;
  $('card-empty').hidden=!empty||isEditing;
  $('card-home').hidden=!selected||isEditing;
  $('card-editor').hidden=!isEditing;
  if(selected&&!isEditing){
   $('card-preview').replaceChildren(view.render(tools.toEditor(selected)));
   const pill=$('card-visibility');pill.className='pill'+(selected.published?' public':'');pill.textContent=selected.published?'Public':'Private draft · only you can see it';
   $('card-publish-row').hidden=!!selected.published;$('card-share-row').hidden=!selected.published;
   $('card-link-name').textContent=multi()?selected.card_label:'';
  }
  const switcher=$('card-switcher');switcher.replaceChildren();switcher.hidden=!multi()||isEditing||!cards.length;
  for(const row of cards){const b=document.createElement('button');b.type='button';b.className='btn'+(row.id===selected?.id?' primary':'');b.textContent=row.card_label;b.disabled=busy;b.setAttribute('aria-pressed',String(row.id===selected?.id));b.onclick=()=>{selected=row;render();announce()};switcher.append(b)}
  const room=maxCards()!==null&&cards.length<maxCards();
  $('cards-new').hidden=!multi()||!room||isEditing;
  for(const el of $('card-editor').querySelectorAll('input,textarea,button'))el.disabled=busy;
 }
 function openEditor(row,values){
  editing=row?row.id:'new';dirty=!!values;
  const v=values||(row?tools.toEditor(row):Object.fromEntries(fields.map(k=>[k,''])));
  fields.forEach(k=>{$('multi-'+k).value=v[k]||''});
  $('multi-label').value=row?row.card_label:(cards.length?'':'My card');
  $('card-label-field').hidden=!multi();
  $('multi-slug').value=row?row.slug:'';$('multi-slug').readOnly=!!row;
  $('card-slug-hint').textContent=row?'Your card’s link name is fixed so printed QR codes keep working.':'Lowercase letters, numbers and hyphens. It can’t be changed later, so printed QR codes keep working.';
  // New cards always start as private drafts (the database requires it); publishing comes after review.
  $('multi-published').checked=row?!!row.published:false;$('card-public-field').hidden=!row;$('card-draft-note').hidden=!!row;
  $('card-delete-section').hidden=!row;$('card-delete-section').open=false;$('card-delete-understand').checked=false;
  $('card-editor-title').textContent=row?'Edit card':'Create your card';
  message(values?'Review these details, then save.':'');
  render();window.ValeApp?.tab('card');$('multi-fullName').focus?.();
 }
 async function closeEditor(){if(dirty&&!await ask('Discard your unsaved card changes?',{confirmLabel:'Discard'}))return;editing=null;dirty=false;message('');render()}
 async function listCards(){
  const e=epoch,owner=user.id;
  const data=await window.ValeAccountLists.read(client,'public_cards',owner,()=>e===epoch&&owner===user?.id);
  if(e!==epoch||owner!==user?.id)return false;
  cards=data.sort((a,b)=>String(a.updated_at).localeCompare(String(b.updated_at))||a.id.localeCompare(b.id));
  selected=cards.find(c=>c.id===selected?.id)||cards[0]||null;loaded=true;
  render();announce();window.ValeUsage?.refresh();return true;
 }
 async function run(work){
  if(busy||!user)return;const e=epoch;busy=true;render();
  try{await work(e)}catch(error){if(e===epoch)message(error.code==='23505'?'That card link is already taken. Choose another.':(error.message||'Something went wrong.')+' Your changes are still in the form.')}
  finally{if(e===epoch){busy=false;render()}}
 }
 $('card-editor').addEventListener('input',()=>{dirty=true});
 $('multi-fullName').addEventListener('input',()=>{if(editing==='new'&&!$('multi-slug').dataset.touched)$('multi-slug').value=slugFrom($('multi-fullName').value)});
 $('multi-slug').addEventListener('input',()=>{$('multi-slug').dataset.touched='1'});
 $('card-create').onclick=()=>openEditor(null);
 $('cards-new').onclick=()=>openEditor(null);
 $('card-edit').onclick=()=>selected&&openEditor(selected);
 // Publishing is its own step, confirmed in the page, after the person has seen their saved card.
 $('card-publish').onclick=async()=>{
  const row=selected;if(!row||row.published||busy)return;
  if(!await ask('Publish this card? Its name, contact details, introduction and links will be visible to anyone with its link or QR code.',{confirmLabel:'Publish'}))return;
  if(selected!==row)return;
  void run(async e=>{
   const {data,error}=await client.from('public_cards').update({published:true,revision:Number(row.revision)+1,updated_at:new Date().toISOString()}).eq('id',row.id).eq('owner_id',user.id).eq('revision',row.revision).select('*').maybeSingle();
   if(e!==epoch)return;if(error)throw error;if(!data){message('This card was changed on another device. Nothing was published.');return}
   selected=data;await listCards();if(e===epoch){message('Published. Your link and QR code are ready.');window.dispatchEvent(new Event('vale-cards-changed'))}
  });
 };
 $('card-cancel').onclick=()=>void closeEditor();
 $('card-editor').onsubmit=event=>{
  event.preventDefault();if(!user||busy)return;
  const values=Object.fromEntries(fields.map(k=>[k,$('multi-'+k).value.trim()]));
  const row=editing==='new'?null:cards.find(c=>c.id===editing);
  if(editing!=='new'&&!row){message('This card is no longer in your account. Your changes are still in the form.');return}
  const label=$('multi-label').value.trim()||row?.card_label||'My card',slug=row?row.slug:($('multi-slug').value.trim()||slugFrom(values.fullName));
  const site=values.website;if(site&&!view.web(site)){message('Enter a website such as example.com.');return}
  const invalid=tools.validate(label,slug,values);if(invalid){message(invalid);return}
  const published=row?$('multi-published').checked:false;
  void run(async e=>{
   const payload={...tools.toRow(values),card_label:label,published,updated_at:new Date().toISOString()};
   const query=row
    ?client.from('public_cards').update({...payload,revision:Number(row.revision)+1}).eq('id',row.id).eq('owner_id',user.id).eq('revision',row.revision).select('*').maybeSingle()
    :client.from('public_cards').insert({...payload,published:false,owner_id:user.id,slug}).select('*').single();
   const {data,error}=await query;if(e!==epoch)return;if(error)throw error;
   if(!data){message('This card was changed on another device. Nothing was overwritten, and your changes are still in the form.');return}
   selected=data;editing=null;dirty=false;$('multi-slug').dataset.touched='';
   await listCards();if(e===epoch){message(!row?'Draft saved. Review your card, then choose Review and publish.':published?'Saved. Your card is public.':'Saved. Your card is private.');window.dispatchEvent(new Event('vale-cards-changed'))}
  });
 };
 $('cards-delete').onclick=()=>{
  const row=cards.find(c=>c.id===editing);if(!row||busy)return;
  if(!$('card-delete-understand').checked){message('Tick the box to confirm. Nothing was deleted.');return}
  void run(async e=>{
   const {data,error}=await client.from('public_cards').delete().eq('id',row.id).eq('owner_id',user.id).eq('revision',row.revision).select('id').maybeSingle();
   if(e!==epoch)return;if(error)throw error;if(!data){message('This card was changed on another device. Nothing was deleted.');return}
   editing=null;dirty=false;selected=null;await listCards();if(e===epoch){message('Card deleted.');window.dispatchEvent(new Event('vale-cards-changed'))}
  });
 };
 function background(){if(user&&!busy&&editing===null&&!document.hidden&&navigator.onLine)void run(async()=>{await listCards()})}
 window.addEventListener('focus',background);document.addEventListener('visibilitychange',()=>{if(!document.hidden)background()});
 window.addEventListener('vale-usage-updated',()=>{if(editing===null)render();else $('card-label-field').hidden=!multi()});
 window.addEventListener('vale-account-ready',event=>{
  const next=event.detail;if(user?.id===next.user?.id&&client===next.client)return;
  epoch++;client=next.client;user=next.user;cards=[];selected=null;editing=null;dirty=false;busy=false;loaded=false;message('');
  fields.forEach(k=>{$('multi-'+k).value=''});render();announce();
  if(user)void run(async()=>{await listCards()});
 });
 window.ValeCards={edit:()=>{if(selected)openEditor(selected)},prefill:values=>openEditor(selected,values),list:()=>cards.map(c=>({...c})),current:()=>selected?{...selected}:null};
 render();
})();
