"""SENTINEL — defensive events from data already on this host. No scans, no fakes."""
from __future__ import annotations

import sqlite3
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROTECT = ROOT / "protect-events.db"
OPS = ROOT / "ops.env"


def _ops_auth_bypass() -> bool | None:
    if not OPS.is_file():
        return None
    try:
        text = OPS.read_text(encoding="utf-8")
    except OSError:
        return None
    for ln in text.splitlines():
        if ln.startswith("HELIX_OPS_AUTH="):
            v = ln.split("=", 1)[1].strip().strip("'\"")
            return v.lower() in ("off", "0", "false", "bypass", "no")
    return None


def _protect_events(limit: int = 20) -> list[dict]:
    if not PROTECT.is_file():
        return []
    try:
        con = sqlite3.connect(f"file:{PROTECT}?mode=ro", uri=True, timeout=3)
        rows = con.execute(
            "SELECT t, cam, kind, note FROM events ORDER BY t DESC LIMIT ?", (limit,)
        ).fetchall()
        con.close()
    except sqlite3.Error:
        return []
    out = []
    for t, cam, kind, note in rows:
        out.append(
            {
                "t": t,
                "sev": "INFO",
                "subsystem": "PROTECT",
                "event": str(kind or "DETECT"),
                "metric": str(cam or "")[:40],
                "value": None,
            }
        )
    return out


def _bind_8642() -> dict:
    # Known: Hermes API should be loopback-only.
    import subprocess
    try:
        p = subprocess.run(
            ["lsof", "-nP", "-iTCP:8642", "-sTCP:LISTEN"],
            capture_output=True, text=True, timeout=3,
        )
        text = p.stdout or ""
    except (OSError, subprocess.TimeoutExpired):
        return {"ok": None, "quality": "UNAVAILABLE"}
    if not text.strip() or "LISTEN" not in text:
        return {"ok": True, "listening": False, "quality": "LIVE"}
    exposed = any(x in text for x in ("*:8642", "0.0.0.0:8642", "[::]:8642"))
    loop = "127.0.0.1:8642" in text
    return {
        "ok": (not exposed) and loop,
        "listening": True,
        "loopback": loop,
        "exposed": exposed,
        "quality": "LIVE",
    }


def snapshot() -> dict:
    events = _protect_events()
    api = _bind_8642()
    if api.get("exposed"):
        events.append(
            {
                "t": time.time(),
                "sev": "WARNING",
                "subsystem": "API",
                "event": "HERMES API NOT LOOPBACK",
                "metric": "8642",
                "value": 1,
            }
        )
    bypass = _ops_auth_bypass()
    if bypass:
        events.append(
            {
                "t": time.time(),
                "sev": "INFO",
                "subsystem": "AUTH",
                "event": "OPS LOGIN BYPASS",
                "metric": "HELIX_OPS_AUTH",
                "value": 1,
            }
        )
    # No fake radar contacts. Empty list is the honest idle state.
    return {
        "ok": True,
        "t": time.time(),
        "quality": "LIVE",
        "active": events,
        "count": len(events),
        "api8642": api,
        "label": "NO ACTIVE SECURITY EVENTS" if not events else f"{len(events)} EVENT(S)",
    }
