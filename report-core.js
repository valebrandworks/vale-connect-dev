/* "Report this card": rules and wording for the report page. No page or network access here.
   Every rule is enforced again on the server (report-card Edge Function and submit_card_report); these checks only
   help people fix mistakes before sending. */
(function(root){
 'use strict';
 const FUNCTION_URL='https://jlprxnmdvoloahssjlnu.supabase.co/functions/v1/report-card';
 // Turnstile site keys are public. On this computer, Cloudflare's published test key lets the page be checked;
 // the server never accepts its tokens. Any other address gets no form.
 const SITE_KEYS={'dev.valebrandworks.com':'0x4AAAAAAF5bZ3cludhKsLJJ','localhost':'1x00000000000000000000AA','127.0.0.1':'1x00000000000000000000AA'};
 const LIMITS={details:1000,email:254};
 // The approved categories, in the order shown, with a short explanation each.
 const CATEGORIES=[
  ['impersonation','Impersonation or fake identity','Pretends to be someone else, or a business it isn’t.'],
  ['scam','Scam or fraud','Asks for money, payment details or passwords, or misleads people.'],
  ['spam','Spam','Unwanted advertising, or links to spam.'],
  ['harassment','Harassment or hate','Threatens, bullies or attacks people or groups.'],
  ['sexual_violent','Sexual or violent content','Sexual, graphic or violent images or text.'],
  ['personal_info','Someone’s personal information','Shares a person’s private details without their permission.'],
  ['ip','Copyright or trademark','Uses someone else’s work, logo or brand without permission.'],
  ['other','Something else','Breaks VALE Connect’s rules in another way.'],
 ];
 const CATEGORY_KEYS=CATEGORIES.map(([key])=>key);
 const SLUG=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
 const text=v=>String(v??'').replace(/[\u0000-\u001f\u007f]/g,' ').trim();
 // Explanations keep their line breaks; only other control characters are removed.
 const longText=v=>String(v??'').replace(/\r\n?/g,'\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g,' ').trim();
 const siteKey=hostname=>Object.hasOwn(SITE_KEYS,hostname)?SITE_KEYS[hostname]:null;
 const slugOk=slug=>typeof slug==='string'&&slug.length>=3&&slug.length<=60&&SLUG.test(slug);
 const emailOk=v=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);

 // Returns the cleaned values and any problems, keyed by field.
 function check(values){
  const errors={},category=String(values.category||''),details=longText(values.details),email=text(values.email);
  if(!CATEGORY_KEYS.includes(category))errors.category='Choose what’s wrong with this card.';
  if(details.length>LIMITS.details)errors.details='Use '+LIMITS.details.toLocaleString('en-US')+' characters or fewer.';
  if(email&&(email.length>LIMITS.email||!emailOk(email)))errors.email='Enter an email address like name@example.com, or leave it empty.';
  if(values.attested!==true)errors.attested='Tick this box to confirm before sending.';
  return {category,details,email,errors};
 }
 function payload({slug,submissionId,token,category,details,email}){
  return {card:slug,submission_id:submissionId,category,details:longText(details),email:text(email),attested:true,turnstile_token:token};
 }
 // Reports never send a sign-in, even when someone is signed in.
 function request(body){return {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}}
 // What to tell the person. Every accepted report gets the same answer.
 function outcome(status){
  switch(status){
   case 'received':return {tone:'ok',done:true,text:'Thanks. We’ve received your report and will review it.'};
   case 'invalid':return {tone:'error',text:'Some details weren’t accepted. Check them and try again.'};
   case 'verification_failed':return {tone:'error',resetCheck:true,text:'The security check didn’t go through. Complete it again, then send.'};
   case 'too_large':return {tone:'error',text:'Your explanation is too long. Shorten it and try again.'};
   case 'network':return {tone:'error',retry:true,text:'Couldn’t send. Check your connection and try again.'};
   default:return {tone:'error',text:'Reporting isn’t available right now. Please try again later, or email support@valebrandworks.com.'};
  }
 }
 const counter=value=>longText(value).length.toLocaleString('en-US')+' / '+LIMITS.details.toLocaleString('en-US');

 const api={FUNCTION_URL,LIMITS,CATEGORIES,CATEGORY_KEYS,siteKey,slugOk,check,payload,request,outcome,counter};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValeReportCore=api;
})(typeof window!=='undefined'?window:globalThis);
