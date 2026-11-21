/* Cards hidden after a review, and restrictions lifted: what their owner is told. No page or network access here.
   The owner sees the reason, the explanation written for them, when it happened and how to appeal. They are never
   told who reported the card or anything else about the report. The database keeps a hidden card unpublished. */
(function(root){
 'use strict';
 const SUPPORT_EMAIL='support@valebrandworks.com';
 // The report reasons, as the owner sees them (the same names as on the report page).
 const REASONS={impersonation:'Impersonation or fake identity',scam:'Scam or fraud',spam:'Spam',harassment:'Harassment or hate',
  sexual_violent:'Sexual or violent content',personal_info:'Someone’s personal information',ip:'Copyright or trademark',other:'Something else'};
 const reason=key=>typeof key==='string'&&Object.hasOwn(REASONS,key)?REASONS[key]:'A breach of VALE Connect’s rules';
 const clean=v=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
 function date(value){const d=new Date(value);return !value||Number.isNaN(d.getTime())?'':d.toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})}
 // An email to support with the card's link name in the subject. Nothing else is filled in.
 function appealHref(slug){return 'mailto:'+SUPPORT_EMAIL+'?subject='+encodeURIComponent('Appeal: hidden card '+clean(slug))}

 function notice(hold,card){
  const on=date(hold?.hidden_at);
  return {
   title:'This card was hidden after a review',
   reason:'Reason: '+reason(hold?.category)+'.',
   message:clean(hold?.owner_message),
   effect:(on?'Since '+on+', ':'')+'people who open its link or QR code see that it isn’t available, and it can’t be published. You can still edit it, download it, or delete it.',
   appeal:'If you think this was a mistake, you can appeal. Email '+SUPPORT_EMAIL+' from the address you sign in with, include the card’s link name ('+clean(card?.slug)+') and explain why it should be restored. A person will review your appeal and reply.',
   appealHref:appealHref(card?.slug),
  };
 }
 // After an admin lifts a restriction the card stays private; its owner is told it can be published again.
 function lifted(){
  return {title:'Restriction lifted',
   text:'After a review, the restriction on this card has been lifted. It’s still private: nobody can see it until you publish it again. Check it, then choose Review and publish when you’re ready.'};
 }
 // Unread "restriction lifted" notices, by card: card id → notice ids (to mark them read).
 const liftedByCard=rows=>{const m=new Map();for(const n of Array.isArray(rows)?rows:[])if(n&&n.kind==='card_restored'&&!n.read_at&&typeof n.card_id==='string'&&typeof n.id==='string')(m.get(n.card_id)||m.set(n.card_id,[]).get(n.card_id)).push(n.id);return m};
 const byCard=rows=>new Map((Array.isArray(rows)?rows:[]).filter(h=>h&&typeof h.card_id==='string').map(h=>[h.card_id,h]));

 const api={SUPPORT_EMAIL,REASONS,reason,appealHref,notice,lifted,liftedByCard,byCard};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValeCardHolds=api;
})(typeof window!=='undefined'?window:globalThis);
