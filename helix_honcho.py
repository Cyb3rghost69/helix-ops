"""Honcho Storage vs Insights telemetry for Helix ops. No secrets, no session ids."""
from __future__ import annotations

import json
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

UNRAID = "192.168.1.84"
HONCHO = f"http://{UNRAID}:8000"
WORKSPACE = "hermes"


def _http(url: str, timeout: float = 5.0, method: str = "GET", body: bytes | None = None) -> tuple[int, object, float]:
    t0 = time.perf_counter()
    req = Request(url, data=body, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urlopen(req, timeout=timeout) as r:
            raw = r.read()
            ms = round((time.perf_counter() - t0) * 1000)
            try:
                return int(r.status), json.loads(raw.decode() or "null"), ms
            except json.JSONDecodeError:
                return int(r.status), None, ms
    except HTTPError as e:
        ms = round((time.perf_counter() - t0) * 1000)
        return int(e.code), None, ms
    except (URLError, TimeoutError, OSError):
        ms = round((time.perf_counter() - t0) * 1000)
        return 0, None, ms


def snapshot() -> dict:
    code, health, hms = _http(f"{HONCHO}/health")
    ok = code == 200 and isinstance(health, dict) and health.get("status") == "ok"
    q_code, queue, qms = _http(f"{HONCHO}/v3/workspaces/{WORKSPACE}/queue/status")
    pending = in_prog = completed = total = None
    if q_code == 200 and isinstance(queue, dict):
        pending = queue.get("pending_work_units")
        in_prog = queue.get("in_progress_work_units")
        completed = queue.get("completed_work_units")
        total = queue.get("total_work_units")
    insights = "NO TELEMETRY"
    if pending is None:
        insights = "NO TELEMETRY"
    elif in_prog and in_prog > 0:
        insights = "DRAINING"
    elif pending == 0:
        insights = "CAUGHT_UP"
    elif pending > 0 and (in_prog == 0 or in_prog is None):
        insights = "STALLED"
    return {
        "host": "unraid",
        "not_on_mac": True,
        "endpoint": f"{HONCHO}/health",
        "ok": ok,
        "http": code,
        "ms": hms,
        "workspace": WORKSPACE,
        "queue": {
            "http": q_code,
            "ms": qms,
            "total": total,
            "completed": completed,
            "in_progress": in_prog,
            "pending": pending,
        },
        "insights": insights,
        "deriver": {
            "status": "NOT_STARTED" if insights == "STALLED" else ("RUNNING" if insights == "DRAINING" else "UNKNOWN"),
            "note": "Compose service deriver is required for Insights. Do not infer health from /health alone.",
        },
        "policy": {
            "automatic_failover": False,
            "ollama_autostart": False,
        },
    }
