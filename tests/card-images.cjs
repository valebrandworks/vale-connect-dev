// Image name rotation when a card is made private, with a simulated storage service and database.
const path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const images=require(path.join(root,'card-images.js'));
const CARD='11111111-1111-4111-8111-111111111111',OWNER='owner-a';
let n=0;const random=()=>'r'+String(++n).padStart(17,'0');
const P=(kind,id,ext='webp')=>CARD+'/'+kind+'-'+id.padEnd(16,'0')+'.'+ext;

function world({files=[],card={},fail={}}={}){
 const store=new Map(files.map(f=>[f.path??f,{created:f.created??0}])),calls=[];
 let row={id:CARD,owner_id:OWNER,published:true,revision:4,appearance:'midnight',display_name:'Synthetic',photo_path:null,logo_path:null,...card};
 const count={copy:0,remove:0,update:0};
 const bucket={
  list:async dir=>{calls.push('list');if(fail.list)return {data:null,error:{message:'list failed'}};return {data:[...store].filter(([p])=>p.startsWith(dir+'/')).map(([p,v])=>({id:'x',name:p.slice(dir.length+1),created_at:new Date(v.created).toISOString()})),error:null}},
  copy:async(from,to)=>{count.copy++;calls.push('copy');if(fail.copy===count.copy)return {error:{message:'copy failed'}};if(!store.has(from))return {error:{message:'not found'}};if(store.size>=4&&[...store.keys()].filter(k=>k.startsWith(CARD)).length>=4)return {error:{message:'limit'}};store.set(to,{created:Date.now()});return {data:{path:to},error:null}},
  remove:async paths=>{count.remove++;calls.push('remove');if(fail.remove&&fail.remove(count.remove))return {error:{message:'remove failed'}};for(const p of paths)store.delete(p);return {data:[],error:null}}
 };
 const client={storage:{from:()=>bucket},from:()=>{const q={f:{},update(p){this.p=p;return this},eq(k,v){this.f[k]=v;return this},select(){return this},
  maybeSingle:async function(){count.update++;calls.push('update');if(fail.updateError)return {data:null,error:{message:'network'}};if(this.f.owner_id!==row.owner_id||this.f.revision!==row.revision||fail.conflict)return {data:null,error:null};row={...row,...this.p};return {data:{...row},error:null}}};return q}};
 return {client,store,row:()=>row,calls,count};
}
const files=w=>[...w.store.keys()].sort();

(async()=>{
 // Zero images: just made private.
 let w=world();let r=await images.makePrivate(w.client,OWNER,w.row(),{},{random});
 assert.equal(r.ok,true);assert.equal(w.row().published,false);assert.deepEqual(files(w),[]);
 // One image: renamed; old file gone; the card points at the new one; appearance and other fields kept.
 w=world({files:[P('photo','a')],card:{photo_path:P('photo','a')}});r=await images.makePrivate(w.client,OWNER,w.row(),{display_name:'Edited'},{random});
 assert.equal(r.ok,true);assert.equal(w.row().published,false);assert.notEqual(w.row().photo_path,P('photo','a'));assert.match(w.row().photo_path,images.PATH);
 assert.deepEqual(files(w),[w.row().photo_path]);assert.equal(w.row().appearance,'midnight');assert.equal(w.row().display_name,'Edited');assert.equal(w.row().logo_path,null);assert.equal(w.row().revision,5);
 // Two images: both renamed, kind and file type kept.
 w=world({files:[P('photo','a'),P('logo','b','png')],card:{photo_path:P('photo','a'),logo_path:P('logo','b','png')}});r=await images.makePrivate(w.client,OWNER,w.row(),{},{random});
 assert.equal(r.ok,true);assert.match(w.row().photo_path,/\/photo-r0+\d+\.webp$/);assert.match(w.row().logo_path,/\/logo-r0+\d+\.png$/);assert.deepEqual(files(w),[w.row().logo_path,w.row().photo_path].sort());
 // Four stored images (two attached, two left over): leftovers removed first, then rotation fits the 4-file limit.
 w=world({files:[P('photo','a'),P('logo','b'),P('photo','c'),P('logo','d')],card:{photo_path:P('photo','a'),logo_path:P('logo','b')}});r=await images.makePrivate(w.client,OWNER,w.row(),{},{random});
 assert.equal(r.ok,true);assert.deepEqual(files(w),[w.row().logo_path,w.row().photo_path].sort());assert.equal(files(w).length,2);
 // Copy fails part-way: copies removed, card still public with its original images. Nothing lost.
 const two={files:[P('photo','a'),P('logo','b')],card:{photo_path:P('photo','a'),logo_path:P('logo','b')}};
 w=world({...two,fail:{copy:2}});r=await images.makePrivate(w.client,OWNER,w.row(),{},{random});
 assert.equal(r.ok,false);assert.equal(r.changed,false);assert.equal(r.stage,'copy');assert.equal(w.row().published,true);assert.deepEqual(files(w),[P('logo','b'),P('photo','a')].sort());assert.equal(w.row().photo_path,P('photo','a'));
 // The card changed on another device: nothing changed, copies removed.
 w=world({...two,fail:{conflict:true}});r=await images.makePrivate(w.client,OWNER,w.row(),{},{random});
 assert.equal(r.ok,false);assert.equal(r.conflict,true);assert.equal(r.changed,false);assert.equal(w.row().published,true);assert.deepEqual(files(w),[P('logo','b'),P('photo','a')].sort());
 // Network error on the update: same.
 w=world({...two,fail:{updateError:true}});r=await images.makePrivate(w.client,OWNER,w.row(),{},{random});
 assert.equal(r.ok,false);assert.equal(r.changed,false);assert.equal(w.row().published,true);assert.equal(files(w).length,2);
 // Another account (or a visitor) can't make it private: the guarded update matches nothing, and copies are removed.
 w=world(two);r=await images.makePrivate(w.client,'someone-else',w.row(),{},{random});
 assert.equal(r.ok,false);assert.equal(r.changed,false);assert.equal(w.row().published,true);assert.deepEqual(files(w),[P('logo','b'),P('photo','a')].sort());
 // Old files can't be deleted: the card IS private with new images, but this is reported as incomplete, never as success.
 w=world({...two,fail:{remove:k=>k>=1}});r=await images.makePrivate(w.client,OWNER,w.row(),{},{random});
 assert.equal(r.ok,false);assert.equal(r.changed,true);assert.equal(r.stage,'delete');assert.equal(w.row().published,false);
 assert.ok(files(w).includes(w.row().photo_path)&&files(w).includes(P('photo','a')),'new images kept; old ones still waiting');
 // Finishing later removes the old files and confirms; the new images are never touched.
 const stuck=w;stuck.count.remove=-100;r=await images.finishPrivate(stuck.client,stuck.row());
 assert.equal(r.ok,true);assert.deepEqual(files(stuck),[stuck.row().logo_path,stuck.row().photo_path].sort());
 // Interrupted after copying (page closed): the card is unchanged; the stray copies are removed by the background tidy-up once old enough.
 w=world({files:[{path:P('photo','a'),created:0},{path:P('photo','z'),created:Date.now()}],card:{photo_path:P('photo','a')}});
 assert.equal(await images.sweep(w.client,[w.row()]),0,'a fresh upload another device may be attaching is left alone');
 assert.equal(await images.sweep(w.client,[w.row()],{now:Date.now()+11*60*1000}),1);assert.deepEqual(files(w),[P('photo','a')]);
 // A storage listing error stops before anything changes.
 w=world({...two,fail:{list:true}});r=await images.makePrivate(w.client,OWNER,w.row(),{},{random});
 assert.equal(r.ok,false);assert.equal(r.changed,false);assert.equal(w.row().published,true);assert.equal(w.calls.includes('copy'),false);
 assert.throws(()=>images.renamed('elsewhere/photo-aaaaaaaaaaaaaaaa.webp'),/Unexpected/);
 console.log('PASS: rotation with 0, 1, 2 and 4 stored images; appearance and edits kept; copy, update, conflict and listing failures change nothing; delete failures reported as incomplete and finished later; other accounts change nothing; stray copies tidied only when old enough.');
})().catch(e=>{console.error(e);process.exitCode=1});
