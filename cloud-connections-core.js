/* Private account connections. Does not cache cloud lists in browser storage. */
(function(root){
 'use strict';
 const local=typeof module!=='undefined'&&module.exports?require('./connections-core.js'):root.ValeConnections;
 const fields={cname:'full_name',cbusiness:'business_name',cemail:'email',cphone:'phone',cjobTitle:'job_title',cwebsite:'website',csocials:'social_links',cnotes:'notes',ccategory:'category',cnext:'next_step',cdate:'follow_up_on'};
 const categories=['Prospect','Customer','Supplier','Partner','Personal','Other'],steps=['Follow up','Send a quote','Schedule a meeting','Stay in touch','Completed'];
 const str=v=>typeof v==='string'?v:'';
 function toLocal(row){
  return {...Object.fromEntries(Object.entries(fields).map(([k,c])=>[k,str(row[c])])),id:row.id,history:Array.isArray(row.history)?structuredClone(row.history):[],source_identity:row.source_identity||'',source_url:row.source_url||''};
 }
 function payload(contact){
  if(!str(contact.cname).trim())throw Error('Enter a connection name.');
  const row=Object.fromEntries(Object.entries(fields).map(([k,c])=>[c,str(contact[k])]));
  row.full_name=row.full_name.trim();row.category=categories.includes(row.category)?row.category:'Other';row.next_step=steps.includes(row.next_step)?row.next_step:'Follow up';row.follow_up_on=row.follow_up_on||null;
  row.history=Array.isArray(contact.history)?structuredClone(contact.history):[];
  row.website=local.safeURL(row.website);row.updated_at=new Date().toISOString();return row;
 }
 function importContact(contact){
  if(!str(contact.cname).trim())throw Error('A selected browser connection has no valid name.');
  const id=typeof contact.id==='string'||typeof contact.id==='number'?String(contact.id):'';
  const fallback=id?'local:'+id:'browser:'+JSON.stringify([contact.cname,contact.cbusiness,contact.cemail,contact.cphone]);
  return {...structuredClone(contact),source_identity:str(contact.source_identity)||fallback};
 }
 async function list(client,owner){
  const {data,error}=await client.from('connections').select('*').eq('owner_id',owner).order('updated_at',{ascending:false});if(error)throw error;return data||[];
 }
 function duplicate(rows,contact){return local.findDuplicate(rows.map(toLocal),contact)}
 async function create(client,owner,contact){
  const row={...payload(contact),owner_id:owner,source_identity:str(contact.source_identity)||null,source_url:local.safeURL(contact.source_url)};
  const {data,error}=await client.from('connections').insert(row).select('*').single();if(error)throw error;return data;
 }
 async function update(client,owner,current,contact){
  const {data,error}=await client.from('connections').update({...payload(contact),revision:Number(current.revision)+1}).eq('id',current.id).eq('owner_id',owner).eq('revision',current.revision).select('*').maybeSingle();
  if(error)throw error;return data;
 }
 const api={fields,categories,steps,toLocal,payload,importContact,list,duplicate,create,update};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValeCloudConnections=api;
})(typeof window!=='undefined'?window:globalThis);
