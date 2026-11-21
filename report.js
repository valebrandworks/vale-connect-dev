/* "Report this card" page. Nothing is sent until the person chooses a reason, confirms the report is accurate,
   passes Cloudflare Turnstile and chooses Send. No account is needed and no sign-in is ever sent. Rules live in
   report-core.js and on the server. */
(()=>{
 'use strict';
 const core=window.ValeReportCore;if(!core||typeof document==='undefined')return;
 const TURNSTILE_SRC='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
 let turnstileLoad=null;

 const el=(tag,props={},...children)=>{const node=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')node.className=v;else if(k==='text')node.textContent=v;else if(k in node&&!k.startsWith('aria'))node[k]=v;else node.setAttribute(k,v)}node.append(...children.filter(c=>c!==null&&c!==undefined&&c!==false));return node};
 // One ID per report. Repeats of the same tap reuse it, so the server never stores a report twice.
 const newId=()=>{if(window.crypto?.randomUUID)return window.crypto.randomUUID();const b=window.crypto.getRandomValues(new Uint8Array(16));b[6]=b[6]&15|64;b[8]=b[8]&63|128;const h=[...b].map(x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20)};
 function loadTurnstile(){
  if(window.turnstile)return Promise.resolve(window.turnstile);
  if(!turnstileLoad)turnstileLoad=new Promise((resolve,reject)=>{
   const s=el('script',{src:TURNSTILE_SRC,async:true});
   s.onload=()=>window.turnstile?resolve(window.turnstile):reject(new Error('turnstile'));s.onerror=()=>{turnstileLoad=null;reject(new Error('turnstile'))};
   document.head.append(s);
  });
  return turnstileLoad;
 }

 // Shows the form for one public card. `card` comes only from the public lookup (get_public_card).
 function mount(hostId,{slug,card}){
  const host=document.getElementById(hostId);if(!host)return;
  const key=core.siteKey(location.hostname);
  if(!key||!core.slugOk(slug)){host.replaceChildren(el('p',{class:'muted',text:'Reporting isn’t available on this address.'}));return}
  const state={submissionId:newId(),token:null,checkId:undefined};
  const status=el('p',{class:'status',role:'status','aria-live':'polite'});
  const say=(message,tone='')=>{status.textContent=message;if(tone)status.dataset.tone=tone;else delete status.dataset.tone};
  const problem=(input,box,message,id)=>{let p=document.getElementById(id);if(!p){p=el('p',{class:'field-error',id});box.append(p)}p.textContent=message;input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby',[input.dataset.hint,id].filter(Boolean).join(' '))};
  const clearProblems=()=>{for(const p of host.querySelectorAll('.field-error'))p.remove();for(const i of host.querySelectorAll('[aria-invalid]')){i.removeAttribute('aria-invalid');if(i.dataset.hint)i.setAttribute('aria-describedby',i.dataset.hint);else i.removeAttribute('aria-describedby')}};

  const heading=el('h1',{id:'report-title',tabindex:'-1',text:'Report this card'});
  const about=el('p',{class:'muted',text:'You’re reporting the card of '+(String(card?.display_name||'').trim()||'this person')+'. The card’s owner is never told who reported it.'});
  const urgent=el('p',{class:'note',text:'If someone is in immediate danger, call 911 or your local emergency number first.'});

  // Reason: one of the approved categories.
  const reasons=el('fieldset',{class:'report-reasons',id:'report-category'},el('legend',{text:'What’s wrong with this card?'}));
  const radios=[];
  for(const [value,label,hint] of core.CATEGORIES){const input=el('input',{type:'radio',name:'report-category',value,id:'report-category-'+value});radios.push(input);reasons.append(el('label',{class:'check reason',for:input.id},input,el('span',{},el('b',{text:label}),el('span',{class:'muted reason-hint',text:hint}))))}
  const reasonsBox=el('div',{class:'share-field'},reasons);
  const ipNote=el('p',{class:'hint',hidden:true,text:'For copyright or trademark complaints, include what you own and where it appears on the card. You can also email support@valebrandworks.com.'});
  for(const r of radios)r.onchange=()=>{ipNote.hidden=r.value!=='ip'||!r.checked};

  const details=el('textarea',{id:'report-details',name:'details',rows:5,maxLength:core.LIMITS.details,placeholder:'What did you see, and why is it a problem?'});
  details.dataset.hint='report-details-hint';details.setAttribute('aria-describedby',details.dataset.hint);
  const count=el('p',{class:'hint',id:'report-details-hint',text:'Optional. '+core.counter('')});
  details.oninput=()=>{count.textContent='Optional. '+core.counter(details.value)};
  const detailsBox=el('div',{class:'share-field'},el('label',{for:'report-details',text:'Explanation (optional)'}),details,count);

  const email=el('input',{type:'email',id:'report-email',name:'email',autocomplete:'email',inputMode:'email',maxLength:core.LIMITS.email});
  email.dataset.hint='report-email-hint';email.setAttribute('aria-describedby',email.dataset.hint);
  const emailBox=el('div',{class:'share-field'},el('label',{for:'report-email',text:'Your email (optional)'}),email,el('p',{class:'hint',id:'report-email-hint',text:'Only if you’d like a reply. It’s deleted when we close your report, and never shown to the card’s owner.'}));

  const check=el('div',{class:'share-check','aria-label':'Security check'});
  const attest=el('input',{type:'checkbox',id:'report-attest'});
  const attestBox=el('div',{class:'share-field'},el('label',{class:'check consent',for:'report-attest'},attest,el('span',{text:'The information in this report is accurate to the best of my knowledge.'})));
  const privacy=el('p',{class:'hint'},'We keep your report, and a scrambled code made from your network (never the address itself) to prevent abuse. Reports are only seen by VALE Connect’s administrators. ',el('a',{href:'privacy.html',target:'_blank',rel:'noopener',text:'Privacy'}));
  const back=el('a',{class:'btn ghost',href:'p.html?u='+encodeURIComponent(slug),text:'Back to the card'});
  const send=el('button',{type:'submit',class:'btn primary',text:'Send report'});
  const form=el('form',{class:'share-form report-form',noValidate:true,'aria-labelledby':'report-title'},reasonsBox,ipNote,detailsBox,emailBox,check,attestBox,privacy,el('div',{class:'actions two'},back,send),status);
  host.replaceChildren(heading,about,urgent,form);

  // Turnstile: rendered only on the allowed addresses, with the action the server requires.
  loadTurnstile().then(ts=>{if(!form.isConnected)return;state.checkId=ts.render(check,{sitekey:key,action:'report-card',theme:'dark',size:'flexible',callback:t=>{state.token=t},'expired-callback':()=>{state.token=null},'error-callback':()=>{state.token=null;say('The security check couldn’t finish. Try again, or check your connection.','error')}})}).catch(()=>{if(form.isConnected){say('The security check couldn’t load. Check your connection, or try another browser.','error');send.disabled=true}});

  let sending=false;
  form.onsubmit=async event=>{
   event.preventDefault();if(sending)return;clearProblems();say('');
   const chosen=radios.find(r=>r.checked);
   const r=core.check({category:chosen?.value,details:details.value,email:email.value,attested:attest.checked});
   const order=[['category',radios[0],reasonsBox],['details',details,detailsBox],['email',email,emailBox],['attested',attest,attestBox]];
   const bad=order.filter(([k])=>r.errors[k]);
   if(bad.length){for(const [k,input,box] of bad)problem(k==='category'?reasons:input,box,r.errors[k],'report-'+k+'-error');(bad[0][0]==='category'?radios[0]:bad[0][1]).focus();say('Check the highlighted details.','error');return}
   if(!state.token){say('Complete the security check first.','error');return}
   sending=true;send.disabled=true;say('Sending…');
   let answer='network';
   try{const res=await fetch(core.FUNCTION_URL,core.request(core.payload({slug,submissionId:state.submissionId,token:state.token,category:r.category,details:r.details,email:r.email})));answer=(await res.json().catch(()=>({}))).status||'error'}catch{answer='network'}
   sending=false;send.disabled=false;
   const result=core.outcome(answer);
   if(result.done){if(state.checkId!==undefined&&window.turnstile){try{window.turnstile.remove(state.checkId)}catch{}}host.replaceChildren(el('h1',{id:'report-title',tabindex:'-1',class:'share-done',text:result.text}),el('p',{class:'muted',text:'We review every report ourselves. If you gave your email, we may contact you about it.'}),el('div',{class:'actions'},el('a',{class:'btn',href:'p.html?u='+encodeURIComponent(slug),text:'Back to the card'})));host.firstChild.focus();return}
   say(result.text,'error');
   // A Turnstile pass works once. After any answer from the server (not a lost connection), a fresh check is needed.
   if(!result.retry&&state.checkId!==undefined&&window.turnstile){state.token=null;try{window.turnstile.reset(state.checkId)}catch{}}
  };
  heading.focus();
 }
 window.ValeReport={mount};
})();
