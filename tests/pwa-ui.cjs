const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=process.argv[2]||path.resolve(__dirname,'..');
const elements=new Map(),events={},swEvents={},regEvents={};let confirmed=false,reloads=0,posted=0,prompts=0;
const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,open:false,textContent:'',onclick:null});return elements.get(id)};
const reg={waiting:{postMessage(data){assert.equal(data.type,'ACTIVATE_UPDATE');posted++}},addEventListener:(k,fn)=>regEvents[k]=fn,update:async()=>{}};
const context={document:{getElementById:element},location:{hostname:'dev.valebrandworks.com',pathname:'/',search:'',reload(){reloads++}},window:{matchMedia:()=>({matches:false}),addEventListener:(k,fn)=>events[k]=fn},navigator:{onLine:true,serviceWorker:{controller:{},ready:Promise.resolve(),register:async(url,options)=>{assert.equal(url,'./sw.js');assert.equal(options.scope,'./');assert.equal(options.updateViaCache,'none');return reg},addEventListener:(k,fn)=>swEvents[k]=fn}},URLSearchParams,confirm:()=>confirmed};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(root,'pwa.js'),'utf8'),context);
const settle=async()=>{for(let i=0;i<4;i++)await new Promise(r=>setImmediate(r))};
(async()=>{
 await settle();assert.equal(element('pwa-update').hidden,false);swEvents.controllerchange();assert.equal(reloads,0);
 await element('pwa-update').onclick();assert.equal(posted,0);
 confirmed=true;context.navigator.onLine=false;await element('pwa-update').onclick();assert.equal(posted,0);
 context.navigator.onLine=true;await element('pwa-update').onclick();assert.equal(posted,1);assert.equal(reloads,0);swEvents.controllerchange();assert.equal(reloads,1);swEvents.controllerchange();assert.equal(reloads,1);
 await element('pwa-install').onclick();assert.equal(element('pwa-help').open,true);
 events.beforeinstallprompt({preventDefault(){},prompt:async()=>{prompts++},userChoice:Promise.resolve({outcome:'accepted'})});await element('pwa-install').onclick();assert.equal(prompts,1);
 events.appinstalled();assert.equal(element('pwa-install').hidden,true);
 context.navigator.onLine=false;events.offline();assert.equal(element('pwa-network').hidden,false);
 const oldElements=new Map(),old=id=>{if(!oldElements.has(id))oldElements.set(id,{hidden:false,textContent:''});return oldElements.get(id)};let oldRegistrations=0;
 const oldContext={document:{getElementById:old},location:{hostname:'valebrandworks.github.io',pathname:'/vale-connect-dev/',search:''},window:{},navigator:{serviceWorker:{register:async()=>{oldRegistrations++}}},URLSearchParams};
 vm.createContext(oldContext);vm.runInContext(fs.readFileSync(path.join(root,'pwa.js'),'utf8'),oldContext);await settle();assert.equal(oldRegistrations,0);assert.equal(old('pwa-install').hidden,true);assert.match(old('pwa-status').textContent,/dev\.valebrandworks\.com/);
 for(const hostname of ['valebrandworks.github.io','example.com']){let n=0;const c={document:{getElementById:()=>({})},location:{hostname,pathname:'/',search:''},window:{},navigator:{serviceWorker:{register:async()=>{n++}}},URLSearchParams};vm.createContext(c);vm.runInContext(fs.readFileSync(path.join(root,'pwa.js'),'utf8'),c);await settle();assert.equal(n,0,hostname)}
 console.log('PASS: former path and unknown hosts never register a worker; install fallback/prompt/completion; offline notice; update waits for consent/online state; no initial or unsolicited reload; one reload after explicit activation.');
})().catch(e=>{console.error(e);process.exitCode=1});

