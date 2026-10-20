# Helix OS Dual-Brain HA V2 — Phase 3

Date: 2026-10-19
Scope: persistent Helix Ops (LaunchAgent prepared), read-only Unraid inventory, architecture/witness/memory research, BRAINS telemetry expansion.
Not in scope: production failover, gateway ownership change, Honcho/SQLite mutation, Cloudflare/UniFi/Funnel, automatic leader election.

Validated inputs: `helix-ha-v2-phase1.md`, `helix-ha-v2-phase2.md`.

## 1. Helix Ops persistence

### Created (this host)

- Label: `com.helix.ops-dashboard` (does **not** replace `ai.hermes.gateway`)
- Plist: `~/Library/LaunchAgents/com.helix.ops-dashboard.plist`
- Wrapper: `~/.hermes/reports/ops-dashboard/helix-ops-launchd.sh`
- Python: `/usr/bin/python3` + cwd `~/.hermes/reports/ops-dashboard`
- KeepAlive: crash restart (`SuccessfulExit=false`)
- ThrottleInterval: 10s
- Logs: `~/.hermes/logs/helix-ops.out.log` / `.err.log` with 5 MiB rotate in wrapper
- Duplicate listener: wrapper exits 1 if `:8790` already bound (KeepAlive retries)

### Load status

`launchctl bootstrap` is **blocked inside the Hermes Telegram gateway process** (guard against gateway restart loops). The plist is on disk. The job is **not loaded**.

`launchctl print gui/501/com.helix.ops-dashboard` → not found.

Current listener: ad-hoc `python3 server.py` PID **15298**, `/health` 200.

`ai.hermes.gateway` remains running PID **78601**. Plist mtime unchanged (Sep 29).

### Logout / reboot

- **LaunchAgent** (Aqua+Background): starts after the user session is available. Not verified across logout or reboot (job never bootstrapped).
- **LaunchDaemon** in `/Library/LaunchDaemons` would be more appropriate for unattended boot **without** a logged-in user. Not created (needs admin install; not authorised as a Daemon).

Administrator load (Mac Terminal.app, not Telegram):

```
kill $(lsof -nP -t -iTCP:8790 -sTCP:LISTEN) 2>/dev/null; launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.helix.ops-dashboard.plist
```

Restart behaviour cannot be proven until that bootstrap.

Tailscale `/ops` unchanged: `https://mats-mac-mini.taild76dc.ts.net/ops` → `127.0.0.1:8790`. Serve routes preserved (`/`, `/ops`, `/board`, `:8443`).

## 2. Unraid inventory (read-only)

Host: 192.168.1.84, kernel 6.18.54-Unraid, up 4d, 128 CPU, 503 GiB RAM.
cache nvme 4% used (17G/890G), array `/mnt/user` 73%, docker loop 77% (76G/100G).

Docker (names/state/ports only): **57** containers, **34** running.

HA-relevant running:

| Name | State | Ports / notes |
|---|---|---|
| Hermes-Agent | Up 21h | 8642, 9119. Image nousresearch/hermes-agent. Bind `/mnt/cache/appdata/hermes-agent` → `/opt/data`. Health API v**0.22.2**. |
| honcho-api-1 | healthy | **192.168.1.84:8000** only (not 127.0.0.1:8000 on the Unraid host). |
| honcho-database-1 | healthy | Postgres 15 + pgvector. Volume `honcho_pgdata` (~67M). |
| honcho-redis-1 | healthy | Volume `honcho_redis-data`. |
| helix-command | Up 4d | **8788** nginx command board — not Helix Ops. |
| Tuwunel | healthy | Matrix HS. |
| RustDeskServer-AiO | Up 4d | 21115–21117. |
| UptimeKuma | healthy | 3001 — monitoring, not a HA witness. |
| beszel | Up 4d | 8090 — monitoring, not a HA witness. |

Stopped / not a witness: `cloudflare-tunnel` Exited (255) 4d — **do not modify**. Conduit Exited 0 (preserved). ollama: no listener.

Hermes-Agent **does** run `hermes gateway run --replace` inside the container (own `gateway.pid`). `config.yaml` mentions telegram/discord (2 lines each) and not matrix. `.env` has **0** `TELEGRAM*` keys. Bravo is **not** consuming Telegram. Do not enable messaging there.

Bravo also has its **own** SQLite (`state.db`, kanban.db, response_store.db) under appdata — separate from Mac `state.db`. Do not filesystem-copy either.

Honcho compose services: api, deriver, database, redis. API/db/redis running. No Honcho backup directory found. `/mnt/user/backups` only has Conduit snapshots.

Nics: br0 192.168.1.84/24 plus docker bridges. No second WAN observed.

## 3. Bravo standby gaps (not activated)

To become a functional **standby brain** Bravo still needs, after later approval:

1. Compatible Hermes version (today **0.22.2 vs Alpha 0.21.3**).
2. Exclusive messaging credentials **only after Alpha is fenced** — never both.
3. Skill/profile/cron parity without live SQLite copy.
4. Honcho still reachable (today it already is — on this host).
5. Independent witness + fencing before any auto promote.
6. Documented promote/failback runbook.

Bravo can keep doing worker jobs now. It is **not** failover-ready.

## 4. Bidirectional plan (design only)

**Alpha → Bravo (Mac down):** detect host vs API vs LLM vs partition using independent witness; fence Mac (disable gateway / network isolation — no IPMI on Mac); confirm Bravo Honcho + config; **manual** promote; start Bravo messaging **only then**.

**Bravo → Alpha (Unraid down while primary):** equivalent checks; Mac must not auto-enable if Bravo still holds lease; Honcho on Unraid is **gone** in this case unless a replica exists.

**Failback:** recovering node stays passive. Current primary remains until administrator handover. No automatic failback. Cooldown against flap.

Automatic engine: **off**.

## 5. Witness and fencing

Evaluated, **none selected, none deployed**.

- **Umbrel** 192.168.1.236 Hermes v0.21.5: same LAN/power domain as both brains likely. Extra peer, not a witness.
- **iLO** 192.168.1.82: same HPE chassis as Bravo. Fencing Bravo via iLO is possible in theory; it is **not** independent arbitration of Unraid death vs network partition.
- **Omarchy** historically unreachable — not always-on.
- **Uptime Kuma / Beszel** on Unraid: same failure domain as Bravo.
- **Tailscale Serve / DERP**: routing, not quorum.

Recommendation for Phase 4 (purchase/place, do not pretend it exists): a **third always-on host** (Pi 5 / used NUC) on a **different UPS and switch if possible**, running a tiny **time-bounded lease** (etcd 3-node later, or one witness + two brains as 3 voters). Until then: **manual failover only**.

No ping-only two-node failover.

Mac has no hardware STONITH. Fence = stop `ai.hermes.gateway` + refuse Bravo dual-poll.

## 6. Memory resilience (no live changes)

- Authoritative conversation memory: **Honcho Postgres on Unraid docker volume `honcho_pgdata` (~67M)**. Unraid remains a **memory SPOF**.
- Redis: cache/queue, volume `honcho_redis-data`.
- Alpha `state.db` SQLite on Mac (~69M Phase 1): sessions/jobs, **not** multi-writer, **do not live-copy**.
- Bravo has a **second** SQLite tree. Dual-write would split-brain.
- No Honcho `pg_dump` / replica / WAL archive found.
- Supported path later: `pg_dump` (consistent) to UNAS or Mac; optional streaming replica **off** Unraid. Not implemented this phase.

## 7. BRAINS panel (hos0526)

Live probes only. New cards: Alpha uptime, gateway owner launchd, ops LaunchAgent loaded, version pair, backup tarball age, failover ready=NO, incident count (empty file).

POST `/api/brains` still 403 `controls_disabled`.

`test_brains.py` 3/3 OK.

## 8. Verification

- Helix Ops `/health` 200 loopback, LAN, Tailscale `/ops/health`
- `/api/brains` live Alpha 0.21.3, Bravo 0.22.2, Honcho 200, witness NONE, failover ready false
- Messaging: `ai.hermes.gateway` PID 78601 unchanged
- Unraid remains worker; no second Telegram token on Bravo `.env`
- Honcho LAN 200; production Serve routes unchanged
- Funnel not touched

## 9. Remaining risks

- Ops dies on logout/reboot until Terminal bootstrap (and still not unattended without a LaunchDaemon)
- Version skew 0.21.3 / 0.22.2
- Honcho SPOF on Unraid
- No witness, no fencing
- Bravo internal `gateway run` could become dangerous if chat tokens are ever added
- docker.img 77% full
- cloudflare-tunnel container down (public Matrix was previously still 200; tunnel not modified)

## 10. Proposed Phase 4 (wait for approval)

1. Load ops LaunchAgent from Terminal; prove KeepAlive with a crash test.
2. Place or reject a real third-host witness; keep auto failover off until then.
3. Design Honcho `pg_dump` + restore drill (no live cutover).
4. Do **not** enable Bravo messaging.
5. Do **not** sync SQLite.

Stop after Phase 3.
