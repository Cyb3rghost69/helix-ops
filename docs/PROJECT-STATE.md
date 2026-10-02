# PROJECT STATE

CURRENT VERSION: 0.1.0-dev  
CURRENT BRANCH: main (baseline)  
LAST MAJOR CHANGE: HELIX/OPS particle identity + REMOTE MATRIX + GitHub project store

## IMPLEMENTED

- CRT ops deck `:8790` (Field Terminal, NOC/Botmesh, TRACE, ADZE strip, Remote Matrix)
- Particle HELIX/OPS wordmark (phosphor, state machine)
- RustDesk OSS collector (hbbs/hbbr TCP, sqlite ids, Mac LAN peers)
- Docker start/stop of named Unraid containers
- UniFi clients + Protect stills (key local)
- Compact SOURCE CONTROL instrument

## IN-PROGRESS

- Login currently bypassed for testing (`HELIX_OPS_AUTH`)
- ADZE live reviews (key absent)
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
