const assert=require('node:assert/strict'),lists=require('../account-lists.js'),core=require('../cloud-connections-core.js');
function api(records,{cap=137,failPage=0,changeCount=false}={}){let pages=0;return {from(table){assert(['connections','public_cards'].includes(table));return {select(_c,opts){assert.equal(opts.count,'exact');return this},eq(k,v){assert.equal(k,'owner_id');assert.equal(v,'owner-a');return this},order(k){assert.equal(k,'id');return this},async range(from,to){pages++;if(failPage===pages)return {error:Error('Network interrupted')};return {data:records.slice(from,Math.min(to+1,from+cap)),count:records.length+(changeCount&&pages>1?1:0)}}}}}}
(async()=>{
 const rows=Array.from({length:1003},(_,i)=>({id:String(i).padStart(5,'0'),owner_id:'owner-a',updated_at:i%2?'2026-11-02':'2026-11-03'}));
 for(const table of ['connections','public_cards'])assert.equal((await lists.read(api(rows),table,'owner-a')).length,1003);
 const sorted=await core.list(api(rows),'owner-a');assert.equal(sorted.length,1003);assert.equal(sorted[0].updated_at,'2026-11-03');assert(sorted.slice(0,502).every(r=>r.updated_at==='2026-11-03'));
 const sharedRows=rows.map((r,i)=>({...r,full_name:'Person '+i,source_identity:i===1002?'card:last-page':''}));assert.equal(core.duplicate(await core.list(api(sharedRows),'owner-a'),{source_identity:'card:last-page'}).exact,true);
 assert.equal((await lists.read(api([]),'connections','owner-a')).length,0);
 await assert.rejects(lists.read(api(rows,{failPage:2}),'connections','owner-a'),/Network interrupted/);
 await assert.rejects(lists.read(api(rows,{changeCount:true}),'connections','owner-a'),/changed while loading/);
 await assert.rejects(lists.read(api([{id:'wrong',owner_id:'owner-b'}]),'connections','owner-a'),/verify/);
 await assert.rejects(lists.read(api([rows[0],rows[0]]),'connections','owner-a'),/verify/);
 let checks=0;await assert.rejects(lists.read(api(rows),'connections','owner-a',()=>++checks<3),/Account changed/);
 console.log('PASS: complete 1003-record connections/cards across lower-cap pages; stable order and newest-first connection display; empty list; failed page/count change/duplicate/wrong owner abort without partial return; account change cancels further pages.');
})().catch(e=>{console.error(e);process.exitCode=1});
