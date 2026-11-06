// Keeps the app and the last report available offline. Always tries the network first.
const CACHE = "delivery-desk-v3";
const SHELL = ["./", "./index.html", "./app.js", "./manifest.webmanifest", "./icon.svg"];

self.addEventListener("install", (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (e) => e.waitUntil(
  caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  const url = new URL(e.request.url);
  const key = url.origin + url.pathname;
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
    return res;
  }).catch(() => caches.match(key)));
});
