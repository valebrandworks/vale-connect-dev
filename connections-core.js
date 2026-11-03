/* Browser-local imports only. Existing contacts and notes are never merged or overwritten. */
(function(root){
 'use strict';
 const KEY='vale-connect-dev-v09-contacts';
 const text=(v,max=1000)=>typeof v==='string'?v.trim().slice(0,max):'';
 const normalized=v=>text(v).replace(/\s+/g,' ').toLocaleLowerCase('en');
 const email=v=>text(v,120).toLowerCase();
 const phone=v=>text(v,40).replace(/[^0-9]/g,'');
 function readContacts(storage){
  const raw=storage.getItem(KEY);if(raw===null)return [];
  try{const list=JSON.parse(raw);if(!Array.isArray(list)||list.some(r=>!r||typeof r!=='object'||Array.isArray(r)))throw Error();return list}
  catch{throw Error('Existing connections could not be read. Nothing was saved or replaced.')}
 }
 function safeURL(value){try{const u=new URL(text(value,16000));return ['https:','http:'].includes(u.protocol)?u.href:''}catch{return ''}}
 function candidate(profile,source={}){
  const c={cname:text(profile?.fullName,90),cbusiness:text(profile?.company,90),cemail:text(profile?.email,120),cphone:text(profile?.phone,40),cnotes:text(profile?.bio,600),cjobTitle:text(profile?.jobTitle,80),cwebsite:safeURL(profile?.website),csocials:text(profile?.socials,3000),ccategory:'Other',cnext:'Follow up',cdate:'',history:[],source_url:safeURL(source.url)};
  if(!c.cname)throw Error('This shared card has no valid name. Nothing was saved.');
  const cardId=text(source.cardId,100);
  c.source_identity=cardId?'card:'+cardId:'snapshot:'+JSON.stringify([normalized(c.cname),normalized(c.cbusiness),email(c.cemail),phone(c.cphone)]);
  return c;
 }
 function findDuplicate(list,incoming){
  let record=incoming.source_identity?list.find(r=>r.source_identity===incoming.source_identity):null;
  if(record)return {record,exact:true,reason:'this shared card'};
  const e=email(incoming.cemail),p=phone(incoming.cphone),name=normalized(incoming.cname),company=normalized(incoming.cbusiness);
  if(e&&(record=list.find(r=>email(r.cemail)===e)))return {record,exact:false,reason:'email address'};
  if(p.length>=7&&(record=list.find(r=>phone(r.cphone)===p)))return {record,exact:false,reason:'phone number'};
  if(name&&company&&(record=list.find(r=>normalized(r.cname)===name&&normalized(r.cbusiness)===company)))return {record,exact:false,reason:'name and company'};
  return null;
 }
 function inspect(storage,profile,source){const incoming=candidate(profile,source);return findDuplicate(readContacts(storage),incoming)}
 function save(storage,profile,source,{separate=false,idFactory}={}){
  const incoming=candidate(profile,source),list=readContacts(storage),duplicate=findDuplicate(list,incoming);
  if(duplicate&&(duplicate.exact||!separate))return {status:'duplicate',...duplicate};
  const id=idFactory?idFactory():(root.crypto?.randomUUID?.()||Date.now()+'-'+Math.random().toString(36).slice(2));
  const record={...incoming,id,created_at:new Date().toISOString()};
  try{storage.setItem(KEY,JSON.stringify([record,...list]))}
  catch{throw Error('Could not save the connection. Browser storage may be unavailable or full. Existing connections were not replaced.')}
  return {status:'saved',record};
 }
 const api={KEY,readContacts,candidate,findDuplicate,inspect,save,safeURL};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValeConnections=api;
})(typeof window!=='undefined'?window:globalThis);
