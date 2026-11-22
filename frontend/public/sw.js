/* The build replaces these two declarations with its asset digest and inventory. */
const RELEASE = 'development';
const SHELL = ['./', './index.html', './manifest.webmanifest'];
const prefix='cronobalance:'+new URL(self.registration.scope).pathname+':',cacheName=prefix+RELEASE;
const paths=new Set(SHELL.map(file=>new URL(file,self.registration.scope).href));
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(cacheName);await cache.addAll(SHELL);await self.skipWaiting()})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{for(const k of await caches.keys())if(k.startsWith(prefix)&&k!==cacheName)await caches.delete(k);await self.clients.claim()})()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==location.origin||!url.href.startsWith(self.registration.scope)||url.pathname.includes('/api/'))return;
  if(request.mode==='navigate'){event.respondWith(fetch(request).catch(async()=>await (await caches.open(cacheName)).match('./index.html')||Response.error()));return}
  if(paths.has(url.href))event.respondWith((async()=>await (await caches.open(cacheName)).match(request)||fetch(request))());
});
