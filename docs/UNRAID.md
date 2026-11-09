# Running HELIX/OPS on Unraid

The dashboard was built on the Mac Mini but `server.py` now detects its platform:

| | macOS (Mac Mini) | Linux / Unraid |
|---|---|---|
| Local host stats | scutil / sysctl / vm_stat | `/proc`, `nproc`, `ip`, `df` |
| Disk shown | `/` | `/mnt/user` → `/mnt/cache` → `/` (Unraid's `/` is RAM) |
| Network throughput | `netstat -I -b` | `/proc/net/dev` + `/proc/net/route` |
| Tailscale | Tailscale.app | `tailscale` on PATH (plugin) |
| Docker / RustDesk | `ssh root@192.168.1.84 …` | run locally (`sh -c`) when `HELIX_ON_UNRAID=1` or `/etc/unraid-version` exists |
| Host id in the deck | `mac` | `unraid` (not probed again as a LAN peer) |

## Install

1. Install python3 on the host (Community Apps: "Python 3 for UNRAID", or NerdTools).
2. Put the repo on a persistent share, e.g. `/mnt/user/appdata/helix-ops` (not `/root`, which is wiped on reboot).
3. `cp .env.example ops.env` and set `HELIX_OPS_PASSWORD` (or `HELIX_OPS_AUTH=off` for testing only).
4. `./helix-ops-unraid.sh start` → `http://<unraid-ip>:8790/`.
5. User Scripts plugin → new script `helix-ops`, body `/mnt/user/appdata/helix-ops/helix-ops-unraid.sh start`, schedule **At Startup of Array**.

## Hermes data

Hermes panels (trace, thoughts, memory, skills, kanban, cron) read Hermes's own files. They are local only if Hermes runs on the same box:

- Hermes on the Mac Mini → those panels show NO TELEMETRY on Unraid. Keep the dashboard on the Mac, or share Hermes's data dir to Unraid read-only.
- Hermes in an Unraid container → set `HELIX_HERMES_HOME` to its data dir (e.g. `/mnt/user/appdata/hermes`) in `helix-ops-unraid.sh`. Optionally set `HELIX_HERMES_BIN` to the `hermes` CLI.

Fleet, network, Docker, RustDesk, LAN clients, git and hardening work on Unraid either way.
