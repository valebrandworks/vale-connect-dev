// Connection backups are tied to the environment of the page's web address (config.js), never to data inside a backup file.
// Development keeps its existing labels; production uses its own; each refuses the other's backups; the production bundle
// cannot export or restore on an unknown address and contains no development backup labels. No network; nothing is written.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{pathToFileURL}=require('node:url');
const root=path.join(__dirname,'..');
const row={id:'11111111-1111-4111-8111-111111111111',full_name:'Backup Test Person',business_name:'',email:'',phone:'',job_title:'',website:'',social_links:'',category:'Other',next_step:'Follow up',notes:'x',history:[]};
const NOW=new Date('2026-11-02T12:00:00Z');

// Loads config, the shared connections code, the exporter and the restorer into one page-like context for a given web address.
function page(files,hostname){
  const ctx={window:{location:{hostname}},TextEncoder,TextDecoder,structuredClone,URL,Blob};ctx.window.window=ctx.window;vm.createContext(ctx);
  for(const name of ['config.js','cloud-connections-core.js','connections-export.js','connections-restore.js'])vm.runInContext(files.get(name).toString('utf8'),ctx,{filename:name});
  return {exp:ctx.window.ValeConnectionExport,restore:ctx.window.ValeConnectionRestore};
}

(async()=>{
  const b=await import(pathToFileURL(path.join(root,'scripts','build-release.mjs')).href);
  const prod=b.bundle();
  const source=new Map(['config.js','cloud-connections-core.js','connections-export.js','connections-restore.js'].map(n=>[n,fs.readFileSync(path.join(root,n))]));
  const NAME=/^vale-(dev|connect)-cloud-connections-2026-11-02T12-00-00-000Z\.json$/;

  // Development (source files): existing labels, for the development site and for this computer.
  for(const host of ['dev.valebrandworks.com','localhost','127.0.0.1']){
    const {exp,restore}=page(source,host),out=exp.file([row],'json',NOW),body=JSON.parse(out.body);
    assert.equal(body.environment,'development',host+': development backups keep the development label');
    assert.equal(out.name,'vale-dev-cloud-connections-2026-11-02T12-00-00-000Z.json',host+': development file name unchanged');
    assert.equal(restore.parse(out.body).count,1,host+': its own backup restores');
  }
  // Existing development backups (made before this change) still restore in development.
  const legacy=JSON.stringify({format:'vale-connect-cloud-connections',version:1,environment:'development',exported_at:NOW.toISOString(),count:1,connections:[{...row}]});
  assert.equal(page(source,'dev.valebrandworks.com').restore.parse(legacy).count,1,'an existing development backup still restores in development');

  // Production (the real release bundle): its own labels.
  const P=page(prod,'connect.valebrandworks.com'),pout=P.exp.file([row],'json',NOW),pbody=JSON.parse(pout.body);
  assert.equal(pbody.environment,'production','production backups say production');
  assert.equal(pout.name,'vale-connect-cloud-connections-2026-11-02T12-00-00-000Z.json','production file name');
  assert.match(P.exp.file([row],'csv',NOW).name,/^vale-connect-cloud-connections-.*\.csv$/,'production CSV file name');
  assert.equal(P.restore.parse(pout.body).count,1,'a production backup restores in production');

  // Cross-environment restores are refused, in both directions, whatever the file claims.
  const D=page(source,'dev.valebrandworks.com'),dout=D.exp.file([row],'json',NOW);
  assert.throws(()=>P.restore.parse(dout.body),/isn’t a VALE Connect backup/,'production refuses a development backup');
  assert.throws(()=>P.restore.parse(legacy),/isn’t a VALE Connect backup/,'production refuses an existing development backup');
  assert.throws(()=>D.restore.parse(pout.body),/isn’t a VALE Connect backup/,'development refuses a production backup');
  for(const v of ['','PRODUCTION','Production',' production','development ','local',null,1])assert.throws(()=>P.restore.parse(JSON.stringify({...pbody,environment:v})),/isn’t a VALE Connect backup/,'production refuses environment '+JSON.stringify(v));
  assert.throws(()=>P.restore.parse(JSON.stringify({...pbody,environment:undefined})),/isn’t a VALE Connect backup/,'production refuses a backup with no environment');

  // The environment comes from the web address, not from the file: the same file is judged by where it is opened.
  assert.equal(page(source,'connect.valebrandworks.com').restore.parse(pout.body).count,1,'the same bundle-independent rule applies to the production address in the source');

  // The production bundle fails closed on any other address (no development fallback is shipped).
  for(const host of ['vale-connect-prod.pages.dev','x.vale-connect-prod.pages.dev','dev.valebrandworks.com','localhost','valebrandworks.com','']){
    const X=page(prod,host);
    assert.throws(()=>X.exp.file([row],'json',NOW),/not available on this web address/,host+': production bundle refuses to export');
    assert.throws(()=>X.restore.parse(pout.body),/not available on this web address/,host+': production bundle refuses to restore');
  }
  // The same, with no web address at all (nothing to take the environment from).
  const ctx={window:{},TextEncoder,TextDecoder,structuredClone,URL,Blob};ctx.window.window=ctx.window;vm.createContext(ctx);
  for(const name of ['config.js','cloud-connections-core.js','connections-export.js','connections-restore.js'])vm.runInContext(prod.get(name).toString('utf8'),ctx);
  assert.throws(()=>ctx.window.ValeConnectionExport.file([row],'json',NOW),/not available/,'no address: production bundle refuses to export');

  // Release check: no development backup identifier can ship in the production bundle.
  for(const [name,bytes] of prod){
    if(!/\.(html|js|css|webmanifest|txt)$|^_headers$/.test(name))continue;const t=bytes.toString('utf8');
    assert.ok(!t.includes('vale-dev-'),name+' ships a development backup file name');
    assert.ok(!/['"]development['"]/.test(t),name+' ships a quoted development environment label');
  }
  for(const bad of ["vale-dev-cloud-connections-","environment:'development'",'"development"',"'development'"])assert.ok(b.FORBIDDEN.includes(bad),'the release builder forbids '+bad);
  assert.throws(()=>b.check('x.js',"const n='vale-dev-cloud-connections-';"),/development value remains/,'a development backup file name refuses the build');
  assert.throws(()=>b.check('x.js',"{environment:'development'}"),/development value remains/,'a development backup label refuses the build');

  console.log('backup-environment: development and production backups labelled and restored per environment; cross-environment restores refused; production fails closed on unknown addresses; no development backup labels in the release');
})().catch(e=>{console.error(e);process.exit(1)});
