/* The Card tab. Cards live in the account (public_cards); the database enforces each plan's card limit. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id),tools=window.ValeCardTools,view=window.ValeCardView;
 if(!$('card-editor')||!tools||!view)return;
 const ask=(text,options)=>window.ValeAsk?window.ValeAsk(text,options):Promise.resolve(confirm(text));
 const fields=Object.keys(tools.fields);
 let client=null,user=null,cards=[],selected=null,editing=null,dirty=false,busy=false,epoch=0,loaded=false;
 const images=window.ValeCardImages,crop=window.ValePhotoCrop,unfinished=new Set();
 const message=text=>{$('cards-status').textContent=text};
 const maxCards=()=>{const u=window.ValeUsage?.usage?.();return u&&u.max_cards!==null&&u.max_cards!==undefined?Number(u.max_cards):null};
 let appearance='charcoal';
 const presets=view.PRESETS||['charcoal'];

 // Photos are private files, shown from memory. Each is downloaded once with the owner's permissions.
 const shown=new Map();
 function photoUrl(path,redraw){
  if(!path||!images||!client)return null;
  if(shown.has(path))return shown.get(path);
  shown.set(path,null);
  images.objectUrl(client,path).then(url=>{shown.set(path,url);if(url)redraw()}).catch(()=>{});
  return null;
 }
 // Photo and logo changes are staged in the editor and saved with Save card.
 // staged: undefined = unchanged; null = remove; a path = a newly uploaded, not yet attached file.
 const KINDS=['photo','logo'],COLUMN={photo:'photo_path',logo:'logo_path'};
 const blank=original=>({original:original||null,staged:undefined,url:null});
 let media={photo:blank(),logo:blank()},cropping=null;
 const changed=kind=>media[kind].staged!==undefined;
 const editorPath=kind=>media[kind].staged===undefined?media[kind].original:media[kind].staged;
 function editorUrl(kind){const m=media[kind];return m.staged?m.url:m.staged===null?null:photoUrl(m.original,renderEditorPreview)}
 async function discardStaged(kind){
  const m=media[kind],path=m.staged;if(path&&images&&client){try{await images.remove(client,[path])}catch{}}
  if(m.url)URL.revokeObjectURL?.(m.url);
  media[kind]={...m,staged:undefined,url:null};
 }
 const discardAll=async()=>{for(const kind of KINDS)await discardStaged(kind)};
 // The image columns to save, for whichever images changed.
 const imageEdits=()=>Object.fromEntries(KINDS.filter(changed).map(k=>[COLUMN[k],media[k].staged||null]));

 // Appearance picker: one choice, keyboard-friendly, previewed live in the editor.
 function setAppearance(value,{markDirty=false}={}){
  appearance=view.preset?view.preset(value):'charcoal';
  for(const b of document.querySelectorAll?.('#card-appearance [data-value]')||[]){const on=b.dataset.value===appearance;b.setAttribute('aria-checked',String(on));b.tabIndex=on?0:-1}
  if(markDirty)dirty=true;renderEditorPreview();
 }
 function renderEditorPreview(){
  const host=$('card-editor-preview');if(!host||editing===null)return;
  const values=Object.fromEntries(fields.map(k=>[k,$('multi-'+k).value])),url={photo:editorUrl('photo'),logo:editorUrl('logo')};
  host.replaceChildren(view.render(values,{preset:appearance,photoUrl:url.photo,logoUrl:url.logo}));
  for(const kind of KINDS){
   const thumb=$('card-'+kind+'-thumb'),fallback=kind==='photo'?(view.initials?view.initials(values.fullName):''):'LOGO';
   if(thumb){if(url[kind]){const img=document.createElement('img');img.src=url[kind];img.alt='';thumb.replaceChildren(img)}else thumb.replaceChildren(document.createTextNode(fallback))}
   const has=!!editorPath(kind),noun=kind==='photo'?'photo':'logo';
   if($('card-'+kind+'-choose'))$('card-'+kind+'-choose').textContent=(has?'Change ':'Add ')+noun;
   if($('card-'+kind+'-remove'))$('card-'+kind+'-remove').hidden=!has;
  }
 }
 for(const b of document.querySelectorAll?.('#card-appearance [data-value]')||[]){
  b.addEventListener('click',()=>setAppearance(b.dataset.value,{markDirty:true}));
  b.addEventListener('keydown',e=>{const i=presets.indexOf(b.dataset.value),step=e.key==='ArrowRight'||e.key==='ArrowDown'?1:e.key==='ArrowLeft'||e.key==='ArrowUp'?-1:0;if(!step)return;e.preventDefault();const next=presets[(i+step+presets.length)%presets.length];setAppearance(next,{markDirty:true});document.querySelector?.('#card-appearance [data-value="'+next+'"]')?.focus()});
 }
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
   $('card-preview').replaceChildren(view.render(tools.toEditor(selected),{preset:selected.appearance,photoUrl:photoUrl(selected.photo_path,render),logoUrl:photoUrl(selected.logo_path,render)}));
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
 function closeCropper(){if(cropping?.bitmap?.close)cropping.bitmap.close();cropping=null;if($('card-photo-cropper'))$('card-photo-cropper').hidden=true}
 function openEditor(row,values){
  // Any unsaved upload from an earlier editing session is discarded before starting again.
  const leftover=KINDS.map(k=>media[k].staged).filter(Boolean);if(leftover.length&&images&&client)images.remove(client,leftover).catch(()=>{});
  editing=row?row.id:'new';dirty=!!values;closeCropper();
  media={photo:blank(row?.photo_path),logo:blank(row?.logo_path)};
  const v=values||(row?tools.toEditor(row):Object.fromEntries(fields.map(k=>[k,''])));
  fields.forEach(k=>{$('multi-'+k).value=v[k]||''});
  $('multi-label').value=row?row.card_label:(cards.length?'':'My card');
  $('card-label-field').hidden=!multi();
  $('multi-slug').value=row?row.slug:'';$('multi-slug').readOnly=!!row;
  $('card-slug-hint').textContent=row?'Your card’s link name is fixed so printed QR codes keep working.':'Lowercase letters, numbers and hyphens. It can’t be changed later, so printed QR codes keep working.';
  // New cards always start as private drafts (the database requires it); publishing comes after review.
  $('multi-published').checked=row?!!row.published:false;$('card-public-field').hidden=!row;$('card-draft-note').hidden=!!row;
  // Sharing back is on unless the owner turned it off (the database default is on).
  if($('multi-accept-shares'))$('multi-accept-shares').checked=row?row.accept_shares!==false:true;
  $('card-delete-section').hidden=!row;$('card-delete-section').open=false;$('card-delete-understand').checked=false;
  $('card-editor-title').textContent=row?'Edit card':'Create your card';
  if($('card-photo-note'))$('card-photo-note').textContent=row?'Your photo is cropped to a square and shown as a circle. It’s saved with your card.':'Save your card first, then you can add a photo.';
  for(const kind of KINDS)if($('card-'+kind+'-choose'))$('card-'+kind+'-choose').hidden=!row;
  if($('card-logo-note'))$('card-logo-note').textContent=row?'Shown on a white tile in the corner of your card. PNG keeps a transparent background. SVG files aren\u2019t accepted.':'Save your card first, then you can add a logo.';
  setAppearance(row?.appearance||'charcoal');
  message(values?'Review these details, then save.':'');
  render();window.ValeApp?.tab('card');$('multi-fullName').focus?.();
 }
 async function closeEditor(){
  if(dirty&&!await ask('Discard your unsaved card changes?',{confirmLabel:'Discard'}))return;
  closeCropper();await discardAll();editing=null;dirty=false;message('');render();
 }
 async function listCards(){
  const e=epoch,owner=user.id;
  const data=await window.ValeAccountLists.read(client,'public_cards',owner,()=>e===epoch&&owner===user?.id);
  if(e!==epoch||owner!==user?.id)return false;
  cards=data.sort((a,b)=>String(a.updated_at).localeCompare(String(b.updated_at))||a.id.localeCompare(b.id));
  selected=cards.find(c=>c.id===selected?.id)||cards[0]||null;loaded=true;
  render();announce();window.ValeUsage?.refresh();
  if(images){
   // Finish any private card whose old image files couldn't be removed earlier, then tidy stray files.
   for(const id of [...unfinished]){const row=cards.find(c=>c.id===id);if(!row||row.published){unfinished.delete(id);continue}const r=await images.finishPrivate(client,row);if(r.ok)unfinished.delete(id)}
   if(e===epoch&&owner===user?.id&&editing===null)void images.sweep(client,cards);
  }
  return true;
 }
 async function run(work){
  if(busy||!user)return;const e=epoch;busy=true;render();
  try{await work(e)}catch(error){if(e===epoch)message(error.code==='23505'?'That card link is already taken. Choose another.':(error.message||'Something went wrong.')+' Your changes are still in the form.')}
  finally{if(e===epoch){busy=false;render()}}
 }

 // Photo picker and square cropper.
 if(crop&&images&&$('card-photo-input')){
  const canvas=$('card-photo-canvas');
  const redraw=()=>{if(cropping)crop.draw(canvas,cropping.bitmap,cropping.state)};
  $('card-photo-choose').onclick=()=>{if(editing&&editing!=='new'&&!busy)$('card-photo-input').click()};
  $('card-photo-input').addEventListener('change',async()=>{
   const file=$('card-photo-input').files?.[0];$('card-photo-input').value='';
   const problem=crop.check(file);if(problem){message(problem);return}
   try{
    const bitmap=await crop.decode(file);closeCropper();
    cropping={bitmap,state:crop.state(bitmap.width,bitmap.height,canvas.width)};
    $('card-photo-zoom').value='1';$('card-photo-cropper').hidden=false;redraw();canvas.focus?.();message('Drag to position your photo, then choose Use photo.');
   }catch(error){message(error.message)}
  });
  let drag=null;
  canvas.addEventListener('pointerdown',e=>{if(!cropping)return;drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture?.(e.pointerId)});
  canvas.addEventListener('pointermove',e=>{if(!drag||!cropping)return;const k=canvas.width/(canvas.getBoundingClientRect().width||canvas.width);cropping.state=crop.pan(cropping.state,(e.clientX-drag.x)*k,(e.clientY-drag.y)*k);drag={x:e.clientX,y:e.clientY};redraw()});
  for(const end of ['pointerup','pointercancel'])canvas.addEventListener(end,()=>{drag=null});
  canvas.addEventListener('wheel',e=>{if(!cropping)return;e.preventDefault();const z=Math.min(crop.MAX_ZOOM,Math.max(1,cropping.state.zoom-(e.deltaY>0?0.1:-0.1)));cropping.state=crop.zoomTo(cropping.state,z);$('card-photo-zoom').value=String(z);redraw()},{passive:false});
  canvas.addEventListener('keydown',e=>{
   if(!cropping)return;const step=16,moves={ArrowLeft:[step,0],ArrowRight:[-step,0],ArrowUp:[0,step],ArrowDown:[0,-step]};
   if(moves[e.key]){e.preventDefault();cropping.state=crop.pan(cropping.state,...moves[e.key]);redraw();return}
   if(e.key==='+'||e.key==='='||e.key==='-'){e.preventDefault();const z=Math.min(crop.MAX_ZOOM,Math.max(1,cropping.state.zoom+(e.key==='-'?-0.1:0.1)));cropping.state=crop.zoomTo(cropping.state,z);$('card-photo-zoom').value=String(z);redraw()}
  });
  $('card-photo-zoom').addEventListener('input',()=>{if(!cropping)return;cropping.state=crop.zoomTo(cropping.state,$('card-photo-zoom').value);redraw()});
  $('card-photo-cancel').onclick=()=>{closeCropper();message('')};
  $('card-photo-use').onclick=()=>{
   const row=cards.find(c=>c.id===editing);if(!cropping||!row)return;
   const job=cropping;
   void run(async e=>{
    message('Preparing your photo…');
    const {blob,ext}=await crop.encode(job.bitmap,job.state);
    const path=await images.upload(client,row.id,'photo',blob,ext);
    if(e!==epoch){try{await images.remove(client,[path])}catch{}return}
    await discardStaged('photo');
    media.photo={...media.photo,staged:path,url:URL.createObjectURL(blob)};dirty=true;closeCropper();renderEditorPreview();
    message('Photo ready. Choose Save card to keep it.');
   });
  };
  $('card-photo-remove').onclick=()=>{
   if(busy)return;
   void (async()=>{await discardStaged('photo');media.photo={...media.photo,staged:media.photo.original?null:undefined};dirty=true;renderEditorPreview();message(media.photo.original?'Photo will be removed when you choose Save card.':'')})();
  };
 }
 // Logo picker: no cropping; scaled to fit 512 px with its shape and transparency kept.
 if(crop?.encodeLogo&&images&&$('card-logo-input')){
  $('card-logo-choose').onclick=()=>{if(editing&&editing!=='new'&&!busy)$('card-logo-input').click()};
  $('card-logo-input').addEventListener('change',()=>{
   const file=$('card-logo-input').files?.[0];$('card-logo-input').value='';
   const problem=crop.checkLogo(file);if(problem){message(problem);return}
   const row=cards.find(c=>c.id===editing);if(!row)return;
   void run(async e=>{
    message('Preparing your logo…');
    const bitmap=await crop.decode(file);
    let out;try{out=await crop.encodeLogo(bitmap)}finally{bitmap.close?.()}
    const path=await images.upload(client,row.id,'logo',out.blob,out.ext);
    if(e!==epoch){try{await images.remove(client,[path])}catch{}return}
    await discardStaged('logo');
    media.logo={...media.logo,staged:path,url:URL.createObjectURL(out.blob)};dirty=true;renderEditorPreview();
    message('Logo ready. Choose Save card to keep it.');
   });
  });
  $('card-logo-remove').onclick=()=>{
   if(busy)return;
   void (async()=>{await discardStaged('logo');media.logo={...media.logo,staged:media.logo.original?null:undefined};dirty=true;renderEditorPreview();message(media.logo.original?'Logo will be removed when you choose Save card.':'')})();
  };
 }

 $('card-editor').addEventListener('input',e=>{if(['card-photo-zoom','card-photo-input','card-logo-input'].includes(e.target?.id))return;dirty=true;renderEditorPreview()});
 $('multi-fullName').addEventListener('input',()=>{if(editing==='new'&&!$('multi-slug').dataset.touched)$('multi-slug').value=slugFrom($('multi-fullName').value)});
 $('multi-slug').addEventListener('input',()=>{$('multi-slug').dataset.touched='1'});
 $('card-create').onclick=()=>openEditor(null);
 $('cards-new').onclick=()=>openEditor(null);
 $('card-edit').onclick=()=>selected&&openEditor(selected);
 // Publishing is its own step, confirmed in the page, after the person has seen their saved card.
 $('card-publish').onclick=async()=>{
  const row=selected;if(!row||row.published||busy)return;
  if(!await ask('Publish this card? Its name, photo, logo, contact details, introduction and links will be visible to anyone with its link or QR code.',{confirmLabel:'Publish'}))return;
  if(selected!==row)return;
  void run(async e=>{
   const {data,error}=await client.from('public_cards').update({published:true,revision:Number(row.revision)+1,updated_at:new Date().toISOString()}).eq('id',row.id).eq('owner_id',user.id).eq('revision',row.revision).select('*').maybeSingle();
   if(e!==epoch)return;if(error)throw error;if(!data){message('This card was changed on another device. Nothing was published.');return}
   selected=data;await listCards();if(e===epoch){message('Published. Your link and QR code are ready.');window.dispatchEvent(new Event('vale-cards-changed'))}
  });
 };
 $('card-cancel').onclick=()=>void closeEditor();
 // After a saved photo change, the replaced file is removed. If that fails, the background tidy-up removes it later.
 async function dropReplaced(oldPath,newPath){if(oldPath&&oldPath!==newPath&&images){try{await images.remove(client,[oldPath])}catch{}}}
 $('card-editor').onsubmit=event=>{
  event.preventDefault();if(!user)return;
  if(busy){message('Your image is still uploading. Choose Save card again in a moment.');return}
  if(cropping){message('Choose Use photo or Cancel first.');return}
  const values=Object.fromEntries(fields.map(k=>[k,$('multi-'+k).value.trim()]));
  const row=editing==='new'?null:cards.find(c=>c.id===editing);
  if(editing!=='new'&&!row){message('This card is no longer in your account. Your changes are still in the form.');return}
  const label=$('multi-label').value.trim()||row?.card_label||'My card',slug=row?row.slug:($('multi-slug').value.trim()||slugFrom(values.fullName));
  const site=values.website;if(site&&!view.web(site)){message('Enter a website such as example.com.');return}
  const invalid=tools.validate(label,slug,values);if(invalid){message(invalid);return}
  const published=row?$('multi-published').checked:false;
  const edits={...tools.toRow(values),card_label:label,appearance,...(row?imageEdits():{}),...($('multi-accept-shares')?{accept_shares:$('multi-accept-shares').checked}:{})};
  // Making a published card private also renames its images, so links made while it was public stop working.
  if(row&&row.published&&!published&&images){
   void run(async e=>{
    message('Making your card private…');
    let current=row;
    // Photo and logo changes are saved first (the card stays public), then the card is made private with them.
    if(KINDS.some(changed)){
     const {data,error}=await client.from('public_cards').update({...imageEdits(),revision:Number(row.revision)+1,updated_at:new Date().toISOString()}).eq('id',row.id).eq('owner_id',user.id).eq('revision',row.revision).select('*').maybeSingle();
     if(e!==epoch)return;if(error)throw error;
     if(!data){message('This card was changed on another device. It’s still public, and nothing was changed.');return}
     current=data;media={photo:blank(data.photo_path),logo:blank(data.logo_path)};
    }
    const {photo_path:_p,logo_path:_l,...rest}=edits;
    const result=await images.makePrivate(client,user.id,current,rest);
    if(e!==epoch)return;
    if(!result.changed){message(result.conflict?'This card was changed on another device. It’s still public, and nothing was changed.':'Your card couldn’t be made private, so it’s still public. Check your connection and try again.');if(current!==row)await listCards();return}
    selected=result.card;editing=null;dirty=false;
    if(!result.ok)unfinished.add(row.id);
    await listCards();
    if(e===epoch){message(unfinished.has(row.id)?'Your card is private, but older copies of its images couldn’t be removed yet. VALE Connect will finish this the next time it loads your card. Saving again also retries.':'Your card is private. Any earlier links to its images stop working within about a minute.');window.dispatchEvent(new Event('vale-cards-changed'))}
   });
   return;
  }
  void run(async e=>{
   const payload={...edits,published,updated_at:new Date().toISOString()};
   const query=row
    ?client.from('public_cards').update({...payload,revision:Number(row.revision)+1}).eq('id',row.id).eq('owner_id',user.id).eq('revision',row.revision).select('*').maybeSingle()
    :client.from('public_cards').insert({...payload,published:false,owner_id:user.id,slug}).select('*').single();
   const {data,error}=await query;if(e!==epoch)return;if(error)throw error;
   if(!data){message('This card was changed on another device. Nothing was overwritten, and your changes are still in the form.');return}
   if(row)for(const kind of KINDS)if(changed(kind)){await dropReplaced(media[kind].original,data[COLUMN[kind]]);if(media[kind].url)URL.revokeObjectURL?.(media[kind].url)}
   media={photo:blank(data.photo_path),logo:blank(data.logo_path)};
   selected=data;editing=null;dirty=false;$('multi-slug').dataset.touched='';
   await listCards();if(e===epoch){message(!row?'Draft saved. Review your card, then choose Review and publish.':published?'Saved. Your card is public.':'Saved. Your card is private.');window.dispatchEvent(new Event('vale-cards-changed'))}
  });
 };
 // Deleting a card first detaches and removes its images; the database refuses to delete a card that still has some.
 async function removeCardImages(row){
  if(!images)return row;
  let current=row;
  if(row.photo_path||row.logo_path){
   const {data,error}=await client.from('public_cards').update({photo_path:null,logo_path:null,revision:Number(row.revision)+1,updated_at:new Date().toISOString()}).eq('id',row.id).eq('owner_id',user.id).eq('revision',row.revision).select('*').maybeSingle();
   if(error)throw error;if(!data)return null;current=data;
  }
  const files=(await images.listCard(client,row.id)).map(f=>f.path);
  await images.remove(client,files);
  return current;
 }
 $('cards-delete').onclick=()=>{
  const row=cards.find(c=>c.id===editing);if(!row||busy)return;
  if(!$('card-delete-understand').checked){message('Tick the box to confirm. Nothing was deleted.');return}
  void run(async e=>{
   await discardAll();
   const current=await removeCardImages(row);if(e!==epoch)return;
   if(!current){message('This card was changed on another device. Nothing was deleted.');return}
   const {data,error}=await client.from('public_cards').delete().eq('id',current.id).eq('owner_id',user.id).eq('revision',current.revision).select('id').maybeSingle();
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
  closeCropper();for(const url of shown.values())if(url)URL.revokeObjectURL?.(url);shown.clear();media={photo:blank(),logo:blank()};
  fields.forEach(k=>{$('multi-'+k).value=''});render();announce();
  if(user)void run(async()=>{await listCards()});
 });
 // A contact file's photo: a small JPEG of the card's saved photo, or nothing.
 async function contactPhoto(card){
  if(!card?.photo_path||!images||!client)return '';
  return images.contactPhoto(await images.blobOf(client,card.photo_path));
 }
 // Every image belonging to this account's cards, removed before the account is deleted.
 async function removeAllImages(){for(const row of cards){const current=await removeCardImages(row);if(!current)throw Error('A card changed on another device. Nothing was deleted. Try again.')}}
 window.ValeCards={edit:()=>{if(selected)openEditor(selected)},prefill:values=>openEditor(selected,values),list:()=>cards.map(c=>({...c})),current:()=>selected?{...selected}:null,contactPhoto,removeAllImages};
 render();
})();
