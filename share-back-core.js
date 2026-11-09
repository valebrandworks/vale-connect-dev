/* "Share your details back": rules and wording for the public card page. No page or network access here.
   Every rule is enforced again on the server (share-card Edge Function and record_share); these checks only help
   people fix mistakes before sending. */
(function(root){
 'use strict';
 const FUNCTION_URL='https://jlprxnmdvoloahssjlnu.supabase.co/functions/v1/share-card';
 const CONSENT_VERSION='2026-11-v1';
 // Turnstile site keys are public. On this computer, Cloudflare's published test key lets the page be checked;
 // the server never accepts its tokens. Any other address gets no form.
 const SITE_KEYS={'dev.valebrandworks.com':'0x4AAAAAAF5bZ3cludhKsLJJ','localhost':'1x00000000000000000000AA','127.0.0.1':'1x00000000000000000000AA'};
 const LIMITS={full_name:90,job_title:80,business_name:90,email:120,phone:40,website:300,note:300};
 // A member's own card: which column holds each field the server accepts, in the order shown.
 const MEMBER_FIELDS=[['full_name','display_name','Name'],['job_title','job_title','Title'],['business_name','business_name','Company'],['email','public_email','Email'],['phone','public_phone','Phone'],['website','website','Website'],['social_links','social_links','Social and other links']];
 const text=v=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
 const siteKey=hostname=>Object.hasOwn(SITE_KEYS,hostname)?SITE_KEYS[hostname]:null;
 const firstName=name=>text(name).split(/\s+/)[0]||'this person';
 const consentText=owner=>'By sharing, I agree to send my selected contact information to '+(text(owner)||'the card’s owner')+', who can save it in their private VALE Connect connections.';
 const emailOk=v=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
 const phoneOk=v=>/^[0-9+(). -]+$/.test(v)&&v.replace(/[^0-9]/g,'').length>=7;

 // Visitors type their details. Returns the fields to send and any problems, keyed by field.
 function checkVisitor(values){
  const fields={},errors={};
  for(const key of ['full_name','job_title','business_name','email','phone','website']){const v=text(values[key]);if(v)fields[key]=v;if(v.length>LIMITS[key])errors[key]='Use '+LIMITS[key]+' characters or fewer.'}
  if(!fields.full_name)errors.full_name='Enter your name.';
  if(fields.email&&!emailOk(fields.email))errors.email='Enter an email address like name@example.com.';
  if(fields.phone&&!phoneOk(fields.phone))errors.phone='Enter a phone number with at least 7 digits.';
  if(!fields.email&&!fields.phone&&!errors.email&&!errors.phone)errors.email='Add an email address or a phone number, so they can reach you.';
  const note=text(values.note);if(note.length>LIMITS.note)errors.note='Use 300 characters or fewer.';
  return {fields,note,errors};
 }
 // What a member could share from one of their own cards: only fields that have something in them.
 function memberOptions(card){return MEMBER_FIELDS.map(([key,column,label])=>({key,label,value:text(card?.[column])})).filter(o=>o.value)}
 function checkMember(selected){
  if(!selected.includes('full_name'))return 'Your name is always shared.';
  if(!selected.includes('email')&&!selected.includes('phone'))return 'Choose your email or phone, so they can reach you.';
  return '';
 }
 function payload({mode,slug,submissionId,token,fields,cardId,memberFields,note}){
  const base={mode,card:slug,submission_id:submissionId,consent:true,consent_version:CONSENT_VERSION,turnstile_token:token,note:text(note)};
  return mode==='member'?{...base,card_id:cardId,member_fields:[...memberFields]}:{...base,fields:{...fields}};
 }
 // Visitors send no sign-in at all; members send only their own session token.
 function request(body,accessToken){
  const headers={'Content-Type':'application/json'};
  if(body.mode==='member'&&accessToken)headers.Authorization='Bearer '+accessToken;
  return {method:'POST',headers,body:JSON.stringify(body)};
 }
 // What to tell the person for each answer. Never reveals whether the owner already had them.
 function outcome(status,owner){
  const who=firstName(owner);
  switch(status){
   case 'shared':return {tone:'ok',done:true,text:'Your details were sent to '+who+'.'};
   case 'invalid':return {tone:'error',text:'Some details weren’t accepted. Check them and try again.'};
   case 'verification_failed':return {tone:'error',resetCheck:true,text:'The security check didn’t go through. Complete it again, then share.'};
   case 'rate_limited':return {tone:'error',text:'Too many details have been shared from here recently. Please try again later.'};
   case 'unavailable':return {tone:'error',closed:true,text:who+' isn’t accepting shared details right now.'};
   case 'sign_in_required':return {tone:'error',text:'Your sign-in has expired. Sign in again, or type your details instead.'};
   case 'network':return {tone:'error',retry:true,text:'Couldn’t send. Check your connection and try again.'};
   default:return {tone:'error',text:'Sharing isn’t available right now. Please try again later.'};
  }
 }
 // Remembered on this device after a successful share, so a second tap shows a notice instead of sending again.
 // Holds only the date: no names or contact details.
 const markerKey=cardId=>'vale-shared-back:'+cardId;
 const markerValue=(now=new Date())=>now.toISOString().slice(0,10);

 const api={FUNCTION_URL,CONSENT_VERSION,LIMITS,siteKey,firstName,consentText,checkVisitor,memberOptions,checkMember,payload,request,outcome,markerKey,markerValue};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValeShareBackCore=api;
})(typeof window!=='undefined'?window:globalThis);
