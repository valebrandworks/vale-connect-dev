/* Account sign-in rules and wording. No page or network access here.
   The server (Supabase Auth) is the authority: its minimum password length, email confirmation and bot protection
   apply whatever the page does. These checks only help people fix mistakes before sending. */
(function(root){
 'use strict';
 const PASSWORD_MIN=10;                         // the same minimum as the server's setting
 const AGREEMENT_VERSION='2026-11-v1';
 const PRIVACY_URL='privacy.html';
 const TERMS_URL=null;                           // set to 'terms.html' when the Terms of Service are published
 // Turnstile site keys are public. On this computer, Cloudflare's published test key lets the page be checked; the
 // server never accepts its tokens. Other addresses get no check from the page (the server still requires one once
 // bot protection is on).
 const SITE_KEYS={'dev.valebrandworks.com':'0x4AAAAAAF5bZ3cludhKsLJJ','localhost':'1x00000000000000000000AA','127.0.0.1':'1x00000000000000000000AA'};
 const siteKey=host=>Object.hasOwn(SITE_KEYS,host)?SITE_KEYS[host]:null;
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
 function checkNewPassword(password,confirm){
  if(String(password||'').length<PASSWORD_MIN)return 'Use at least '+PASSWORD_MIN+' characters for your password.';
  if(password!==confirm)return 'Those passwords don’t match.';
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
  const m=String(error?.message||error||'').toLowerCase(),code=String(error?.code||'').toLowerCase();
  if(!m&&!code)return '';
  if(/captcha/.test(m+code))return 'The security check didn’t go through. Complete it again, then try again.';
  if(/rate limit|too many|seconds|over_request|over_email/.test(m+code))return 'Too many attempts. Please wait a few minutes and try again.';
  if(/failed to fetch|network|load failed|fetch/.test(m))return 'VALE Connect couldn’t reach its sign-in service. Check your connection and try again.';
  if(/signups? not allowed|signup.*disabled|signup_disabled/.test(m+code))return 'New accounts aren’t open yet. Please check back soon.';
  if(/email not confirmed|email_not_confirmed/.test(m+code))return 'Confirm your email address first. We can send the link again.';
  if(/weak|pwned|leaked|compromised|breach/.test(m+code))return 'That password has appeared in a data breach. Choose a different one.';
  if(/password/.test(m)&&/(at least|short|characters|length)/.test(m))return 'Use at least '+PASSWORD_MIN+' characters for your password.';
  if(context==='signin'&&/invalid login|invalid credentials|invalid_credentials/.test(m+code))return 'That email and password don’t match. Check them and try again, or reset your password.';
  if(context==='signup'&&/already|registered|exists/.test(m))return CHECK_EMAIL;
  return 'Something went wrong. Please try again.';
 }
 const CHECK_EMAIL='Check your email for a confirmation link, then come back and sign in.';
 const RESET_SENT='If that email has an account, a reset link is on its way. Check your inbox and spam folder.';
 const RESENT='If that email is waiting for confirmation, a new link is on its way.';

 const api={PASSWORD_MIN,AGREEMENT_VERSION,PRIVACY_URL,TERMS_URL,CHECK_EMAIL,RESET_SENT,RESENT,siteKey,emailOk,agreement,checkSignIn,checkNewPassword,checkSignUp,message};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValeAuthCore=api;
})(typeof window!=='undefined'?window:globalThis);
