"""Read Honcho backup status. No secrets, no dump contents."""
from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Optional

_CACHE = {"t": 0.0, "data": None}
_LOCAL = Path.home() / ".hermes" / "reports" / "honcho-backup-status.json"
_SSH = [
    "ssh",
    "-i",
    str(Path.home() / ".ssh" / "id_ed25519_unraid_hermes"),
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=5",
    "root@192.168.1.84",
    "cat /mnt/user/backups/honcho/status.json",
]


def _age_hours(stamp: Optional[str]):
    if not stamp or len(stamp) < 13:
        return None
    try:
        t = time.strptime(stamp[:15], "%Y%m%d-%H%M%S")
        return round((time.time() - time.mktime(t)) / 3600, 1)
    except Exception:
        return None


def _warn(d: dict) -> list:
    w = []
    loc = d.get("last_local") or {}
    nas = d.get("last_nas") or {}
    age = _age_hours(loc.get("stamp"))
    if not loc.get("sha256"):
        w.append("no_local_backup")
    if age is not None and age > 36:
        w.append("missed_backup")
    if age is not None and age > 48:
        w.append("expired_backup")
    if nas.get("ok") is False or nas.get("verified") is False:
        w.append("nas_replication_failed")
    if (d.get("restore_test") or {}).get("status") not in ("passed_isolated",):
        w.append("restore_unverified")
    if not loc.get("list_ok"):
        w.append("archive_unread")
    return w


def snapshot(force: bool = False) -> dict:
    now = time.time()
    if not force and _CACHE["data"] and now - _CACHE["t"] < 60:
        return _CACHE["data"]
    raw = None
    src = None
    try:
        r = subprocess.run(_SSH, capture_output=True, text=True, timeout=12)
        if r.returncode == 0 and r.stdout.strip().startswith("{"):
            raw = json.loads(r.stdout)
            src = "unraid"
    except Exception:
        raw = None
    if raw is None and _LOCAL.is_file():
        try:
            raw = json.loads(_LOCAL.read_text(encoding="utf-8"))
            src = "local_cache"
        except Exception:
            raw = None
    if not raw:
        out = {"ok": False, "source": None, "error": "NO TELEMETRY", "warnings": ["unknown"]}
        _CACHE["t"] = now
        _CACHE["data"] = out
        return out
    loc = raw.get("last_local") or {}
    nas = raw.get("last_nas") or {}
    age = _age_hours(loc.get("stamp"))
    rt = raw.get("restore_test") or {}
    sched = raw.get("schedule") or {}
    out = {
        "ok": bool(raw.get("ok")),
        "source": src,
        "last_success_stamp": loc.get("stamp"),
        "age_hours": age,
        "bytes": loc.get("bytes"),
        "sha256": loc.get("sha256"),
        "list_ok": loc.get("list_ok"),
        "toc_entries": loc.get("toc_entries"),
        "local_ok": bool(loc.get("sha256")),
        "nas_ok": bool(nas.get("ok") or nas.get("verified")),
        "nas_verified": bool(nas.get("verified") or nas.get("ok")),
        "schedule_active": bool(sched.get("active")),
        "next": "03:30 Australia/Sydney daily" if sched.get("active") else "unscheduled",
        "restore_test": rt.get("status") or "unknown",
        "restore_isolated": bool(rt.get("isolated")),
        "recoverable_claim": False,
        "note": "pg_restore --list is not recoverability. Isolated restore tested schema/extensions/counts only.",
        "warnings": _warn(raw),
        "retention_applied": bool((raw.get("retention") or {}).get("applied")),
    }
    _CACHE["t"] = now
    _CACHE["data"] = out
    try:
        _LOCAL.write_text(json.dumps(raw, indent=2) + "\n", encoding="utf-8")
    except Exception:
        pass
    return out
