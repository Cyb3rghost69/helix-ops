"""Live Hermes context telemetry. Never invent window occupancy."""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

HOME = Path.home() / ".hermes"
STATE = HOME / "state.db"
META = HOME / "cache" / "endpoint_model_metadata.json"
CTX_CACHE = HOME / "context_length_cache.yaml"
CFG = HOME / "config.yaml"


def _ro(path: Path):
    if not path.is_file():
        return None
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=5)


def _yaml_ctx_cache() -> dict[str, int]:
    out: dict[str, int] = {}
    if not CTX_CACHE.is_file():
        return out
    try:
        text = CTX_CACHE.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return out
    for ln in text.splitlines():
        if ":" not in ln or ln.strip().startswith("context"):
            continue
        k, v = ln.split(":", 1)
        k = k.strip()
        try:
            out[k] = int(str(v).strip())
        except ValueError:
            continue
    return out


def _meta_ctx(model: str) -> int | None:
    if not model or not META.is_file():
        return None
    try:
        data = json.loads(META.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    models = {}
    if isinstance(data, dict):
        if isinstance(data.get("models"), dict):
            models = data["models"]
        else:
            for v in data.values():
                if isinstance(v, dict) and isinstance(v.get("models"), dict):
                    models = v["models"]
                    break
    row = models.get(model) if isinstance(models, dict) else None
    if isinstance(row, dict):
        n = row.get("context_length")
        if isinstance(n, int) and n > 0:
            return n
    cache = _yaml_ctx_cache()
    for key, n in cache.items():
        if key.startswith(model + "@") or key == model:
            return n
    return None


def _cfg_model() -> tuple[str | None, str | None]:
    if not CFG.is_file():
        return None, None
    try:
        text = CFG.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None, None
    model = None
    provider = None
    in_model = False
    for ln in text.splitlines():
        s = ln.rstrip()
        if s.startswith("model:") or s.strip() == "model:":
            in_model = True
            continue
        if in_model and s and not s.startswith(" ") and not s.startswith("\t"):
            in_model = False
        if in_model:
            if "default:" in s:
                model = s.split(":", 1)[1].strip().strip("'\"")
            if "provider:" in s:
                provider = s.split(":", 1)[1].strip().strip("'\"")
    return model or None, provider or None


def snapshot() -> dict:
    """Per-request and session token totals. Window occupancy stays None unless measured."""
    cfg_model, cfg_provider = _cfg_model()
    out = {
        "ok": False,
        "quality": "UNAVAILABLE",
        "windowQuality": "UNAVAILABLE",
        "model": cfg_model,
        "provider": cfg_provider,
        "sessionId": None,
        "contextCapacity": None,
        "windowUsed": None,
        "windowFree": None,
        "utilization": None,
        "requestTokens": None,
        "outputTokens": None,
        "sessionInput": None,
        "sessionOutput": None,
        "sessionCacheRead": None,
        "apiCalls": None,
        "note": "no live window occupancy",
        "t": time.time(),
    }
    con = _ro(STATE)
    if con is None:
        return out
    try:
        cur = con.cursor()
        row = cur.execute(
            """SELECT id, model, input_tokens, output_tokens, cache_read_tokens,
                      api_call_count, last_activity_at
               FROM sessions WHERE IFNULL(archived,0)=0
               ORDER BY last_activity_at DESC LIMIT 1"""
        ).fetchone()
        if not row:
            out["quality"] = "UNAVAILABLE"
            return out
        sid, model, inn, outt, cache, calls, last = row
        model = model or cfg_model
        cap = _meta_ctx(model) if model else None
        out.update(
            {
                "ok": True,
                "quality": "LIVE",
                "windowQuality": "UNAVAILABLE",
                "model": model,
                "sessionId": sid,
                "contextCapacity": cap,
                "sessionInput": inn,
                "sessionOutput": outt,
                "sessionCacheRead": cache,
                "apiCalls": calls,
                "lastActivity": last,
                "note": "session totals are lifetime, not current window",
            }
        )
        # last usage row for the empty task is still cumulative — do not treat as request
        usage = cur.execute(
            """SELECT input_tokens, output_tokens, api_call_count, task
               FROM session_model_usage WHERE session_id=? ORDER BY last_seen DESC""",
            (sid,),
        ).fetchall()
        main = next((u for u in usage if not (u[3] or "").strip()), None)
        if main:
            out["sessionInput"] = main[0]
            out["sessionOutput"] = main[1]
            out["apiCalls"] = main[2]
        # Per-message token_count is often null — only emit request tokens when present
        tok = cur.execute(
            """SELECT token_count FROM messages
               WHERE session_id=? AND token_count IS NOT NULL
               ORDER BY id DESC LIMIT 1""",
            (sid,),
        ).fetchone()
        if tok and tok[0] is not None:
            out["requestTokens"] = int(tok[0])
            out["requestQuality"] = "LIVE"
        else:
            out["requestQuality"] = "UNAVAILABLE"
        # Never: sessionInput / capacity as utilization
        out["utilization"] = None
        out["windowUsed"] = None
        out["windowFree"] = None
        return out
    except sqlite3.Error:
        out["ok"] = False
        out["quality"] = "UNAVAILABLE"
        return out
    finally:
        try:
            con.close()
        except sqlite3.Error:
            pass
