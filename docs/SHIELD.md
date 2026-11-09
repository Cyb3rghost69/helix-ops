# RAGNAR SHIELD — `#/shield`

Defensive LAN exposure audit. Check ideas ported from [Ragnar](https://github.com/imperador/ragnar)
(Python 2 IoT pentest tool) into `helix_shield.py` — Python 3 stdlib only, **non-destructive**.

| Ragnar module | SHIELD check |
|---|---|
| netServ | TCP connect sweep of 34 risky ports; read-only probes: Redis `PING`, Docker `/version`, MQTT anonymous `CONNECT`, Elasticsearch `/`, memcached `version`, SSH banner / SSH-1 |
| transCrypt | negotiated TLS version / cipher / bits, PFS, TLS 1.0/1.1 still accepted, cert expiry, self-signed |
| webI | login form or Basic auth over cleartext HTTP, X-Frame-Options / CSP `frame-ancestors`, HSTS, `Server` version leak |
| — (new) | UniFi: new device vs operator baseline, UniFi gear with firmware pending, IPS events + alarms (24h) |
| mrBin | **not ported** (firmware analysis needs images, not a LAN scan) |

**Not ported, by design:** SYN/HTTP floods, SQL injection, XSS payloads, directed fuzzing, credential guessing.
See `docs/DECISIONS.md`.

## Guard rails

- Only private/loopback IPs **and** inside `SHIELD_SCOPE` (default `192.168.1.0/24`). Public IPs are refused even if scope says `0.0.0.0/0`.
- No credentials are ever sent. No secrets in `/api/shield` JSON.
- `POST /api/shield` goes through the deck's normal gate: login, same-origin (CSRF) check, viewer accounts read-only; every action lands in the ADMIN security log; the Unraid container requires a bearer token (24+ chars) and refuses to start without one.
- Runtime state (`shield.db`, `shield-baseline.json`) is gitignored, baseline file mode 0600.

## Score

Cost: HIGH 15 · MED 6 · LOW 2 · INFO 0. `score = 100 / (1 + cost/60)` → A ≥90, B ≥75, C ≥60, D ≥40, F.
- **No HIGH → never below C** (score floor 60). An F means something is genuinely exposed.
- **Known devices:** a plain "port open" MED on a device you own — in the baseline, or given an owner in `clients-aliases.json` — counts as LOW ("routine on a known device"). Specific problems (no-auth Redis/Docker/MQTT, cleartext logins, weak TLS) keep their severity everywhere.
- The deck re-scores after adding owner knowledge and its own posture checks, so the dial, home tile and top-bar chip always agree.

**MUTE** = operator accepted the risk (removed from score, kept visible under SHOW MUTED).
**ACK** = add a new device to the baseline. The first scan seeds the baseline silently.
Hosts are grouped by owner; **UNKNOWN OWNER** is listed first, dashed — name them in `clients-aliases.json`.

## Deploy modes

### A. Unraid container (recommended)

Always-on, wired, independent of the Mini. The deck proxies `/api/shield` to it.

```bash
# on Unraid (from a checkout of this repo)
mkdir -p /mnt/user/appdata/helix-shield
cp unraid/helix-shield/shield.env.example /mnt/user/appdata/helix-shield/shield.env   # fill SHIELD_TOKEN, UNIFI_API_KEY
chmod 600 /mnt/user/appdata/helix-shield/shield.env
chown -R 10001 /mnt/user/appdata/helix-shield
docker build -f unraid/helix-shield/Dockerfile -t helix-shield:latest .
docker run -d --name helix-shield --restart unless-stopped \
  -p 8791:8791 --env-file /mnt/user/appdata/helix-shield/shield.env \
  -v /mnt/user/appdata/helix-shield:/data helix-shield:latest
curl -s http://127.0.0.1:8791/health
```

Then on the Mini, in `ops.env`: `SHIELD_REMOTE=http://192.168.1.84:8791` and the same `SHIELD_TOKEN`; restart `:8790`.
In this mode the Mini does **not** schedule scans; the container does (`SHIELD_INTERVAL_H`, default 6).

### B. Local (fallback)

No `SHIELD_REMOTE` → the scanner runs inside `server.py` on the Mini, targets = `/api/clients` (UniFi + DNS) + infra hosts.

## API

- `GET /api/shield` → `{state, report, history, baseline, interval_h, next_scan, scope, modules, remote?, remote_error?}`
- `POST /api/shield` `{action: scan | mute | unmute (key) | ack_device (dev) | rebaseline}`
