const CACHE = "admin-ch-v1";
const ASSETS = [
  "./admin.html",
  "./admin.js",
  "./manifest.webmanifest"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  e.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      // cache solo GET same-origin
      try {
        const url = new URL(req.url);
        if (req.method === "GET" && url.origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
      } catch {}
      return res;
    }).catch(() => cached))
  );
});
