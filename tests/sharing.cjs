// Share tab and older long-format links, with a fake page. Only a saved, public card can be shared.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const read=f=>fs.readFileSync(path.join(root,f),'utf8');
const html=read('index.html');
for(const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(match[1]);
class El{constructor(id='',tag=''){this.id=id;this.tagName=tag;this.textContent='';this.hidden=false;this.disabled=false;this.children=[];this.attrs={};this.handlers={};this.dataset={};this.className=''}
 append(...n){this.children.push(...n)}replaceChildren(...n){this.children=[...n]}setAttribute(k,v){this.attrs[k]=v}addEventListener(k,f){(this.handlers[k]||=[]).push(f)}querySelector(sel){return sel==='canvas'?this.children.find(c=>c.tagName==='canvas')||null:null}
 getContext(){return {fillRect(){},set fillStyle(_v){}}}toBlob(cb){cb({})}click(){}remove(){}}
function page(search){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new El(id));return elements.get(id)},events={},calls={copy:[],share:[],downloads:[],cloud:[]};
 const tabs=['card','share','connections','account'].map(t=>Object.assign(new El(),{dataset:{tab:t}}));
 const window={addEventListener:(n,f)=>events[n]=f,dispatchEvent(){},scrollTo(){},ValeCloudSave:{mount:(...a)=>calls.cloud.push(a)}};
 const context={window,document:{getElementById:get,createElement:t=>new El('',t),querySelectorAll:sel=>sel==='[data-tab]'?tabs:[],createElementNS:(_ns,t)=>new El('',t),createTextNode:t=>({textContent:t}),body:new El()},
  location:{href:'https://dev.valebrandworks.com/'+search,search},URL,URLSearchParams,TextDecoder,Uint8Array,Blob:class{constructor(p){this.parts=p}},
  atob:s=>Buffer.from(s,'base64').toString('binary'),navigator:{clipboard:{writeText:async v=>calls.copy.push(v)},share:async v=>calls.share.push(v)},
  CustomEvent:class{constructor(t,o){this.type=t;this.detail=o?.detail}},setTimeout(){}};
 window.window=window;window.document=context.document;context.URL=class extends URL{static createObjectURL(b){calls.downloads.push(b);return 'blob:x'}static revokeObjectURL(){}};
 vm.createContext(context);
 vm.runInContext(read('qr-bundle.js'),context);context.ValeQR=window.ValeQR;
 for(const f of ['platform-icons.js','card-view.js','cards-core.js','app.js'])vm.runInContext(read(f),context);
 return {get,events,calls,window,tabs};
}
(async()=>{
 const p=page('');
 const select=detail=>p.events['vale-card-selected']({detail});
 // Signed out, no card, and a private card: nothing to share, and the reason is given.
 select({card:null,signedIn:false});assert.equal(p.get('share-ready').hidden,true);assert.match(p.get('share-none-text').textContent,/Sign in/);
 select({card:null,signedIn:true});assert.match(p.get('share-none-text').textContent,/Create your card/);
 const card={id:'c1',slug:'ana-ruiz-1a2b3c',display_name:'Ana Ruiz',job_title:'Founder',business_name:'Delta',public_email:'',public_phone:'',website:'',introduction:'',social_links:'',published:false};
 select({card,signedIn:true});assert.equal(p.get('share-ready').hidden,true);assert.match(p.get('share-none-text').textContent,/private/);
 await p.get('share-copy').onclick();await p.get('share-native').onclick();assert.equal(p.calls.copy.length+p.calls.share.length,0,'a private card is never shared');
 // Public: a short link and a QR code.
 select({card:{...card,published:true},signedIn:true});
 assert.equal(p.get('share-ready').hidden,false);assert.equal(p.get('share-name').textContent,'Ana Ruiz');
 assert.equal(p.get('share-url').textContent,'dev.valebrandworks.com/p.html?u=ana-ruiz-1a2b3c');
 assert.ok(p.get('share-qr').children.some(c=>c.tagName==='canvas'),'QR drawn');
 await p.get('share-copy').onclick();assert.deepEqual(p.calls.copy,['https://dev.valebrandworks.com/p.html?u=ana-ruiz-1a2b3c']);
 await p.get('share-native').onclick();assert.equal(p.calls.share[0].url,'https://dev.valebrandworks.com/p.html?u=ana-ruiz-1a2b3c');
 p.get('share-vcf').onclick();assert.match(p.calls.downloads[0].parts[0],/FN:Ana Ruiz/);
 // The Card tab's Share button opens the Share tab.
 p.get('card-share').onclick();assert.equal(p.get('tab-share').hidden,false);assert.equal(p.get('tab-card').hidden,true);
 // Older long-format links still open, read-only, with save options.
 const long=Buffer.from(JSON.stringify({fullName:'Long Link',company:'Older Co',socials:'https://www.linkedin.com/in/someone'})).toString('base64url');
 const legacy=page('?card='+long);
 assert.equal(legacy.get('app').hidden,true);assert.equal(legacy.get('publicView').hidden,false);
 const rendered=legacy.get('publicCard').children[0];assert.equal(rendered.className,'vcard');assert.equal(rendered.dataset.preset,'charcoal','older links use the default appearance');
 assert.equal(legacy.calls.cloud[0][1].fullName,'Long Link');assert.equal(legacy.calls.cloud[0][1].company,'Older Co');
 for(const bad of ['%%%',Buffer.from('[]').toString('base64url'),Buffer.from(JSON.stringify({fullName:'  '})).toString('base64url')]){
  const broken=page('?card='+bad);assert.match(broken.get('publicCard').textContent,/damaged or incomplete/);assert.equal(broken.get('savePublic').hidden,true);assert.equal(broken.calls.cloud.length,0);
 }
 // ?view= addresses used by older links and emails still open the right tab.
 assert.equal(page('?view=cloud-connections').get('tab-connections').hidden,false);
 assert.equal(page('?view=account').get('tab-account').hidden,false);
 console.log('PASS: script syntax; only public cards share; short link and QR; contact download; Share button opens Share; older long links open read-only and damaged ones fail safely; older view addresses still work.');
})().catch(e=>{console.error(e);process.exitCode=1});
