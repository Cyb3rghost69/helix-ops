# HELIX/OPS

**HELIX OPERATIONS SYSTEM**  
東京統合管制

Private source of truth for the Mac Helix ops dashboard (`:8790`).

## PROJECT OVERVIEW

HELIX/OPS is a CRT / PC-98 operations deck that observes Hermes Agent, silent Mac profiles, Unraid peers, UniFi, Docker, and a self-hosted RustDesk OSS relay. It is **not** a generic SaaS console.

Human-readable name: **HELIX OPS**  
Technical identity: **HELIX/OPS**  
Node: **HOS://TKY-06**  
Mobile: **HELIX FIELD TERMINAL**

## ARCHITECTURE SUMMARY

| Layer | What |
|---|---|
| Frontend | Single `index.html` + module CSS/JS (no bundler) |
| Backend | stdlib `http.server` in `server.py` on `0.0.0.0:8790` |
| Auth | HttpOnly cookie; creds in local `ops.env` (gitignored) |
| Agents | Hermes (Grok / xai-oauth) lead; ADZE (OpenAI) silent critic |
| Remote | RustDesk ich777 AiO on Unraid — no Pro API |

```
USER
  │
  ▼
HELIX OPS  (:8790)
  │
  ▼
HERMES // GROK
  ├── ADZE // OPENAI
  ├── BOTMESH
  ├── RUSTDESK (hbbs/hbbr)
  └── HELIX SERVICES (UniFi / Docker / Honcho)
```

## INSTALLATION

macOS with Python 3.11+. No pip dependencies for the dashboard.

```bash
cd /path/to/helix-ops
cp .env.example ops.env   # then set HELIX_OPS_PASSWORD locally
python3 server.py
```

Health: `http://127.0.0.1:8790/health`

## DEVELOPMENT

Edit files in this directory. HTML/CSS/JS are reread on each GET. After `server.py` changes, restart the `:8790` listener.

```bash
python3 -m py_compile server.py rustdesk_remote.py helix_lights.py helix_voice.py
python3 -m unittest test_remote.py test_adze.py test_lights.py test_voice.py
```

## BUILD

There is no frontend build. Assets are served as static files from `server.py`.

## DEPLOYMENT

**IMPLEMENTED:** Mac Mini process, bind `0.0.0.0:8790`. Tailscale Serve path `/ops` (no Funnel).  
**NOT** a Docker image in this repo. Unraid `:8788` is a separate command board — do not iframe it.

## ENVIRONMENT VARIABLES

See `.env.example`. Real values live in `ops.env`, `unifi.env`, and `~/.hermes/.env` — never this repository.

## DASHBOARD MODULES

| Module | Status |
|---|---|
| SYSTEM CORE / plaque + particle HELIX/OPS wordmark | IMPLEMENTED |
| HERMES // COGNITIVE CORE | IMPLEMENTED (observable events, not CoT) |
| ADZE // ANALYSIS CORE | IMPLEMENTED (offline until local OPENAI_API_KEY) |
| HΞL-01 // SYSTEM OPERATOR | IMPLEMENTED (mobile Field Terminal) |
| BOTMESH // NETWORK CONTROL | IMPLEMENTED (`helix-noc.js`, live APIs only) |
| REMOTE MATRIX // RUSTDESK | IMPLEMENTED (OSS: TCP + sqlite + LAN peers; no sessions) |
| AGENT COGNITIVE TRACE | IMPLEMENTED (`[05] TRACE`) |
| SERVICE MATRIX / Docker | IMPLEMENTED (`[04] ARCHIVE`) |
| NETWORK PULSE / LAN clients | IMPLEMENTED (`[02] NETWORK`) |
| HELIX EVENT BUS | IMPLEMENTED (NOC events + TRACE bus; real events only) |
| DATA VAULT | IN DEVELOPMENT (memory/SOUL viewer exists; not a vault product) |
| MODEL MATRIX | PLANNED (model/provider shown on Hermes card only) |
| SOURCE CONTROL // GITHUB | IMPLEMENTED (compact git status) |
| LIGHTING CONTROL / WiZ LAN | IMPLEMENTED (`[08] LIGHTING`, UDP 38899) |
| VOICE INTERFACE | IMPLEMENTED (`[09] VOICE`, PTT + tool router) |

## AGENT SYSTEM

See `docs/AGENTS.md`. Only Helix speaks on Telegram. Prefect, Foreman, Canon, Scribe, ADZE are silent.

## SECURITY NOTES

- Never commit `ops.env`, `unifi.env`, keys, or `RustDesk.toml`.
- Do not paste passwords or API keys in Telegram.
- OSS RustDesk has no API; 21114 closed is expected.
- `/health` is unauthenticated; the rest of the deck uses the ops cookie unless `HELIX_OPS_AUTH=off` (testing).

## GITHUB WORKFLOW

1. Read `docs/PROJECT-STATE.md`, `docs/ARCHITECTURE.md`, `docs/DESIGN-SYSTEM.md`, `docs/AGENTS.md`, `docs/DECISIONS.md`, `CHANGELOG.md`.
2. `git status` — do not discard user work.
3. Feature branch for large changes; keep `main` working.
4. Test, secret-scan, commit, push. Never force-push `main`. Never `git reset --hard` unless the operator authorizes it.

Canonical remote: **private** `helix-ops` under the operator GitHub account.
