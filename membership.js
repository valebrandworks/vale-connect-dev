/* The signed-in account's plan and usage. Limits come from the database, never from this file. */
(()=>{
 'use strict';
 const targets=['account-usage'];
 let client=null,user=null,request=0,features=null,usage=null;
 const announce=()=>{if(typeof CustomEvent==='function')window.dispatchEvent?.(new CustomEvent('vale-usage-updated'))};
 const show=text=>{for(const id of targets){const el=document.getElementById(id);if(el)el.textContent=text}};
 const number=n=>Number(n).toLocaleString('en-US');
 // Plain account summary. Card counts appear only on plans with more than one card.
 function describe(u){
  const parts=[`${u.plan_name} membership`];
  if(u.max_cards===null||Number(u.max_cards)>1)parts.push(u.max_cards===null?`${number(u.card_count)} cards`:`${number(u.card_count)} of ${number(u.max_cards)} cards`);
  parts.push(u.max_active_connections===null?`${number(u.active_connection_count)} connections`:`${number(u.active_connection_count)} of ${number(u.max_active_connections)} connections`);
  if(Number(u.archived_connection_count)>0)parts.push(`${number(u.archived_connection_count)} archived`);
  return parts.join(' · ');
 }
 // A notice only when close to a limit; nothing otherwise.
 function nearLimit(u){
  if(!u||u.max_active_connections===null)return '';
  const max=Number(u.max_active_connections),used=Number(u.active_connection_count);
  if(used>=max)return `You’ve reached ${number(max)} active connections. Archive people you no longer need to add new ones. Archived connections keep their notes.`;
  if(used>=Math.floor(max*0.9))return `You have ${number(used)} of ${number(max)} active connections. Archiving people you no longer need frees up space.`;
  return '';
 }
 async function refresh(){
  const current=++request;
  if(!client||!user){features=null;usage=null;show('');announce();return}
  try{
   const [{data,error},plan]=await Promise.all([client.rpc('get_my_usage'),client.rpc('get_my_features')]);
   if(current!==request)return;
   features=Array.isArray(plan?.data)?plan.data:null;usage=!error&&data?.[0]?{...data[0]}:null;
   show(usage?describe(usage):'');announce();
  }catch{if(current===request){usage=null;show('')}}
 }
 // Unknown until loaded. This only shapes the screens; the database enforces the rules.
 window.ValeUsage={refresh,describe,nearLimit,usage:()=>usage?{...usage}:null,has:feature=>features?features.includes(feature):undefined};
 window.addEventListener('vale-account-ready',event=>{
  const next=event.detail;if(user?.id===next.user?.id&&client===next.client)return;
  client=next.client;user=next.user;usage=null;features=null;void refresh();
 });
})();
