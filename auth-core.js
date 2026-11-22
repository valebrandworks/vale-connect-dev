/* Account sign-in rules and wording. No page or network access here.
   The server (Supabase Auth) is the authority: its minimum password length, email confirmation and bot protection
   apply whatever the page does. These checks only help people fix mistakes before sending. */
(function(root){
 'use strict';
 const PASSWORD_MIN=10;                         // the same minimum as the server's setting
 const PASSWORD_MAX_BYTES=72;                    // Supabase Auth hashes with bcrypt, which uses at most 72 bytes (verified on development before release)
 const byteLength=v=>typeof TextEncoder==='function'?new TextEncoder().encode(String(v||'')).length:String(v||'').length;
 const AGREEMENT_VERSION='2026-11-v1';
 const PRIVACY_URL='privacy.html';
 const TERMS_URL=null;                           // set to 'terms.html' when the Terms of Service are published
 // Public settings for this web address (config.js). Not a security boundary: the server checks everything again.
 const config=root.ValeConfig||(typeof require==='function'?require('./config.js'):null);
 const siteKey=host=>config?.forHost(host)?.turnstileSiteKey||null;
 const emailOk=v=>/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v||'').trim());

 // The agreement shown at sign-up. Terms are added automatically once TERMS_URL is set.
 function agreement(termsUrl=TERMS_URL){
  return termsUrl
   ?{parts:['I agree to the ',{text:'Terms of Service',href:termsUrl},' and have read the ',{text:'Privacy Policy',href:PRIVACY_URL},'.'],version:AGREEMENT_VERSION,terms:true}
   :{parts:['I have read and accept the ',{text:'Privacy Policy',href:PRIVACY_URL},'.'],version:AGREEMENT_VERSION,terms:false};
 }

 function checkSignIn({email,password}){
  if(!emailOk(email))return 'Enter your email address.';
  if(!password)return 'Enter your password.';        // no length rule: older, shorter passwords still sign in
  return '';
 }
 function checkNewPassword(password,confirm,{current='',requireCurrent=false}={}){
  if(requireCurrent&&!current)return 'Enter your current password.';
  if(String(password||'').length<PASSWORD_MIN)return 'Use at least '+PASSWORD_MIN+' characters for your password.';
  if(byteLength(password)>PASSWORD_MAX_BYTES)return TOO_LONG;
  if(password!==confirm)return 'Those passwords don’t match.';
  if(requireCurrent&&password===current)return 'Choose a different password from your current one.';
  return '';
 }
 function checkSignUp({email,password,confirm,agreed}){
  if(!emailOk(email))return 'Enter your email address.';
  const bad=checkNewPassword(password,confirm);if(bad)return bad;
  if(!agreed)return 'Tick the box to accept the Privacy Policy.';
  return '';
 }

 // Plain-language messages for answers from Supabase Auth. Never reveals whether an email has an account.
 function message(error,context='signin'){
  const m=String(error?.message||error||'').toLowerCase(),code=String(error?.code||'').toLowerCase(),reasons=Array.isArray(error?.reasons)?error.reasons.map(r=>String(r).toLowerCase()):[];
  if(!m&&!code)return '';
  if(/captcha/.test(m+code))return 'The security check didn’t go through. Complete it again, then try again.';
  if(/rate limit|too many|seconds|over_request|over_email/.test(m+code))return 'Too many attempts. Please wait a few minutes and try again.';
  if(/failed to fetch|network|load failed|fetch/.test(m))return 'VALE Connect couldn’t reach its sign-in service. Check your connection and try again.';
  if(/signups? not allowed|signup.*disabled|signup_disabled/.test(m+code))return 'New accounts aren’t open yet. Please check back soon.';
  if(/email not confirmed|email_not_confirmed/.test(m+code))return 'Confirm your email address first. We can send the link again.';
  // Supabase uses the code weak_password for several reasons; the reasons (or the wording) tell them apart.
  // The server's own codes for the current-password rule (checked on development): required = none was sent, invalid = it was wrong (both carry the same English text).
  if(code==='current_password_required')return 'Enter your current password.';
  if(code==='current_password_invalid')return 'Your current password wasn’t accepted. Check it and try again.';
  if(reasons.includes('pwned')||/pwned|leaked|compromised|breach|known to be weak/.test(m))return 'That password has appeared in a data breach. Choose a different one.';
  if(reasons.includes('length')||(/password/.test(m)&&/(at least|short|too short)/.test(m)))return 'Use at least '+PASSWORD_MIN+' characters for your password.';
  if(/too long|longer than|72|maximum.*(character|length)/.test(m)&&/password/.test(m))return TOO_LONG;
  if(/same_password|different from the old|different password|should be different/.test(m+code))return 'That’s the password you already use. Choose a different one.';
  if(/reauthentication_needed|reauthentication/.test(m+code))return 'For your security, sign out and sign in again, then change your password.';
  if(context==='password'&&/invalid.*(credential|password)|incorrect|current password|not valid|wrong/.test(m+code))return 'Your current password wasn’t accepted. Check it and try again.';
  if(code==='weak_password'||/weak/.test(m))return 'Choose a stronger password.';
  if(context==='signup'&&/isn['’]t supported for new accounts|email provider/.test(m))return 'That email provider isn’t supported for new accounts. Please use a different email address.';
  if((context==='signup'||context==='resend')&&/error sending|sending (confirmation|recovery|email)|unexpected_failure|smtp/.test(m+code))return EMAIL_TROUBLE;
  if(context==='signin'&&/invalid login|invalid credentials|invalid_credentials/.test(m+code))return 'That email and password don’t match. Check them and try again, or reset your password.';
  if(context==='signup'&&/already|registered|exists/.test(m))return CHECK_EMAIL;
  return 'Something went wrong. Please try again.';
 }
 const CHECK_EMAIL='Check your email for a confirmation link, then come back and sign in.';
 // The server's limit is 72 BYTES (verified on development): 72 plain letters, or fewer when the password has accented or non-Latin characters.
 const TOO_LONG='That password is too long. Use 72 letters or numbers at most (fewer if it has accented or non-Latin characters).';
 const OTHERS_SIGNED_OUT='Password changed. Your other devices were signed out. A page already open on another device can keep working for up to an hour.';
 const OTHERS_NOT_SIGNED_OUT='Password changed, but we couldn’t sign out your other devices. If someone else may know your old password, sign out on those devices yourself.';
 const EMAIL_TROUBLE='We couldn’t send the email just now. Please try again in a little while.';
 const RESET_SENT='If that email has an account, a reset link is on its way. Check your inbox and spam folder. If nothing arrives in a few minutes, try again later.';
 const RESENT='If that email is waiting for confirmation, a new link is on its way.';

 const api={PASSWORD_MIN,PASSWORD_MAX_BYTES,TOO_LONG,OTHERS_SIGNED_OUT,OTHERS_NOT_SIGNED_OUT,EMAIL_TROUBLE,AGREEMENT_VERSION,PRIVACY_URL,TERMS_URL,CHECK_EMAIL,RESET_SENT,RESENT,siteKey,emailOk,agreement,checkSignIn,checkNewPassword,checkSignUp,message};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValeAuthCore=api;
})(typeof window!=='undefined'?window:globalThis);
