// public/sw.js
// Cache-busting SW that updates cleanly

const CACHE = "notes-v4";

const ASSETS = [
  "/",
  "/index.html",
  "/manifest.json",
  "/sw.js",
  "/icon-192.png",
  "/icon-512.png",
  "/og.png",
  "/chat.html",
  "/chat.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => (k === CACHE ? null : caches.delete(k))));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Network-first for HTML (so updates show), cache-first for assets
  const isHTML = event.request.headers.get("accept")?.includes("text/html");

  if (isHTML) {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
          return res;
        })
        .catch(() => caches.match(event.request).then((r) => r || caches.match("/index.html")))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return res;
      });
    })
  );
});
