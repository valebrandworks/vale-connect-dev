/* Private account connections. Does not cache cloud lists in browser storage. */
(function(root){
 'use strict';
 const local=typeof module!=='undefined'&&module.exports?require('./connections-core.js'):root.ValeConnections;
 const lists=typeof module!=='undefined'&&module.exports?require('./account-lists.js'):root.ValeAccountLists;
 const fields={cname:'full_name',cbusiness:'business_name',cemail:'email',cphone:'phone',cjobTitle:'job_title',cwebsite:'website',csocials:'social_links',cnotes:'notes',ccategory:'category',cnext:'next_step',cdate:'follow_up_on',cmetOn:'met_on',cmetWhere:'met_where',cmetHow:'met_how',cintroducedBy:'introduced_by'};
 const categories=['Prospect','Customer','Supplier','Partner','Personal','Other'],steps=['Follow up','Send a quote','Schedule a meeting','Stay in touch','Completed'];
 const str=v=>typeof v==='string'?v:'';
 function toLocal(row){
  return {...Object.fromEntries(Object.entries(fields).map(([k,c])=>[k,str(row[c])])),id:row.id,history:Array.isArray(row.history)?structuredClone(row.history):[],source_identity:row.source_identity||'',source_url:row.source_url||''};
 }
 function payload(contact){
  if(!str(contact.cname).trim())throw Error('Enter a connection name.');
  const row=Object.fromEntries(Object.entries(fields).map(([k,c])=>[c,str(contact[k])]));
  row.full_name=row.full_name.trim();row.category=categories.includes(row.category)?row.category:'Other';row.next_step=steps.includes(row.next_step)?row.next_step:'Follow up';row.follow_up_on=row.follow_up_on||null;row.met_on=row.met_on||null;
  row.history=Array.isArray(contact.history)?structuredClone(contact.history):[];
  row.website=local.website(row.website);row.updated_at=new Date().toISOString();return row;
 }
 function importContact(contact){
  if(!str(contact.cname).trim())throw Error('A selected browser connection has no valid name.');
  const id=typeof contact.id==='string'||typeof contact.id==='number'?String(contact.id):'';
  const fallback=id?'local:'+id:'browser:'+JSON.stringify([contact.cname,contact.cbusiness,contact.cemail,contact.cphone]);
  return {...structuredClone(contact),source_identity:str(contact.source_identity)||fallback};
 }
 async function list(client,owner,valid=()=>true){
  const rows=await lists.read(client,'connections',owner,valid);
  return rows.sort((a,b)=>String(b.updated_at||'').localeCompare(String(a.updated_at||''))||a.id.localeCompare(b.id));
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
 // Overview totals: a browser contact already imported to the cloud counts once.
 function overview(browser,cloud,today){
  const imported=new Set(cloud.map(row=>row.source_identity).filter(Boolean));
  const items=[...cloud.filter(row=>!row.archived_at).map(row=>({next:row.next_step,date:row.follow_up_on||''})),...browser.filter(c=>!imported.has(c.source_identity||'local:'+c.id)).map(c=>({next:c.cnext,date:c.cdate||''}))];
  const open=items.filter(item=>item.next!=='Completed');
  return {count:items.length,follow:open.length,overdue:open.filter(item=>item.date&&item.date<today).length};
 }
 async function setArchived(client,owner,current,archived){
  const {data,error}=await client.from('connections').update({archived_at:archived?new Date().toISOString():null,revision:Number(current.revision)+1}).eq('id',current.id).eq('owner_id',owner).eq('revision',current.revision).select('*').maybeSingle();
  if(error)throw error;return data;
 }
 async function remove(client,owner,current){
  const {data,error}=await client.from('connections').delete().eq('id',current.id).eq('owner_id',owner).eq('revision',current.revision).select('id').maybeSingle();
  if(error)throw error;return data;
 }
 // Search looks across details, notes and dated history. "due" includes overdue and today.
 // Basic search (advanced false) looks at names only and ignores filters.
 function matches(row,{query='',category='',followUp='',today='',advanced=true}={}){
  if(advanced&&category&&row.category!==category)return false;
  if(advanced&&followUp){
   const date=row.follow_up_on||'',open=row.next_step!=='Completed';
   if(!date||!open||(followUp==='overdue'?date>=today:date>today))return false;
  }
  const words=String(query).trim().toLocaleLowerCase('en').split(/\s+/).filter(Boolean);
  if(!words.length)return true;
  const history=Array.isArray(row.history)?row.history.map(entry=>entry?.text||'').join(' '):'';
  if(!advanced)return words.every(word=>str(row.full_name).toLocaleLowerCase('en').includes(word));
  const haystack=[row.full_name,row.business_name,row.email,row.phone,row.job_title,row.notes,row.category,row.met_where,row.met_how,row.introduced_by,history].map(str).join(' ').toLocaleLowerCase('en');
  return words.every(word=>haystack.includes(word));
 }
 // The database's pause on adding many new connections quickly (connection_limits). Nothing saved is affected.
 const isRateLimit=error=>error?.hint==='connection_rate_limit'||/New connections are paused/.test(String(error?.message||''));
 const api={fields,categories,steps,toLocal,payload,importContact,list,duplicate,create,update,overview,setArchived,remove,matches,isRateLimit};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValeCloudConnections=api;
})(typeof window!=='undefined'?window:globalThis);
