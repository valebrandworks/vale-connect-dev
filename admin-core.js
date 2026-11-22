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
 const ACTION_LABELS={status:'Status changed',note:'Note',hide_card:'Card hidden',restore_card:'Restriction lifted',
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
  restore:{label:'Lift restriction',noteLabel:'Why is the restriction being lifted?',
   confirm:'Lift the restriction on this card? It stays private until its owner chooses to publish it again. They’ll be told it can be published.'},
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
  return report.card_published?'Public':'Private (not public until its owner publishes it)';
 }
 function historyLine(entry){
  const label=has(ACTION_LABELS,entry?.action)?ACTION_LABELS[entry.action]:'Action';
  const change=entry?.action==='status'&&entry.from_status&&entry.to_status?': '+statusLabel(entry.from_status)+' → '+statusLabel(entry.to_status):'';
  return {title:label+change,note:clean(entry?.note),by:clean(entry?.admin_email)||'A former admin',when:when(entry?.created_at)};
 }

 // Sign-up overview (counts only; the database function returns no addresses). Resend Free allows 100 emails a day, so a few
 // plain thresholds turn the numbers into notes. "Emails seen" is a lower bound: Auth keeps only each account's latest send time.
 const EMAIL_NOTE_AT=60,EMAIL_WARN_AT=80,EMAIL_DAILY_LIMIT=100;
 function overview(data){
  const o=data&&typeof data==='object'?data:{},n=o.now&&typeof o.now==='object'?o.now:{};
  const num=v=>Number.isFinite(Number(v))?Number(v):0;
  const pair=kind=>num(n[kind+'_accepted'])+' / '+num(n[kind+'_refused']);   // share_… and report_… columns
  const sent=num(n.confirmation_emails_seen)+num(n.recovery_emails_seen);
  const notes=[];
  if(sent>=EMAIL_WARN_AT)notes.push({level:'warn',text:'About '+sent+' sign-up and reset emails were seen today. The free email plan allows '+EMAIL_DAILY_LIMIT+' a day (shared with testing and report alerts); new people may not receive their email once it is used up.'});
  else if(sent>=EMAIL_NOTE_AT)notes.push({level:'note',text:'About '+sent+' sign-up and reset emails were seen today, of '+EMAIL_DAILY_LIMIT+' allowed a day on the free email plan.'});
  if(num(n.hook_errors)>0)notes.push({level:'warn',text:'The new-account email filter had '+num(n.hook_errors)+' internal error(s) today. Sign-ups were allowed through. Ask for it to be checked.'});
  if(num(n.purge_candidates)>0)notes.push({level:'note',text:num(n.purge_candidates)+' sign-up(s) were never confirmed and are over 7 days old. Nothing is deleted automatically yet.'});
  const rows=[['New accounts today',num(n.new_users)],['Confirmed accounts',num(n.confirmed_users)],['Waiting for confirmation',num(n.unconfirmed_pending)],
   ['Confirmation emails seen today',num(n.confirmation_emails_seen)],['Reset emails seen today',num(n.recovery_emails_seen)],['Sign-ups refused by the email filter today',num(n.hook_blocked)],
   ['Shares accepted / refused today',pair('share')],['Reports accepted / refused today',pair('report')]];
  const history=(Array.isArray(o.history)?o.history:[]).slice(0,14).map(h=>({day:clean(h.day),text:num(h.new_users)+' new, '+(num(h.confirmation_emails_seen)+num(h.recovery_emails_seen))+' emails seen, '+num(h.hook_blocked)+' refused'}));
  const filter=(Array.isArray(o.hook_recent)?o.hook_recent:[]).slice(0,10).map(h=>({when:when(h.at),text:h.kind==='blocked'?'Refused a new account from '+clean(h.domain):'Internal error (sign-up allowed)'}));
  const runs=(Array.isArray(o.purge_runs)?o.purge_runs:[]).slice(0,5).map(r=>({when:when(r.ran_at),text:(r.kind==='purge_applied'?'Deleted '+num(r.deleted)+' of '+num(r.candidates):'Dry run: '+num(r.candidates)+' would be deleted')+' (older than '+num(r.days)+' days)'}));
  return {rows,notes,history,filter,runs};
 }
 const api={LIMITS,IDLE_MINUTES,overview,EMAIL_NOTE_AT,EMAIL_WARN_AT,SUPPORT_EMAIL,CATEGORY_LABELS,STATUSES,FILTERS,ACTION_LABELS,ACTIONS,CARD_FIELDS,
  categoryLabel,statusLabel,filterOk,isOpen,gate,mfaStep,codeOk,checkNote,checkOwnerMessage,actions,call,errorText,when,cardRows,cardState,historyLine};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValeAdminCore=api;
})(typeof window!=='undefined'?window:globalThis);
