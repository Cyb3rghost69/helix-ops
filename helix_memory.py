#!/usr/bin/env python3
"""HELIX MEMORY MATRIX — discovery + telemetry. Never returns memory contents."""
from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

HERMES_HOME = Path.home() / ".hermes"
MEM_DIR = HERMES_HOME / "memories"
CONFIG = HERMES_HOME / "config.yaml"
HONCHO_CFG = HERMES_HOME / "honcho.json"
STATE_DB = HERMES_HOME / "state.db"
PENDING = HERMES_HOME / "pending" / "memory"
PROFILES = HERMES_HOME / "profiles"
KNOWN_AGENTS = ("prefect", "foreman", "canon", "scribe", "adze")
DOC_NAMES = (
    "README.md",
    "CHANGELOG.md",
    "docs/ARCHITECTURE.md",
    "docs/DESIGN-SYSTEM.md",
    "docs/AGENTS.md",
    "docs/PROJECT-STATE.md",
    "docs/DECISIONS.md",
    "docs/SECURITY.md",
    "docs/DASHBOARD.md",
    "docs/RUSTDESK.md",
    "docs/BOTMESH.md",
)

_CACHE: dict = {"t": 0.0, "data": None, "sig": {}}
_EVENTS: list[dict] = []
_INSPECTED = [
    str(CONFIG),
    str(MEM_DIR / "MEMORY.md"),
    str(MEM_DIR / "USER.md"),
    str(STATE_DB),
    str(HONCHO_CFG),
    str(PROFILES),
    "ops-dashboard/.git",
    "ops-dashboard/docs",
]


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S%z")


def _pressure(util) -> str | None:
    if util is None:
        return None
    if util >= 100:
        return "FULL"
    if util >= 90:
        return "CAPACITY WARNING"
    if util >= 80:
        return "CONSOLIDATION ADVISED"
    if util >= 70:
        return "ELEVATED"
    return "NOMINAL"


def _md_meta(path: Path) -> dict:
    if not path.is_file():
        return {"exists": False, "used": 0, "entries": 0, "bytes": 0, "mtime": None, "rev": None}
    raw = path.read_text(encoding="utf-8", errors="replace")
    used = len(raw)
    parts = [p for p in raw.split("§") if p.strip()]
    st = path.stat()
    rev = f"{st.st_mtime_ns:x}"[-4:].upper()
    return {
        "exists": True,
        "used": used,
        "entries": len(parts) if parts else (1 if raw.strip() else 0),
        "bytes": st.st_size,
        "mtime": int(st.st_mtime),
        "rev": rev,
    }


def _mem_cfg() -> dict:
    out = {
        "memory_enabled": True,
        "user_profile_enabled": True,
        "write_approval": False,
        "memory_char_limit": 2200,
        "user_char_limit": 1375,
        "provider": "builtin",
    }
    if not CONFIG.is_file():
        return out
    in_mem = False
    for line in CONFIG.read_text(encoding="utf-8", errors="replace").splitlines():
        if line.startswith("memory:"):
            in_mem = True
            continue
        if in_mem:
            if line and not line.startswith((" ", "\t")):
                break
            s = line.strip()
            if s.startswith("#") or ":" not in s:
                continue
            k, _, v = s.partition(":")
            k, v = k.strip(), v.strip().strip("'\"")
            if k in out:
                if v.lower() in ("true", "false"):
                    out[k] = v.lower() == "true"
                elif v.isdigit():
                    out[k] = int(v)
                elif v:
                    out[k] = v
    return out


def _bank(i: int, **kw) -> dict:
    b = {
        "id": f"M{i:02d}",
        "name": kw.get("name"),
        "type": kw.get("type"),
        "source": kw.get("source"),
        "backend": kw.get("backend"),
        "enabled": kw.get("enabled", True),
        "status": kw.get("status", "ONLINE"),
        "capacityType": kw.get("capacityType"),
        "used": kw.get("used"),
        "limit": kw.get("limit"),
        "free": kw.get("free"),
        "utilization": kw.get("utilization"),
        "entries": kw.get("entries"),
        "bytes": kw.get("bytes"),
        "lastModified": kw.get("lastModified"),
        "sessionVisible": kw.get("sessionVisible"),
        "provider": kw.get("provider"),
        "capabilities": kw.get("capabilities") or {},
        "pressure": kw.get("pressure"),
        "writeMode": kw.get("writeMode"),
        "extra": kw.get("extra") or {},
    }
    if b["limit"] not in (None, 0) and b["used"] is not None:
        b["free"] = max(0, int(b["limit"]) - int(b["used"]))
        b["utilization"] = round(100.0 * int(b["used"]) / int(b["limit"]), 1)
        b["pressure"] = _pressure(b["utilization"])
    else:
        b["utilization"] = None
        b["pressure"] = None
        if b.get("free") is None:
            b["free"] = None
    return b


def _session_stats() -> dict:
    empty = {
        "ok": False,
        "sessions": 0,
        "messages": 0,
        "bytes": 0,
        "fts": False,
        "oldest": None,
        "newest": None,
        "current": None,
        "tokens": None,
        "sessionHash": None,
        "sessionStarted": None,
    }
    if not STATE_DB.is_file():
        return empty
    out = dict(empty)
    out["ok"] = True
    out["bytes"] = STATE_DB.stat().st_size
    try:
        con = sqlite3.connect(f"file:{STATE_DB}?mode=ro", uri=True)
        cur = con.cursor()
        tables = {r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        out["fts"] = "messages_fts" in tables
        if "sessions" in tables:
            out["sessions"] = int(cur.execute("SELECT COUNT(*) FROM sessions").fetchone()[0])
            row = cur.execute(
                "SELECT MIN(started_at), MAX(COALESCE(last_activity_at, started_at)) FROM sessions"
            ).fetchone()
            out["oldest"] = row[0]
            out["newest"] = row[1]
            cur_row = cur.execute(
                "SELECT id, started_at, last_activity_at, message_count, "
                "COALESCE(input_tokens,0)+COALESCE(output_tokens,0), system_prompt_hash "
                "FROM sessions ORDER BY COALESCE(last_activity_at, started_at) DESC LIMIT 1"
            ).fetchone()
            if cur_row:
                out["current"] = cur_row[0]
                out["sessionStarted"] = cur_row[1]
                out["tokens"] = int(cur_row[4] or 0)
                out["sessionHash"] = (cur_row[5] or "")[:8] or None
        if "messages" in tables:
            out["messages"] = int(cur.execute("SELECT COUNT(*) FROM messages").fetchone()[0])
        con.close()
    except sqlite3.Error:
        out["ok"] = False
    return out


def _honcho() -> dict:
    info = {"ok": False, "provider": "honcho", "url": None, "ms": None, "hosts": 0}
    if HONCHO_CFG.is_file():
        try:
            raw = json.loads(HONCHO_CFG.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            raw = {}
        info["url"] = str(raw.get("baseUrl") or "")[:80] or None
        hosts = raw.get("hosts") if isinstance(raw.get("hosts"), dict) else {}
        info["hosts"] = sum(1 for h in hosts.values() if isinstance(h, dict) and h.get("enabled"))
        info["recall"] = raw.get("recallMode")
    url = (info["url"] or "http://192.168.1.84:8000").rstrip("/") + "/health"
    t0 = time.time()
    try:
        req = Request(url, method="GET")
        with urlopen(req, timeout=2.5) as r:
            body = r.read(80)
            info["ok"] = r.status == 200 and b"ok" in body.lower()
            info["ms"] = int((time.time() - t0) * 1000)
    except (URLError, HTTPError, TimeoutError, OSError):
        info["ok"] = False
        info["ms"] = int((time.time() - t0) * 1000)
    return info


def _project(git_now) -> dict:
    root = Path(__file__).resolve().parent
    files = 0
    latest = None
    for rel in DOC_NAMES:
        p = root / rel
        if p.is_file():
            files += 1
            m = int(p.stat().st_mtime)
            latest = m if latest is None else max(latest, m)
    g = git_now() if callable(git_now) else (git_now or {})
    return {
        "files": files,
        "lastModified": latest,
        "repo": g.get("repo"),
        "branch": g.get("branch"),
        "head": g.get("head"),
        "sync": g.get("sync"),
        "ok": bool(g.get("ok")),
    }


def _emit(prev: dict | None, cur: dict) -> None:
    if not prev:
        return
    pmap = {b["id"]: b for b in prev.get("banks") or []}
    for b in cur.get("banks") or []:
        o = pmap.get(b["id"])
        if not o:
            _EVENTS.append({"t": _now(), "code": f"MEM/{b['id']} ONLINE", "detail": b["name"]})
            continue
        if o.get("used") != b.get("used") and b.get("capacityType") == "CHARACTERS":
            delta = int(b["used"] or 0) - int(o.get("used") or 0)
            sign = "+" if delta >= 0 else ""
            _EVENTS.append(
                {"t": _now(), "code": f"MEM/{b['id']} WRITE {sign}{delta} CHR", "detail": b["name"]}
            )
            if b.get("utilization") is not None:
                _EVENTS.append(
                    {
                        "t": _now(),
                        "code": f"MEM/{b['id']} UTIL {o.get('utilization')}→{b['utilization']}%",
                        "detail": "",
                    }
                )
        if o.get("status") != b.get("status"):
            _EVENTS.append(
                {"t": _now(), "code": f"MEM/{b['id']} {b['status']}", "detail": b["name"]}
            )
    while len(_EVENTS) > 24:
        _EVENTS.pop(0)


def snapshot(git_now=None, force: bool = False) -> dict:
    now = time.time()
    if not force and _CACHE["data"] and now - _CACHE["t"] < 4:
        return _CACHE["data"]
    cfg = _mem_cfg()
    sess = _session_stats()
    hon = _honcho()
    proj = _project(git_now)
    banks = []
    n = 1
    write_mode = "ASK" if cfg.get("write_approval") else "AUTO"

    core = _md_meta(MEM_DIR / "MEMORY.md")
    banks.append(
        _bank(
            n,
            name="CORE MEMORY",
            type="CORE",
            source="Hermes",
            backend="MEMORY.md",
            enabled=bool(cfg.get("memory_enabled")),
            status="ONLINE" if core["exists"] else "OFFLINE",
            capacityType="CHARACTERS",
            used=core["used"],
            limit=int(cfg.get("memory_char_limit") or 2200),
            entries=core["entries"],
            bytes=core["bytes"],
            lastModified=core["mtime"],
            sessionVisible=True,
            provider="builtin",
            writeMode=write_mode,
            extra={"rev": core["rev"]},
            capabilities={
                "capacity": True,
                "utilization": True,
                "entries": True,
                "writes": True,
                "history": False,
            },
        )
    )
    n += 1
    user = _md_meta(MEM_DIR / "USER.md")
    banks.append(
        _bank(
            n,
            name="USER PROFILE",
            type="USER",
            source="Hermes",
            backend="USER.md",
            enabled=bool(cfg.get("user_profile_enabled")),
            status="ONLINE" if user["exists"] else "OFFLINE",
            capacityType="CHARACTERS",
            used=user["used"],
            limit=int(cfg.get("user_char_limit") or 1375),
            entries=user["entries"],
            bytes=user["bytes"],
            lastModified=user["mtime"],
            sessionVisible=True,
            provider="builtin",
            writeMode=write_mode,
            extra={"rev": user["rev"]},
            capabilities={
                "capacity": True,
                "utilization": True,
                "entries": True,
                "writes": True,
                "history": False,
            },
        )
    )
    n += 1
    banks.append(
        _bank(
            n,
            name="SESSION ARCHIVE",
            type="SESSION",
            source="Hermes",
            backend="SQLite state.db",
            enabled=sess["ok"],
            status="ONLINE" if sess["ok"] else "OFFLINE",
            capacityType="RECORDS",
            used=sess["sessions"],
            limit=None,
            entries=sess["messages"],
            bytes=sess["bytes"],
            extra={
                "oldest": sess["oldest"],
                "newest": sess["newest"],
                "current": sess["current"],
                "fts": sess["fts"],
            },
            capabilities={
                "capacity": False,
                "utilization": False,
                "size": True,
                "records": True,
                "search": sess["fts"],
            },
        )
    )
    n += 1
    banks.append(
        _bank(
            n,
            name="CONTEXT BUFFER",
            type="CONTEXT",
            source="Hermes",
            backend="session tokens",
            status="ONLINE" if sess["ok"] else "UNKNOWN",
            capacityType="TOKENS",
            used=None,
            limit=None,
            extra={"session": sess["current"], "note": "no live window occupancy"},
            capabilities={"capacity": False, "utilization": False, "records": True},
        )
    )
    n += 1
    banks.append(
        _bank(
            n,
            name="PROJECT MEMORY",
            type="PROJECT",
            source="HELIX",
            backend="Git/docs",
            status="ONLINE" if proj["ok"] else "NO REMOTE",
            capacityType="DOCUMENTS",
            used=proj["files"],
            limit=None,
            entries=proj["files"],
            lastModified=proj["lastModified"],
            extra={
                "repo": proj["repo"],
                "branch": proj["branch"],
                "head": proj["head"],
                "sync": proj["sync"],
            },
            capabilities={"capacity": False, "records": True},
        )
    )
    n += 1
    banks.append(
        _bank(
            n,
            name="EXTERNAL MEMORY",
            type="EXTERNAL",
            source="Honcho",
            backend="honcho HTTP",
            enabled=str(cfg.get("provider") or "") == "honcho",
            status="ONLINE" if hon["ok"] else "OFFLINE",
            capacityType="UNBOUNDED",
            used=None,
            limit=None,
            provider="honcho",
            extra={"url": hon.get("url"), "ms": hon.get("ms"), "hosts": hon.get("hosts")},
            capabilities={"capacity": False, "utilization": False, "latency": True},
        )
    )
    n += 1
    for name in KNOWN_AGENTS:
        md = PROFILES / name / "memories" / "MEMORY.md"
        ud = PROFILES / name / "memories" / "USER.md"
        st = PROFILES / name / "state.db"
        has_mem = md.is_file() or ud.is_file()
        if not has_mem and not st.is_file():
            continue
        if has_mem:
            meta = _md_meta(md if md.is_file() else ud)
            banks.append(
                _bank(
                    n,
                    name=f"AGENT {name.upper()}",
                    type="AGENT",
                    source=name,
                    backend="MEMORY.md" if md.is_file() else "USER.md",
                    status="ONLINE",
                    capacityType="CHARACTERS",
                    used=meta["used"],
                    limit=None,
                    entries=meta["entries"],
                    bytes=meta["bytes"],
                    lastModified=meta["mtime"],
                    capabilities={"capacity": False, "entries": True, "utilization": False},
                )
            )
        else:
            banks.append(
                _bank(
                    n,
                    name=f"AGENT {name.upper()} STATE",
                    type="STATE",
                    source=name,
                    backend="state.db",
                    status="ONLINE" if st.is_file() else "NONE",
                    capacityType="BYTES",
                    used=st.stat().st_size if st.is_file() else 0,
                    limit=None,
                    bytes=st.stat().st_size if st.is_file() else 0,
                    capabilities={"capacity": False, "size": True},
                )
            )
        n += 1

    pending_n = len(list(PENDING.glob("*.json"))) if PENDING.is_dir() else 0
    if pending_n:
        banks.append(
            _bank(
                n,
                name="PENDING WRITES",
                type="CACHE",
                source="Hermes",
                backend="pending/memory",
                status="STAGED",
                capacityType="RECORDS",
                used=pending_n,
                limit=None,
                entries=pending_n,
                capabilities={"capacity": False, "records": True},
            )
        )

    disk_rev = core.get("rev")
    sess_rev = sess.get("sessionHash")
    pending_load = False
    if sess.get("sessionStarted") and core.get("mtime"):
        pending_load = float(core["mtime"]) > float(sess["sessionStarted"])

    hel01 = "MEMORY MATRIX NOMINAL"
    if not hon["ok"] and str(cfg.get("provider") or "") == "honcho":
        hel01 = "EXTERNAL MEMORY LINK LOST"
    elif pending_load:
        hel01 = "NEW MEMORY AWAITING SESSION LOAD"
    else:
        core_b = banks[0]
        if core_b.get("pressure") in ("CAPACITY WARNING", "FULL", "CONSOLIDATION ADVISED"):
            hel01 = "CORE MEMORY PRESSURE ELEVATED"
        elif core_b.get("pressure") == "ELEVATED":
            hel01 = "CORE MEMORY PRESSURE ELEVATED"

    data = {
        "ok": True,
        "code": "MEM://HERMES-01",
        "name": "MEMORY MATRIX",
        "secondary": "HERMES MEMORY CORE",
        "ja": "記憶演算システム",
        "discoveredAt": _now(),
        "banks": banks,
        "bankCount": len(banks),
        "context": {
            "used": None,
            "limit": None,
            "utilization": None,
            "session": sess.get("current"),
        },
        "revision": {
            "disk": disk_rev,
            "session": sess_rev,
            "pendingLoad": pending_load,
        },
        "writeMode": write_mode,
        "provider": cfg.get("provider"),
        "hel01": hel01,
        "events": list(_EVENTS[-12:]),
        "inspected": list(_INSPECTED),
        "wrote": False,
    }
    prev = _CACHE.get("data")
    _emit(prev, data)
    data["events"] = list(_EVENTS[-12:])
    wrote = any("WRITE" in (e.get("code") or "") for e in data["events"][-3:])
    data["wrote"] = wrote
    if wrote and hel01 == "MEMORY MATRIX NOMINAL":
        data["hel01"] = "MEMORY COMMIT CONFIRMED"
    _CACHE["t"] = now
    _CACHE["data"] = data
    return data


def rescan(git_now=None) -> dict:
    _CACHE["t"] = 0.0
    data = snapshot(git_now, force=True)
    _EVENTS.append(
        {
            "t": _now(),
            "code": f"MEM/DISCOVERY {data['bankCount']:02d} BANKS",
            "detail": "",
        }
    )
    data["events"] = list(_EVENTS[-12:])
    _CACHE["data"] = data
    return data


def strip_contents(obj):
    """Refuse content-bearing keys if they ever appear."""
    banned = {"text", "content", "prompt", "body", "memory_text", "user_text"}
    if isinstance(obj, dict):
        return {k: strip_contents(v) for k, v in obj.items() if k not in banned}
    if isinstance(obj, list):
        return [strip_contents(x) for x in obj]
    return obj
