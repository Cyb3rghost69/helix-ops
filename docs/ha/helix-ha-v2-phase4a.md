# Helix OS Dual-Brain HA V2 — Phase 4A

Date: 2026-10-19 AEDT.
Mode: **research and documentation only**. No controller deploy, no simulator deploy, no `launchctl`, no Hermes restart, no Honcho/SQLite mutation, no gateway start on Bravo, no route/credential changes.

Inputs: `helix-ha-v2-phase1.md`, `helix-ha-v2-phase2.md`, `helix-ha-v2-phase3.md`, live health probes, official Hermes docs/releases.

Live at write time (read-only):

- Alpha Hermes `127.0.0.1:8642` 200 **v0.21.3**
- Bravo Hermes `192.168.1.84:8642` 200 **v0.22.2**
- Honcho `192.168.1.84:8000/health` 200
- Helix Ops `:8790` 200, ad-hoc PID 15298 (LaunchAgent still **not** loaded)
- Gateway launchd PID **78601** (untouched)
- BRAINS: `automatic_failover=false`, `failover_readiness.ready=false`, `witness=NONE`
- Umbrel `:8643` 200 v0.21.5; iLO ping OK; Omarchy `192.168.1.207` ping **loss**

---

## 1. HA controller architecture (not deployed)

Official Hermes has **no host HA**. Docs “failover” is LLM **provider** fallback (`/docs/user-guide/features/fallback-providers`). Multiplex is one process, many profiles. A Grok/xAI outage must **not** change brains.

### Requirement

The controller must keep working if **both** Hermes agents are dead. Therefore it cannot live inside:

- Mac Helix / `ai.hermes.gateway`
- Helix Ops (`server.py` on Alpha)
- Unraid `Hermes-Agent`
- Uptime Kuma / Beszel on Unraid (same domain as Bravo)

### Proposed service: `helix-ha-controller`

Small standalone process (Go or Python, no LLM). Three pieces:

1. **Lease store** — single table: `leader`, `epoch`, `expires_at`, `fenced[]`. Time-bounded lease (suggested **15s** TTL, renew every **5s**). Expired lease is not proof the previous leader stopped.
2. **Witness** — third failure domain. Votes and stores the lease. If the witness is down, **no automatic promotion** (fail-safe).
3. **Node agents** — tiny heartbeats on Alpha and Bravo that are **not** Hermes. They report four independent signals:

| Signal | Meaning | Failover? |
|---|---|---|
| ICMP / SSH / host ping from witness | Host reachable | No by itself |
| Hermes `/health` | Agent process | Local restart candidate, not promote |
| Gateway lock / poller alive | Messaging owner | Ownership transfer only after fence |
| LLM canary (xAI/OpenAI **direct**, not via Hermes) | Provider | **Never** promote |

Promotion requires: witness agrees Alpha is **host-down** (not LLM-down), Bravo is healthy, Honcho reachable from Bravo, lease expired **or** fenced, and **either** manual approval **or** (later) auto policy still off until tested.

### Placement

| Location | Failure domain | Verdict |
|---|---|---|
| Dedicated Pi/NUC (recommended) | Third host, own PSU/UPS if possible | **Controller + witness** |
| Umbrel 192.168.1.236 | Same LAN/house; another Hermes | Peer only, **not** witness |
| iLO 192.168.1.82 | Same HPE chassis as Bravo | Possible **Bravo STONITH**, not quorum |
| Omarchy 192.168.1.207 | Laptop, currently offline | Unsuitable |
| UNAS-Pro | Storage, likely same rack | Backup target, not witness |
| Helix Ops / Kuma | Dies with a brain | Monitor only |

**Proposed controller location:** new always-on host on LAN + Tailscale, **not** Alpha, **not** Bravo. Until it exists, the controller design is paper-only and promotion stays **manual**.

### Leader election

- One holder of the lease.
- Quorum: **2 of {Alpha-agent, Bravo-agent, Witness}**. Minority partition cannot promote.
- Uncertain leadership → no chat tokens on either side.
- Default primary preference: Alpha (Mac Mini M2). Failback **never** automatic.

### Fencing / STONITH

- **Alpha (Mac):** no BMC. Fence = stop `ai.hermes.gateway` (only from a local/Terminal session or a future controller SSH with a **dedicated** fence key), plus lease refuse. Power fence is unplug / UPS only.
- **Bravo (Unraid):** iLO can power-cycle the OS if BMC still has power. That is host fence, **not** independent arbitration of “is Unraid dead vs partitioned.”
- Software fence first: the non-leader **must not** have Telegram/Discord/Matrix tokens loaded.

### Network partition

Two-node ping-only failover is forbidden. If Alpha cannot see Bravo but witness still sees Alpha, Alpha keeps the lease. If witness sees neither, freeze leadership (no promote).

### Manual promotion / controlled failback

1. Admin confirms on the **witness UI** (not Telegram-on-Alpha, which may be dead).
2. Fence old leader.
3. Confirm exclusive lease.
4. Start messaging **only** on the new leader.
5. On recovery of the old primary: stay passive until `handover` is approved.

### Simultaneous power loss

All leases expire. On boot: **no** gateway consumes bot tokens until the witness issues a lease. Prefer Alpha if both return healthy. Honcho Postgres WAL replay on Unraid; if Unraid disk is dirty, restore from last `pg_dump` (see §3). Do not start two gateways “to be safe.”

### Dependencies (when built)

- Witness host up
- Heartbeat agents on Alpha + Bravo
- Honcho reachable from the intended leader
- Compatible Hermes versions
- Token pack present **only** on the leader
- Helix Ops optional (display); must not be the controller

---

## 2. Existing hardware assessment

Unsuitable as independent witness (re-probed):

- **Umbrel** ping OK, Hermes v0.21.5 `:8643` — extra Hermes on same LAN.
- **iLO** ping OK — Bravo chassis.
- **Omarchy** ping loss — not 24/7.
- **Uptime Kuma / Beszel** — run on Unraid.
- **Helix Ops** — runs on Mac, ad-hoc, LaunchAgent not loaded.

**Minimum additional hardware:** one always-on SBC or mini PC.

- Raspberry Pi 5 (4–8 GB) **or** used NUC
- Ethernet (not Wi-Fi-only)
- Own USB-C/PoE PSU; ideally a **second UPS** or at least a different PDU from the DL385
- 32 GB+ storage
- Tailscale for remote admin (Funnel stays off)

Cost band: roughly a Pi 5 kit. No new UniFi/Cloudflare changes required.

Until that box exists: **manual failover only**.

---

## 3. Honcho memory resilience (not executed)

Inspected live, no dumps taken.

| Item | Finding |
|---|---|
| Engine | PostgreSQL **15.19** (Debian) in `honcho-database-1` |
| Image | `pgvector/pgvector:pg15` |
| Volume | Docker volume `honcho_pgdata` (~**67M**), not a named Unraid share |
| Redis | `honcho-redis-data` (cache; not the memory source of truth) |
| API bind | **192.168.1.84:8000** only (Unraid localhost `:8000` does not answer) |
| `pg_dump` | Present **inside** the DB container (15.19). **Not** on the Unraid host PATH |
| Existing backups | None for Honcho. `/mnt/user/backups` has Conduit snapshots only |
| Off-host store | UNAS-Pro SMB `//UNAS-PRO.LOCALDOMAIN/Data` (~11T free) |
| Compose services | api, deriver, database, redis (`restart: unless-stopped`) |

Mac client (`~/.hermes/honcho.json`): `baseUrl=http://192.168.1.84:8000`, workspace `hermes`, `sessionStrategy=global`. Alpha death does **not** destroy Honcho. **Unraid death does.**

### Prepared backup procedure (do not run in 4A)

1. `docker exec honcho-database-1 pg_dump -Fc` using the container’s existing `POSTGRES_USER` / `POSTGRES_DB` (do not paste secrets).
2. Write to `/mnt/user/backups/honcho/honcho-YYYYmmdd-HHMM.dump` then copy to UNAS `.../backups/honcho/`.
3. Keep 7 daily + 4 weekly. Expected dump size ~ tens of MB at current 67M datadir.
4. Verify with `pg_restore --list` on a copy, not against live.

### Prepared restore procedure (do not run in 4A)

1. Stop `honcho-api-1` and deriver (later phase).
2. Restore into a **new** database or a maintenance window, never a live dual-writer.
3. Start API; check `http://192.168.1.84:8000/health`.
4. RPO = time since last dump (daily → up to ~24h memory loss). RTO = minutes.

### Replication feasibility (not enabled)

Postgres 15 streaming replica onto the **Mac or the future witness** would cover **Unraid/Honcho death**. It does not help Alpha-down (Honcho already lives on Bravo). Replica is a Phase 4B+ design; WAL shipping needs a dedicated user and disk. Do not file-copy `honcho_pgdata` while running.

Suggested frequency once approved: **daily dump** immediately; replica later if Unraid SPOF is unacceptable.

---

## 4. Hermes version compatibility

| Node | Version | Channel |
|---|---|---|
| Alpha Mac | **0.21.3** (2026.9.14) | git install, messaging gateway |
| Bravo Unraid | **0.22.2** (2026.10.15, `d923a5eb`) | Docker `nousresearch/hermes-agent` |
| Umbrel | 0.21.5 | extra peer |

Official index: https://hermes-agent.nousresearch.com/docs/llms.txt  
Releases: https://github.com/NousResearch/hermes-agent/releases

There is **no** productized dual-host HA in that window. Relevant deltas 0.21.3 → 0.22.2:

- **v0.21.2 / 0.21.3:** `state.db` connection/lock campaign; WAL refusal on cross-VM filesystems; multiplex isolation; Honcho peer-model rework.
- **v0.21.4+:** host-wide **gateway singleton lock** / rendezvous so Desktop does not spawn a second gateway.
- **v0.22.0 (“Threshold”):** one backend + one gateway for every profile; huge surface change since 0.21.0 (~24k commits in the 0.21.0→0.22.0 window including 0.21.x patches).
- **v0.22.2:** reboot-safe gateway start (boot epoch vs recycled PID) — important for Docker/launchd; **do not** treat 0.22.1 as a target (wrong commit; session-delete known issue).
- **≤0.21.x profile export** can contain provider keys in `sessions/request_dump_*.json`. Do not share Alpha exports. 0.22.x scrubs exports.

Implications for this homelab:

- **Config:** YAML keys exist on both, but 0.22 gateway lock/boot-epoch behaviour differs. Copying Alpha `config.yaml` onto Bravo 0.22.2 is not a proven migrate.
- **State DBs:** two separate SQLite trees. Do not copy. 0.22.2 Bravo `state.db` is not a resume of Alpha sessions.
- **Messaging:** singleton lock is per **host**. Two hosts with the same bot token still double-consume. Version match does not make dual-gateway safe.
- **Identities:** Alpha multiplex (default, adze, prefect, …). Bravo is a worker image running `gateway run` **without** Telegram env keys.
- **Tools:** 0.22 tool-id / catalog / connector work is absent on 0.21.3. Skills on Mac are not Bravo’s `/opt/data/skills`.
- **Memory:** both can use Honcho HTTP; Mac already does. Honcho is version-independent of Hermes patch level **as a client**.
- **Session restore after failover:** Honcho recall can survive; **Telegram offset, Discord gateway session, Matrix device E2EE keys** live on Alpha and will not follow a file copy.

**Safe strategy (do not execute now):** keep Alpha 0.21.3 as the chat brain until an **on-Mac** `hermes update` to **0.22.2** (skip 0.22.1), after a stopped-gateway `state.db` backup. Do **not** downgrade Bravo. Do **not** promote Bravo to chat owner while versions differ. Do **not** upgrade from Telegram.

---

## 5. Standby gateway readiness (no credentials copied)

Ingress today is **exclusive to Alpha**.

| Platform | Mode (Alpha) | Bravo |
|---|---|---|
| Telegram | Bot API **polling** (`TELEGRAM_BOT_TOKEN` present on Mac `.env`) | **0** `TELEGRAM*` keys |
| Discord | Bot websocket (`DISCORD_BOT_TOKEN`; allowlist on) | not armed |
| Matrix | Client sync + E2EE (`MATRIX_*` on Mac; Community profile separate) | not armed |
| BlueBubbles | Local Mac API `127.0.0.1:1234` | **cannot** follow Unraid without moving BlueBubbles |
| Hermes webhooks | `127.0.0.1:8644` multiplex `/p/<profile>/webhooks/` | different host |

Safe ownership transfer (later, manual):

1. Fence Alpha gateway (stop pollers).
2. Wait until Telegram `getUpdates` is idle (no second poller).
3. Place tokens on Bravo **only then**.
4. Start **one** gateway.
5. Matrix: new device will need verification; do not disable E2EE.
6. Discord: same application; do not create a replacement bot.

Duplicate-message risk: two pollers on one Telegram token, two Discord gateway connections, two Matrix syncs. **Highest HA risk.** Session offsets in Alpha `state.db` are not Honcho.

Do not reveal, copy, rotate, or activate those credentials in this phase.

---

## 6. BRAINS failure simulator (design only — not deployed)

Add a **client-side overlay** on `[18] BRAINS`. No new production routes that mutate.

Proposed (Phase 4B, after approval):

- UI: `SIMULATION` banner, scenario `<select>`, `APPLY SIM` / `CLEAR SIM`.
- Data: `helix-brains-sim.js` maps scenario → overlay JSON. Live `/api/brains` still fetched; overlay **replaces displayed fields only**.
- Label every simulated field `SIM`.
- `POST /api/brains` remains 403. Simulator **must not** fetch `/api/restart`, promote, Tailscale, or `launchctl`.
- Optional query `?sim=alpha-offline` for screenshots; ignored by the API.

Scenarios (all fake):

| ID | Overlay |
|---|---|
| `alpha-offline` | Alpha API DOWN, primary still “alpha (configured)”, ready=false |
| `bravo-offline` | Bravo API DOWN |
| `honcho-down` | Honcho DOWN, replication note SPOF |
| `partition` | Alpha OK locally, Bravo/Honcho fail from Alpha’s view, witness NONE |
| `witness-none` | current truth, highlighted |
| `gateway-fail` | Alpha API OK, `owns_messaging` false / launchd down |
| `alpha-recovery` | Alpha UP, Bravo still shown as primary **if** a sim lease said so (labelled SIM) |
| `bravo-recovery` | Bravo UP, no auto failback |
| `failback-controlled` | both UP, primary stays simulated Bravo until CLEAR |

Do not ship this in 4A (ops process left running untouched aside from this report).

---

## 7. Remote safety (observed)

- No `launchctl bootstrap`
- No Hermes/gateway stop
- No Serve/Funnel/Cloudflare/UniFi edits
- No Honcho dump/restore/replication
- No Bravo messaging
- Helix Ops PID 15298 left running
- Automatic failover still off

---

## 8. Risks and blockers

1. **No third host** → no safe auto election.
2. **Honcho volume on Unraid docker.img** (loop 77% in Phase 3) — memory SPOF + docker disk pressure.
3. **Version skew** 0.21.3 vs 0.22.2.
4. **Ops not persistent** (LaunchAgent not loaded; remote Telegram cannot load it).
5. **BlueBubbles tied to Mac.**
6. **Bravo already runs `gateway run`** — safe today only because Telegram keys are absent. Adding tokens without fencing Alpha = split-brain.
7. Mac has **no STONITH**.
8. LLM outage ≠ host outage (must keep that distinction in any later engine).

---

## 9. Proposed Phase 4B (wait for approval)

1. Buy/place witness hardware (or explicitly accept manual-only forever).
2. Daily Honcho `pg_dump` to `/mnt/user/backups/honcho` + UNAS (first **approved** write to Honcho is dump-only).
3. Optional BRAINS simulator overlay (display-only).
4. On-Mac Terminal: load `com.helix.ops-dashboard` (still not from Telegram).
5. Do **not** upgrade Alpha, do **not** enable Bravo chat, do **not** auto-failover.

Stop after Phase 4A.
