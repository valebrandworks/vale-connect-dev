/* Shows the signed-in account's plan and usage. Limits come from the database, never from this file. */
(()=>{
 'use strict';
 const targets=['usage-overview','cards-usage','cloud-contacts-usage','account-usage'];
 let client=null,user=null,request=0;
 const show=text=>{for(const id of targets){const el=document.getElementById(id);if(el)el.textContent=text}};
 const part=(used,max,noun)=>max===null?`${used} ${noun} (unlimited)`:`${used} of ${max} ${noun}`;
 function describe(u){
  const parts=[`${u.plan_name} plan`,part(u.card_count,u.max_cards,'cards'),part(u.active_connection_count,u.max_active_connections,'active connections')];
  if(Number(u.archived_connection_count)>0)parts.push(`${u.archived_connection_count} archived`);
  const full=[];
  if(u.max_cards!==null&&Number(u.card_count)>=u.max_cards)full.push('cards');
  if(u.max_active_connections!==null&&Number(u.active_connection_count)>=u.max_active_connections)full.push('active connections');
  return parts.join(' · ')+(full.length?` — you've reached your ${full.join(' and ')} limit; existing items stay available.`:'');
 }
 async function refresh(){
  const current=++request;
  if(!client||!user){show('');return}
  try{
   const {data,error}=await client.rpc('get_my_usage');
   if(current!==request)return;
   if(error||!data?.[0]){show('');return}
   show(describe(data[0]));
  }catch{if(current===request)show('')}
 }
 window.ValeUsage={refresh,describe};
 window.addEventListener('vale-account-ready',event=>{
  const next=event.detail;if(user?.id===next.user?.id&&client===next.client)return;
  client=next.client;user=next.user;void refresh();
 });
})();
