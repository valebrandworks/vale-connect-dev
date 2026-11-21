/* Private report review: rules and wording for admin.html. No page or network access here.
   The database is the authority. Every admin function checks, on the server, that the caller is a listed platform
   admin signed in with two-step verification (vale_private.require_admin), and checks every note and message again.
   These helpers only decide what the page shows and help admins fix mistakes before sending. */
(function(root){
 'use strict';
 const reportCore=root.ValeReportCore||(typeof require==='function'?require('./report-core.js'):null);
 const LIMITS={note:2000,ownerMessage:500,page:50};
 const IDLE_MINUTES=15;
 const SUPPORT_EMAIL='support@valebrandworks.com';
 const CATEGORY_LABELS=Object.fromEntries((reportCore?.CATEGORIES||[]).map(([key,label])=>[key,label]));
 const STATUSES=[['new','New'],['reviewing','Reviewing'],['action_taken','Action taken'],['dismissed','Dismissed']];
 const STATUS_LABELS=Object.fromEntries(STATUSES);
 // Filters for the list. "All" shows open reports first, oldest first (the database's order).
 const FILTERS=[['','All'],...STATUSES];
 const ACTION_LABELS={status:'Status changed',note:'Note',hide_card:'Card hidden',restore_card:'Card restored',
  legal_hold:'Legal hold placed',release_hold:'Legal hold released',block_reporter:'Reporting network blocked',unblock_reporter:'Reporting network unblocked'};
 const CARD_FIELDS=[['display_name','Name'],['job_title','Title'],['business_name','Business'],['introduction','Introduction'],
  ['public_email','Email'],['public_phone','Phone'],['website','Website']];

 const has=(map,key)=>typeof key==='string'&&Object.hasOwn(map,key);
 const categoryLabel=key=>has(CATEGORY_LABELS,key)?CATEGORY_LABELS[key]:'Unknown reason';
 const statusLabel=key=>has(STATUS_LABELS,key)?STATUS_LABELS[key]:'Unknown';
 const filterOk=key=>FILTERS.some(([k])=>k===key);
 const clean=v=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
 const isOpen=report=>report?.status==='new'||report?.status==='reviewing';

 // Which step the page is at, from the answer to a first, harmless admin request.
 // Only a listed admin ever gets "mfa_required"; everyone else gets the same refusal, so the page reveals nothing.
 function gate(error){
  if(!error)return 'ok';
  if(error.code==='42501'&&error.hint==='mfa_required')return 'mfa';
  if(error.code==='42501'||error.code==='PGRST301'||/jwt|not authorized|permission denied/i.test(String(error.message||'')))return 'denied';
  return 'error';
 }
 // Two-step sign-in state, from Supabase Auth: enrolled and verified, or not yet set up.
 function mfaStep({currentLevel,nextLevel}={},verifiedFactors=[]){
  if(currentLevel==='aal2')return 'ok';
  if(nextLevel==='aal2'||verifiedFactors.length)return 'challenge';
  return 'enroll';
 }
 const codeOk=code=>/^\d{6}$/.test(String(code||'').replace(/\s+/g,''));

 // Notes are kept in the audit trail. Decisions need one; the database refuses them without it.
 function checkNote(value,required=true){
  const v=clean(value);
  if(required&&!v)return {value:v,error:'Add a short note explaining the decision. It’s kept in the audit trail.'};
  if(v.length>LIMITS.note)return {value:v,error:'Keep the note under '+LIMITS.note.toLocaleString('en-US')+' characters.'};
  return {value:v,error:''};
 }
 function checkOwnerMessage(value){
  const v=clean(value);
  if(!v)return {value:v,error:'Write the explanation the card’s owner will see.'};
  if(v.length>LIMITS.ownerMessage)return {value:v,error:'Keep the owner’s explanation to '+LIMITS.ownerMessage+' characters or fewer.'};
  return {value:v,error:''};
 }

 // What an admin can do with a report right now. The database checks each one again.
 function actions(report){
  if(!report)return [];
  const out=[];
  if(report.status==='new')out.push('reviewing');
  if(isOpen(report))out.push('dismissed','action_taken');else out.push('reopen');
  if(report.card_hidden)out.push('restore');else if(report.card_id&&report.card_current)out.push('hide');
  out.push(report.legal_hold?'release_hold':'legal_hold');
  out.push(report.reporter_blocked?'unblock':'block');
  out.push('note');
  return out;
 }
 // The exact database call for each action. Notes are required for all of them.
 function call(action,report,{note='',ownerMessage=''}={}){
  const id=report.id;
  switch(action){
   case 'reviewing':return ['admin_set_report_status',{p_report_id:id,p_status:'reviewing',p_note:note}];
   case 'reopen':return ['admin_set_report_status',{p_report_id:id,p_status:'reviewing',p_note:note}];
   case 'dismissed':return ['admin_set_report_status',{p_report_id:id,p_status:'dismissed',p_note:note}];
   case 'action_taken':return ['admin_set_report_status',{p_report_id:id,p_status:'action_taken',p_note:note}];
   case 'hide':return ['admin_hide_card',{p_report_id:id,p_owner_message:ownerMessage,p_note:note}];
   case 'restore':return ['admin_restore_card',{p_card_id:report.card_id,p_note:note}];
   case 'legal_hold':return ['admin_set_legal_hold',{p_report_id:id,p_hold:true,p_note:note}];
   case 'release_hold':return ['admin_set_legal_hold',{p_report_id:id,p_hold:false,p_note:note}];
   case 'block':return ['admin_block_reporter',{p_report_id:id,p_block:true,p_note:note}];
   case 'unblock':return ['admin_block_reporter',{p_report_id:id,p_block:false,p_note:note}];
   case 'note':return ['admin_add_note',{p_report_id:id,p_note:note}];
   default:throw new Error('Unknown action');
  }
 }
 // Button wording, what the form asks for, and the confirmation shown before anything is sent.
 const ACTIONS={
  reviewing:{label:'Mark as reviewing',noteLabel:'Note (optional)',optional:true,confirm:null},
  reopen:{label:'Reopen',noteLabel:'Why reopen this report?',confirm:'Reopen this report? The reporter’s email was deleted when it closed and can’t be recovered.'},
  dismissed:{label:'Dismiss',noteLabel:'Why is no action needed?',confirm:'Dismiss this report? It closes, and the reporter’s email (if any) is deleted.'},
  action_taken:{label:'Close as action taken',noteLabel:'What action was taken?',confirm:'Close this report as action taken, without hiding the card? The reporter’s email (if any) is deleted.'},
  hide:{label:'Hide card',noteLabel:'Internal note (why it’s hidden)',owner:true,danger:true,
   confirm:'Hide this card? It disappears from its link and QR code at once, its owner can’t publish it again, and they’ll see your explanation and how to appeal. The report closes as action taken.'},
  restore:{label:'Restore card',noteLabel:'Why is it being restored?',confirm:'Restore this card? It becomes public again at once, and its owner is told.'},
  legal_hold:{label:'Place legal hold',noteLabel:'Why must this be kept?',confirm:'Place a legal hold? This report and its history won’t be deleted on schedule until the hold is released.'},
  release_hold:{label:'Release legal hold',noteLabel:'Why is the hold no longer needed?',confirm:'Release the legal hold? The report will then follow the normal deletion schedule.'},
  block:{label:'Block reporting network',noteLabel:'Why block it? (for example, repeated false reports)',danger:true,
   confirm:'Block this report’s network? Future reports from it will be quietly not stored for a year. You never see the network itself.'},
  unblock:{label:'Unblock reporting network',noteLabel:'Why unblock it?',confirm:'Unblock this report’s network?'},
  note:{label:'Add note',noteLabel:'Note',confirm:null},
 };

 // Plain messages for database answers. Admin functions raise short, readable messages; anything else is generic.
 function errorText(error){
  const g=gate(error);
  if(g==='mfa')return 'Your two-step sign-in has expired. Enter a code from your authenticator app again.';
  if(g==='denied')return 'This action isn’t available for your account.';
  const m=clean(error?.message);
  if(/failed to fetch|network|load failed/i.test(m))return 'Couldn’t reach the server. Check your connection and try again. Nothing was changed.';
  if(error?.code==='P0001'&&m&&m.length<=200)return m;
  return 'Something went wrong. Nothing was changed. Please try again.';
 }

 function when(value){
  const d=new Date(value);if(!value||Number.isNaN(d.getTime()))return '';
  return d.toLocaleString('en-US',{year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 }
 // The card as reported, its current details, and what changed since. Only public card fields ever reach the page.
 function cardRows(report){
  const was=report?.card_snapshot||{},now=report?.card_current||null;
  return CARD_FIELDS.filter(([k])=>clean(was[k])||clean(now?.[k])).map(([k,label])=>({label,reported:clean(was[k]),current:now?clean(now[k]):null,changed:!!now&&clean(was[k])!==clean(now[k])}));
 }
 function cardState(report){
  if(!report?.card_id||!report.card_current)return 'Deleted by its owner';
  if(report.card_hidden)return 'Hidden after review';
  return report.card_published?'Public':'Private (its owner unpublished it)';
 }
 function historyLine(entry){
  const label=has(ACTION_LABELS,entry?.action)?ACTION_LABELS[entry.action]:'Action';
  const change=entry?.action==='status'&&entry.from_status&&entry.to_status?': '+statusLabel(entry.from_status)+' → '+statusLabel(entry.to_status):'';
  return {title:label+change,note:clean(entry?.note),by:clean(entry?.admin_email)||'A former admin',when:when(entry?.created_at)};
 }

 const api={LIMITS,IDLE_MINUTES,SUPPORT_EMAIL,CATEGORY_LABELS,STATUSES,FILTERS,ACTION_LABELS,ACTIONS,CARD_FIELDS,
  categoryLabel,statusLabel,filterOk,isOpen,gate,mfaStep,codeOk,checkNote,checkOwnerMessage,actions,call,errorText,when,cardRows,cardState,historyLine};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValeAdminCore=api;
})(typeof window!=='undefined'?window:globalThis);
