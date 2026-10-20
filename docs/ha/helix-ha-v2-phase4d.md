# Helix OS Dual-Brain HA V2 — Phase 4D

Date: 2026-10-19 AEDT (15:36–15:40).
Mode: production **stability audit** (read-only except Honcho `/health` dashboard probes).
Not authorised / not done: automatic failover, controller deploy, fencing, extra dump, SQLite copy, Bravo chat tokens, gateway restart, route/credential/database mutation.

Inputs: `helix-ha-v2-phase{1,2,3,4a,4b,4c}.md`, `references/dual-brain-ha.md`, live HTTP, LaunchAgent print, Unraid read-only cron/backup inspect.

Ops tree backup before dashboard edits:
`~/.hermes/cache/scratch/ops-dashboard-bak-ha-v2-phase4d-202610191538.tgz`

ASSET_V **hos0529**. Messaging gateway launchd PID **76636** unchanged.

---

## 1. Production stability audit (read-only)

| Check | Result |
|---|---|
| Alpha Hermes | `127.0.0.1:8642/health` 200 **v0.22.2** |
| Bravo Hermes | `192.168.1.84:8642/health` 200 **v0.22.2** |
| Versions | **MATCH** (skew from 4C closed) |
| Honcho `/health` | 200 `{"status":"ok"}` |
| Honcho `/` | **404** `{"detail":"Not Found"}` — must not be used as a health probe |
| Helix Ops | `:8790/health` 200, Tailscale `/ops/health` 200 |
| Ops LaunchAgent | `com.helix.ops-dashboard` **loaded**, state running, `runs = 2` (prior controlled restart), current PID after this pass **78198** then recycled to load probe fix |
| Messaging gateway | `ai.hermes.gateway` **loaded**, PID **76636**, supervised by launchd. Telegram/Discord/Matrix on Alpha only |
| Gateway ownership | **Alpha**. Bravo Telegram env keys **0** (inventory). Do not add |
| Auto failover | **OFF**. `POST /api/brains` **403** `controls_disabled` |
| Memory provider | Mac `memory.provider=honcho` |
| Tailscale Serve | `/` → 8787, `/ops` → 8790, `/board` → 8788, `:8443` → 4240. Funnel not enabled |
| Incidents file | `helix-ha-incidents.json` empty list |
| Ops logs | `helix-ops.err.log` / `.out.log` empty since 15:25 |

### Messaging / error log (not a failover trigger)

Recent `gateway.error.log` (values redacted):

- BlueBubbles Cloudflare hostname **NXDOMAIN** (`trycloudflare.com`) — iMessage path degraded, **not** Hermes host death.
- Honcho **dialectic** “Could not reach the model provider: Connection error” — LLM provider, **not** Honcho HTTP. Must **not** promote Bravo.

### Helix Ops recycle this pass

Python probe fix required a new `server.py` import. Only the **ops** listener on `:8790` was SIGTERM’d; LaunchAgent KeepAlive brought it back. **Not** `hermes gateway restart`. Gateway PID 76636 confirmed after.

---

## 2. Dashboard Honcho probes

| Location | Before | After |
|---|---|---|
| `helix_brains.py` | already `/health` | unchanged |
| `server.py` `unraid_host()` | `http://UNRAID:8000/` (404 → false down) | **`/health`** |
| `index.html` dock tile | `http://192.168.1.84:8000/` | **`/health`** |
| Docker WebUI fallback `honcho-api-1` | `8000/` (404 click) | **`/docs`** (working GUI; not a health probe) |

Live `GET /api/brains` after recycle:

- Honcho `{ok: true, http: 200, ms: 9}`
- `readiness_evidence.honcho_probe` = `http://192.168.1.84:8000/health`
- Alpha/Bravo both v0.22.2
- `test_brains.py` 3/3 OK

Visuals / themes / simulator overlay preserved. Promote/failback still **disabled**.

---

## 3. Backup verification readiness

Do **not** claim the daily job is proven. No 03:30 unattended stamp exists.

| Item | Verified |
|---|---|
| Script | `/mnt/user/backups/honcho/bin/honcho-backup.sh` mode **700** |
| Cron (persist) | `/boot/config/plugins/dynamix/user.cron`: `30 3 * * *` |
| Cron (live) | `/etc/cron.d/root` same line |
| TZ | Host clock AEDT; schedule is **local** 03:30; Unraid zone follows Australia/Sydney |
| Next window | **2026-10-20 03:30** Australia/Sydney |
| Local archive | `honcho-20261019-102628.dump` 859639 B (Phase 4B **manual** dump, 10:26) |
| SHA sidecar | GNU `HASH  file`; `sha256sum -c` **OK** |
| NAS copy | `/mnt/remotes/UNAS-PRODOMAIN_Data/backups/honcho/` same size; sidecar present; `nas_verified: true` |
| Logs | `/mnt/user/backups/honcho/logs/` (backup + restore-test). Cron stdout `/dev/null` |
| Overlap | `flock` in script (not re-read this pass; 4C) |
| Retention | **off** — not enabled |
| Failure detection | `status.json` `ok` / `last_nas.ok` / log files. No paging integration |
| Isolated restore | 4B once (`passed_isolated`, 163s). Not unattended |

`helix_honcho_backup.snapshot()`: local_ok, nas_ok, nas_verified, schedule_active true, age ~5.2h, `recoverable_claim` false.

BRAINS `scheduled_backup` remains **MISSING** until a cron-written stamp after 03:30.

No extra dump triggered.

---

## 4. Independent HA controller — deployment spec (not deployed)

**Do not buy/install this phase.** Paper only. Automatic failover stays **off**.

### Witness vs full quorum stack

| Piece | Witness-only | Safe quorum (minimum to *consider* auto later) |
|---|---|---|
| Always-on third host | **Required** | Required |
| Heartbeat + lease file | **Required** | Required |
| Hermes `/health` probes | Optional | Required |
| ICMP/TCP from third host | **Required** | Required |
| Quorum 2-of-3 voters | No (observer only) | **Required** |
| Fencing / STONITH | No | **Required** before any auto promote |
| Gateway lock (tokens on one host) | No | **Required** |
| Honcho replica off Unraid | No | Required for Unraid-down memory |
| LLM canary | Forbidden as promote signal | Same: **never** promotes |
| Helix Ops / Kuma / Bravo Hermes | **Must not host the controller** | Same |

A witness that only pings is **not** a controller. A controller without fencing is **not** safe auto-HA.

### Recommended N100 witness

| Item | Spec |
|---|---|
| OS | Debian 13 stable (or Ubuntu Server LTS). No desktop. |
| CPU | Intel N100 (4c) is enough |
| RAM | **16 GB** if Honcho replica is planned later; **8 GB** lease-only |
| Disk | **256 GB NVMe SSD** minimum (not SD, not USB stick). Separate `/var` for logs+lease |
| Network | **Ethernet** to LAN; Tailscale userspace or kernel; **Funnel off**; static DHCP reservation |
| Power | **Own USB-C PSU** on a **different UPS/PDU than the DL385**. 10–25 W typical |
| Location | Not the Unraid chassis, not the Mini, not Umbrel, not iLO, not Omarchy |
| Services | `helix-ha-controller` systemd unit; optional later Postgres 15+pgvector replica |
| SSH | Dedicated `ed25519` fence/control key, **not** `id_ed25519_unraid_hermes` |

### Controller service

- Name: `helix-ha-controller.service` (systemd, `Restart=on-failure`, `WatchdogSec=30`).
- Language: Go or Python 3, **no LLM**.
- Must keep running if **both** Hermes agents are dead.
- Logs: journald + `/var/log/helix-ha/` (rotate). No secrets.

### Heartbeat

| Signal | Interval | Down after | Promote? |
|---|---|---|---|
| Host ICMP + TCP 22/443 from witness | 5s | 3 misses (~15s) | No |
| Hermes `/health` Alpha `127.0.0.1` via Tailscale/LAN, Bravo `:8642/health` | 5s | 3 misses | Local restart candidate only |
| Gateway owner lock (Alpha launchd / Bravo token-absent) | 15s | — | Ownership change only after fence |
| LLM canary (xAI **direct**) | 60s | n/a | **Never** |

Lease TTL **60s**, renew **15s**. 15s TTL is too tight for this LAN (4C).

### Lease storage

SQLite on witness disk (`/var/lib/helix-ha/lease.db`): `leader`, `epoch`, `expires_at`, `fenced[]`, `reason`.
If controller dies, leases **expire → freeze**. Do not guess.

### Quorum

Voters: `{Alpha-agent, Bravo-agent, Witness}`. Need **2**.
Witness down → **no auto promote**; keep last lease until expiry then **freeze** (no new owner).
Minority partition cannot take tokens.

### Fencing (required before auto; **missing today**)

- **Alpha:** no BMC. Fence = stop `ai.hermes.gateway` from witness SSH with a **dedicated** key, then refuse lease. Power fence = unplug/UPS only.
- **Bravo:** iLO can power-cycle the OS if BMC still has power. That is **host** fence, not independent proof of Unraid death vs partition.
- Software fence first: non-leader **must not** load Telegram/Discord/Matrix tokens.

### Gateway ownership protection

One bot token, one poller. Confirm Telegram `getUpdates` idle on the old host before loading tokens on the new host. Bravo `.env` stays **zero** `TELEGRAM*` until a future **manual** cutover after fence.

### Secure communications

- Witness ↔ brains: SSH pubkey + HTTPS health checks on LAN/Tailscale.
- No Funnel. No 2375. No Docker socket on the witness.
- Lease file mode 0600. No API keys in the lease DB.

### Recovery after power/network failure

- Both brains reboot: Alpha LaunchAgent takes chat; Bravo remains token-less; witness must be up before any election.
- Witness reboot: freeze auto path; human confirms Alpha still owns pollers.
- Uncertain leadership → **no tokens on either host**.

### Controlled failback

**Never automatic.** Recovering node stays passive. Admin handover only. Cooldown against flap.

### Explicitly out of scope this phase

Deploy, purchase, enable auto failover, Bravo messaging, Honcho replica install.

---

## 5. BRAINS dashboard (hos0529)

Live `GET /api/brains`:

| Field | Value |
|---|---|
| Alpha | v**0.22.2** UP |
| Bravo | v**0.22.2** UP |
| Gateway ownership | Alpha launchd PID 76636 |
| Honcho | `/health` 200 |
| Local dump | stamp `20261019-102628`, NAS verified |
| Scheduled backup | **MISSING** (cron present, no 03:30 run) |
| Ops LaunchAgent | **LOADED** |
| Witness | **NONE** |
| Fencing | **NONE** |
| Controller | **NONE** |
| Failover ready | **false** |
| Overall HA | **NOT READY** |
| Promote / failback | **disabled** |

---

## 6. Remaining blockers

1. No independent witness host (N100/Pi+SSD) on a different UPS.
2. No fencing/STONITH.
3. No deployed controller / lease / quorum.
4. Honcho still a Unraid SPOF (no replica).
5. Daily 03:30 dump **not observed**.
6. Ops LaunchAgent reboot/logout survival **unverified** (needs a real reboot test).
7. BlueBubbles Cloudflare tunnel hostname dead — iMessage, not HA.
8. Helix Ops is still a Launch**Agent** (needs logged-in Aqua session); unattended boot wants a Launch**Daemon** (not created).

## 7. Proposed Phase 4E (approval required)

1. Wait for **2026-10-20 03:30** and verify a **new** dump stamp + NAS SHA (no extra manual dump unless that window fails).
2. Hardware: place N100 per §4; still **no auto failover**.
3. Optional: Honcho streaming replica **on the witness**, not on the Mini.
4. Optional: LaunchDaemon for ops if unattended Mini boot is required.
5. Do **not** enable Bravo messaging.
6. Do **not** sync `state.db`.

**Stop after Phase 4D. Await approval.**
