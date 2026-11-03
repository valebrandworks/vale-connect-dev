/* Complete owner-filtered reads; never return a silently truncated page. */
(function(root){
 'use strict';
 async function read(client,table,owner,valid=()=>true){
  if(!['connections','public_cards'].includes(table)||!owner)throw Error('Sign in before loading your account list.');
  const rows=[],seen=new Set();let expected=null;
  for(;;){
   if(!valid())throw Error('Account changed. List request cancelled.');
   const {data,error,count}=await client.from(table).select('*',{count:'exact'}).eq('owner_id',owner).order('id',{ascending:true}).range(rows.length,rows.length+499);
   if(!valid())throw Error('Account changed. List request cancelled.');if(error)throw error;
   if(!Array.isArray(data)||!Number.isSafeInteger(count)||count<0)throw Error('Could not verify the complete list. Please refresh.');
   if(expected===null)expected=count;if(count!==expected)throw Error('Your saved list changed while loading. Please refresh.');
   for(const row of data){if(row.owner_id!==owner||!row.id||seen.has(row.id))throw Error('Could not verify the complete list. Please refresh.');seen.add(row.id);rows.push(row)}
   if(rows.length===expected)return rows;
   if(!data.length||rows.length>expected)throw Error('The saved list was incomplete. Please refresh.');
  }
 }
 const api={read};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValeAccountLists=api;
})(typeof window!=='undefined'?window:globalThis);
