// Regression tests for three defects recorded in docs/phase-0-baseline.md.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const local=require(path.join(root,'connections-core.js')),core=require(path.join(root,'cloud-connections-core.js')),restore=require(path.join(root,'connections-restore.js'));
const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),viewer=fs.readFileSync(path.join(root,'p.html'),'utf8');
let failed=0;
function check(name,work){try{work();console.log('  ok: '+name)}catch(error){failed++;console.error('  FAILED: '+name+'\n    '+error.message)}}

check('website typed without https:// is kept, unsafe values never become links',()=>{
 const save=value=>core.payload({cname:'Synthetic',cwebsite:value}).website;
 for(const [typed,expected] of [
  ['example.com','https://example.com/'],['www.example.com','https://www.example.com/'],[' example.com/about?x=1 ','https://example.com/about?x=1'],
  ['sub.example.co.uk:8443/a','https://sub.example.co.uk:8443/a'],['https://example.com','https://example.com/'],['http://example.com','http://example.com/'],
  ['','']]){assert.equal(save(typed),expected,typed)}
 for(const unsafe of ['javascript:alert(1)','javascript:1','JaVaScRiPt:alert(1)','data:text/html,x','data.example:text','mailto:a@example.com','a@example.com','ftp://example.com','file:///c:/x','not a website','localhost','example','.com','//example.com'])assert.equal(save(unsafe),'',unsafe);
 assert.equal(local.candidate({fullName:'Synthetic',website:'example.com'},{}).cwebsite,'https://example.com/');
 assert.match(viewer,/ValeConnections\.website\(data\.website\)/);
 const row={id:'11111111-1111-4111-8111-111111111111',full_name:'Synthetic',category:'Other',next_step:'Follow up',history:[],website:core.payload({cname:'x',cwebsite:'a'.repeat(190)+'.example.com/'}).website};
 assert.ok(row.website.length>200);
 assert.equal(restore.parse(JSON.stringify({format:'vale-connect-cloud-connections',version:1,environment:'development',count:1,connections:[row]})).count,1);
});

check('unreadable browser contacts are never replaced',()=>{
 const start=html.indexOf('function storedContacts()'),end=html.indexOf('function txt(v)');assert.ok(start>0&&end>start,'guard code not found in index.html');
 assert.ok(html.includes('contacts=storedContacts()||[]'));
 const run=initial=>{
  const data=new Map(Object.entries(initial)),alerts=[];
  const context={localStorage:{getItem:k=>data.has(k)?data.get(k):null,setItem:(k,v)=>data.set(k,v)},window:{ValeConnections:local},alert:m=>alerts.push(m),structuredClone,KEY:'card-key',CKEY:local.KEY,UNREADABLE_CONTACTS:'Saved browser connections could not be read.'};
  vm.createContext(context);vm.runInContext(html.slice(start,end),context);return {context,data,alerts};
 };
 for(const raw of ['{corrupt','{}','[null]','["bad"]']){
  const {context,data,alerts}=run({[local.KEY]:raw});
  assert.equal(context.save(local.KEY,[{id:'new'}]),false,raw);assert.equal(data.get(local.KEY),raw);assert.equal(alerts.length,1);
  assert.equal(context.save(local.KEY,[]),false,'delete-all must not replace unreadable data');assert.equal(data.get(local.KEY),raw);
  assert.equal(context.save('card-key',{fullName:'Synthetic'}),true,'My Card saving is unaffected');
 }
 const good=run({[local.KEY]:JSON.stringify([{id:'a'}])});assert.equal(good.context.save(local.KEY,[{id:'a'},{id:'b'}]),true);assert.equal(JSON.parse(good.data.get(local.KEY)).length,2);
 const empty=run({});assert.equal(empty.context.save(local.KEY,[{id:'first'}]),true);assert.equal(empty.alerts.length,0);
});

check('Overview totals include cloud connections without double counting imports',()=>{
 assert.match(html,/renderOverview/);assert.match(html,/vale-cloud-connections-loaded/);
 const today='2026-11-03';
 const browser=[{id:'1',cnext:'Follow up',cdate:'2026-11-01'},{id:'2',cnext:'Completed',cdate:'2026-01-01'},{id:'3',cnext:'Follow up',cdate:''},{id:'4',source_identity:'card:x',cnext:'Stay in touch',cdate:'2026-12-01'}];
 assert.deepEqual({...core.overview(browser,[],today)},{count:4,follow:3,overdue:1});
 const cloud=[{source_identity:'local:1',next_step:'Follow up',follow_up_on:null},{source_identity:'card:x',next_step:'Completed',follow_up_on:'2026-01-01'},{source_identity:null,next_step:'Send a quote',follow_up_on:'2026-11-02'},{source_identity:'card:y',next_step:'Follow up',follow_up_on:today}];
 assert.deepEqual({...core.overview(browser,cloud,today)},{count:6,follow:4,overdue:1});
 assert.deepEqual({...core.overview([],[],today)},{count:0,follow:0,overdue:0});
});

if(failed){console.error(failed+' check(s) failed.');process.exitCode=1}
else console.log('PASS: websites without https:// are kept and unsafe values rejected; unreadable browser contacts are never replaced; Overview includes cloud connections without double counting.');
