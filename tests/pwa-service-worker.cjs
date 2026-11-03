const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=process.argv[2]||path.resolve(__dirname,'..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.webmanifest'),'utf8'));
const origin='https://valebrandworks.github.io',base=origin+'/vale-connect-dev/';
assert.equal(new URL(manifest.scope,base).href,base);assert.equal(new URL(manifest.start_url,base).pathname,'/vale-connect-dev/');assert.equal(manifest.id,'/vale-connect-dev/');assert.equal(manifest.display,'standalone');
for(const icon of manifest.icons)assert(fs.existsSync(path.join(root,icon.src)));
const stores=new Map(),handlers={},deleted=[],fetched=[];let offline=false,skipped=0,claimed=0;
function store(name){if(!stores.has(name))stores.set(name,new Map());return stores.get(name)}
const caches={
 async open(name){const data=store(name);return {async addAll(requests){for(const r of requests)data.set(r.url,new Response(r.url.endsWith('offline.html')?'OFFLINE SCREEN':'STATIC ICON'))},async match(url){return data.get(typeof url==='string'?url:url.url)?.clone()}}},
 async keys(){return [...stores.keys()]},async delete(name){deleted.push(name);return stores.delete(name)}
};
const context={URL,Request,Response,caches,self:{registration:{scope:base},clients:{claim:async()=>{claimed++}},skipWaiting:()=>{skipped++},addEventListener:(type,fn)=>{handlers[type]=fn}},fetch:async(request,options)=>{fetched.push({url:request.url||request,options});if(offline)throw Error('offline');return new Response('NETWORK ONLY PRIVATE RESPONSE')}};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'sw.js'),'utf8'),context);
async function lifetime(type){let promise;handlers[type]({waitUntil:p=>promise=p});await promise}
async function request(url,mode='cors',method='GET'){let response;handlers.fetch({request:{url,mode,method},respondWith:p=>response=p});return response?await response:null}
(async()=>{
 await lifetime('install');assert.equal(skipped,0);
 const cached=[...stores.values()].flatMap(x=>[...x.keys()]);assert.equal(cached.length,5);assert(cached.every(u=>u===base+'offline.html'||u.startsWith(base+'assets/icons/')));
 assert(!cached.some(u=>u.includes('?')||u.includes('supabase')||u.endsWith('index.html')||u.endsWith('p.html')));
 store('production-cache');store('vale-connect-dev-pwa-obsolete');await lifetime('activate');assert.deepEqual(deleted,['vale-connect-dev-pwa-obsolete']);assert(stores.has('production-cache'));assert.equal(claimed,1);
 const response=await request(base+'p.html?u=private-test','navigate');assert.equal(await response.text(),'NETWORK ONLY PRIVATE RESPONSE');assert.equal(fetched.at(-1).options.cache,'no-store');
 assert.equal([...stores.values()].flatMap(x=>[...x.keys()]).length,5);
 offline=true;assert.equal(await (await request(base+'?card=DO-NOT-CACHE','navigate')).text(),'OFFLINE SCREEN');assert.equal(await (await request(base+'p.html?u=test','navigate')).text(),'OFFLINE SCREEN');
 assert.equal(await request('https://jlprxnmdvoloahssjlnu.supabase.co/rest/v1/profiles'),null);
 assert.equal(await request(origin+'/vale-connect/','navigate'),null);
 assert.equal(await request(base+'cards.js'),null);assert.equal(await request(base+'assets/icons/icon-192.png?private=1'),null);assert.equal(await request(base+'p.html','navigate','POST'),null);
 assert.equal(await (await request(base+'assets/icons/icon-192.png')).text(),'STATIC ICON');
 handlers.message({data:{type:'ACTIVATE_UPDATE'},source:{url:origin+'/vale-connect/'}});assert.equal(skipped,0);
 handlers.message({data:{type:'ACTIVATE_UPDATE'},source:{url:base}});assert.equal(skipped,1);
 console.log('PASS: scoped manifest/icons; static-only cache; no navigation/API/query persistence; offline fallback; production/non-GET bypass; own-cache cleanup; explicit scope-checked update activation.');
})().catch(e=>{console.error(e);process.exitCode=1});

