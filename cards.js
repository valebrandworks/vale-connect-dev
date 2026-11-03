/* Separate multi-card manager; the original My Card/profile sync stays intact. */
(()=>{
 'use strict';
 const $=id=>document.getElementById(id), tools=window.ValeCardTools;
 if(!$('cards-manager')||!tools)return;
 let client=null,user=null,cards=[],selected=null,dirty=false,busy=false,epoch=0;
 const message=text=>{$('cards-status').textContent=text};
 const fields=Object.keys(tools.fields);
 const editor=()=>Object.fromEntries(fields.map(k=>[k,$('multi-'+k).value.trim()]));
 function controls(){
  $('cards-login-note').hidden=!!user;
  $('cards-workspace').hidden=!user;
  for(const id of ['cards-new','cards-refresh','cards-save','cards-publish'])$(id).disabled=busy||!user;
  $('cards-publish').disabled=busy||!user||!selected;
  $('cards-publish').textContent=selected?.published?'Unpublish card':'Publish card';
  $('cards-state').textContent=selected?(selected.published?'Published — these card fields are public.':'Private draft — visible only to your account.'):'New private draft';
  $('multi-slug').disabled=!!selected||busy;
  for(const el of $('cards-form').querySelectorAll('input,textarea'))el.disabled=busy||!user||(el.id==='multi-slug'&&!!selected);
 }
 function clearForm(){
  selected=null;dirty=false;
  fields.forEach(k=>{$('multi-'+k).value=''});
  $('multi-label').value='';$('multi-slug').value='';
  renderShare();controls();
 }
 function fill(row){
  selected={...row};dirty=false;
  const values=tools.toEditor(row);
  fields.forEach(k=>{$('multi-'+k).value=values[k]});
  $('multi-label').value=row.card_label;$('multi-slug').value=row.slug;
  renderList();renderShare();controls();
 }
 function discard(){return !dirty||confirm('Discard the unsaved edits in this card editor? Saved cards will not be deleted.')}
 function renderList(){
  const list=$('cards-list');list.replaceChildren();
  if(!cards.length){const p=document.createElement('p');p.textContent='No saved cards yet. Create a private draft to begin.';list.append(p)}
  for(const row of cards){
   const button=document.createElement('button');button.type='button';button.className='btn alt';
   button.textContent=row.card_label+' · '+(row.published?'Published':'Private draft');
   button.setAttribute('aria-pressed',String(row.id===selected?.id));button.disabled=busy;
   button.onclick=()=>{if(!busy&&discard())fill(row)};list.append(button);
  }
 }
 function renderShare(){
  const host=$('cards-qr');host.replaceChildren();
  const link=$('cards-public-link');link.hidden=true;link.removeAttribute('href');
  $('cards-qr-download').disabled=true;
  if(!selected?.published){$('cards-share-note').textContent='Save a draft, review its public fields, then publish to enable its public link and QR.';return}
  const url=new URL('p.html',location.href);url.searchParams.set('u',selected.slug);
  link.href=url.href;link.textContent='Open published card';link.hidden=false;
  $('cards-share-note').textContent='This link shows the last saved published card. Unsaved edits are not shared.';
  try{
   if(typeof window.ValeQR!=='function')throw Error('QR generator unavailable.');
   const qr=new window.ValeQR(-1,1);qr.addData(url.href);qr.make();
   const n=qr.getModuleCount(),scale=6,canvas=document.createElement('canvas');canvas.width=canvas.height=(n+8)*scale;
   const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#000';
   for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(qr.isDark(y,x))ctx.fillRect((x+4)*scale,(y+4)*scale,scale,scale);
   canvas.setAttribute('aria-label','QR code for published card');host.append(canvas);$('cards-qr-download').disabled=false;
  }catch(error){host.textContent=error.message||'QR generator unavailable.'}
 }
 async function listCards(){
  const requestEpoch=epoch,owner=user.id;
  const {data,error}=await client.from('public_cards').select('*').eq('owner_id',owner).order('card_label').order('id');
  if(requestEpoch!==epoch||owner!==user?.id)return false;
  if(error)throw error;cards=data||[];renderList();return true;
 }
 async function run(work){
  if(busy||!user)return;const requestEpoch=epoch;busy=true;controls();renderList();
  try{await work(requestEpoch)}catch(error){if(requestEpoch===epoch)message(error.code==='23505'?'That public link name is already in use. Choose another name.':error.message||'Card request failed.')}
  finally{if(requestEpoch===epoch){busy=false;controls();renderList()}}
 }
 function conflict(){message('This card changed in another session. Your edits are still in the form. Copy them before refreshing the card list; nothing was overwritten.')}
 $('cards-new').onclick=()=>{if(discard()){clearForm();renderList();message('New private draft. Your original My Card is unchanged.')}};
 $('cards-refresh').onclick=()=>{if(!discard())return;void run(async e=>{if(await listCards()&&e===epoch){const row=cards.find(r=>r.id===selected?.id);if(row)fill(row);else clearForm();message('Card list refreshed.')}})};
 $('cards-form').addEventListener('input',()=>{dirty=true});
 $('multi-label').addEventListener('input',()=>{
  if(selected)return;
  const label=$('multi-label').value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,45)||'card';
  $('multi-slug').value=label+'-'+crypto.randomUUID().slice(0,8);
 });
 $('cards-form').onsubmit=e=>{
  e.preventDefault();if(!user||busy)return;
  const values=editor(),label=$('multi-label').value.trim(),slug=$('multi-slug').value.trim();
  const invalid=tools.validate(label,slug,values);if(invalid){message(invalid);return}
  if(selected?.published&&!confirm('This card is published. Save these edits to its public profile?'))return;
  void run(async requestEpoch=>{
   const payload={...tools.toRow(values),card_label:label,updated_at:new Date().toISOString()};
   let query;
   if(selected)query=client.from('public_cards').update({...payload,revision:Number(selected.revision)+1}).eq('id',selected.id).eq('owner_id',user.id).eq('revision',selected.revision).select('*').maybeSingle();
   else query=client.from('public_cards').insert({...payload,owner_id:user.id,slug,published:false}).select('*').single();
   const {data,error}=await query;if(requestEpoch!==epoch)return;if(error)throw error;if(!data){conflict();return}
   fill(data);message(data.published?'Published card updated.':'Private draft saved.');await listCards();
  });
 };
 $('cards-publish').onclick=()=>{
  if(!selected||busy)return;
  if(dirty){message('Save your edits before changing publication status.');return}
  const publish=!selected.published;
  if(publish&&!confirm('Publish this card? Its name, company, contact details, introduction and links will be readable by anyone with its link.'))return;
  void run(async requestEpoch=>{
   const {data,error}=await client.from('public_cards').update({published:publish,revision:Number(selected.revision)+1,updated_at:new Date().toISOString()}).eq('id',selected.id).eq('owner_id',user.id).eq('revision',selected.revision).select('*').maybeSingle();
   if(requestEpoch!==epoch)return;if(error)throw error;if(!data){conflict();return}
   fill(data);message(publish?'Card published. Public link and QR are ready.':'Card unpublished. The public link no longer displays it.');await listCards();
  });
 };
 $('cards-qr-download').onclick=()=>{
  if(!selected?.published)return;const canvas=$('cards-qr').querySelector('canvas');if(!canvas)return;
  const link=document.createElement('a');link.href=canvas.toDataURL('image/png');link.download=selected.slug+'-qr.png';link.click();
 };
 window.addEventListener('vale-account-ready',event=>{
  const next=event.detail;
  if(user?.id===next.user?.id&&client===next.client)return;
  epoch++;client=next.client;user=next.user;cards=[];busy=false;clearForm();renderList();
  message(user?'Loading your cards…':'Sign in through Cloud Account to manage your cards.');
  if(user)void run(async e=>{if(await listCards()&&e===epoch)message('Choose a card, or create a new private draft. Your original My Card stays separate.')});
 });
 clearForm();renderList();message('Sign in through Cloud Account to manage your cards.');
})();

