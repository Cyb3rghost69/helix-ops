# Changelog

## Unreleased

### Added

- BOTMESH v2: server-side MeshBus over every agent DB + Unraid worker (`/api/mesh`, live `/api/stream` SSE), bot↔bot and bot tool traffic, FLOOR view with walking agents, worker mascot, activity-based online status. Installable PWA (manifest, icons, service worker). Bundled pixel fonts.
- **Arcade app** (`index.html` + `app/`): full rebuild — boot screen, pixel loaders, sidebar/bottom-nav shell, HOME, animated BOTMESH (real Helix↔bot messages and tool calls as flying packets, replay, inspector, comms log, link stats), AGENTS with per-agent pages and Helix terminal, TRACE, SYSTEMS (hosts, docker, network, remote, security), MEMORY (banks, files, skills), SETTINGS (animation, sound, boot). Old UI kept at `/legacy`.
- Linux/Unraid support in server.py (platform detection, /proc-based host + network stats, local docker on Unraid, `HELIX_HERMES_HOME`/`HELIX_HERMES_BIN`), `helix-ops-unraid.sh` start/stop script, docs/UNRAID.md.
- Arcade FLOOR clean-up: legacy duplicates hidden, MORE MODULES drawer, compact Hermes terminal, mobile Hermes card, severity Needs You banner.
- COMMAND DECK for desktop OPERATIONS (`helix-deck.css`, `helix-deck.js`): instrument tiles, Botmesh topology + inspector, Hermes/ADZE cards, fleet compute chart, Needs You queue, trace swimlanes, docker tiles, LAN owner grid, remote peers, git commit strip, memory banks. `DECK: OFF` restores legacy NOC.
- ARCADE command floor as default theme (CRT via THEME / `?theme=crt`): header with arcade mark, FLOOR tab, fleet CPU line+bars, hardening.py findings list, pipeline chips, `auth_open` on `/api/stats`.
- Field Terminal focus card with per-metric sparkline.
- Tab count badges.
- `/api/stats` network byte counters; `/api/git` 14-day commit counts.
- MEMORY MATRIX (`/api/matrix`) — Hermes/HELIX memory banks, no file contents.
- REMOTE MATRIX for self-hosted RustDesk OSS (hbbs/hbbr health, known peers, COPY ID / rustdesk:// launch).
- ADZE analysis-core profile, orchestrator, dual-core TRACE strip.
- AGENT COGNITIVE TRACE module.
- HELIX FIELD TERMINAL mobile home.
- Compact SOURCE CONTROL instrument.
- Desktop INSTRUMENT BUS (SYSTEM CORE / MODEL MATRIX / SERVICE MATRIX / DATA VAULT) from live APIs.

### Changed

- /api/stats is collected in the background (every ~15s, `HELIX_STATS_REFRESH_S`) and served from the latest snapshot with `cache_age_s`, so the deck no longer waits ~20s per refresh. Docker tiles list stopped containers first.
- Fixed: commit strip coloured zero-commit days; CRT pipeline chips / hardening.py unstyled; mobile header overlap and triple Needs You; agent counts included the human node; hard-coded asset version in helix-arcade.js.
- Wordmark particles are amber/orange squares; DORMANT → DNA → HELIX/OPS → CRC OK ● ONLINE.
- CRT chrome remains phosphor green.

### Security

- Runtime secrets (`ops.env`, `unifi.env`) excluded from version control.
