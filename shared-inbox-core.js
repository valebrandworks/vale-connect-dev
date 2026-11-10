/* "Shared with you": turns the owner's own share records and notifications into what the Connections tab shows.
   No page or network access here. Owners only ever read their own rows (database rules), and every action
   runs through the database's own functions. */
(function(root){
 'use strict';
 const FIELDS=[['business_name','Company'],['job_title','Title'],['email','Email'],['phone','Phone'],['website','Website'],['social_links','Links']];
 const text=v=>String(v??'').trim();

 function when(iso,now=new Date()){
  const t=new Date(iso);if(Number.isNaN(t.getTime()))return '';
  const mins=Math.round((now-t)/60000);
  if(mins<1)return 'Just now';if(mins<60)return mins+(mins===1?' minute ago':' minutes ago');
  const hours=Math.round(mins/60);if(hours<24)return hours+(hours===1?' hour ago':' hours ago');
  const days=Math.round(hours/24);if(days===1)return 'Yesterday';if(days<7)return days+' days ago';
  return t.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:t.getFullYear()===now.getFullYear()?undefined:'numeric'});
 }

 // One item per share, newest first. "unread" comes from the owner's notifications for that share.
 function items(shares,notifications,{connections=[],cards=[],now=new Date()}={}){
  const unreadByShare=new Map(),mutualShares=new Set();
  for(const n of notifications||[]){if(!n.share_id)continue;if(!n.read_at)(unreadByShare.get(n.share_id)||unreadByShare.set(n.share_id,[]).get(n.share_id)).push(n.id);if(n.kind==='mutual')mutualShares.add(n.share_id)}
  const connectionById=new Map((connections||[]).map(c=>[c.id,c])),cardById=new Map((cards||[]).map(c=>[c.id,c])),manyCards=(cards||[]).length>1;
  return [...(shares||[])].sort((a,b)=>String(b.last_shared_at||b.created_at).localeCompare(String(a.last_shared_at||a.created_at))).map(s=>{
   const v=s.shared||{},connection=s.connection_id?connectionById.get(s.connection_id):null,card=cardById.get(s.card_id);
   const item={id:s.id,name:text(v.full_name)||'Someone',company:text(v.business_name),when:when(s.last_shared_at||s.created_at,now),
    via:manyCards&&card?(text(card.card_label)||text(card.display_name)):'',repeats:Math.max(1,Number(s.repeat_count)||1),
    note:text(s.note),details:FIELDS.map(([k,l])=>[l,text(v[k])]).filter(([,val])=>val).map(([l,val])=>[l,l==='Links'?(()=>{const n=val.split('\n').filter(x=>x.trim()).length;return n+(n===1?' link':' links')})():val]),
    unreadIds:unreadByShare.get(s.id)||[],mutual:mutualShares.has(s.id)||!!connection?.mutual,connectionId:s.connection_id||null,
    connectionArchived:!!connection?.archived_at,outcome:s.outcome,actions:[]};
   item.unread=item.unreadIds.length>0;
   switch(s.outcome){
    case 'added':item.status='Added to your connections.';if(item.connectionId)item.actions.push('open');break;
    case 'owner_added':item.status='You added this as a separate connection.';if(item.connectionId)item.actions.push('open');break;
    case 'duplicate':item.status='You may already have this person, so nothing was changed.';if(item.connectionId)item.actions.push('open-existing');item.actions.push('add-separate');break;
    case 'limit_reached':item.status='Not added: you’d reached your plan’s connection limit.';item.actions.push('add-separate');break;
    default:item.status='';
   }
   if(item.mutual)item.status+=' You’ve both shared your details.';
   return item;
  });
 }
 const unreadCount=list=>list.filter(i=>i.unread).length;
 const ACTION_LABELS={'open':'Open','open-existing':'Open existing','add-separate':'Add as separate connection'};
 const api={items,unreadCount,when,ACTION_LABELS};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValeSharedInboxCore=api;
})(typeof window!=='undefined'?window:globalThis);
