# PROJECT STATE

CURRENT VERSION: 0.1.0-dev  
CURRENT BRANCH: helix-medic (local; main is baseline)  
LAST MAJOR CHANGE: Gap close — CTX honesty, 7D flight recorder, HΞL-01, Mac SMART, Sentinel empty-honest

## IMPLEMENTED

- CRT ops deck `:8790` (Field Terminal, orchestrator SYSTEM STATE, NOC/Botmesh, TRACE, ADZE strip, Remote Matrix, MEMORY MATRIX with live Hermes discovery, HELIX/89 theme engine)
- Particle HELIX/OPS wordmark (amber/orange squares, DORMANT boot)
- RustDesk OSS collector (hbbs/hbbr TCP, sqlite ids, Mac LAN peers)
- Docker start/stop of named Unraid containers
- UniFi clients + Protect stills (key local)
- LIGHTING CONTROL (`[08] LIGHTING`, WiZ LAN UDP, rooms/scenes)
- Compact SOURCE CONTROL instrument
- Desktop INSTRUMENT BUS (SYSTEM CORE / MODEL / SERVICE / DATA VAULT)
- Hermes Agent API: POST `/api/hermes/chat` → localhost `:8642` `/v1/chat/completions`; GET `/api/hermes/status`

## IN-PROGRESS

- Login currently bypassed for testing (`HELIX_OPS_AUTH`)
- Cache Btrfs RAID1 degraded (Unraid, outside this repo)

## PLANNED

- RustDesk session DIRECT/RELAYED (needs Pro)
- Hermes-driven DNA tokens/s
- Turn ops login back on when asked

## KNOWN ISSUES

- OSS RustDesk peer `info` often IP-only; ThinkPad online comes from LAN address book
- `honcho_conclude` save can fail
- iPhone MagicDNS needs Tailscale DNS / Safari

## CURRENT PRIORITIES

1. Private GitHub `helix-ops` as engineering memory
2. Keep main working; no secret commits
3. Operator: restore login when ready

## DECISIONS

See `docs/DECISIONS.md`.
