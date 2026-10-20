"""Dual-brain telemetry. Real HTTP/ICMP/local files only. No secrets, no fake lag."""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
import urllib.request
from pathlib import Path
from typing import Optional

_CACHE: dict = {"t": 0.0, "data": None}
_HOME = Path.home()
_INVENTORY = _HOME / ".hermes" / "reports" / "helix-ha-inventory.json"
_INCIDENTS = _HOME / ".hermes" / "reports" / "helix-ha-incidents.json"
_BACKUP_GLOB = str(_HOME / ".hermes" / "cache" / "scratch" / "ops-dashboard-bak-ha-v2-phase2-*.tgz")


def _http(url: str, timeout: float = 3.0) -> dict:
    t0 = time.monotonic()
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "HelixOps-Brains/1"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(400)
            ms = int((time.monotonic() - t0) * 1000)
            ver = None
            try:
                j = json.loads(body.decode("utf-8", "replace"))
                ver = j.get("version")
            except Exception:
                j = None
            return {
                "ok": 200 <= r.status < 400,
                "http": r.status,
                "ms": ms,
                "version": ver,
            }
    except Exception as e:
        ms = int((time.monotonic() - t0) * 1000)
        return {"ok": False, "http": 0, "ms": ms, "error": type(e).__name__, "version": None}


def _launchd(label: str) -> dict:
    uid = os.getuid()
    try:
        r = subprocess.run(
            ["launchctl", "print", f"gui/{uid}/{label}"],
            capture_output=True,
            text=True,
            timeout=3,
        )
    except Exception as e:
        return {"label": label, "loaded": False, "pid": None, "error": type(e).__name__}
    pid = None
    state = None
    if r.returncode == 0:
        for line in r.stdout.splitlines():
            s = line.strip()
            if s.startswith("pid ="):
                try:
                    pid = int(s.split("=", 1)[1].strip())
                except ValueError:
                    pid = None
            if s.startswith("state =") and state is None:
                state = s.split("=", 1)[1].strip()
    return {
        "label": label,
        "loaded": r.returncode == 0,
        "pid": pid,
        "state": state,
    }


def _uptime_days() -> Optional[float]:
    try:
        t = subprocess.check_output(["sysctl", "-n", "kern.boottime"], text=True, timeout=2)
        m = re.search(r"sec\s*=\s*(\d+)", t)
        if m:
            return round((time.time() - int(m.group(1))) / 86400, 2)
    except Exception:
        return None
    return None


def _ops_listener() -> dict:
    try:
        r = subprocess.run(
            ["lsof", "-nP", "-iTCP:8790", "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        lines = [ln for ln in r.stdout.splitlines() if "LISTEN" in ln]
        pid = None
        cmd = None
        if lines:
            parts = lines[0].split()
            if len(parts) >= 2:
                cmd, pid = parts[0], parts[1]
        health = _http("http://127.0.0.1:8790/health")
        return {"pid": pid, "command": cmd, "health": health}
    except Exception as e:
        return {"pid": None, "command": None, "error": type(e).__name__}


def _backup() -> dict:
    import glob

    files = sorted(glob.glob(_BACKUP_GLOB))
    if not files:
        return {"status": "NONE", "path": None, "mtime": None, "bytes": None}
    p = files[-1]
    st = os.stat(p)
    return {
        "status": "PRESENT",
        "path": os.path.basename(p),
        "mtime": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(st.st_mtime)),
        "age_hours": round((time.time() - st.st_mtime) / 3600, 1),
        "bytes": st.st_size,
    }


def _read_json(path: Path, default):
    try:
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default
    return default


def snapshot(force: bool = False) -> dict:
    now = time.time()
    if not force and _CACHE["data"] and now - _CACHE["t"] < 8:
        return _CACHE["data"]
    alpha_api = _http("http://127.0.0.1:8642/health")
    bravo_api = _http("http://192.168.1.84:8642/health")
    honcho = _http("http://192.168.1.84:8000/health")
    umbrel = _http("http://192.168.1.236:8643/health")
    board = _http("http://192.168.1.84:8788/")
    load = None
    try:
        avg = os.getloadavg()
        n = os.cpu_count() or 1
        load = {"load1": round(avg[0], 2), "cpus": n, "pct": round(100.0 * avg[0] / n, 1)}
    except Exception:
        load = None
    ops_job = _launchd("com.helix.ops-dashboard")
    gw_job = _launchd("ai.hermes.gateway")
    inv = _read_json(_INVENTORY, {})
    incidents = _read_json(_INCIDENTS, [])
    if not isinstance(incidents, list):
        incidents = []
    a_ver = alpha_api.get("version")
    b_ver = bravo_api.get("version")
    compat = {
        "alpha": a_ver,
        "bravo": b_ver,
        "same": bool(a_ver and b_ver and a_ver == b_ver),
        "note": "Both nodes report Hermes v0.22.2." if (a_ver == b_ver == "0.22.2") else "Version mismatch is observed, not repaired.",
    }
    failover_ready = False
    try:
        import helix_honcho_backup
        hb = helix_honcho_backup.snapshot()
    except Exception:
        hb = {"ok": False, "error": "NO TELEMETRY"}
    def _lvl(ok, partial=False):
        if ok:
            return "verified"
        if partial:
            return "partially_implemented"
        return "missing"
    readiness = {
        "alpha_health": _lvl(bool(alpha_api.get("ok"))),
        "bravo_health": _lvl(bool(bravo_api.get("ok"))),
        "version_compatibility": _lvl(compat["same"], partial=not compat["same"]),
        "gateway_ownership": _lvl(bool(gw_job.get("loaded"))),
        "honcho": _lvl(bool(honcho.get("ok"))),
        "honcho_backup_freshness": _lvl(bool(hb.get("ok") and hb.get("local_ok")), partial=bool(hb.get("ok"))),
        "offhost_backup": _lvl(bool(hb.get("nas_ok"))),
        "isolated_restore": _lvl(hb.get("restore_test") == "passed_isolated"),
        "scheduled_backup": "missing",
        "memory_failover": "missing",
        "witness": "missing",
        "quorum": "missing",
        "fencing": "missing",
        "lease_controller": "missing",
        "standby_config": "partially_implemented",
        "last_restore_test": _lvl(hb.get("restore_test") == "passed_isolated"),
        "failover_testing": "missing",
        "failback_tested": "missing",
        "automatic_failover": "missing",
    }
    evidence = {
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "alpha_api": alpha_api.get("version"),
        "bravo_api": bravo_api.get("version"),
        "honcho_http": honcho.get("http"),
        "gateway_pid": gw_job.get("pid"),
        "backup_stamp": hb.get("last_success_stamp"),
        "nas_verified": hb.get("nas_verified"),
        "restore_test": hb.get("restore_test"),
        "scheduled_backup_note": "4E approved. Waiting unattended 2026-10-20 03:30 Australia/Sydney stamp. Manual dump 20261019-102628 is not that proof.",
        "honcho_probe": "http://192.168.1.84:8000/health",
        "phase": "4E",
        "overall": "NOT READY",
    }
    out = {
        "ok": True,
        "t": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "policy": {
            "automatic_failover": False,
            "automatic_failback": False,
            "promotion_controls": "disabled",
            "reason": "No independent witness or fencing. Manual only after later-phase approval.",
        },
        "primary": "alpha",
        "standby": "bravo",
        "alpha": {
            "role": "ACTIVE PRIMARY (configured, not elected)",
            "host": "Mac Mini M2",
            "hermes_api": alpha_api,
            "load": load,
            "uptime_days": _uptime_days(),
            "owns_messaging": True,
        },
        "bravo": {
            "role": "PASSIVE STANDBY / worker",
            "host": "Unraid 192.168.1.84",
            "hermes_api": bravo_api,
            "command_board": board,
            "owns_messaging": False,
        },
        "honcho": {
            **honcho,
            "host": "unraid",
            "not_on_mac": True,
            "endpoint": "http://192.168.1.84:8000/health",
            "engine": "postgresql-15.19+pgvector",
            "volume": "honcho_pgdata",
            "shared_spof": True,
        },
        "umbrel_peer": umbrel,
        "gateway_ownership": {
            "host": "alpha",
            "launchd": gw_job,
            "bravo_telegram_env_keys": inv.get("bravo_telegram_env_keys"),
        },
        "ops_persist": {
            "launchd": ops_job,
            "listener": _ops_listener(),
            "survives_logout": "unverified",
            "survives_reboot": "unverified",
            "launchdaemon_needed_for_unattended": True,
        },
        "witness": {
            "status": "NONE",
            "ready": False,
            "charlie": "observer_candidate",
            "umbrel_independent": False,
            "ilo_independent": False,
            "note": "Charlie/Umbrel is another Hermes on the same LAN (v0.21.5). Observer probes only — not a quorum witness. iLO is the Unraid chassis.",
        },
        "fencing": {
            "status": "DESIGNED_NOT_ACTIVE",
            "ready": False,
            "layer": "software_lease_then_gateway_stop",
            "note": "Paper only. Local gateway.lock is not cross-host. Do not enable.",
        },
        "controller": {"status": "NONE", "ready": False, "note": "Witness service not deployed. Paper spec only."},
        "replication": {
            "status": "DUMP_ONLY",
            "note": "Authoritative Honcho is Unraid Postgres honcho_pgdata. Mac is client only. No streaming replica. Filesystem sync of live DB is forbidden.",
        },
        "microserver": {
            "status": "NOT_LOCATED",
            "role": "proposed_charlie",
            "note": "HPE MicroServer Gen10 not identified on LAN this pass. Umbrel 192.168.1.236 remains observer-candidate only. Bravo is DL385 Gen10, not a MicroServer.",
        },
        "config_compatibility": compat,
        "backup": _backup(),
        "honcho_backup": hb,
        "readiness": readiness,
        "readiness_evidence": evidence,
        "failover_readiness": {
            "ready": failover_ready,
            "witness": False,
            "fencing": False,
            "honcho_off_unraid": False,
            "version_match": compat["same"],
            "ops_launchd": ops_job.get("loaded"),
            "controller": False,
        },
        "incidents": incidents[-10:],
        "inventory_at": inv.get("at"),
        "spof": [
            "Mac owns Telegram/Discord/Matrix pollers",
            "Honcho on Unraid (Mac is client; Unraid is shared SPOF)",
            "No independent witness",
            "No fencing / STONITH",
            "No HA controller",
            "Scheduled Honcho dump not yet proven at 03:30",
            "Hermes gateway.lock is host-local; Telegram 409 is not a fence",
        ],
    }
    _CACHE["t"] = now
    _CACHE["data"] = out
    return out


def refuse_mutate() -> dict:
    return {
        "ok": False,
        "error": "controls_disabled",
        "detail": "Automatic failover and promotion are off until witness, fencing, and admin approval.",
    }
