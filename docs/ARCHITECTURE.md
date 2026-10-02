# HELIX/OPS architecture

Factual description of the running Mac dashboard. Planned items are marked.

## Runtime

```
USER ── browser ── :8790 (Mac Mini, 0.0.0.0)
                      │
                      ├── index.html + helix-*.{js,css}
                      ├── server.py  ThreadingHTTPServer
                      ├── ops.env          gitignored login
                      └── unifi.env        gitignored UniFi key
```

Tailscale Serve: `https://<magicdns>/ops` → `127.0.0.1:8790`. Funnel stays **off**.

Unraid command board `:8788` is a **different** static site. Do not iframe it into ops.

## Frontend

No bundler, no WebSocket. Polling:

| Path | Role |
|---|---|
| GET `/api/stats` | Hermes/gateway/hosts (~20s) |
| GET `/api/compute` | fleet CPU (~1s) |
| GET `/api/thoughts` | observable CLI events |
| GET `/api/agents` `/api/talk` `/api/trace` `/api/adze` | agents / TRACE / ADZE status |
| GET `/api/docker` `/api/clients` `/api/protect` | Unraid / LAN / cameras |
| GET `/api/remote` | RustDesk OSS snapshot |
| GET `/api/git` | local git status |
| GET `/api/lights` | WiZ lighting snapshot |
| GET `/api/voice` | voice config + history |
| GET `/manifest.webmanifest` | PWA manifest (Helix OS) |

`/ops` prefix is applied when `location.pathname` starts with `/ops`.

## Backend

Python 3 stdlib only (`http.server`, `sqlite3`, `subprocess`). SSH to Unraid uses `~/.ssh/id_ed25519_unraid_hermes` (not in this repo).

## Auth

Cookie `helix_ops` HttpOnly. Password hash compare in `server.py`. `/health` open. Testing bypass: `HELIX_OPS_AUTH=off` in `ops.env`.

## Agents (out of process)

Lead inference is Hermes Agent (`xai-oauth` / grok-4.6), not this repo. ADZE is profile `adze` + `adze_openai.py` (OpenAI HTTPS, key from env, never frontend).

## Storage

Read-only Hermes `~/.hermes/state.db` and profile DBs. Ops-local: `prompts.jsonl`, `protect-events.db`, `helix-remote.json` — gitignored.

## Network

| Host | Role |
|---|---|
| 192.168.1.172 | Mac Mini / HELIX OPS |
| 192.168.1.84 | Unraid / RustDesk / Honcho / *arr |
| 192.168.1.236 | Umbrel peer |
| 192.168.1.207 | Omarchy laptop (host inventory name, not branding) |
| 192.168.1.151 | ThinkPad |
| 192.168.1.1 | UDM |

## Planned

- Native RustDesk session telemetry (needs Pro API; OSS does not expose it)
- Hermes-state-driven DNA tokens/s
- Unraid Tailscale CA
