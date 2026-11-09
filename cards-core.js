/* Shared public-card field conversion. No credentials or network access. */
(function(root){
  'use strict';
  const fields={fullName:'display_name',jobTitle:'job_title',company:'business_name',phone:'public_phone',email:'public_email',website:'website',bio:'introduction',socials:'social_links'};
  const text=v=>String(v||'').trim();
  function toEditor(row){return Object.fromEntries(Object.entries(fields).map(([key,column])=>[key,text(row?.[column])]))}
  function toRow(editor){return Object.fromEntries(Object.entries(fields).map(([key,column])=>[column,text(editor[key])]))}
  function validate(label,slug,editor){
    if(!text(label)||text(label).length>80)return 'Enter a card name of 1–80 characters.';
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length<3||slug.length>60)return 'Use 3–60 lowercase letters, numbers and hyphens for the public link name.';
    if(!text(editor.fullName))return 'Enter the name to display on this card.';
    return '';
  }
  // photo: optional base64 JPEG. Long lines are folded at 75 characters, as vCard requires.
  function fold(line){if(line.length<=75)return line;const parts=[line.slice(0,75)];for(let i=75;i<line.length;i+=74)parts.push(' '+line.slice(i,i+74));return parts.join('\r\n')}
  function vcard(editor,photo=''){
    const esc=v=>text(v).replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
    const urls=text(editor.socials).split('\n').map(line=>{const p=line.split('|');return text(p.length>1?p.slice(1).join('|'):p[0])}).filter(u=>/^https?:\/\//i.test(u));
    const image=/^[A-Za-z0-9+/]+=*$/.test(photo)?[fold('PHOTO;ENCODING=b;TYPE=JPEG:'+photo)]:[];
    return ['BEGIN:VCARD','VERSION:3.0','FN:'+esc(editor.fullName),'ORG:'+esc(editor.company),'TITLE:'+esc(editor.jobTitle),'TEL:'+esc(editor.phone),'EMAIL:'+esc(editor.email),'URL:'+esc(editor.website),'NOTE:'+esc(editor.bio),...urls.map(u=>'URL:'+esc(u)),...image,'END:VCARD'].join('\r\n');
  }
  const api={fields,toEditor,toRow,validate,vcard};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValeCardTools=api;
})(typeof window!=='undefined'?window:globalThis);

