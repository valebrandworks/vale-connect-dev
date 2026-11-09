/* Draws a digital card. Shared by the app, the public card page and older long-format links. */
(function(root){
 'use strict';
 const text=v=>String(v??'').trim();
 const PRESETS=['charcoal','ivory','midnight','slate'];
 const preset=v=>PRESETS.includes(v)?v:'charcoal';
 function web(value){
  let s=text(value);if(!s)return null;
  if(!/^[a-z][a-z0-9+.-]*:/i.test(s))s='https://'+s;
  try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)&&u.hostname.includes('.')?u.href:null}catch{return null}
 }
 // Same page if only the scheme, "www.", letter case or a trailing slash differ.
 function sameAddress(a,b){
  const key=s=>{try{const u=new URL(s);return u.hostname.toLowerCase().replace(/^www\./,'')+u.pathname.replace(/\/+$/,'')+u.search}catch{return s}};
  return !!a&&!!b&&key(a)===key(b);
 }
 // Lines are "Label | address" or just an address. Repeats, and the website itself, are shown once.
 function links(data){
  const website=web(data.website),out=[];
  for(const line of text(data.socials).split('\n')){
   if(!text(line))continue;
   const parts=line.split('|'),label=parts.length>1?text(parts[0]):'',url=web(parts.length>1?parts.slice(1).join('|'):parts[0]);
   if(!url||sameAddress(url,website)||out.some(l=>sameAddress(l.url,url)))continue;
   const platform=root.ValePlatforms?.platform(url)||null;
   out.push({url,label:label||(platform?root.ValePlatforms.name(platform):new URL(url).hostname.replace(/^www\./,'')),platform});
  }
  return {website,socials:out};
 }
 function initials(name){return text(name).split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0].toUpperCase()).join('')||'V'}
 const glyphs={
  phone:'M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.24 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z',
  mail:'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zm0 2.2V17h16V7.2l-8 5.3z',
  globe:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zm6.9 8h-3a14 14 0 0 0-1.3-5.4A7 7 0 0 1 18.9 11zM12 5c.9 1.2 1.8 3.4 1.9 6h-3.8c.1-2.6 1-4.8 1.9-6zM9.4 5.6A14 14 0 0 0 8.1 11h-3a7 7 0 0 1 4.3-5.4zM5.1 13h3a14 14 0 0 0 1.3 5.4A7 7 0 0 1 5.1 13zm6.9 6c-.9-1.2-1.8-3.4-1.9-6h3.8c-.1 2.6-1 4.8-1.9 6zm2.6-.6a14 14 0 0 0 1.3-5.4h3a7 7 0 0 1-4.3 5.4z'
 };
 function glyph(doc,name){const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg'),p=doc.createElementNS(ns,'path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');p.setAttribute('d',glyphs[name]);p.setAttribute('fill','currentColor');svg.append(p);return svg}
 // options: photoUrl and logoUrl (image slots; initials show when there is no photo), preset (one of PRESETS; anything else shows Charcoal).
 function render(data,options={},doc=root.document){
  const el=(tag,cls,value)=>{const e=doc.createElement(tag);if(cls)e.className=cls;if(value!==undefined)e.textContent=value;return e};
  const card=el('article','vcard');card.dataset.preset=preset(options.preset);
  card.append(el('div','mark','VALE CONNECT'));
  if(options.logoUrl){const logo=el('img','logo');logo.src=options.logoUrl;logo.alt=text(data.company)?text(data.company)+' logo':'Logo';card.append(logo);card.classList?.add('has-logo')}
  const head=el('div','head');
  if(options.photoUrl){const photo=el('img','photo');photo.src=options.photoUrl;photo.alt='';head.append(photo)}
  else{const photo=el('div','photo',initials(data.fullName));photo.setAttribute('aria-hidden','true');head.append(photo)}
  const who=el('div');who.append(el('div','name',text(data.fullName)||'Your name'));
  if(text(data.jobTitle))who.append(el('div','role',text(data.jobTitle)));
  if(text(data.company))who.append(el('div','company',text(data.company)));
  head.append(who);card.append(head);
  if(text(data.bio))card.append(el('p','intro',text(data.bio)));
  const {website,socials}=links(data),contact=el('div','contact');
  const action=(href,label,icon,external)=>{const a=el('a');a.href=href;a.append(glyph(doc,icon),doc.createTextNode(label));if(external){a.target='_blank';a.rel='noopener noreferrer'}contact.append(a)};
  const phone=text(data.phone).replace(/[^+\d]/g,'');if(phone)action('tel:'+phone,'Call','phone');
  if(text(data.email))action('mailto:'+encodeURIComponent(text(data.email)),'Email','mail');
  if(website)action(website,'Website','globe',true);
  if(contact.childElementCount)card.append(contact);
  if(socials.length){
   const row=el('div','socials');
   for(const link of socials){
    const a=el('a');a.href=link.url;a.target='_blank';a.rel='noopener noreferrer';a.title=link.label;a.setAttribute('aria-label',link.label);
    const icon=link.platform&&root.ValePlatforms?.element(link.platform,doc);
    if(icon)a.append(icon);else{a.className='text-link';a.textContent=link.label}
    row.append(a);
   }
   card.append(row);
  }
  return card;
 }
 const api={render,links,web,sameAddress,initials,PRESETS,preset};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValeCardView=api;
})(typeof window!=='undefined'?window:globalThis);
