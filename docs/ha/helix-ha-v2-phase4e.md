# Helix OS Dual-Brain HA V2 — Phase 4E

Date: **2026-10-19 16:12 AEDT**.  
Mode: **read-only** discovery, reporting, documentation.  
Prefect: **allow** — write this file only; no ops JSON/markdown edits; no production restarts.

**Authorised this phase:** verify scheduler + existing archives; confirm Alpha/Bravo health and exclusive chat ownership; confirm Ops LaunchAgent; paper observer + fencing + LAN limits + N100 spec; BRAINS readiness **as observed**.  
**Not authorised / not done:** failover, failback, gateway changes, service restarts, database writes, HA voting deploy, automatic promotion, Umbrel Bitcoin/Docker, N100 purchase, Honcho replica, extra dump.

Charlie (Umbrel) is a **separate physical PC** and is **not** approved as a production witness (`helix-umbrel-witness-assessment.md`).

---

## Clock (do not claim 03:30 succeeded)

| | |
|---|---|
| Live now | **Mon 19 Oct 2026 16:12 AEDT** (`Australia/Sydney`) |
| Unraid `date` | Mon Oct 19 16:11:30 AEDT 2026 |
| Unraid zone | `/etc/localtime` → `Australia/Sydney`; `USE_NTP=yes` |
| First scheduled window | **Tue 20 Oct 2026 03:30** Australia/Sydney (~**11 h 18 m** from this write) |
| Manual dump | `20261019-102628` (Phase 4B, 10:26) — **not** cron proof |

**The first scheduled run has not occurred. It is not successful.** Do not fire a manual dump for that proof.

---

## 1. Honcho backup scheduler (verified present, unproven)

| Item | Live |
|---|---|
| Script | `/mnt/user/backups/honcho/bin/honcho-backup.sh` mode **700**, 124 lines, mtime 2026-10-19 10:57 |
| Persist cron | `/boot/config/plugins/dynamix/user.cron`: `30 3 * * * /mnt/user/backups/honcho/bin/honcho-backup.sh >/dev/null 2>&1` |
| Live cron | `/etc/cron.d/root` **same line** (comment: Helix Honcho dump Sydney 03:30) |
| TZ | Host local = Australia/Sydney. Cron `30 3` is **local 03:30**, not a fixed UTC offset. DST follows zoneinfo. |
| Next fire | **2026-10-20 03:30:00 AEDT** |
| Overlap | `flock -n` on `$DIR/backup.lock`. No lock file present now (idle). |
| Dump method | `docker exec honcho-database-1 sh -c 'pg_dump -Fc --no-password -U "$POSTGRES_USER" -d "$POSTGRES_DB"'` — credentials from **container env**, not argv |
| Then | `pg_restore --list`, SHA-256 sidecar, `cp` to NAS only if `NASROOT` is a mountpoint |
| Fail path | dump/list failure writes `status.json` `ok:false` and exits 1. Missing NAS → `nas_unmounted`, local archive kept |
| stdout | cron redirects to `/dev/null`; real log is `$DIR/logs/backup-$STAMP.log` |
| Adjacent job | CA Mover Tuning `40 3 * * *` (10 min later). 859 KiB dump should finish first; note only, not changed |

`status.json` `schedule.active=true`, `cron=30 3 * * *`, `tz=Australia/Sydney`.

**Not operational until a cron-written stamp exists.** Scheduler **configured** ≠ scheduler **proven**.

---

## 2–3. Existing archives, checksums, NAS (intact — still the 4B manual)

**Only dump on disk:** `honcho-20261019-102628.dump`

| Copy | Path | Bytes | `sha256sum -c` |
|---|---|---|---|
| Local | `/mnt/user/backups/honcho/honcho-20261019-102628.dump` mode 600 | **859639** | **OK** |
| NAS | `/mnt/remotes/UNAS-PRODOMAIN_Data/backups/honcho/honcho-20261019-102628.dump` | **859639** | **OK** |

SHA-256 (both sidecars, GNU `HASH  filename`):  
`eaae0048d02d68bbb8d635dcd87fb07a28513585fca7c562b471ff786213834b`

NAS mount live: CIFS `//UNAS-PRO.LOCALDOMAIN/Data` at `/mnt/remotes/UNAS-PRODOMAIN_Data` (addr `192.168.1.177`, vers 3.1.1). Sidecar present on both sides.

`status.json` (Unraid, `t=2026-10-19T10:32:00Z`): `ok=true`, `last_local.stamp=20261019-102628`, `list_ok`, toc 132, extension `vector`, `last_nas.ok/verified=true`, `restore_test=passed_isolated` (163 s, 13 user tables, 61 indexes, prod Honcho 200), `retention.applied=false`, `honcho_http=200`.

Logs: `backup-20261019-102628.log` (manual), two restore-test logs (first attempt failed mid-shutdown; second passed). **No `backup-20261020-*` log.**

Honcho `/health` 200 before/after this inspect. **No dump triggered.**

`recoverable_claim` remains **false** (list + one isolated restore ≠ conversational recoverability).

---

## 4. Alpha / Bravo health and exclusive messaging

Live HTTP (Mac, 16:10 AEDT):

| Probe | Result |
|---|---|
| Alpha `127.0.0.1:8642/health` | 200 **v0.22.2** (6 ms) |
| Bravo `192.168.1.84:8642/health` | 200 **v0.22.2** (4 ms) |
| Honcho `192.168.1.84:8000/health` | 200 `{"status":"ok"}` |
| Charlie `192.168.1.236:8643/health` | 200 **v0.21.5** (peer only) |
| Helix Ops `127.0.0.1:8790/health` | 200 |
| Ping Bravo / Charlie / UDM / iLO | OK, ~0.4–0.6 ms |

Messaging:

| | |
|---|---|
| Owner | **Alpha** |
| launchd | `ai.hermes.gateway` **loaded**, state running, **runs=1**, PID **76636** |
| Listen | `python3` PID 76694 on `127.0.0.1:8642` |
| BRAINS | `alpha.owns_messaging=true`, `bravo.owns_messaging=false` |
| Bravo Telegram env keys | **0** (inventory `helix-ha-inventory.json`; BRAINS `gateway_ownership.bravo_telegram_env_keys=0`) |
| Charlie chat keys | none (prior Umbrel inspect; Telegram disabled) |
| `POST /api/brains` | **403** `controls_disabled` |

Versions **match** 0.22.2. Primary configured Alpha, standby Bravo. **No gateway restart this pass.**

---

## 5. Helix Ops LaunchAgent

| | |
|---|---|
| Label | `com.helix.ops-dashboard` |
| plist | `~/Library/LaunchAgents/com.helix.ops-dashboard.plist` |
| State | **running** (launchctl print) |
| PID | **78782** (same PID listening `*:8790`) |
| runs | **5** (KeepAlive recycles; not touched this pass) |
| Logs | `~/.hermes/logs/helix-ops.{out,err}.log` |
| Dashboard | `GET /api/brains` 200 live telemetry |
| Logout / reboot survival | **unverified** |
| Unattended boot | still needs Launch**Daemon** (`/Library/LaunchDaemons`) — **not created** |

Monitoring is operational for a logged-in Aqua session. That is not unattended HA.

---

## 6. Charlie heartbeat observer (design only — **not deployed**)

Charlie = Umbrel `192.168.1.236`, HP EliteDesk 800 G3 DM, umbrelOS 2.0. **Not** a voter. **Not** a lease issuer. **Do not** touch Bitcoin/Fulcrum/LND.

### Purpose

Log whether Alpha, Bravo, Honcho, and the UDM answer. Humans and BRAINS can read the log. **Nothing on Alpha or Bravo must honor this log.**

### Placement

- **Out of** `hermes-gateway.service` (must keep running if Hermes on Charlie dies).
- User unit `helix-ha-observer.service` + linger, `Restart=always`, `MemoryMax=64M`, `CPUQuota=5%`.
- Code: small POSIX/Python, **no LLM**, no Docker socket, no sudo.
- State: `~/helix-ha-observer/heartbeat.jsonl` mode 640 on the **data** persist (`/home` already on nvme0n1p4). Rotate at 20 MiB.
- Clock: UTC timestamps (Charlie is Etc/UTC; Alpha/Bravo are AEDT).

### Probes (read-only)

| Target | How | Interval | Down after |
|---|---|---|---|
| Alpha host | ICMP `192.168.1.172` | 15 s | 3 misses |
| Alpha Hermes | HTTP `http://192.168.1.172:8642/health` if LAN-published; else note loopback-only | 15 s | 3 misses |
| Bravo host | ICMP `192.168.1.84` | 15 s | 3 misses |
| Bravo Hermes | HTTP `http://192.168.1.84:8642/health` | 15 s | 3 misses |
| Honcho | HTTP `http://192.168.1.84:8000/health` **only** | 15 s | 3 misses |
| UDM | ICMP `192.168.1.1` | 15 s | 3 misses |
| iLO | ICMP `192.168.1.82` (reachability, not login) | 60 s | n/a |
| LLM / xAI | **omit** | — | never a signal |

Note: Alpha API is **loopback `127.0.0.1:8642`** from the Mini. Charlie may see ICMP to `.172` and still fail HTTP 8642. That is a **valid observer result**, not a reason to bind Alpha `:8642` on LAN. Do not change Serve/Funnel.

### Forbidden in this unit

Lease file that brains read, SSH to Alpha/Bravo, iLO actions, token copy, `docker`, bitcoin-cli, promoting, writing Alpha/Bravo disk.

### What success looks like (later approval)

JSONL lines `{ts, src:charlie, icmp:{}, http:{}}`. Charlie reboot → unit returns (linger). umbrelOS OTA → **not guaranteed** (custom user unit; Canon gap). Observer death → log stops; **production stays frozen/manual**.

---

## 7. Fencing (assessment — **none deployed**)

Status today: BRAINS `fencing.status=NONE`.

### Alpha (Mac Mini) — no BMC

| Method | Practical? | Notes |
|---|---|---|
| Software: stop `ai.hermes.gateway` | **Yes, best** | Dedicated fence key + `launchctl bootout` / `hermes gateway stop` from **Mac Terminal or future witness SSH**. Not from the Telegram process (self-SIGTERM). |
| Credential isolation | **Yes, in force** | Tokens only on Alpha `.env`. Bravo/Charlie have zero chat keys. |
| Power / UPS | Weak | Unplug or Mini UPS. No iLO-class OOB. Sleep/lid not applicable (desktop Mini). |
| Tailscale / Serve | Not a fence | Cutting Serve does not stop polling. |

Expired heartbeat is **not** proof Alpha stopped. Fence = confirm poller dead (no `getUpdates`) **then** refuse lease.

### Bravo (Unraid) — iLO exists

| Method | Practical? | Notes |
|---|---|---|
| Software: keep Telegram unset | **Yes, in force** | Bravo `gateway run` is safe **only** while `TELEGRAM*` count is 0. |
| iLO `https://192.168.1.82/` power-cycle | Host STONITH | Same chassis as Bravo. Proves “OS can be killed if BMC has power,” **not** “Unraid is dead vs partitioned.” Do not put iLO password on Charlie. Dedicated fence key, human/N100 only. |
| Docker stop Hermes-Agent | Soft fence | Stops worker/API; does not fence the host; Medic must not fight it. |

### Safe ownership transfer (manual, later)

1. Admin on a path that is **not** dead Alpha Telegram.  
2. Fence Alpha gateway. Wait until Telegram `getUpdates` idle.  
3. Confirm Bravo still has **zero** chat env keys, then place tokens **once**.  
4. Start **one** gateway. Matrix device will need verification. Discord: same application, no second bot.  
5. Failback **never** automatic. Recovered Alpha stays token-less until handover.

Do **not** rsync `state.db`. Honcho is memory, not offsets.

### Hermes implementation (v0.22.2 tree — not activated)

Local locks **do not** fence Bravo:

| Mechanism | Scope | HA meaning |
|---|---|---|
| `~/.hermes/gateway.lock` | One `HERMES_HOME` | Second `gateway run` on the **Mini** is blocked. Unraid has its own home. |
| `host_rendezvous` | One OS user on one machine | Multiplex attach on Alpha. Bravo is another kernel. |
| `acquire_scoped_lock(telegram, token)` | `$XDG_STATE_HOME/hermes/gateway-locks` **on that host** | “One token across profiles” on the Mini. Bravo never sees this flock. |
| Telegram HTTP **409** `terminated by other getUpdates` | Bot API | Second poller **kills** the first and **drops pending updates**. Steal, not fence. |

Safe later path: witness lease **before** adapters start; `hermes gateway stop` + launchd **bootout** on the fenced node; tokens on Bravo only after `getUpdates` idle; Discord same application (no second bot); Matrix new device verification.

Software to write later (not this phase): `helix-ha-controller` on N100; `helix-ha-agent` on Alpha/Bravo that **refuses** telegram/discord/matrix without a valid lease; optional Hermes hook besides local flock.

Hardware fallback: Mini has **no BMC** (`womp=1` WOL only; sudo shutdown not available to Helix). iLO can power-cycle Bravo **and Honcho**. **No smart PDU found** in inventory (UNKNOWN). **No power command this phase.**

---

## 8. Shared LAN — what you can tolerate vs cannot

All of Alpha, Bravo, Charlie, iLO, UDM are **one hop on `192.168.1.0/24`**. Unraid has **no Tailscale**. Charlie + Mini do.

| Failure | Tolerable with current policy (manual, auto off) | Unsafe if auto 2-of-3 were on |
|---|---|---|
| Alpha process/host death | Chat dies; Bravo stays worker; Honcho lives; wait for human | Promote on ping-fail → split-brain if Alpha still polling |
| Bravo / Honcho death | Chat lives on Alpha; memory SPOF; restore from dump (RPO up to ~24 h **once cron is proven**) | “Promote” does nothing useful for memory |
| Charlie death | Bitcoin/LN/HA apps down; Helix chat/Honcho unaffected | If Charlie were the voter, freeze (fail-safe) but no fence |
| UDM / L2 down | All three isolated. Tailscale may join Mini↔Charlie only | Minority cannot tell “I am partitioned” from “they died.” **Cannot auto-promote** |
| WAN / LLM provider down | Chat adapters error; hosts up | **Must not** promote (Canon: failover is provider-scoped) |
| House power (UPS unproven) | All may die together | Leases expire; on boot **no tokens until human/Alpha preference** |
| Cache/array Unraid issues | Worker/Honcho risk; not a chat dual-active | Irrelevant to token mutex |

**Can tolerate (today):** single-host death with **manual** response and **tokens never duplicated**.  
**Cannot tolerate:** automatic promotion, two pollers, quorum on this LAN, treating Charlie or iLO as an independent domain.

---

## 9. Production witness hardware (not purchased)

Charlie is **unsuitable** as that box (busy full node, same LAN/power, already a Hermes peer). Spec unchanged from 4D:

| Item | Requirement |
|---|---|
| Machine | Intel N100 mini PC **or** Pi 5 8 GB **with USB/NVMe SSD** (not SD) |
| OS | Debian 13 (or Ubuntu Server LTS), no desktop, no Umbrel, no Hermes |
| RAM | 8 GB lease-only; **16 GB** if Honcho replica later |
| Disk | 256 GB NVMe min; lease+logs on durable disk |
| NIC | **Ethernet** to LAN; static DHCP; Tailscale OK; **Funnel off** |
| Power | **Own PSU on a different UPS/PDU than the DL385**. Independent of Mini if possible |
| Location | Not Unraid chassis, not Mini, not Charlie, not iLO, not Omarchy |
| Network independence | A second VLAN/switch is **feasible later**, not required to start observer/controller; UDM still a SPOF until then |
| SSH | New `ed25519` for control/fence — **not** `id_ed25519_unraid_hermes` / `_umbrel` |
| Services | `helix-ha-controller` (or observer first); optional Postgres 15+pgvector replica **later** |
| Must not | Docker socket, chat tokens, Bitcoin, Helix Ops, Kuma-as-controller |

Witness ≠ quorum. A ping host is not a controller. A controller without fencing is not safe auto-HA.

---

## 10. BRAINS readiness (confirmed facts only)

Live `GET /api/brains` after hos0531. Promote/failback still 403.

| Field | Live |
|---|---|
| `policy.automatic_failover` | **false** |
| `policy.automatic_failback` | **false** |
| `promotion_controls` | disabled |
| `primary` | alpha |
| `standby` | bravo |
| Alpha / Bravo Hermes | v**0.22.2** UP |
| Honcho | `/health` 200 |
| Gateway | Alpha launchd PID **76636** |
| Charlie peer | v0.21.5 UP — **not** a witness (`charlie=observer_candidate`) |
| Ops LaunchAgent | loaded |
| `POST /api/brains` | 403 |
| Honcho backup stamp | `20261019-102628` local+NAS verified |
| `readiness.scheduled_backup` | **missing** |
| `readiness_evidence.overall` | **NOT READY** |
| `failover_readiness.ready` | **false** |
| `fencing` | **DESIGNED_NOT_ACTIVE** (`ready=false`) |
| `controller` / `witness` | NONE |
| BRAINS asset | **hos0531** |
| Incidents | `[]` |

Readiness levels (API):

- **verified:** alpha_health, bravo_health, version_compatibility, gateway_ownership, honcho, honcho_backup_freshness (manual archive), offhost_backup, isolated_restore, last_restore_test  
- **partial:** standby_config  
- **missing:** scheduled_backup, memory_failover, witness, quorum, fencing, lease_controller, failover_testing, failback_tested, automatic_failover  

SPOF list from API still includes Mac pollers, Honcho on Unraid, no witness, no fencing, no controller, scheduled dump not proven.

---

## Production unchanged

- Alpha primary, gateway PID 76636  
- Bravo worker, no chat tokens added  
- Honcho 200, no dump/restore this pass  
- Charlie Bitcoin workloads untouched  
- Serve/Funnel/Cloudflare/UniFi untouched  
- Auto failover off  

---

## Remaining blockers

1. **Unattended 03:30 dump not yet due** — resume **after 2026-10-20 03:30 AEDT**. PASS only if new local+NAS stamp, SHA `-c` OK, `status.json` stamp newer than `20261019-102628`, Honcho 200, cron log present. If silent, then investigate.  
2. No production witness host (N100/Pi+SSD, different UPS). Charlie **rejected** for that role.  
3. No fencing/STONITH deployed.  
4. No HA controller / lease / quorum.  
5. Honcho replica absent (Unraid memory SPOF).  
6. Ops LaunchDaemon absent (reboot/logout unverified).  
7. Auto failover must stay off.

---

## Proposed next (approval)

1. After 03:30, **close 4E backup proof** (read-only). No extra dump unless that window fails.  
2. Optional **Charlie observer** unit per §6 — separate yes; still non-voting.  
3. Human: place N100 per §9. Still no auto failover.  
4. Do **not** enable Bravo/Charlie chat. Do **not** sync `state.db`.

**Stop. Wait for approval.**
