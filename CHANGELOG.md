# Changelog

## Unreleased

### Added

- HELIX/89 visual system (`helix-theme.*`) — `--hx-*` tokens, five identities + custom, motion OFF/REDUCED/STANDARD/ENHANCED.
- Graph engine, Cognitive Load, Priority Engine, Attention Bus (real telemetry only).
- MEMORY MATRIX (`/api/matrix`) — Hermes/HELIX memory banks, no file contents. Discovery inventory, MemoryStore `§` parser, bounded util graphs, priority/cognitive/event-bus hooks.
- HELIX SYSTEM ORCHESTRATOR (`helix-orch.js`) — derived SYSTEM STATE, bottleneck (evidence only), flight recorder 1H–7D + time scrub, F-keys, FPS governor, optional DISPLAY PERFORMANCE overlay.
- CONTEXT BUFFER (`/api/ctx`) — model capacity + session token totals; window occupancy stays NO TELEMETRY unless measured.
- DATA VAULT SMART (`/api/vault`) — Mac NVMe SMART overall from diskutil.
- SENTINEL (`/api/sentinel`) — defensive events only; empty is NO ACTIVE SECURITY EVENTS.
- HΞL-01 operator (`helix-hel01.js`) — event-driven ASCII states.
- REMOTE MATRIX for self-hosted RustDesk OSS (hbbs/hbbr health, known peers, COPY ID / rustdesk:// launch).
- ADZE analysis-core profile, orchestrator, dual-core TRACE strip.
- AGENT COGNITIVE TRACE module.
- HELIX FIELD TERMINAL mobile home.
- LIGHTING CONTROL (`[08] LIGHTING`) — local WiZ UDP provider, rooms, Helix scenes, no cloud.
- VOICE INTERFACE (`[09] VOICE`) — push-to-talk, browser STT/TTS, tool router into lights/status.
- HELIX COMPUTE (`[10] COMPUTE`) — route LOCAL-MAC / BIGBOI / OLLAMA-LOCAL / CLOUD-AI. Hermes terminal stays local.
- Hermes Agent API bridge (`/api/hermes/status`, `/api/hermes/chat`) — server-side only, session `helix-main`.
- PAD LAYOUT (`helix-tablet.css`) — 768–1366 tablet: sticky tabs, lighting 2-col, thumb PTT.
- PWA (`manifest.webmanifest` + `helix-sw.js`) — installable Helix OS on Tailscale HTTPS `/ops`.
- CRT audit — removed Geocities magenta/purple leftovers from ops chrome (CPU bars, mesh, chips, header).
- Compact SOURCE CONTROL instrument.
- Desktop INSTRUMENT BUS (SYSTEM CORE / MODEL MATRIX / SERVICE MATRIX / DATA VAULT) from live APIs.

### Changed

- Wordmark particles are amber/orange squares; DORMANT → DNA → HELIX/OPS → CRC OK ● ONLINE.
- CRT chrome remains phosphor green.

### Security

- HELIX Medic 1.2 — isolated tests, GET `/api/medic` does not tick fail counts, auto-restart writes `docker_diagnosis` then COMPLETE, prune ghost desired names. Live guard stays allowlisted bash; capabilities-only stub not deployed.
- Runtime secrets (`ops.env`, `unifi.env`) excluded from version control.
