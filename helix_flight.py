"""Bounded HELIX flight recorder. Metrics/events only. No secrets, no chat, no CoT."""
from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB = ROOT / "helix-flight.db"
LOCK = threading.Lock()

SAMPLE_KEYS = (
    "t", "system", "cpu", "ram", "mem", "ctx", "gpu", "bottleneck",
    "top", "score", "hermes", "net", "remote", "svc", "busy",
)
EVENT_KEYS = ("t", "sev", "subsystem", "event", "metric", "value")
FORBIDDEN = (
    "password", "token", "secret", "key", "content", "prompt", "message",
    "reasoning", "authorization", "cookie", "seed", "wallet",
)
KEEP_S = 7 * 24 * 3600
CADENCE = (
    (3600, 5),
    (6 * 3600, 30),
    (24 * 3600, 60),
    (3 * 24 * 3600, 300),
    (KEEP_S, 600),
)


def _conn() -> sqlite3.Connection:
    con = sqlite3.connect(str(DB), timeout=5)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute(
        """CREATE TABLE IF NOT EXISTS samples (
            t INTEGER NOT NULL, system TEXT, cpu REAL, ram REAL, mem REAL,
            ctx REAL, gpu REAL, bottleneck TEXT, top TEXT, score INTEGER,
            hermes TEXT, net TEXT, remote TEXT, svc TEXT, busy INTEGER
        )"""
    )
    con.execute(
        """CREATE TABLE IF NOT EXISTS events (
            t INTEGER NOT NULL, sev TEXT, subsystem TEXT, event TEXT,
            metric TEXT, value REAL
        )"""
    )
    con.execute("CREATE INDEX IF NOT EXISTS s_t ON samples(t)")
    con.execute("CREATE INDEX IF NOT EXISTS e_t ON events(t)")
    return con


def _clean(row: dict, keys: tuple[str, ...]) -> dict:
    if not isinstance(row, dict):
        return {}
    blob = json.dumps(row).lower()
    for bad in FORBIDDEN:
        if bad in blob and bad not in ("remote",):  # remote is a chip name
            # still drop obvious secret fields
            pass
    out = {}
    for k in keys:
        if k not in row:
            continue
        v = row[k]
        if k in FORBIDDEN:
            continue
        if isinstance(v, str):
            low = v.lower()
            if any(b in low for b in ("password", "bearer ", "sk-", "api_key")):
                continue
            v = v[:80]
        out[k] = v
    return out


def ingest_sample(row: dict) -> bool:
    d = _clean(row, SAMPLE_KEYS)
    if not d:
        return False
    t = int(d.get("t") or time.time() * 1000)
    if t < 10_000_000_000:
        t = int(t * 1000)
    d["t"] = t
    with LOCK:
        con = _conn()
        try:
            last = con.execute("SELECT t FROM samples ORDER BY t DESC LIMIT 1").fetchone()
            if last and t - int(last[0]) < 4000:
                return False
            con.execute(
                """INSERT INTO samples(t,system,cpu,ram,mem,ctx,gpu,bottleneck,top,score,hermes,net,remote,svc,busy)
                   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    t, d.get("system"), d.get("cpu"), d.get("ram"), d.get("mem"),
                    d.get("ctx"), d.get("gpu"), d.get("bottleneck"), d.get("top"),
                    d.get("score"), d.get("hermes"), d.get("net"), d.get("remote"),
                    d.get("svc"), 1 if d.get("busy") else 0,
                ),
            )
            con.commit()
            return True
        finally:
            con.close()


def ingest_event(row: dict) -> bool:
    d = _clean(row, EVENT_KEYS)
    if not d.get("event") and not d.get("subsystem"):
        return False
    t = int(d.get("t") or time.time() * 1000)
    if t < 10_000_000_000:
        t = int(t * 1000)
    sev = str(d.get("sev") or "INFO")[:16]
    with LOCK:
        con = _conn()
        try:
            con.execute(
                "INSERT INTO events(t,sev,subsystem,event,metric,value) VALUES(?,?,?,?,?,?)",
                (t, sev, str(d.get("subsystem") or "")[:32], str(d.get("event") or "")[:80],
                 str(d.get("metric") or "")[:32], d.get("value")),
            )
            con.commit()
            return True
        finally:
            con.close()


def _keep_sample(age_ms: int, t: int) -> bool:
    age_s = age_ms / 1000.0
    bucket = 600
    for horizon, step in CADENCE:
        if age_s <= horizon:
            bucket = step
            break
    return (t // 1000) % bucket == 0 or age_s <= 5


def prune() -> None:
    now = int(time.time() * 1000)
    cutoff = now - KEEP_S * 1000
    with LOCK:
        con = _conn()
        try:
            con.execute("DELETE FROM samples WHERE t < ?", (cutoff,))
            con.execute("DELETE FROM events WHERE t < ?", (cutoff,))
            rows = con.execute("SELECT t FROM samples ORDER BY t").fetchall()
            drop = []
            for (t,) in rows:
                age = now - int(t)
                if age > 3600 * 1000 and not _keep_sample(age, int(t)):
                    drop.append(int(t))
            # never drop samples that coincide with events of WARNING+
            if drop:
                keep_ev = {
                    int(r[0])
                    for r in con.execute(
                        "SELECT t FROM events WHERE sev IN ('CRITICAL','WARNING','ALERT')"
                    )
                }
                drop = [t for t in drop if t not in keep_ev]
            for t in drop:
                con.execute("DELETE FROM samples WHERE t=?", (t,))
            con.commit()
        finally:
            con.close()


def query(range_s: int = 86400, at: int | None = None, limit: int = 400) -> dict:
    now = int(time.time() * 1000)
    start = now - int(range_s) * 1000
    with LOCK:
        con = _conn()
        con.row_factory = sqlite3.Row
        try:
            samples = [
                dict(r)
                for r in con.execute(
                    "SELECT * FROM samples WHERE t>=? ORDER BY t DESC LIMIT ?",
                    (start, limit),
                )
            ]
            events = [
                dict(r)
                for r in con.execute(
                    "SELECT * FROM events WHERE t>=? ORDER BY t DESC LIMIT 200",
                    (start,),
                )
            ]
            closest = None
            if at is not None:
                row = con.execute(
                    "SELECT * FROM samples ORDER BY ABS(t-?) ASC LIMIT 1", (int(at),)
                ).fetchone()
                closest = dict(row) if row else None
            n = con.execute("SELECT COUNT(*) FROM samples").fetchone()[0]
            ne = con.execute("SELECT COUNT(*) FROM events").fetchone()[0]
        finally:
            con.close()
    return {
        "ok": True,
        "rangeS": range_s,
        "samples": list(reversed(samples)),
        "events": list(reversed(events)),
        "closest": closest,
        "counts": {"samples": n, "events": ne},
        "quality": "RECORDED" if samples else "UNAVAILABLE",
    }


def ingest(payload: dict) -> dict:
    if not isinstance(payload, dict):
        return {"ok": False}
    n_s = n_e = 0
    if isinstance(payload.get("sample"), dict) and ingest_sample(payload["sample"]):
        n_s = 1
    for ev in payload.get("events") or []:
        if isinstance(ev, dict) and ingest_event(ev):
            n_e += 1
    if time.time() % 30 < 2:
        prune()
    return {"ok": True, "samples": n_s, "events": n_e}
