const CACHE = "saathi-static-v1";
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.add("/offline.html")));
  self.skipWaiting();
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith("saathi-static-") && key !== CACHE).map(key => caches.delete(key)),
  )).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  if (event.request.method === "GET" && event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/offline.html")));
  }
});
