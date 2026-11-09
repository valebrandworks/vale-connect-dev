// Square cropping math, contact-file photos and upload naming.
const path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
const crop=require(path.join(root,'photo-crop.js')),tools=require(path.join(root,'cards-core.js')),images=require(path.join(root,'card-images.js'));
const close=(a,b)=>Math.abs(a-b)<1e-6;
// A wide photo starts centred and just covers the square: no empty edges.
let s=crop.state(4000,3000,560);
assert.ok(close(s.scale,560/3000));assert.ok(close(s.y,0));assert.ok(close(s.x,(560-4000*s.scale)/2));
let r=crop.source(s);assert.ok(close(r.size,3000));assert.ok(close(r.x,500));assert.ok(close(r.y,0));
// Panning stops at the edges.
s=crop.pan(s,10000,10000);assert.equal(s.x,0);assert.equal(s.y,0);
s=crop.pan(s,-10000,-10000);assert.ok(close(s.x,560-4000*s.scale));assert.ok(close(s.y,0),'a photo exactly as tall as the square can\'t move vertically');
// Zooming keeps the centre of the square on the same point of the photo, within 1–4×.
s=crop.state(1000,1000,560);const before=crop.source(s);s=crop.zoomTo(s,2);r=crop.source(s);
assert.ok(close(r.x+r.size/2,before.x+before.size/2)&&close(r.y+r.size/2,before.y+before.size/2));assert.ok(close(r.size,500));
assert.equal(crop.zoomTo(s,99).zoom,crop.MAX_ZOOM);assert.equal(crop.zoomTo(s,0).zoom,1);assert.equal(crop.zoomTo(s,'x').zoom,1);
// The cropped area always stays inside the photo.
for(const [w,h] of [[3000,4000],[640,480],[513,4000]]){let t=crop.state(w,h,560);for(const z of [1,1.7,4])for(const [dx,dy] of [[-9999,0],[9999,9999],[123,-77]]){t=crop.pan(crop.zoomTo(t,z),dx,dy);const q=crop.source(t);assert.ok(q.x>=-1e-6&&q.y>=-1e-6&&q.x+q.size<=w+1e-6&&q.y+q.size<=h+1e-6,`${w}x${h} z${z}`)}}
// Input checks.
assert.equal(crop.check(null),'Choose a photo.');assert.match(crop.check({size:25*1024*1024,type:'image/jpeg'}),/under 20 MB/);assert.match(crop.check({size:10,type:'application/pdf'}),/Choose a photo/);assert.equal(crop.check({size:10,type:'image/heic'}),'');
// Contact files: a JPEG photo line, folded to 75 characters, only for valid base64.
const v=tools.vcard({fullName:'Ana'},'QUJD'.repeat(60)).split('\r\n');
const photoAt=v.findIndex(l=>l.startsWith('PHOTO;ENCODING=b;TYPE=JPEG:'));assert.ok(photoAt>0);
assert.ok(v.every(l=>l.length<=75));assert.ok(v.slice(photoAt+1,-1).every(l=>l.startsWith(' ')));
assert.equal(v.at(-1),'END:VCARD');
assert.equal(v.slice(photoAt,-1).map((l,i)=>i?l.slice(1):l).join('').replace('PHOTO;ENCODING=b;TYPE=JPEG:',''),'QUJD'.repeat(60),'unfolding gives back the exact photo');
assert.doesNotMatch(tools.vcard({fullName:'Ana'},'not base64!\r\nX-EVIL:1'),/PHOTO|X-EVIL/,'nothing but base64 goes into the photo line');
assert.doesNotMatch(tools.vcard({fullName:'Ana'}),/PHOTO/);
// Uploads: a fresh name in the card's own folder, the right type, never overwriting.
(async()=>{
 const calls=[];const client={storage:{from:()=>({upload:async(p,b,o)=>{calls.push({p,o});return {error:null}}})}};
 const card='11111111-1111-4111-8111-111111111111';
 const p=await images.upload(client,card,'photo',{},'webp');
 assert.match(p,images.PATH);assert.ok(p.startsWith(card+'/photo-'));assert.equal(calls[0].o.contentType,'image/webp');assert.equal(calls[0].o.upsert,false);assert.equal(calls[0].o.cacheControl,'300');
 assert.equal(calls.length,1);await images.upload(client,card,'photo',{},'jpg');assert.equal(calls[1].o.contentType,'image/jpeg');
 await assert.rejects(images.upload(client,card,'avatar',{},'webp'),/Unsupported/);await assert.rejects(images.upload(client,card,'photo',{},'svg'),/Unsupported/);await assert.rejects(images.upload(client,'../etc','photo',{},'webp'),/Unexpected/);
 console.log('PASS: crop starts centred and covering; panning and zoom stay inside the photo; input checks; contact photo folded and base64-only; uploads named inside the card folder, typed, never overwriting.');
})().catch(e=>{console.error(e);process.exitCode=1});
