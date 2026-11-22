const CACHE='cronobalance-shell-v24';
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(['./','./manifest.webmanifest']))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{const request=event.request;const url=new URL(request.url);if(request.method!=='GET'||url.pathname.includes('/api/'))return;event.respondWith(fetch(request).then(response=>{if(response.ok&&url.origin===location.origin){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(request,copy));}return response;}).catch(()=>caches.match(request).then(cached=>cached||caches.match('./')));});
