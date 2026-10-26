/* HELIX/OPS service worker — makes the app installable and lets the shell open offline.
   App files: network first (so updates arrive immediately), cache as fallback.
   Never caches /api, /login, /logout or the live stream. */
const VERSION = "hos1200";
const CACHE = "helix-shell-" + VERSION;
const SHELL = ["./", "app/arcade.css", "app/core.js", "app/mesh.js", "app/avatar.js", "app/pages.js", "app/lights.js", "app/admin.js", "app/manifest.webmanifest",
  "app/icons/icon-192.png", "app/icons/icon-512.png", "app/icons/apple-touch-icon.png", "helix-arcade-mark.svg",
  "app/fonts/silkscreen-400.woff", "app/fonts/silkscreen-700.woff", "app/fonts/vt323-400.woff",
  "app/fonts/plexmono-400.woff", "app/fonts/plexmono-500.woff", "app/fonts/plexmono-600.woff"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { credentials: "same-origin" })).catch(() => null)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("helix-shell-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (/\/(api|login|logout|legacy)(\/|$|\?)/.test(url.pathname)) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok && res.type === "basic" && !res.redirected) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((hit) => hit || (req.mode === "navigate" ? caches.match("./") : Response.error())))
  );
});
