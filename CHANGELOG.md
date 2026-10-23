# Changelog

## Unreleased

### Added

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

- Fixed: commit strip coloured zero-commit days; CRT pipeline chips / hardening.py unstyled; mobile header overlap and triple Needs You; agent counts included the human node; hard-coded asset version in helix-arcade.js.
- Wordmark particles are amber/orange squares; DORMANT → DNA → HELIX/OPS → CRC OK ● ONLINE.
- CRT chrome remains phosphor green.

### Security

- Runtime secrets (`ops.env`, `unifi.env`) excluded from version control.
