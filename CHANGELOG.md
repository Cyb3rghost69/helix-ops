# Changelog

## Unreleased

### Added

- MEMORY MATRIX (`/api/matrix`) — Hermes/HELIX memory banks, no file contents.
- REMOTE MATRIX for self-hosted RustDesk OSS (hbbs/hbbr health, known peers, COPY ID / rustdesk:// launch).
- ADZE analysis-core profile, orchestrator, dual-core TRACE strip.
- AGENT COGNITIVE TRACE module.
- HELIX FIELD TERMINAL mobile home.
- LIGHTING CONTROL (`[08] LIGHTING`) — local WiZ UDP provider, rooms, Helix scenes, no cloud.
- VOICE INTERFACE (`[09] VOICE`) — push-to-talk, browser STT/TTS, tool router into lights/status.
- PAD LAYOUT (`helix-tablet.css`) — 768–1366 tablet: sticky tabs, lighting 2-col, thumb PTT.
- PWA (`manifest.webmanifest` + `helix-sw.js`) — installable Helix OS on Tailscale HTTPS `/ops`.
- Compact SOURCE CONTROL instrument.
- Desktop INSTRUMENT BUS (SYSTEM CORE / MODEL MATRIX / SERVICE MATRIX / DATA VAULT) from live APIs.

### Changed

- Wordmark particles are amber/orange squares; DORMANT → DNA → HELIX/OPS → CRC OK ● ONLINE.
- CRT chrome remains phosphor green.

### Security

- Runtime secrets (`ops.env`, `unifi.env`) excluded from version control.
