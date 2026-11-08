/* Card image storage helpers. Images are private; the database lets visitors read an image only while it is
   attached to a published card. Making a card private also gives its images new file names, so any signed
   link someone created while the card was public stops working. */
(function(root){
 'use strict';
 const BUCKET='card-images';
 const PATH=/^([0-9a-f-]{36})\/(photo|logo)-[a-z0-9]{16,40}\.(webp|png|jpg)$/;
 const ORPHAN_AGE_MS=10*60*1000;
 function randomPart(){
  const bytes=(root.crypto||globalThis.crypto).getRandomValues(new Uint8Array(24)),abc='abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from(bytes,b=>abc[b%36]).join('');
 }
 // A fresh name in the same card folder, keeping the kind (photo/logo) and file type.
 function renamed(path,random=randomPart){
  const m=PATH.exec(path);if(!m)throw Error('Unexpected image path.');
  return m[1]+'/'+m[2]+'-'+random()+'.'+m[3];
 }
 const attached=card=>[card.photo_path,card.logo_path].filter(Boolean);
 async function listCard(client,cardId){
  const {data,error}=await client.storage.from(BUCKET).list(cardId,{limit:100});
  if(error)throw error;
  return (data||[]).filter(f=>f&&f.name&&f.id!==null).map(f=>({path:cardId+'/'+f.name,created:Date.parse(f.created_at||'')||0}));
 }
 async function remove(client,paths){
  if(!paths.length)return;
  const {error}=await client.storage.from(BUCKET).remove(paths);if(error)throw error;
 }
 // Removes files in a card's folder that the card doesn't use. minAgeMs protects an upload another
 // device may be about to attach; the owner's own explicit actions pass 0.
 async function removeUnattached(client,card,{minAgeMs=0,now=Date.now()}={}){
  const keep=new Set(attached(card)),files=await listCard(client,card.id);
  const stale=files.filter(f=>!keep.has(f.path)&&now-f.created>=minAgeMs).map(f=>f.path);
  await remove(client,stale);return stale.length;
 }
 /* Makes a published card private and rotates its image names, as one operation.
    1. Remove unattached files (makes room under the 4-files-per-card limit).
    2. Copy each attached image to a new random name. On failure: delete the copies; nothing changed.
    3. One revision-guarded update: published=false, the new paths and any other edits. On failure: delete
       the copies; nothing changed.
    4. Delete the old files and confirm the folder holds exactly the new ones. On failure the card is private
       but old links may still work: reported as incomplete, and finishPrivate() can complete it.
    Returns {ok, changed, card, stage, error}. */
 async function makePrivate(client,ownerId,card,edits={},{random=randomPart}={}){
  const old=attached(card),copies=[],map={};
  const undo=async()=>{try{await remove(client,copies)}catch{}};
  try{await removeUnattached(client,card)}catch(error){return {ok:false,changed:false,stage:'prepare',error}}
  for(const path of old){
   const target=renamed(path,random);
   const {error}=await client.storage.from(BUCKET).copy(path,target);
   if(error){await undo();return {ok:false,changed:false,stage:'copy',error}}
   copies.push(target);map[path]=target;
  }
  const payload={...edits,published:false,photo_path:card.photo_path?map[card.photo_path]:null,logo_path:card.logo_path?map[card.logo_path]:null,revision:Number(card.revision)+1,updated_at:new Date().toISOString()};
  const {data,error}=await client.from('public_cards').update(payload).eq('id',card.id).eq('owner_id',ownerId).eq('revision',card.revision).select('*').maybeSingle();
  if(error||!data){await undo();return {ok:false,changed:false,stage:'update',conflict:!error,error}}
  return finishPrivate(client,data,old);
 }
 // Deletes the given old files (or every unattached file) and confirms only the card's own images remain.
 async function finishPrivate(client,card,old=null){
  try{
   if(old)await remove(client,old.filter(p=>!attached(card).includes(p)));
   await removeUnattached(client,card);
   const left=(await listCard(client,card.id)).map(f=>f.path).sort(),expected=attached(card).sort();
   if(JSON.stringify(left)!==JSON.stringify(expected))return {ok:false,changed:true,card,stage:'delete',error:Error('Old image files are still stored.')};
   return {ok:true,changed:true,card};
  }catch(error){return {ok:false,changed:true,card,stage:'delete',error}}
 }
 // Background tidy-up for the signed-in owner's cards: removes unattached files older than 10 minutes.
 async function sweep(client,cards,options={}){
  let removed=0;for(const card of cards){try{removed+=await removeUnattached(client,card,{minAgeMs:ORPHAN_AGE_MS,...options})}catch{}}return removed;
 }
 const api={BUCKET,PATH,renamed,attached,listCard,removeUnattached,makePrivate,finishPrivate,sweep};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValeCardImages=api;
})(typeof window!=='undefined'?window:globalThis);
