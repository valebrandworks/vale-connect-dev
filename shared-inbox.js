/* "Shared with you" in the Connections tab: details people shared from the owner's card, with a count on the
   Connections tab. Reads only the signed-in owner's own share records and notifications (database rules allow
   nothing else), and acts only through the database's own functions: mark_notifications_read and
   add_shared_as_connection. Rules and wording are in shared-inbox-core.js. */
(()=>{
 'use strict';
 const core=window.ValeSharedInboxCore,host=document.getElementById('shared-inbox');if(!core||!host)return;
 const SHOWN=5;
 let client=null,user=null,epoch=0,shares=[],notifications=[],cards=[],connections=[],busy=false,showAll=false,lastLoad=0,timer=null,note='',loadFailed=false;
 const ask=(text,options)=>window.ValeAsk?window.ValeAsk(text,options):Promise.resolve(confirm(text));
 const el=(tag,props={},...children)=>{const node=document.createElement(tag);for(const [k,v] of Object.entries(props)){if(k==='class')node.className=v;else if(k==='text')node.textContent=v;else if(k in node&&!k.startsWith('aria'))node[k]=v;else node.setAttribute(k,v)}node.append(...children.filter(c=>c!==null&&c!==undefined&&c!==false));return node};

 async function load(force=false){
  if(!user||!client)return;
  if(!force&&Date.now()-lastLoad<10000)return;
  lastLoad=Date.now();const e=epoch,owner=user.id;
  const [n,s]=await Promise.all([
   client.from('notifications').select('id,kind,share_id,connection_id,created_at,read_at').eq('owner_id',owner).order('created_at',{ascending:false}).limit(100),
   client.from('card_shares').select('id,card_id,outcome,shared,note,created_at,last_shared_at,repeat_count,connection_id,reviewed_at').eq('owner_id',owner).order('last_shared_at',{ascending:false}).limit(50),
  ]).catch(()=>[{error:true},{error:true}]);
  if(e!==epoch||owner!==user?.id)return;
  if(n.error||s.error){loadFailed=true;note='Couldn’t load what people shared with you. It will try again shortly.';render();return}
  notifications=n.data||[];shares=s.data||[];
  if(!cards.length&&window.ValeAccountLists)cards=await window.ValeAccountLists.read(client,'public_cards',owner,()=>e===epoch&&owner===user?.id).catch(()=>[]);
  if(e!==epoch)return;
  // A successful load clears only its own earlier error, never the result of something the owner just did.
  if(loadFailed){loadFailed=false;note=''}
  render();
 }

 function badge(count){
  const tab=document.querySelector('[data-tab="connections"]');if(!tab)return;
  let b=tab.querySelector('.nav-badge');
  if(!count){b?.remove();tab.removeAttribute('aria-label');return}
  if(!b){b=el('span',{class:'nav-badge','aria-hidden':'true'});tab.append(b)}
  b.textContent=count>9?'9+':String(count);tab.setAttribute('aria-label','Connections, '+count+' new');
 }

 function render(){
  const list=core.items(shares,notifications,{connections,cards});
  const unread=core.unreadCount(list);badge(user?unread:0);
  host.replaceChildren();
  if(!user||(!list.length&&!note)){host.hidden=true;return}
  host.hidden=false;
  const head=el('div',{class:'section-title'},el('h2',{id:'shared-inbox-title'},'Shared with you',unread?el('span',{class:'pill public inbox-new',text:unread+' new'}):null));
  if(unread){const all=el('button',{type:'button',class:'btn ghost small-btn',text:'Mark all as read',disabled:busy});all.onclick=()=>markRead(null);head.append(all)}
  const status=el('p',{class:'status',role:'status','aria-live':'polite',text:note});
  const ul=el('ul',{class:'inbox-list'});
  for(const item of showAll?list:list.slice(0,SHOWN)){
   const li=el('li',{class:'inbox-item'+(item.unread?' unread':'')});
   const initials=item.name.split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0].toUpperCase()).join('')||'·';
   const meta=[item.company,item.via?'via '+item.via:'',item.when,item.repeats>1?'shared '+item.repeats+' times':''].filter(Boolean).join(' · ');
   const title=el('div',{class:'inbox-who'},el('b',{},item.unread?el('span',{class:'sr-only',text:'New: '}):null,item.name,item.mutual?el('span',{class:'pill public tag',text:'Mutual'}):null),el('span',{class:'muted small',text:meta}));
   li.append(el('div',{class:'inbox-row'},el('span',{class:'avatar','aria-hidden':'true',text:initials}),title,item.unread?el('span',{class:'dot','aria-hidden':'true'}):null));
   if(item.status)li.append(el('p',{class:'inbox-status',text:item.status}));
   if(item.note)li.append(el('p',{class:'inbox-note',text:'“'+item.note+'”'}));
   if(item.details.length){const dl=el('dl',{class:'inbox-details'});for(const [k,v] of item.details)dl.append(el('dt',{text:k}),el('dd',{text:v}));li.append(el('details',{},el('summary',{text:'What they shared'}),dl))}
   if(item.actions.length){
    const row=el('div',{class:'actions'});
    for(const action of item.actions){const b=el('button',{type:'button',class:action==='add-separate'?'btn':'btn ghost',text:core.ACTION_LABELS[action],disabled:busy});b.onclick=()=>act(action,item);row.append(b)}
    li.append(row);
   }
   ul.append(li);
  }
  host.append(head,ul);
  if(list.length>SHOWN){const more=el('button',{type:'button',class:'btn ghost block',text:showAll?'Show fewer':'Show all '+list.length});more.onclick=()=>{showAll=!showAll;render()};host.append(more)}
  host.append(status);
 }

 async function markRead(ids){
  if(busy||!user)return;const e=epoch;busy=true;
  try{const {error}=await client.rpc('mark_notifications_read',{p_ids:ids});if(error)throw error;if(e!==epoch)return;
   const now=new Date().toISOString();for(const n of notifications)if(!n.read_at&&(ids===null||ids.includes(n.id)))n.read_at=now}
  catch{if(e===epoch)note='Couldn’t mark as read. Try again.'}
  finally{if(e===epoch){busy=false;render()}}
 }

 async function act(action,item){
  if(busy||!user)return;
  if(action==='open'||action==='open-existing'){
   window.dispatchEvent(new CustomEvent('vale-open-connection',{detail:{id:item.connectionId}}));
   if(item.unread)await markRead(item.unreadIds);
   return;
  }
  if(action==='add-separate'){
   if(!await ask('Add '+item.name+' as a separate connection? Any existing connection stays as it is.',{confirmLabel:'Add'}))return;
   const e=epoch;busy=true;render();
   try{
    const {error}=await client.rpc('add_shared_as_connection',{p_share_id:item.id});if(error)throw error;
    if(e!==epoch)return;note='Added '+item.name+' to your connections.';
    window.dispatchEvent(new Event('vale-cloud-connections-changed'));
   }catch(error){if(e===epoch)note=error?.message||'Couldn’t add this connection. Try again.'}
   finally{if(e===epoch){busy=false;if(item.unread)await markRead(item.unreadIds);await load(true)}}
  }
 }

 window.addEventListener('vale-cloud-connections-loaded',event=>{connections=event.detail?.rows||[];if(user)render()});
 window.addEventListener('vale-cards-changed',()=>{cards=[];void load(true)});
 window.addEventListener('vale-tab-shown',event=>{if(event.detail?.tab==='connections')void load()});
 window.addEventListener('focus',()=>void load());
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)void load()});
 window.addEventListener('vale-account-ready',event=>{
  const next=event.detail;if(user?.id===next.user?.id&&client===next.client)return;
  epoch++;client=next.client;user=next.user;shares=[];notifications=[];cards=[];busy=false;showAll=false;note='';loadFailed=false;lastLoad=0;
  if(timer)clearInterval(timer);timer=null;render();
  if(user){void load(true);timer=setInterval(()=>{if(!document.hidden)void load()},60000)}
 });
 window.ValeSharedInbox={refresh:()=>load(true)};
})();
