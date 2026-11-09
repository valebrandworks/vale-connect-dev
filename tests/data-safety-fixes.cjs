// Regression tests for defects recorded in docs/phase-0-baseline.md and the Free interface milestone.
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
 // Cards show websites typed without https://, and never turn unsafe values into links.
 const view=require(path.join(root,'card-view.js'));
 assert.equal(view.web('example.com'),'https://example.com/');assert.equal(view.web('http://example.com'),'http://example.com/');
 for(const unsafe of ['javascript:alert(1)','data:text/html,x','mailto:a@example.com','file:///c:/x','localhost','not a website'])assert.equal(view.web(unsafe),null,unsafe);
 assert.match(viewer,/ValeCardView\.render\(values,\{preset:data\.appearance,\.\.\.shown\}\)/);
 assert.match(viewer,/\[\['photoUrl',data\.photo_path\],\['logoUrl',data\.logo_path\]\]/,'the public page shows the photo and the logo');
 assert.match(viewer,/images\.objectUrl\(client,path\)/,'the public page loads images with the visitor\'s own permissions, never a public address');
 assert.doesNotMatch(viewer,/getPublicUrl|createSignedUrl/);
 // Appearance presets: only the four known names; anything else shows Charcoal.
 assert.deepEqual(view.PRESETS,['charcoal','ivory','midnight','slate']);
 for(const [given,shown] of [['ivory','ivory'],['midnight','midnight'],['slate','slate'],['charcoal','charcoal'],['neon','charcoal'],[undefined,'charcoal'],['"><script>','charcoal']])assert.equal(view.preset(given),shown,String(given));
 const row={id:'11111111-1111-4111-8111-111111111111',full_name:'Synthetic',category:'Other',next_step:'Follow up',history:[],website:core.payload({cname:'x',cwebsite:'a'.repeat(190)+'.example.com/'}).website};
 assert.ok(row.website.length>200);
 assert.equal(restore.parse(JSON.stringify({format:'vale-connect-cloud-connections',version:1,environment:'development',count:1,connections:[row]})).count,1);
});

check('public cards show the website once, and well-known platforms as icons',()=>{
 globalThis.ValePlatforms=require(path.join(root,'platform-icons.js'));const view=require(path.join(root,'card-view.js'));
 const {website,socials}=view.links({website:'www.example.com',socials:'Website | https://example.com/\nhttps://www.example.com\nLinkedIn | https://www.linkedin.com/in/someone\nhttps://linkedin.com/in/someone/\ninstagram.com/someone\nPortfolio | https://portfolio.example.org\njavascript:alert(1)'});
 assert.equal(website,'https://www.example.com/');
 assert.deepEqual(socials.map(l=>[l.label,l.platform]),[['LinkedIn','linkedin'],['Instagram','instagram'],['Portfolio',null]],'the website and repeated links appear once; unsafe lines are dropped');
 assert.equal(globalThis.ValePlatforms.platform('https://evil-linkedin.com.example/x'),null,'look-alike addresses get no platform icon');
 assert.equal(globalThis.ValePlatforms.platform('https://m.facebook.com/x'),'facebook');
});

check('the app never writes to browser storage, so older browser data can’t be overwritten',()=>{
 const loaded=[...html.matchAll(/<script src="([a-z0-9-]+\.js)/g)].map(m=>m[1]);
 assert.ok(loaded.includes('import-local.js')&&!loaded.includes('connections-ui.js'));
 for(const file of loaded){const source=fs.readFileSync(path.join(root,file),'utf8');assert.doesNotMatch(source,/localStorage\.setItem/,file)}
 assert.doesNotMatch(html,/localStorage\.setItem/);
});

check('connection totals count cloud connections without double counting imports',()=>{
 const today='2026-11-03';
 const browser=[{id:'1',cnext:'Follow up',cdate:'2026-11-01'},{id:'2',cnext:'Completed',cdate:'2026-01-01'},{id:'3',cnext:'Follow up',cdate:''},{id:'4',source_identity:'card:x',cnext:'Stay in touch',cdate:'2026-12-01'}];
 assert.deepEqual({...core.overview(browser,[],today)},{count:4,follow:3,overdue:1});
 const cloud=[{source_identity:'local:1',next_step:'Follow up',follow_up_on:null},{source_identity:'card:x',next_step:'Completed',follow_up_on:'2026-01-01'},{source_identity:null,next_step:'Send a quote',follow_up_on:'2026-11-02'},{source_identity:'card:y',next_step:'Follow up',follow_up_on:today}];
 assert.deepEqual({...core.overview(browser,cloud,today)},{count:6,follow:4,overdue:1});
 assert.deepEqual({...core.overview([],[],today)},{count:0,follow:0,overdue:0});
});

if(failed){console.error(failed+' check(s) failed.');process.exitCode=1}
else console.log('PASS: websites without https:// are kept and unsafe values rejected; public cards show the website once with platform icons; the app never overwrites browser data; totals don’t double count imports.');
