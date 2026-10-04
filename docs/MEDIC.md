# HELIX Medic

Deterministic Docker observer/repair for HELIX OS. The LLM never receives `docker.sock`.

## Detected platforms

| Host | OS | Docker |
|---|---|---|
| Mats-Mac-mini | macOS 27.0 Darwin 27.0.0 arm64 | **none** (no Docker Desktop) — control plane only |
| bigboi 192.168.1.84 | Unraid OS **7.3.2** (Slackware-like, kernel 6.18.38-Unraid) | Docker **Engine 29.5.3** API **1.54**, storage **btrfs**, root `/var/lib/docker`, 47 containers |

Never run Ubuntu/systemd docker instructions on Unraid. Never run `systemctl restart docker` on the Mac.

## Sources

- Docker Engine API / events: https://docs.docker.com/engine/api https://docs.docker.com/engine/reference/commandline/events
- `docker start` / healthchecks: https://docs.docker.com/engine/reference/commandline/run
- Unraid Docker management: https://docs.unraid.net/unraid-os/manual/docker-management/
- Unraid docker.img troubleshooting: https://docs.unraid.net/unraid-os/troubleshooting/docker/
- Overview (`docker.img`, templates): https://docs.unraid.net/unraid-os/using-unraid-to/run-docker-containers/overview/

## Architecture

```
Hermes / Helix ops (Mac)
    → helix_medic.py (state machine, policy, incidents)
        → SSH helix-worker@bigboi
            → sudo -n /usr/local/sbin/helix-docker-guard <allowlisted>
                → local docker CLI (socket stays on Unraid)
```

`helix-docker-guard` is bash (Unraid host has no python3). It is **not** a LAN API. No TCP 2375.

Default for **desired-running** containers: **auto-restart** after 3 consecutive failed polls (~90s). Intentionally stopped containers stay stopped. Hard never-autorepair: **ollama**, **transmission**. Recreate/rm/prune/engine still need approval or are forbidden. Mac Docker is not required and is not installed.

## Threat model

- LLM / dashboard cannot pass arbitrary docker/shell.
- Names must match `^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$` and exist in `docker ps -a`.
- Denied: prune, rm, exec, pull, system, kill, network mutate, docker.img, reboot.
- Recreate / engine restart / image pull → existing WAITING_APPROVAL; DESTRUCTIVE still fail-closed.
- helix-worker is **not** in the docker group.

## Rollback

Remove `/usr/local/sbin/helix-docker-guard` and the extra sudoers line; Helix COMPUTE `helix-read` remains. Disable Medic loop by not calling `start_loop()`.

## Watchdog

Mac ops thread restarts the Medic reconcile loop if it dies. The watchdog never repairs unrelated containers. Guard is not a daemon — each call is one-shot.
