# Helix OS Dual-Brain HA V2 — Phase 4C

Date: 2026-10-19 AEDT (remote Telegram). No production HA, no replication install, no Hermes restart, no `launchctl bootstrap`, no extra dump.

Live re-check: Alpha Hermes **0.21.3** `:8642` 200, gateway launchd PID **78601**, Bravo **0.22.2** 200, Honcho 200, ops `:8790` 200 (PID after UI reload only). Auto failover **off**. POST `/api/brains` **403**.

Ops tree backup: `~/.hermes/cache/scratch/ops-dashboard-bak-ha-v2-phase4c-202610191057.tgz`

---

## 1. Backup automation verification

| Check | Result |
|---|---|
| Script | `/mnt/user/backups/honcho/bin/honcho-backup.sh` mode **700**, PATH includes `/usr/bin` (`docker` there) |
| Cron | `30 3 * * *` in `/boot/config/plugins/dynamix/user.cron` **and** `/etc/cron.d/root` |
| TZ | Unraid `Australia/Sydney` (AEDT now). Cron is **local** 03:30; DST follows zoneinfo (not a fixed UTC offset) |
| Persist reboot | `user.cron` on `/boot` is the Unraid-surviving source; `update_cron` materialises `/etc/cron.d/root` |
| Overlap | `flock -n` on `backup.lock` |
| Secrets | dump via `docker exec sh -c` + container env; no password in argv |
| Local vs NAS | `status.json` has `last_local` and `last_nas.ok/error` separately |
| NAS fail | missing `NASROOT` dir → `nas_unmounted`, local archive kept |
| Logs | `/mnt/user/backups/honcho/logs/` (5 MiB rotate). Cron stdout `/dev/null` — failures live in those logs |
| Archives | `honcho-20261019-102628.dump` **859639** B, SHA `eaae0048…834b` local **and** NAS |
| `sha256sum -c` | Was **broken** (hash-only files). **Fixed** GNU `HASH  filename` on both copies; `-c` now **OK**. Future NAS sidecars patched in the script |
| Retention | still **off** |
| Scheduled run | **Not yet observed.** Next window 2026-10-20 03:30 AEDT. Do **not** call the schedule operational |

Do not claim daily backups work until that cron execution writes a new stamp.

---

## 2. Honcho memory if Unraid is offline

Honcho primary is Unraid Postgres 15.19 + pgvector (`honcho_pgdata`). Alpha-down does **not** lose Honcho. Unraid-down **does**.

| Option | RPO | RTO | Helps Unraid-down while Mac lives? | Helps Mac-down (Bravo promote)? | Verdict |
|---|---|---|---|---|---|
| **A. Replica on Alpha** | seconds (if streaming) | promote replica on Mac | **Yes** | **No** (Mac is dead; replica dies with it) | Useful only for Honcho-host failure while Alpha still chats. Mac has **no Docker**; Homebrew Postgres+pgvector is extra surface. Split-brain if both Unraid and Mac accept writes. |
| **B. Independent memory host** (witness/NUC) | seconds | re-point both brains’ `baseUrl` | Yes | Yes (if Bravo can reach it) | Best failure domain. Same box as lease witness is acceptable **only if** that box is not Unraid/Mac power. Needs disk endurance (not SD). |
| **C. Restore from UNAS dump** | up to ~24h (once schedule is proven) | tens of minutes (`pg_restore` ~163s isolated + Honcho start) | After rebuild | After rebuild | **Floor today.** Already have a verified dump+NAS copy. Not live HA. |

**Recommendation (safest practical now):** keep **C** as the only implemented path. Do **not** install A on the Mac Mini (wrong domain for Alpha-down; no Docker). Design **B** onto the future witness (Postgres 15 + pgvector, replica of Unraid, `hot_standby`, slot + WAL keep). Until B exists, Unraid remains the memory SPOF. Do not dual-write.

---

## 3. HA controller specification (not deployed)

Process: `helix-ha-controller` on the **witness**, no LLM, no Helix Ops dependency.

**Signals (independent):**
1. Host ICMP/TCP from witness
2. Hermes `/health`
3. Gateway lock / poller (messaging owner)
4. LLM canary **direct to provider** — **never** promotes

**Lease:** 15s is too tight for this LAN (false expire during sleep/IO). Specify **60s TTL**, heartbeat **15s**, declare down after **3 misses** (~45–60s). Manual promote ignores TTL if fence is proven.

**Quorum:** 2 of {Alpha-agent, Bravo-agent, Witness}. Witness down → **no auto promote**, keep last lease until expiry then **freeze** (no new owner). Uncertain → **no tokens on either host**.

**Fence before chat on standby:**
1. Lease not held by old primary (expired **and** witness cannot reach old `/health` **and** ICMP fail), **or** admin fence
2. Confirm old gateway not polling (Telegram getUpdates idle)
3. Write `fenced[]` + new epoch
4. Only then authorise token load on standby

**Controller restart:** lease file/sqlite on witness disk; if controller dies, leases expire → freeze, do not guess.

**Power loss both brains:** no tokens until witness is up and admin or policy elects Alpha preference.

**Failback:** never automatic.

---

## 4. Witness hardware (do not buy this phase)

| | Pi 5 8GB | Intel N100 mini PC |
|---|---|---|
| Lease-only | Fine with **USB SSD** (not SD for logs) | Overkill but sturdier |
| + Honcho replica (option B) | Marginal (I/O, USB) | **Better** |
| Power | 5–15 W, own PSU/UPS **not** the DL385 PDU | 10–25 W, same UPS rule |
| Tailscale | Yes | Yes |
| Updates | Raspberry OS / Debian | Debian |

**Recommend:** N100 (or Pi 5 + SSD if budget) on **Ethernet**, Tailscale, Funnel off, own UPS or at least a different PDU from Bravo. Sharing UniFi switch with both brains is a remaining network domain — note it; do not pretend independence.

Not Umbrel, iLO, Omarchy, Kuma, Helix Ops.

---

## 5. Alpha 0.21.3 → 0.22.2 (not executed)

Official: no host HA. 0.22.2 is the Docker/reboot-safe gateway tag; **skip 0.22.1**.

**When local Mac access exists:**
1. Stop ops? optional. **Stop messaging:** Terminal `hermes gateway stop` (not Telegram).
2. Copy `~/.hermes/state.db*` + `config.yaml` + `.env` (0600) to a dated tarball. Do not live-copy later.
3. `hermes update` to **0.22.2** only (not `--set-channel main`).
4. Do not import Bravo `state.db`.
5. `hermes gateway install --start-now --start-on-login` then `hermes gateway status`.
6. Verify Telegram/Discord/Matrix inbound; Helix Ops `/health`; Honcho still 200.
7. Rollback: restore tarball, checkout previous git tag `v0.21.3` / `bce20d0b`, restart gateway.
8. Downtime: minutes for gateway only. Do not move credentials to Bravo.

Risks: 0.22 singleton lock / boot-epoch; 0.21.x profile export dumps can contain keys — don’t share exports.

---

## 6. BRAINS checklist — **hos0528**

Read-only checklist (VERIFIED / PARTIAL / MISSING / UNKNOWN). Overall text **NOT READY — auto failover off** (no safety %). Promote/failback still disabled. Simulator still overlay-only.

Scheduled backup = **MISSING** until a cron stamp exists. Memory failover / witness / quorum / fencing / lease / failover tests = **MISSING**.

---

## 7. Recovery runbooks (paper — not executed)

For all: **do not start Bravo chat tokens while Alpha gateway may still poll.** LLM outage ≠ promote.

### 1. Alpha Hermes process crash
- Detect: `/health` fail, launchd KeepAlive should restart PID.
- Impact: chat pause seconds–minutes.
- Do: wait launchd; `hermes gateway status` from Terminal if needed.
- Prohibit promote.
- Data loss: in-flight turns. RTO: minutes.

### 2. Alpha host failure
- Detect: witness ICMP + `/health` fail (not just Grok 429).
- Impact: Telegram/Discord/Matrix **down**. Honcho still on Unraid.
- Checks: fence Mac (no BMC — power/unreachable). Confirm no poller.
- Promote Bravo **only** after lease+fence+tokens moved. **Blocked today** (no witness).
- Data loss: Mac `state.db`, BlueBubbles. RTO: unknown until 4D.

### 3. Bravo worker failure
- Detect: Bravo `/health` down; Honcho may still be up (different containers).
- Impact: peer jobs; not chat.
- Do: Medic/docker start `Hermes-Agent` if desired-running. Do not touch tokens.
- Data loss: worker jobs. RTO: minutes.

### 4. Unraid host failure
- Detect: 192.168.1.84 down, Honcho down, Bravo down.
- Impact: memory + worker + media + Matrix HS.
- Memory: restore dump to a **new** Postgres (option C) or future replica (B). Not onto a live dual-writer.
- Prohibit Bravo promote (Bravo is dead). Alpha chat may run **without** Honcho recall.
- RPO: last dump age. RTO: restore ~few minutes + Honcho bring-up.

### 5. Honcho database failure
- Detect: `:8000` down, `honcho-database-1` unhealthy.
- Do not file-copy `honcho_pgdata`. Isolated restore procedure already tested. Production restore needs approval.
- Chat continues without memory.

### 6. NAS unavailable
- Detect: `last_nas.ok=false` / `nas_unmounted`. Local dump still valid.
- Do not treat NAS as empty local dir. Fix CIFS; retry copy. No promote.

### 7. Witness failure
- Detect: controller down.
- Behaviour: **freeze** auto path. Manual only. Do not elect.

### 8. Network partition
- Detect: asymmetric probes. Ping-only majority on one side is **not** enough.
- Behaviour: keep existing owner; no second poller.

### 9. Both hosts restart together
- Detect: both `/health` return after boot.
- Alpha LaunchAgent gateway should take chat. Bravo must remain token-less. Ops dashboard may be down (no LaunchAgent loaded).
- Lease: none today — human confirms only Alpha polls.

### 10. Primary returns after (future) failover
- Keep Bravo owner until **handover**. Alpha must not auto-enable gateway.

---

## 8. Verification (this phase)

- Alpha messaging PID 78601 unchanged
- Bravo worker, no Telegram keys added
- Honcho 200; dump+NAS SHA `-c` OK
- BRAINS sim isolated; POST 403
- Auto failover disabled

---

## 9. Phase 4D / local Mac tasks

**4D (approval):** first **scheduled** dump proof after 03:30; witness purchase; optional Honcho replica on witness; still no auto HA.

**Needs Mac Terminal (remote Telegram cannot):**
- `launchctl bootstrap` ops LaunchAgent
- `hermes update` to 0.22.2
- `hermes gateway restart` / stop
- Any Bravo token cutover (never from here)

Stop after 4C.
