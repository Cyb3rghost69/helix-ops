# Helix OS Dual-Brain HA V2 — Phase 4B

Date: 2026-10-19 AEDT.
Authorised: Honcho `pg_dump`, daily schedule, UNAS copy, isolated restore, BRAINS sim + backup telemetry.
Not authorised: production HA, replication, gateway migration, SQLite copy, Hermes upgrade, leader election.

Ops backup before edits: `~/.hermes/cache/scratch/ops-dashboard-bak-ha-v2-phase4b-202610191025.tgz`

## 1. Honcho identity (auth diagnosis)

Previous `datname` query used `-U postgres`. **Role `postgres` does not exist** in this image (FATAL). Not a password failure.

Live identity via container env (values not printed): `POSTGRES_USER` / `POSTGRES_DB` → current_user=`honcho`, current_database=`honcho`.
Container: `honcho-database-1`. Volume: `honcho_pgdata` (`PGDATA=/var/lib/postgresql/data/pgdata`). `pg_dump` 15.19 inside the container. Host has no `pg_dump`.

## 2. Initial backup — **completed**

| Field | Value |
|---|---|
| Stamp | `20261019-102628` |
| Local | `/mnt/user/backups/honcho/honcho-20261019-102628.dump` mode 0600 |
| Size | **859639** bytes |
| SHA-256 | `eaae0048d02d68bbb8d635dcd87fb07a28513585fca7c562b471ff786213834b` |
| Format | `pg_dump -Fc` via `docker exec … sh -c` using container env (`--no-password`) |
| `pg_restore --list` | exit 0, 132 TOC entries, `EXTENSION vector` |
| Honcho API | 200 before and after |
| Postgres | not stopped; no live file copy |

`pg_restore --list` is **not** treated as recoverability.

## 3. Daily schedule — **configured**

Script: `/mnt/user/backups/honcho/bin/honcho-backup.sh` (flock, tmp→final, SHA, NAS copy only if mount exists, 5 MiB log rotate, no secrets in argv).
Cron: `30 3 * * *` Australia/Sydney via `/boot/config/plugins/dynamix/user.cron` → `/etc/cron.d/root`.
Retention **not** applied (no deletes).

## 4. UNAS off-host — **verified copy exists**

Existing share `//UNAS-PRO.LOCALDOMAIN/Data` mount `/mnt/remotes/UNAS-PRODOMAIN_Data`, directory `backups` already present and writable. Copy:

`/mnt/remotes/UNAS-PRODOMAIN_Data/backups/honcho/honcho-20261019-102628.dump`

Checksum match after transfer. CIFS modes are `777 nobody:users` (nounix) — integrity is the SHA-256, not POSIX mode.
Unavailable NAS is not treated as empty local dir (script).

## 5. Isolated restore — **passed once** (not unattended)

Disposable `pgvector/pgvector:pg15` (`f115a941954a`, already present), `--network none`, unique name, env-file shredded, **not** `honcho_pgdata`.
First attempt: container shutting down mid-restore; removed.
Second: `pg_restore` exit **0**, extensions `plpgsql,vector`, 13 user tables, 61 public indexes, elapsed **163s**, production Honcho 200. Container removed. Counts only (no message bodies).

Monthly unattended restore: **not scheduled**. Needs resource limits + cleanup trap verified in a later phase.

## 6. BRAINS / monitoring — **hos0527**

- Backup cards: dump age/size, NAS verified, restore status, warnings.
- Simulator: 12 scenarios, amber `SIMULATION MODE` banner, client overlay only. POST `/api/brains` still **403**.
- Readiness (live): Alpha/Bravo/Honcho/gateway/backup/NAS/restore **verified**; versions/standby **partial**; witness/quorum/fencing/lease/auto-failover **missing**.
- `recoverable_claim` remains **false**.

Ops restarted (`server.py` PID 59637) to load modules. Hermes gateway PID **78601** unchanged.

## 7. Bidirectional memory if Unraid fails

Backups are point-in-time. Live HA needs Postgres **streaming replica** (15) on Mac or a future witness, or Honcho hosted off Unraid. **Not activated.**

## 8. Production unchanged

Alpha primary, Bravo worker, chat tokens on Mac, Honcho on Unraid, Serve routes untouched, auto failover off.

## 9. Task board

| Item | State |
|---|---|
| Initial dump + SHA + list | completed + tested |
| NAS checksum copy | completed + tested |
| Daily cron 03:30 Sydney | configured (first night untested) |
| Isolated restore | completed + tested (once) |
| Monthly restore cron | blocked (by design) |
| Retention deletes | blocked |
| BRAINS sim + backup UI | completed |
| Streaming replica | blocked |
| Auto HA | blocked |

## 10. SPOF remaining

Honcho on Unraid; chat on Mac; no witness; ops LaunchAgent unloaded; version skew 0.21.3/0.22.2; BlueBubbles on Mac.

## 11. Phase 4C (approval)

Witness hardware; optional replica; Terminal load of ops LaunchAgent; Alpha 0.22.2 update (skip 0.22.1); do not arm Bravo chat.
