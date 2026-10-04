/* HELIX/OPS service worker — static assets only. Never cache /api or live data. */
const VER = "hos0503";
const CACHE = "helix-ops-" + VER;

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE));
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith("helix-ops-") && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const u = new URL(req.url);
  if (u.origin !== self.location.origin) return;
  if (u.pathname.includes("/api/")) return;
  if (/\/(login|logout)$/.test(u.pathname.replace(/\/$/, ""))) return;
  const nav = req.mode === "navigate" || req.destination === "document";
  if (nav) {
    e.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }
  if (!/\.(css|js|svg|png|webmanifest|ico)$/.test(u.pathname) && !u.pathname.endsWith("/manifest.webmanifest")) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const net = fetch(req).then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit || net;
  })());
});
