/* "Share your details back" on a public card page. Nothing is sent until the person fills in the form, ticks the
   consent box, passes Cloudflare Turnstile and chooses Share. Visitors need no account. Signed-in members can pick
   details from one of their own cards; those values are read again on the server from that card, so the page
   can't add anything else. Rules live in share-back-core.js and on the server. */
(()=>{
 'use strict';
 const core=window.ValeShareBackCore;if(!core||typeof document==='undefined')return;
 const TURNSTILE_SRC='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
 let client=null,user=null,epoch=0,ownCards=null,ownCardsLoad=null;const widgets=[];
 let turnstileLoad=null;

 const el=(tag,props={},...children)=>{const node=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')node.className=v;else if(k==='text')node.textContent=v;else if(k in node&&!k.startsWith('aria'))node[k]=v;else node.setAttribute(k,v)}node.append(...children.filter(c=>c!==null&&c!==undefined&&c!==false));return node};
 const store={get(k){try{return window.localStorage.getItem(k)}catch{return null}},set(k,v){try{window.localStorage.setItem(k,v)}catch{}}};
 // One ID per share. Repeats of the same tap reuse it, so the server never stores a share twice.
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
 // The signed-in person's own cards, through the owner-only reader the Card tab uses. The card being viewed
 // still comes only from the public lookup (get_public_card).
 function loadOwnCards(){
  if(!user||!client||!window.ValeAccountLists)return Promise.resolve([]);
  if(!ownCardsLoad){const generation=epoch,owner=user.id;ownCardsLoad=window.ValeAccountLists.read(client,'public_cards',owner,()=>generation===epoch&&owner===user?.id).then(rows=>{if(generation===epoch)ownCards=rows;return rows}).catch(()=>{if(generation===epoch)ownCards=[];return []})}
  return ownCardsLoad;
 }

 function mount(hostId,options){const host=document.getElementById(hostId);if(!host)return;const widget={host,...options,submissionId:newId()};widgets.push(widget);intro(widget)}

 function intro(widget){
  const {host,card}=widget;closeCheck(widget);host.replaceChildren();
  const key=core.siteKey(location.hostname);
  if(!card?.accept_shares||!key){host.hidden=true;return}
  host.hidden=false;const who=core.firstName(card.display_name);
  const heading=el('h2',{id:'share-back-title',text:'Share your details with '+who});
  if(user&&ownCards?.some(c=>c.id===card.id)){host.append(heading,el('p',{class:'muted',text:'This is your card. People who open it can share their details with you here.'}));return}
  const open=el('button',{type:'button',class:'btn block',text:'Share my details'});open.onclick=()=>form(widget);
  if(store.get(core.markerKey(card.id))){open.textContent='Share again';host.append(heading,el('p',{class:'muted',text:'You’ve already shared your details with '+who+' from this device.'}),el('div',{class:'actions'},open));return}
  host.append(heading,el('p',{class:'muted',text:'Send '+who+' your contact details so they can reach you. Nothing is shared until you choose Share.'}),el('div',{class:'actions'},open));
 }

 function closeCheck(widget){if(widget.checkId!==undefined&&window.turnstile){try{window.turnstile.remove(widget.checkId)}catch{}}widget.checkId=undefined;widget.token=null}

 async function form(widget){
  const {host,card}=widget,who=core.firstName(card.display_name),generation=epoch;
  if(user){await loadOwnCards();if(generation!==epoch)return}
  const mine=user?(ownCards||[]).filter(c=>c.id!==card.id):[];
  host.replaceChildren();widget.token=null;
  const heading=el('h2',{id:'share-back-title',tabindex:'-1',text:'Share your details with '+who});
  const status=el('p',{class:'status',role:'status','aria-live':'polite'});
  const say=(message,tone='')=>{status.textContent=message;if(tone)status.dataset.tone=tone;else delete status.dataset.tone};
  // A problem is shown under its field and linked to it, alongside any hint.
  const problem=(input,message)=>{const id=input.id+'-error';let p=document.getElementById(id);if(!p){p=el('p',{class:'field-error',id});input.closest('.share-field').append(p)}p.textContent=message;input.setAttribute('aria-invalid','true');input.setAttribute('aria-describedby',[input.dataset.hint,id].filter(Boolean).join(' '))};
  const clearProblems=()=>{for(const p of host.querySelectorAll('.field-error'))p.remove();for(const i of host.querySelectorAll('[aria-invalid]')){i.removeAttribute('aria-invalid');if(i.dataset.hint)i.setAttribute('aria-describedby',i.dataset.hint);else i.removeAttribute('aria-describedby')}};
  const field=(key,label,attrs={})=>{const input=el(attrs.multiline?'textarea':'input',{id:'share-'+key,name:key,maxLength:core.LIMITS[key],...attrs.input});if(attrs.hint){input.dataset.hint=input.id+'-hint';input.setAttribute('aria-describedby',input.dataset.hint)}return {input,box:el('div',{class:'share-field'},el('label',{for:input.id,text:label}),input,attrs.hint?el('p',{class:'hint',id:input.id+'-hint',text:attrs.hint}):null)}};

  // Members choose: details from one of their cards, or typed details.
  let mode=mine.length?'member':'visitor';
  const modeBox=el('fieldset',{class:'share-mode'},el('legend',{class:'sr-only',text:'How do you want to share?'}));
  if(user){for(const [value,label] of [['member','From my VALE card'],['visitor','Type my details']]){const input=el('input',{type:'radio',name:'share-mode',value,id:'share-mode-'+value,checked:value===mode,disabled:value==='member'&&!mine.length});input.onchange=()=>{mode=value;show()};modeBox.append(el('label',{class:'seg',for:input.id},input,el('span',{text:label})))}}

  // Member section.
  const memberBox=el('div',{class:'share-member'});let chosenCard=mine[0]||null;const ticks=new Map();
  const drawMember=()=>{
   memberBox.replaceChildren();ticks.clear();if(!chosenCard)return;
   if(mine.length>1){const select=el('select',{id:'share-card-choice'});for(const c of mine)select.append(el('option',{value:c.id,text:(c.card_label||c.display_name)+(c.published?'':' (private draft)'),selected:c.id===chosenCard.id}));select.onchange=()=>{chosenCard=mine.find(c=>c.id===select.value)||mine[0];drawMember()};memberBox.append(el('div',{class:'share-field'},el('label',{for:'share-card-choice',text:'Card'}),select))}
   const list=el('fieldset',{class:'share-picks'},el('legend',{text:'Choose what to share'}));
   for(const o of core.memberOptions(chosenCard)){
    const shown=o.key==='social_links'?(()=>{const n=o.value.split('\n').filter(l=>l.trim()).length;return n+(n===1?' link':' links')})():o.value;
    const input=el('input',{type:'checkbox',id:'share-pick-'+o.key,checked:o.key==='full_name',disabled:o.key==='full_name'});ticks.set(o.key,input);
    list.append(el('label',{class:'check pick',for:input.id},input,el('span',{},el('b',{text:o.label}),el('span',{class:'muted pick-value',text:shown}))));
   }
   memberBox.append(list);
  };
  drawMember();

  // Visitor section.
  const name=field('full_name','Your name',{input:{autocomplete:'name',required:true}});
  const email=field('email','Email',{input:{type:'email',autocomplete:'email',inputMode:'email'}});
  const phone=field('phone','Phone',{input:{type:'tel',autocomplete:'tel'},hint:'Add an email, a phone number, or both.'});
  const title=field('job_title','Title',{input:{autocomplete:'organization-title'}}),company=field('business_name','Company',{input:{autocomplete:'organization'}}),site=field('website','Website',{input:{inputMode:'url',autocomplete:'url',placeholder:'example.com'}});
  const visitorBox=el('div',{class:'share-visitor'},el('div',{class:'fields'},name.box,email.box,phone.box),el('details',{class:'share-more'},el('summary',{text:'Add your title, company or website (optional)'}),el('div',{class:'fields'},title.box,company.box,site.box)));

  const note=field('note','Note to '+who+' (optional)',{multiline:true,input:{rows:2,placeholder:'Great to meet you at…'}});
  const check=el('div',{class:'share-check','aria-label':'Security check'});
  const consent=el('input',{type:'checkbox',id:'share-consent'});
  const consentBox=el('div',{class:'share-field'},el('label',{class:'check consent',for:'share-consent'},consent,el('span',{},core.consentText(card.display_name)+' ',el('a',{href:'privacy.html',target:'_blank',rel:'noopener',text:'How shared details are handled'}))));
  const cancel=el('button',{type:'button',class:'btn ghost',text:'Cancel'}),send=el('button',{type:'submit',class:'btn primary',text:'Share my details'});
  const formEl=el('form',{class:'share-form',noValidate:true,'aria-labelledby':'share-back-title'},user?modeBox:null,memberBox,visitorBox,note.box,check,consentBox,el('div',{class:'actions two'},cancel,send),status);
  const show=()=>{memberBox.hidden=mode!=='member';visitorBox.hidden=mode!=='visitor'};show();
  host.append(heading,formEl);heading.focus();

  // Turnstile: rendered only now, only on the allowed addresses.
  loadTurnstile().then(ts=>{if(!formEl.isConnected)return;widget.checkId=ts.render(check,{sitekey:core.siteKey(location.hostname),action:'share-card',theme:'dark',size:'flexible',callback:t=>{widget.token=t},'expired-callback':()=>{widget.token=null},'error-callback':()=>{widget.token=null;say('The security check couldn’t finish. Try again, or check your connection.','error')}})}).catch(()=>{if(formEl.isConnected){say('The security check couldn’t load. Check your connection, or try another browser.','error');send.disabled=true}});

  cancel.onclick=()=>intro(widget);
  let sending=false;
  formEl.onsubmit=async event=>{
   event.preventDefault();if(sending)return;clearProblems();say('');
   let body;
   if(mode==='member'){
    const picked=[...ticks].filter(([,i])=>i.checked).map(([k])=>k),bad=core.checkMember(picked);
    if(bad){say(bad,'error');(ticks.get('email')||ticks.get('phone')||heading).focus();return}
    body={mode,cardId:chosenCard.id,memberFields:picked};
   }else{
    const r=core.checkVisitor({full_name:name.input.value,email:email.input.value,phone:phone.input.value,job_title:title.input.value,business_name:company.input.value,website:site.input.value});
    const inputs={full_name:name.input,email:email.input,phone:phone.input,job_title:title.input,business_name:company.input,website:site.input};
    const keys=Object.keys(r.errors);
    if(keys.length){for(const k of keys)problem(inputs[k],r.errors[k]);if(keys.some(k=>['job_title','business_name','website'].includes(k)))visitorBox.querySelector('details').open=true;inputs[keys[0]].focus();say('Check the highlighted details.','error');return}
    body={mode,fields:r.fields};
   }
   if(note.input.value.trim().length>core.LIMITS.note){problem(note.input,'Use 300 characters or fewer.');note.input.focus();return}
   if(!consent.checked){problem(consent,'Tick this box to agree before sharing.');consent.focus();return}
   if(!widget.token){say('Complete the security check first.','error');check.focus?.();return}
   let accessToken='';
   if(mode==='member'){const {data}=await client.auth.getSession().catch(()=>({data:null}));accessToken=data?.session?.access_token||'';if(!accessToken){say(core.outcome('sign_in_required',card.display_name).text,'error');return}}
   sending=true;send.disabled=true;cancel.disabled=true;say('Sending…');
   let answer='network';
   try{const res=await fetch(core.FUNCTION_URL,core.request(core.payload({...body,slug:widget.slug,submissionId:widget.submissionId,token:widget.token,note:note.input.value}),accessToken));answer=(await res.json().catch(()=>({}))).status||'error'}catch{answer='network'}
   sending=false;send.disabled=false;cancel.disabled=false;
   const result=core.outcome(answer,card.display_name);
   if(result.done){store.set(core.markerKey(card.id),core.markerValue());widget.submissionId=newId();closeCheck(widget);host.replaceChildren(el('h2',{id:'share-back-title',tabindex:'-1',class:'share-done',text:result.text}),el('p',{class:'muted',text:'They’ll find your details in their VALE Connect connections.'}));host.firstChild.focus();return}
   if(result.closed){closeCheck(widget);host.replaceChildren(el('p',{class:'muted',role:'status',text:result.text}));return}
   say(result.text,'error');
   // A Turnstile pass works once. After any answer from the server, a fresh check is needed.
   if(!result.retry&&widget.checkId!==undefined&&window.turnstile){widget.token=null;try{window.turnstile.reset(widget.checkId)}catch{}}
  };
 }

 window.addEventListener('vale-account-ready',event=>{const next=event.detail;if(user?.id===next.user?.id&&client===next.client)return;epoch++;client=next.client;user=next.user;ownCards=null;ownCardsLoad=null;if(user)loadOwnCards().then(()=>{for(const w of widgets)if(!w.host.querySelector('form'))intro(w)});for(const w of widgets)intro(w)});
 window.ValeShareBack={mount};
})();
