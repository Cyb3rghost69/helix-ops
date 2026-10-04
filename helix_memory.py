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
_HISTORY: list[dict] = []
_LAST_HIST: dict = {}
ENTRY_DELIMITER = "\n§\n"


def _ctx_extra(sess: dict) -> dict:
    extra = {"session": sess.get("current"), "note": "no live window occupancy"}
    try:
        import helix_ctx
        snap = helix_ctx.snapshot()
    except Exception:
        return extra
    extra.update(
        {
            "model": snap.get("model"),
            "capacity": snap.get("contextCapacity"),
            "sessionInput": snap.get("sessionInput"),
            "sessionOutput": snap.get("sessionOutput"),
            "requestTokens": snap.get("requestTokens"),
            "windowQuality": snap.get("windowQuality"),
            "quality": snap.get("quality"),
        }
    )
    return extra

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


def _parse_entries(raw: str) -> list[str]:
    """Match Hermes MemoryStore._parse_entries (split on full \\n§\\n only)."""
    return [e for e in (x.strip() for x in raw.split(ENTRY_DELIMITER)) if e]


def _md_meta(path: Path) -> dict:
    if not path.is_file():
        return {"exists": False, "used": 0, "entries": 0, "bytes": 0, "mtime": None, "rev": None}
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except (OSError, UnicodeDecodeError):
        raw = path.read_text(encoding="utf-8", errors="replace")
    entries = _parse_entries(raw)
    used = len(ENTRY_DELIMITER.join(entries)) if entries else 0
    st = path.stat()
    rev = f"{st.st_mtime_ns:x}"[-4:].upper()
    return {
        "exists": True,
        "used": used,
        "entries": len(entries),
        "bytes": st.st_size,
        "mtime": int(st.st_mtime),
        "rev": rev,
    }


def _mem_cfg(path: Path | None = None) -> dict:
    out = {
        "memory_enabled": True,
        "user_profile_enabled": True,
        "write_approval": False,
        "memory_char_limit": 2200,
        "user_char_limit": 1375,
        "provider": "builtin",
    }
    cfg = path or CONFIG
    if not cfg.is_file():
        return out
    in_mem = False
    for line in cfg.read_text(encoding="utf-8", errors="replace").splitlines():
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
        "lastRead": kw.get("lastRead"),
        "lastWrite": kw.get("lastWrite", kw.get("lastModified")),
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
        "prompts": 0,
    }
    if not STATE_DB.is_file():
        return empty
    out = dict(empty)
    out["ok"] = True
    out["bytes"] = STATE_DB.stat().st_size
    try:
        con = sqlite3.connect(f"file:{STATE_DB}?mode=ro", uri=True, timeout=5)
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
        if "system_prompts" in tables:
            out["prompts"] = int(cur.execute("SELECT COUNT(*) FROM system_prompts").fetchone()[0])
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


BUNDLED_PROVIDERS = (
    "honcho",
    "mem0",
    "supermemory",
    "byterover",
    "hindsight",
    "holographic",
    "openviking",
    "retaindb",
)
PLUGIN_CFG = {
    "supermemory": HERMES_HOME / "supermemory.json",
    "mem0": HERMES_HOME / "mem0.json",
    "hindsight": HERMES_HOME / "hindsight.json",
}


def _provider_catalog(active: str) -> dict:
    src = HERMES_HOME / "hermes-agent" / "plugins" / "memory"
    installed = []
    if src.is_dir():
        installed = sorted(
            p.name for p in src.iterdir() if p.is_dir() and p.name in BUNDLED_PROVIDERS
        )
    unused = [n for n in installed if n != active]
    sidecar = []
    unknown = []
    for name, path in PLUGIN_CFG.items():
        if path.is_file():
            sidecar.append(name)
            if name != active:
                unknown.append(name)
    return {
        "active": active,
        "installed": installed,
        "unused": unused,
        "sidecars": sidecar,
        "unknown": unknown,
    }


def _honcho_records() -> int | None:
    if not HONCHO_CFG.is_file():
        return None
    try:
        raw = json.loads(HONCHO_CFG.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None
    base = str(raw.get("baseUrl") or "http://192.168.1.84:8000").rstrip("/")
    ws = str(raw.get("workspace") or "hermes")
    url = f"{base}/v3/workspaces/{ws}/conclusions/list?size=1"
    t0 = time.time()
    try:
        req = Request(url, data=b"{}", method="POST")
        req.add_header("Content-Type", "application/json")
        with urlopen(req, timeout=2.0) as r:
            blob = r.read(4096)
            data = json.loads(blob.decode() or "{}") if blob else {}
        total = data.get("total") if isinstance(data, dict) else None
        return int(total) if isinstance(total, int) else None
    except (URLError, HTTPError, TimeoutError, OSError, json.JSONDecodeError, ValueError):
        _ = time.time() - t0
        return None


def _skill_count() -> dict:
    root = HERMES_HOME / "skills"
    if not root.is_dir():
        return {"ok": False, "entries": 0, "bytes": 0}
    n = 0
    b = 0
    for p in root.rglob("SKILL.md"):
        if not p.is_file():
            continue
        n += 1
        try:
            b += p.stat().st_size
        except OSError:
            pass
    return {"ok": True, "entries": n, "bytes": b}


def _session_index() -> dict:
    p = HERMES_HOME / "sessions" / "sessions.json"
    dumps = HERMES_HOME / "sessions"
    keys = 0
    dump_n = 0
    dump_b = 0
    if p.is_file():
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                keys = sum(1 for k in data if k != "_README")
        except (OSError, json.JSONDecodeError):
            keys = 0
    if dumps.is_dir():
        for f in dumps.iterdir():
            if f.is_file() and f.name.startswith("request_dump"):
                dump_n += 1
                dump_b += f.stat().st_size
    return {"routes": keys, "dumps": dump_n, "dumpBytes": dump_b}


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


def _maybe_hist(b: dict, op: str, force: bool = False) -> None:
    if not b.get("id"):
        return
    if b.get("utilization") is None and b.get("type") not in ("CORE", "USER", "SESSION"):
        return
    nowt = time.time()
    last = _LAST_HIST.get(b["id"])
    changed = (
        not last
        or last.get("used") != b.get("used")
        or last.get("utilization") != b.get("utilization")
        or last.get("entries") != b.get("entries")
    )
    if not changed and not force:
        if last and nowt - last["t"] < 60:
            return
        if b.get("utilization") is None and b.get("type") != "SESSION":
            return
    _HISTORY.append(
        {
            "t": int(nowt),
            "bank": b["id"],
            "used": b.get("used"),
            "limit": b.get("limit"),
            "utilization": b.get("utilization"),
            "entries": b.get("entries"),
            "op": op,
        }
    )
    while len(_HISTORY) > 180:
        _HISTORY.pop(0)
    _LAST_HIST[b["id"]] = {
        "t": nowt,
        "used": b.get("used"),
        "utilization": b.get("utilization"),
        "entries": b.get("entries"),
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
            op = "CONSOLIDATE" if delta < 0 and (b.get("entries") or 0) < (o.get("entries") or 0) else "WRITE"
            _EVENTS.append(
                {"t": _now(), "code": f"MEM/{b['id']} {op} {sign}{delta} CHR", "detail": b["name"]}
            )
            _maybe_hist(b, op, force=True)
            if b.get("utilization") is not None:
                _EVENTS.append(
                    {
                        "t": _now(),
                        "code": f"MEM/{b['id']} UTIL {o.get('utilization')}→{b['utilization']}%",
                        "detail": "",
                    }
                )
        elif o.get("used") != b.get("used") and b.get("type") == "SESSION":
            _EVENTS.append(
                {"t": _now(), "code": f"MEM/{b['id']} SESSIONS {o.get('used')}→{b.get('used')}", "detail": ""}
            )
            _maybe_hist(b, "GROWTH", force=True)
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
    hon_n = _honcho_records() if hon.get("ok") else None
    proj = _project(git_now)
    catalog = _provider_catalog(str(cfg.get("provider") or "builtin"))
    skills = _skill_count()
    sidx = _session_index()
    banks = []
    n = 1
    write_mode = "ASK" if cfg.get("write_approval") else "AUTO"
    inspected = [
        str(CONFIG),
        str(MEM_DIR / "MEMORY.md"),
        str(MEM_DIR / "USER.md"),
        str(STATE_DB),
        str(HONCHO_CFG),
        str(PROFILES),
        str(HERMES_HOME / "skills"),
        str(HERMES_HOME / "sessions" / "sessions.json"),
        str(HERMES_HOME / "SOUL.md"),
        str(HERMES_HOME / "hermes-agent" / "plugins" / "memory"),
        str(HERMES_HOME / "hermes-agent" / "agent" / "memory_manager.py"),
        "ops-dashboard/.git",
        "ops-dashboard/docs",
    ]

    def add(**kw):
        nonlocal n
        banks.append(_bank(n, **kw))
        n += 1

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
            lastWrite=core["mtime"],
            lastRead=None,
            sessionVisible=True,
            provider="builtin",
            writeMode=write_mode,
            extra={"rev": core["rev"]},
            capabilities={
                "capacity": True,
                "utilization": True,
                "entries": True,
                "writes": True,
                "history": True,
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
            lastWrite=user["mtime"],
            lastRead=None,
            sessionVisible=True,
            provider="builtin",
            writeMode=write_mode,
            extra={"rev": user["rev"]},
            capabilities={
                "capacity": True,
                "utilization": True,
                "entries": True,
                "writes": True,
                "history": True,
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
            extra=_ctx_extra(sess),
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
            used=hon_n,
            limit=None,
            entries=hon_n,
            provider="honcho",
            extra={"url": hon.get("url"), "ms": hon.get("ms"), "hosts": hon.get("hosts"), "records": hon_n, "recall": hon.get("recall")},
            capabilities={"capacity": False, "utilization": False, "latency": True, "records": hon_n is not None},
        )
    )
    n += 1
    if sess.get("fts"):
        banks.append(
            _bank(
                n,
                name="SESSION SEARCH INDEX",
                type="INDEX",
                source="Hermes",
                backend="FTS5 messages_fts",
                status="ONLINE",
                capacityType="RECORDS",
                used=sess["messages"],
                limit=None,
                entries=sess["messages"],
                extra={"trigram": True},
                capabilities={"capacity": False, "utilization": False, "search": True, "records": True},
            )
        )
        n += 1
    if sidx["routes"] or sidx["dumps"]:
        banks.append(
            _bank(
                n,
                name="GATEWAY SESSION INDEX",
                type="INDEX",
                source="Hermes",
                backend="sessions.json",
                status="ONLINE",
                capacityType="RECORDS",
                used=sidx["routes"],
                limit=None,
                entries=sidx["dumps"],
                bytes=sidx["dumpBytes"],
                extra={"dumps": sidx["dumps"]},
                capabilities={"capacity": False, "records": True, "size": True},
            )
        )
        n += 1
    soul = _md_meta(HERMES_HOME / "SOUL.md")
    if soul["exists"]:
        banks.append(
            _bank(
                n,
                name="SOUL IDENTITY",
                type="AGENT",
                source="Hermes",
                backend="SOUL.md",
                status="ONLINE",
                capacityType="CHARACTERS",
                used=soul["used"],
                limit=None,
                entries=soul["entries"],
                bytes=soul["bytes"],
                lastModified=soul["mtime"],
                capabilities={"capacity": False, "utilization": False, "entries": True},
            )
        )
        n += 1
    if skills["ok"] and skills["entries"]:
        banks.append(
            _bank(
                n,
                name="SKILL STORE",
                type="AGENT",
                source="Hermes",
                backend="skills/**/SKILL.md",
                status="ONLINE",
                capacityType="DOCUMENTS",
                used=skills["entries"],
                limit=None,
                entries=skills["entries"],
                bytes=skills["bytes"],
                capabilities={"capacity": False, "utilization": False, "records": True},
            )
        )
        n += 1
    if sess.get("prompts"):
        banks.append(
            _bank(
                n,
                name="PROMPT CACHE",
                type="CACHE",
                source="Hermes",
                backend="system_prompts",
                status="ONLINE",
                capacityType="RECORDS",
                used=sess["prompts"],
                limit=None,
                entries=sess["prompts"],
                extra={"note": "hash index only"},
                capabilities={"capacity": False, "records": True},
            )
        )
        n += 1
    agent_mem = []
    profile_names = []
    if PROFILES.is_dir():
        profile_names = sorted(p.name for p in PROFILES.iterdir() if p.is_dir() and not p.name.startswith("."))
    for name in profile_names:
        pcfg = _mem_cfg(PROFILES / name / "config.yaml")
        md = PROFILES / name / "memories" / "MEMORY.md"
        ud = PROFILES / name / "memories" / "USER.md"
        st = PROFILES / name / "state.db"
        if md.is_file():
            meta = _md_meta(md)
            banks.append(
                _bank(
                    n,
                    name=f"AGENT {name.upper()} CORE",
                    type="AGENT",
                    source=name,
                    backend="MEMORY.md",
                    status="ONLINE",
                    capacityType="CHARACTERS",
                    used=meta["used"],
                    limit=int(pcfg.get("memory_char_limit") or 0) or None,
                    entries=meta["entries"],
                    bytes=meta["bytes"],
                    lastModified=meta["mtime"],
                    provider=str(pcfg.get("provider") or ""),
                    capabilities={
                        "capacity": bool(pcfg.get("memory_char_limit")),
                        "utilization": bool(pcfg.get("memory_char_limit")),
                        "entries": True,
                    },
                )
            )
            agent_mem.append(name + "/CORE")
            n += 1
        if ud.is_file():
            meta = _md_meta(ud)
            banks.append(
                _bank(
                    n,
                    name=f"AGENT {name.upper()} USER",
                    type="AGENT",
                    source=name,
                    backend="USER.md",
                    status="ONLINE",
                    capacityType="CHARACTERS",
                    used=meta["used"],
                    limit=int(pcfg.get("user_char_limit") or 0) or None,
                    entries=meta["entries"],
                    bytes=meta["bytes"],
                    lastModified=meta["mtime"],
                    capabilities={
                        "capacity": bool(pcfg.get("user_char_limit")),
                        "utilization": bool(pcfg.get("user_char_limit")),
                        "entries": True,
                    },
                )
            )
            agent_mem.append(name + "/USER")
            n += 1
        if st.is_file() and not md.is_file() and not ud.is_file():
            banks.append(
                _bank(
                    n,
                    name=f"AGENT {name.upper()} STATE",
                    type="STATE",
                    source=name,
                    backend="state.db",
                    status="ONLINE",
                    capacityType="BYTES",
                    used=st.stat().st_size,
                    limit=None,
                    bytes=st.stat().st_size,
                    capabilities={"capacity": False, "size": True},
                )
            )
            agent_mem.append(name + "/STATE")
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
        n += 1

    disk_rev = core.get("rev")
    sess_rev = sess.get("sessionHash")
    pending_load = False
    try:
        if sess.get("sessionStarted") and core.get("mtime"):
            pending_load = float(core["mtime"]) > float(sess["sessionStarted"])
    except (TypeError, ValueError):
        pending_load = False

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
        "inspected": inspected,
        "discovery": {
            "lastDiscovery": _now(),
            "banksDetected": len(banks),
            "providers": catalog,
            "sessionBackends": ["state.db", "sessions.json", "FTS5"] if sess.get("fts") else ["state.db", "sessions.json"],
            "agentMemory": agent_mem,
            "projectMemory": {"files": proj["files"], "repo": proj.get("repo"), "head": proj.get("head")},
            "unknown": catalog.get("unknown") or [],
        },
        "wrote": False,
        "history": [],
    }
    prev = _CACHE.get("data")
    _emit(prev, data)
    for b in banks:
        if b.get("type") in ("CORE", "USER", "SESSION"):
            _maybe_hist(b, "SAMPLE")
    data["history"] = list(_HISTORY[-180:])
    data["events"] = list(_EVENTS[-12:])
    wrote = any(("WRITE" in (e.get("code") or "") or "CONSOLIDATE" in (e.get("code") or "")) for e in data["events"][-3:])
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
