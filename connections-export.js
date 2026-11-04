/* Read-only account exports. No browser persistence or database writes. */
(function(root){
 'use strict';
 const columns=['id','full_name','business_name','email','phone','job_title','website','social_links','category','next_step','follow_up_on','met_on','met_where','met_how','introduced_by','notes','history','source_identity','source_url','archived_at','revision','created_at','updated_at'];
 function clean(row){return Object.fromEntries(columns.map(k=>[k,k==='history'?structuredClone(Array.isArray(row[k])?row[k]:[]):row[k]??null]))}
 async function fetchAll(client,owner,valid=()=>true){
  if(!owner)throw Error('Sign in before exporting cloud connections.');
  const rows=[],seen=new Set();let expected=null;
  for(;;){
   if(!valid())throw Error('Account changed. Export cancelled.');
   const {data,error,count}=await client.from('connections').select('*',{count:'exact'}).eq('owner_id',owner).order('id',{ascending:true}).range(rows.length,rows.length+499);
   if(!valid())throw Error('Account changed. Export cancelled.');if(error)throw error;
   if(!Number.isSafeInteger(count)||count<0||!Array.isArray(data))throw Error('Could not verify the full cloud list. No export was created.');
   if(expected===null)expected=count;
   if(count!==expected)throw Error('The cloud list changed during export. Please try again.');
   for(const row of data){if(row.owner_id!==owner||!row.id||seen.has(row.id))throw Error('Could not verify the full cloud list. Please try again.');seen.add(row.id);rows.push(clean(row))}
   if(rows.length===expected)return rows;
   if(!data.length||rows.length>expected)throw Error('The cloud list was incomplete. Please try again.');
  }
 }
 function csvCell(value){
  let text=typeof value==='object'&&value!==null?JSON.stringify(value):String(value??'');
  // Prevent spreadsheet formulas, including values preceded by whitespace/control characters.
  if(/^[\s\u0000-\u001f]*[=+\-@]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;
  return '"'+text.replaceAll('"','""')+'"';
 }
 function file(rows,format,now=new Date()){
  if(!['csv','json'].includes(format))throw Error('Choose CSV or JSON.');
  const records=rows.map(clean),date=now.toISOString();
  const body=format==='json'?JSON.stringify({format:'vale-connect-cloud-connections',version:1,environment:'development',exported_at:date,count:records.length,connections:records},null,2):'\ufeff'+[columns.map(csvCell).join(','),...records.map(r=>columns.map(k=>csvCell(r[k])).join(','))].join('\r\n')+'\r\n';
  return {body,type:format==='json'?'application/json;charset=utf-8':'text/csv;charset=utf-8',name:'vale-dev-cloud-connections-'+date.replace(/[:.]/g,'-')+'.'+format,count:records.length};
 }
 function download(result){
  const url=URL.createObjectURL(new Blob([result.body],{type:result.type})),a=document.createElement('a');a.href=url;a.download=result.name;document.body.append(a);
  try{a.click()}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000)}
 }
 const api={columns,fetchAll,file,download};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValeConnectionExport=api;
})(typeof window!=='undefined'?window:globalThis);
