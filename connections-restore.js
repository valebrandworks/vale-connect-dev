/* Validate VALE Connect JSON backups and prepare insert-only restores. */
(function(root){
 'use strict';
 const core=typeof module!=='undefined'&&module.exports?require('./cloud-connections-core.js'):root.ValeCloudConnections;
 const MAX_BYTES=10*1024*1024,MAX_RECORDS=5000,uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 const limits={full_name:90,business_name:90,email:120,phone:40,job_title:80,website:300,social_links:3000,category:40,next_step:40,notes:10000,met_where:200,met_how:200,introduced_by:120,source_identity:4096,source_url:8192};
 function parse(text){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_BYTES)throw Error('Choose a JSON backup no larger than 10 MB.');
  let data;try{data=JSON.parse(text.replace(/^\ufeff/,''))}catch{throw Error('This file can’t be read as a backup. Choose a Full backup (JSON) downloaded from VALE Connect.');}
  if(!data||data.format!=='vale-connect-cloud-connections'||data.version!==1||data.environment!=='development')throw Error('This isn’t a VALE Connect backup file. Choose a Full backup (JSON) downloaded from VALE Connect.');
  if(!Array.isArray(data.connections)||data.connections.length>MAX_RECORDS||data.count!==data.connections.length)throw Error('The backup count is invalid or exceeds 5,000 connections. Nothing was imported.');
  const records=data.connections.map((row,index)=>{
   const fail=()=>{throw Error('Connection '+(index+1)+' has invalid or unsupported fields. Nothing was imported.');};
   if(!row||typeof row!=='object'||Array.isArray(row)||!uuid.test(row.id))fail();
   const clean={id:row.id.toLowerCase()};
   for(const [k,max]of Object.entries(limits)){const value=row[k];if(value!==null&&value!==undefined&&typeof value!=='string')fail();clean[k]=value||'';if(clean[k].length>max||clean[k].includes('\u0000'))fail();}
   if(!clean.full_name.trim()||!core.categories.includes(clean.category)||!core.steps.includes(clean.next_step))fail();
   for(const key of ['website','source_url'])if(clean[key]){try{if(!['http:','https:'].includes(new URL(clean[key]).protocol))fail();}catch{fail();}}
   for(const key of ['follow_up_on','met_on']){const date=row[key];if(date!==null&&date!==undefined&&date!==''){if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date)fail();}clean[key]=date||null;}
   if(!Array.isArray(row.history)||row.history.length>1000)fail();
   clean.history=row.history.map(entry=>{if(!entry||typeof entry!=='object'||typeof entry.date!=='string'||typeof entry.text!=='string'||entry.date.length>80||entry.text.length>1000||entry.date.includes('\u0000')||entry.text.includes('\u0000'))fail();return {date:entry.date,text:entry.text}});
   // Preserve only approved fields. Owner IDs, revision and auth metadata are never restored.
   return clean;
  });return {records,count:records.length};
 }
 function contact(row){const value=core.toLocal(row);value.source_identity=row.source_identity||'backup:'+row.id;return value}
 function match(rows,row){const identity=rows.find(r=>r.id===row.id);if(identity)return {exact:true,reason:'connection ID',record:identity};return core.duplicate(rows,contact(row))}
 function preview(records,rows){
  const seenIds=new Set(),seenSources=new Set();
  return records.map(row=>{const source=contact(row).source_identity,inside=seenIds.has(row.id)||seenSources.has(source);seenIds.add(row.id);seenSources.add(source);return {row,match:inside?{exact:true,reason:'repeated entry in this file'}:match(rows,row)}});
 }
 async function restore(client,owner,records,existing,valid=()=>true){
  let added=0,skipped=0,failed=0;const rows=[...existing];
  for(const row of records){
   if(!valid())return {added,skipped,failed,cancelled:true};
   if(match(rows,row)?.exact){skipped++;continue}
   try{const saved=await core.create(client,owner,contact(row));if(!valid())return {added:added+1,skipped,failed,cancelled:true};rows.push(saved);added++;}
   catch(error){if(error.code==='23505')skipped++;else {failed++;return {added,skipped,failed,stopped:true};}}
  }
  return {added,skipped,failed,cancelled:false};
 }
 const api={MAX_BYTES,MAX_RECORDS,parse,contact,match,preview,restore};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValeConnectionRestore=api;
})(typeof window!=='undefined'?window:globalThis);
