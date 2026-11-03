const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const root=process.argv[2]||(fs.existsSync(path.join(__dirname,'index.html'))?__dirname:path.resolve(__dirname,'..'));
const expected='https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js';
for(const file of ['index.html','p.html']){
 const html=fs.readFileSync(path.join(root,file),'utf8');
 const scripts=[...html.matchAll(/<script\b[^>]*src="([^"]+)"/g)].map(x=>x[1]).filter(x=>x.includes('@supabase/supabase-js'));
 assert.deepEqual(scripts,[expected]);assert(!html.includes('supabase-js@2/'));
}
console.log('PASS: app and public viewer each load exactly one Supabase 2.118.0 UMD script; no floating major-version script remains.');
