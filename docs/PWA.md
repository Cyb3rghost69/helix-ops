# Helix OS HTTPS + PWA

Helix ops stays on the Mini Python server (`:8790`). HTTPS is **existing Tailscale Serve**, not a new reverse proxy.

## URL

```
https://mats-mac-mini.taild76dc.ts.net/ops/
```

Certificate: Let's Encrypt via Tailscale (CN `mats-mac-mini.taild76dc.ts.net`). Tailnet only. Funnel off.

LAN HTTP `http://192.168.1.172:8790/` remains for the Mini. Safari will **not** grant microphone there (insecure origin). Use the HTTPS URL on tablets.

Tablet must be on the same Tailscale tailnet.

## Install

iPad Safari (open the HTTPS `/ops/` URL first):

Share → Add to Home Screen

Android Chrome:

Install app / Add to Home Screen

Instructions also live under **[09] VOICE** → TABLET INSTALL (collapsed).

## Service worker

`helix-sw.js` caches CSS/JS/SVG/PNG only. `/api/*` is never cached. HTML is network-first. New `ASSET_V` / `VER` drops old caches.
