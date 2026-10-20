# HELIX OS Dual-Brain HA V2 — Phase 2

Date: 2026-10-19 AEDT. No production failover. No gateway restart. No Honcho/network/Cloudflare/UniFi/Funnel changes. No SQLite copy.

Backup: `~/.hermes/cache/scratch/ops-dashboard-bak-ha-v2-phase2-202610190921.tgz` (excludes `ops.env` / `unifi.env` / `.git`).

## Dashboard restore

**Cause:** Helix Ops is not a LaunchAgent. `server.py` had been stopped (nothing on `:8790`). Not a bind conflict (8787 WebUI unrelated). `py_compile` clean.

**Restore:** documented `python3 server.py` from `~/.hermes/reports/ops-dashboard`, bind `0.0.0.0:8790`. Listener PID **1590**. Auto-start **not** configured (would need LaunchAgent approval).

### Verification
- `http://127.0.0.1:8790/health` 200 `{"ok":true}`
- `http://127.0.0.1:8790/` 200
- LAN `http://192.168.1.172:8790/health` 200
- Tailscale `https://mats-mac-mini.taild76dc.ts.net/ops/health` 200
- `/api/hermes/status` 200, `/api/agents` 200
- Mac Hermes API `:8642` 200 v0.21.3 (unchanged gateway PID **78601**)
- Unraid Hermes `:8642` 200 v0.22.2 (still worker)
- Honcho `:8000/health` 200
- WebUI 8787 302, command board 8788 200
- Tailscale Serve routes unchanged (`/` `/ops` `/board`; Funnel not enabled)

## Dual-Brain monitor (non-invasive)

New `[18] BRAINS` pane + `GET /api/brains` (live HTTP only). Promote/failback buttons **disabled**. `POST /api/brains` returns **403** `controls_disabled`. ASSET_V **hos0525**. Tests: `test_brains.py` 3 OK.

Live snapshot: Alpha API up v0.21.3, Bravo API up v0.22.2, Honcho up, witness NONE, auto failover false.

Visual pixel QA of the new pane: **PARTIAL** (did not capture a browser shot; Brave profile locked).

## Architecture (design only — not activated)

**Normal:** Alpha = exclusive messaging primary. Bravo = passive worker/standby. Independent worker tasks OK on Bravo. Honcho shared on Unraid.

**Alpha down:** Detect host vs API vs provider vs partition. Quorum/witness required. Fence Alpha before Bravo takes Telegram/Discord/Matrix tokens. **Automatic promotion remains OFF.**

**Alpha returns:** Bravo stays primary until admin failback. Alpha must not auto-enable messaging.

**Bravo down while Alpha primary:** Alpha continues; redundancy lost; notify.

**Split-brain:** One bot token cannot be polled twice. Expired heartbeat ≠ fenced. No STONITH. Umbrel is **not** an independent witness (same LAN, another Hermes v0.21.5). iLO is Bravo BMC. Omarchy was offline in Phase 1.

**Memory:** Honcho on Unraid = Bravo SPOF for memory. Mac `state.db` is not portable. Do not rsync SQLite. Provider (Grok) outage ≠ host failover.

## Remaining SPOF
1. Mac messaging gateway
2. Honcho on Unraid
3. No witness / fencing
4. Ops dashboard process (no LaunchAgent; dies on logout/reboot)
5. Version skew Mac 0.21.3 / Unraid 0.22.2 / Umbrel 0.21.5

## Needs admin approval (Phase 3+)
- LaunchAgent for Helix Ops persist across reboot
- Independent witness host (not Umbrel-as-Hermes, not iLO)
- Secure credential provisioning for Bravo messaging (not yet)
- Honcho backup/HA design implementation
- Live failover tests
- Failback policy

**Phase 3 must not start without explicit approval.**
