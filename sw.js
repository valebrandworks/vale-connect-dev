/* Development scope only. Cache static offline artwork/screen, never account or card responses. */
'use strict';
const CACHE_PREFIX='vale-connect-dev-pwa-';
const CACHE_NAME=CACHE_PREFIX+'v7';
const scope=new URL(self.registration.scope);
const staticPaths=['offline.html','assets/icons/icon-192.png','assets/icons/icon-512.png','assets/icons/maskable-512.png','assets/icons/apple-touch-icon.png'];
const staticURLs=staticPaths.map(path=>new URL(path,scope).href);
const offlineURL=new URL('offline.html',scope).href;

self.addEventListener('install',event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(CACHE_NAME);
  // No app HTML, query URLs, cloud API requests, tokens, profiles, or contacts.
  await cache.addAll(staticURLs.map(url=>new Request(url,{cache:'reload'})));
 })());
 // An update waits until the user chooses to reload or closes older app windows.
});
self.addEventListener('activate',event=>{
 event.waitUntil((async()=>{
  for(const key of await caches.keys())if(key.startsWith(CACHE_PREFIX)&&key!==CACHE_NAME)await caches.delete(key);
  await self.clients.claim();
 })());
});
self.addEventListener('message',event=>{
 if(event.data?.type==='ACTIVATE_UPDATE'&&event.source?.url){
  const source=new URL(event.source.url);
  if(source.origin===scope.origin&&source.pathname.startsWith(scope.pathname))self.skipWaiting();
 }
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
 if(request.mode==='navigate'){
  event.respondWith((async()=>{
   try{return await fetch(request,{cache:'no-store'})}
   catch{
    const cache=await caches.open(CACHE_NAME),fallback=await cache.match(offlineURL);
    return fallback||new Response('VALE Connect needs an internet connection.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});
   }
  })());
  return;
 }
 // Strict exact-URL allowlist: no runtime caching of page/API/query responses.
 if(staticURLs.includes(url.href))event.respondWith((async()=>{
  const cache=await caches.open(CACHE_NAME);
  return (await cache.match(url.href))||fetch(request);
 })());
});
