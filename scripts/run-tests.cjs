// Runs every test suite in tests/. Each runs with file writes and network access blocked.
const {spawnSync}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'tests');
const suites=fs.readdirSync(dir).filter(name=>name.endsWith('.cjs')).sort();
let failed=0;
for(const name of suites){
 const result=spawnSync(process.execPath,['--permission','--allow-fs-read=*',path.join(dir,name)],{cwd:root,encoding:'utf8',timeout:60000});
 if(result.status===0){console.log('pass  '+name);continue}
 failed++;
 console.error('FAIL  '+name+(result.error?' ('+result.error.message+')':''));
 const output=(result.stdout||'')+(result.stderr||'');if(output.trim())console.error(output.trim());
}
console.log('\n'+(suites.length-failed)+' of '+suites.length+' suites passed.');
if(failed)process.exitCode=1;
