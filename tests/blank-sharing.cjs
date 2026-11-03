const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const siteRoot = process.argv[2] || path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(siteRoot, 'index.html'), 'utf8');
for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    disabled:false, hidden:false, textContent:'', value:'', children:[],
    append(child){this.children.push(child)}, replaceChildren(){this.children=[]},
    removeAttribute(name){delete this[name]},
    getContext(){return {fillRect(){}}},
  });
  return elements.get(id);
}
const calls = {copy:[], share:[], prompt:[]};
const context = {
  TextEncoder, TextDecoder, Uint8Array, URLSearchParams,
  btoa:s=>Buffer.from(s,'binary').toString('base64'),
  atob:s=>Buffer.from(s,'base64').toString('binary'),
  $:element, node:(tag,cls,text)=>Object.assign(element(Symbol()),{tag,textContent:text||''}),
  location:{href:'http://127.0.0.1:12345/vale-connect-dev/'},
  navigator:{clipboard:{writeText:async value=>calls.copy.push(value)},share:async value=>calls.share.push(value)},
  prompt:(...args)=>calls.prompt.push(args),setTimeout(){},
  window:{dispatchEvent(){}},CustomEvent:function(){},
  txt:v=>String(v||'').trim(), card:{fullName:''}, blank:{fullName:'',bio:''},KEY:'test',
  save:()=>false,update(){},
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(siteRoot,'qr-bundle.js'),'utf8'),context);
context.ValeQR=context.window.ValeQR;
vm.runInContext(html.slice(html.indexOf('function encoded(data)'),html.indexOf('function download(')),context);
vm.runInContext(html.slice(html.indexOf("$('copy').onclick="),html.indexOf("$('downloadQR').onclick=")),context);

(async()=>{
  for (const name of ['', '   ']) {
    context.card={fullName:name};context.renderQR();
    assert.equal(context.shareLink(),null);
    for (const id of ['copy','downloadQR','nativeShare']) assert.equal(element(id).disabled,true);
    assert.equal(element('openPublic').hidden,true);
    assert.equal(element('openPublic').href,undefined);
    assert.equal(element('shareurl').textContent,'');
    assert.match(element('qr').children[0].textContent,/click Save Card before sharing/);
    await element('copy').onclick();await element('nativeShare').onclick();
  }
  assert.equal(calls.copy.length,0);assert.equal(calls.share.length,0);assert.equal(calls.prompt.length,0);
  context.card={fullName:'Saved Test',bio:'Synthetic only'};context.renderQR();
  for(const id of ['copy','downloadQR','nativeShare'])assert.equal(element(id).disabled,false);
  assert.equal(element('openPublic').hidden,false);
  assert.equal(element('qr').children[0].tag,'canvas');
  const url=context.shareLink();
  const payload=JSON.parse(Buffer.from(new URL(url).searchParams.get('card'),'base64url').toString('utf8'));
  assert.equal(payload.fullName,'Saved Test');
  await element('copy').onclick();await element('nativeShare').onclick();
  assert.equal(calls.copy[0],url);assert.equal(calls.share[0].url,url);
  context.card={fullName:''};context.renderQR();
  assert.equal(element('openPublic').href,undefined);assert.equal(element('openPublic').hidden,true);
  assert.equal(element('qr').children[0].tag,'p');
  vm.runInContext(html.slice(html.indexOf("$('cardform').onsubmit="),html.indexOf('function encoded(data)')),context);
  element('fullName').value='Unsaved Test';element('bio').value='Not stored';
  element('cardform').onsubmit({preventDefault(){}});
  assert.equal(context.card.fullName,'');assert.equal(context.shareLink(),null);
  context.save=()=>true;
  element('cardform').onsubmit({preventDefault(){}});
  assert.equal(context.card.fullName,'Unsaved Test');
  assert.ok(context.shareLink());
  console.log('PASS: script syntax; blank/whitespace sharing disabled; no empty clipboard/native payload; saved-card QR and URL round trip; stale link cleared; failed save stays unshareable; successful save enables sharing.');
})().catch(error=>{console.error(error);process.exitCode=1});

