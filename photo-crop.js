/* Square photo cropping and optimisation in the browser. Nothing leaves the device until the person saves.
   Re-encoding through a canvas also drops hidden metadata such as a phone photo's location. */
(function(root){
 'use strict';
 const OUTPUT=512,MAX_INPUT_BYTES=20*1024*1024,MAX_ZOOM=4;
 // The visible square shows the image scaled to cover it ("zoom" 1 = just covers), positioned by offset.
 function state(width,height,view){
  const base=view/Math.min(width,height),scale=base;
  return clamp({width,height,view,base,zoom:1,scale,x:(view-width*scale)/2,y:(view-height*scale)/2});
 }
 // The image must always cover the square: no empty edges.
 function clamp(s){
  const w=s.width*s.scale,h=s.height*s.scale;
  return {...s,x:Math.min(0,Math.max(s.view-w,s.x)),y:Math.min(0,Math.max(s.view-h,s.y))};
 }
 function pan(s,dx,dy){return clamp({...s,x:s.x+dx,y:s.y+dy})}
 // Zooms around the centre of the square, so the face being framed stays put.
 function zoomTo(s,zoom){
  const z=Math.min(MAX_ZOOM,Math.max(1,Number(zoom)||1)),scale=s.base*z;
  const cx=(s.view/2-s.x)/s.scale,cy=(s.view/2-s.y)/s.scale;
  return clamp({...s,zoom:z,scale,x:s.view/2-cx*scale,y:s.view/2-cy*scale});
 }
 // The part of the original image inside the square, in original pixels.
 function source(s){const size=s.view/s.scale;return {x:-s.x/s.scale,y:-s.y/s.scale,size}}
 function check(file){
  if(!file)return 'Choose a photo.';
  if(file.size>MAX_INPUT_BYTES)return 'That photo is too large to work with. Choose one under 20 MB.';
  if(file.type&&!/^image\//.test(file.type))return 'Choose a photo (JPG, PNG, WebP or HEIC).';
  return '';
 }
 async function decode(file){
  try{return await root.createImageBitmap(file,{imageOrientation:'from-image'})}
  catch{throw Error('This photo can’t be opened here. Try a JPG or PNG.')}
 }
 function draw(canvas,bitmap,s){
  const ctx=canvas.getContext('2d'),k=canvas.width/s.view;
  ctx.fillStyle='#111317';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.drawImage(bitmap,s.x*k,s.y*k,s.width*s.scale*k,s.height*s.scale*k);
 }
 // 512 × 512, WebP where the browser can make it, otherwise JPEG. Returns {blob, ext}.
 async function encode(bitmap,s,doc=root.document){
  const c=doc.createElement('canvas');c.width=c.height=OUTPUT;
  const ctx=c.getContext('2d'),r=source(s);ctx.imageSmoothingQuality='high';
  ctx.drawImage(bitmap,r.x,r.y,r.size,r.size,0,0,OUTPUT,OUTPUT);
  const blob=(type,q)=>new Promise(res=>c.toBlob(res,type,q));
  let out=await blob('image/webp',0.85);
  if(out&&out.type==='image/webp')return {blob:out,ext:'webp'};
  out=await blob('image/jpeg',0.88);
  if(!out)throw Error('This browser couldn’t prepare the photo.');
  return {blob:out,ext:'jpg'};
 }
 const api={OUTPUT,MAX_ZOOM,state,clamp,pan,zoomTo,source,check,decode,draw,encode};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.ValePhotoCrop=api;
})(typeof window!=='undefined'?window:globalThis);
