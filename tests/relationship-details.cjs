// Relationship details, search and filters, including backup and restore of the new fields.
const path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const core=require(path.join(root,'cloud-connections-core.js')),exporter=require(path.join(root,'connections-export.js')),restore=require(path.join(root,'connections-restore.js'));
const today='2026-11-04';
const rows=[
 {id:'a',full_name:'Ana Ruiz',business_name:'Delta Signs',email:'ana@example.invalid',phone:'',job_title:'',notes:'Wants a banner',category:'Customer',next_step:'Follow up',follow_up_on:'2026-11-01',met_where:'Dallas Expo',met_how:'Trade show',introduced_by:'Sam Lee',history:[{date:'2026-10-01',text:'Discussed vinyl pricing'}]},
 {id:'b',full_name:'Ben Cole',business_name:'',email:'',phone:'555-0100',job_title:'Owner',notes:'',category:'Partner',next_step:'Completed',follow_up_on:'2026-10-01',met_where:'',met_how:'',introduced_by:'',history:[]},
 {id:'c',full_name:'Cara Diaz',business_name:'',email:'',phone:'',job_title:'',notes:'',category:'Prospect',next_step:'Stay in touch',follow_up_on:today,met_where:'',met_how:'',introduced_by:'',history:[]},
 {id:'d',full_name:'Dev Shah',business_name:'',email:'',phone:'',job_title:'',notes:'',category:'Prospect',next_step:'Follow up',follow_up_on:'2026-12-25',met_where:'',met_how:'',introduced_by:'',history:[]},
 {id:'e',full_name:'Eli Park',business_name:'',email:'',phone:'',job_title:'',notes:'',category:'Other',next_step:'Follow up',follow_up_on:null,met_where:'',met_how:'',introduced_by:'',history:[]},
];
const found=f=>rows.filter(r=>core.matches(r,{today,...f})).map(r=>r.id).join('');
assert.equal(found({}),'abcde');
for(const [query,ids] of [['ana','a'],['  DELTA ','a'],['dallas','a'],['trade show','a'],['sam lee','a'],['vinyl','a'],['banner','a'],['555-0100','b'],['owner','b'],['no match','']])assert.equal(found({query}),ids,query);
assert.equal(found({category:'Prospect'}),'cd');
assert.equal(found({followUp:'due'}),'ac','due includes overdue and today, not completed or future');
assert.equal(found({followUp:'overdue'}),'a');
assert.equal(found({query:'a',category:'Customer',followUp:'overdue'}),'a');
assert.equal(found({query:'zzz',category:'Customer'}),'');
assert.equal(core.matches({id:'x',full_name:'Old',history:null},{today,query:'old'}),true,'older rows without new fields');

const contact={cname:'Synthetic',cmetOn:'2026-01-15',cmetWhere:'Expo',cmetHow:'Trade show',cintroducedBy:'Sam'};
const row=core.payload(contact);assert.equal(row.met_on,'2026-01-15');assert.equal(row.met_where,'Expo');assert.equal(row.met_how,'Trade show');assert.equal(row.introduced_by,'Sam');
assert.equal(core.payload({cname:'Synthetic'}).met_on,null,'blank date is saved as no date');assert.equal(core.payload({cname:'Synthetic'}).met_where,'');
const back=core.toLocal({...row,id:'1'});assert.equal(back.cmetOn,'2026-01-15');assert.equal(back.cintroducedBy,'Sam');

// New fields survive a backup, and older backups without them still restore.
const id='11111111-1111-4111-8111-111111111111';
const saved={id,owner_id:'o',full_name:'Synthetic',category:'Other',next_step:'Follow up',history:[],met_on:'2026-01-15',met_where:'Expo',met_how:'Trade show',introduced_by:'Sam'};
const file=exporter.file([saved],'json');const parsed=restore.parse(file.body).records[0];
assert.equal(parsed.met_on,'2026-01-15');assert.equal(parsed.introduced_by,'Sam');assert.equal(restore.contact(parsed).cmetWhere,'Expo');
const older=JSON.stringify({format:'vale-connect-cloud-connections',version:1,environment:'development',count:1,connections:[{id,full_name:'Older',category:'Other',next_step:'Follow up',history:[]}]});
assert.equal(restore.parse(older).records[0].met_on,null);
assert.throws(()=>restore.parse(older.replace('"history"','"met_on":"not a date","history"')),/invalid or unsupported/);
assert.throws(()=>restore.parse(older.replace('"history"','"introduced_by":"'+'x'.repeat(121)+'","history"')),/invalid or unsupported/);
console.log('PASS: relationship details save and load; search across details and history; category and follow-up filters; backup and restore include the new fields; older data still works.');
