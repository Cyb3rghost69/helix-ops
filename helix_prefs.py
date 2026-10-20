"""HELIX selective preference memory — Honcho conclusions only.

Does not replace helix_memory.py (MEMORY MATRIX). Writes only:
PREFERENCE, ALIAS, SCENE_PREFERENCE, COMPUTE_PREFERENCE.
Explicit user intent required. Honcho down must not break home/compute/voice.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from datetime import datetime
from typing import Any

VERSION = "1.0"
PREFIX = "HELIX_PREF "
CLASSES = ("PREFERENCE", "ALIAS", "SCENE_PREFERENCE", "COMPUTE_PREFERENCE")
KEYS = ("colour", "brightness", "policy", "alias", "scene")
POLICIES = ("FAST", "BALANCED", "LOCAL-FIRST")
SECRET_RE = re.compile(
    r"api[_-]?key|password|passwd|token|secret|credential|private key|begin [a-z ]*key|sk-[a-z0-9]|bearer\s",
    re.I,
)
CAPS = {
    "memory.ping": {"risk": "READ", "params": [], "approval": False},
    "memory.status": {"risk": "READ", "params": [], "approval": False},
    "memory.preferences.list": {"risk": "READ", "params": [], "approval": False},
    "memory.preferences.get": {"risk": "READ", "params": ["id"], "approval": False},
    "memory.preferences.set": {"risk": "SAFE-ACTION", "params": [], "approval": False},
    "memory.preferences.delete": {"risk": "SAFE-ACTION", "params": ["id"], "approval": False},
    "memory.preferences.apply": {"risk": "SAFE-ACTION", "params": [], "approval": False},
}

_MOCK: list[dict] | None = None
_DOWN = False


def set_mock(store: list[dict] | None = None, *, down: bool = False) -> None:
    global _MOCK, _DOWN
    _MOCK = None if store is None and not down else list(store or [])
    _DOWN = bool(down)


def _cfg() -> dict:
    from pathlib import Path
    path = Path.home() / ".hermes" / "honcho.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    return {
        "base": str(data.get("baseUrl") or "http://192.168.1.84:8000").rstrip("/"),
        "workspace": str(data.get("workspace") or "hermes"),
        "peer": str(data.get("peerName") or "matflaherty"),
        "observer": "hermes",
    }


def _http(method: str, path: str, body: Any = None, timeout: float = 6.0) -> dict:
    if _DOWN:
        return {"ok": False, "error": "honcho offline", "offline": True}
    if _MOCK is not None:
        return _mock_http(method, path, body)
    cfg = _cfg()
    url = cfg["base"] + path
    raw = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(url, data=raw, method=method)
    if raw is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            blob = r.read()
            data = json.loads(blob.decode() or "null") if blob else None
            return {"ok": True, "status": r.status, "data": data}
    except urllib.error.HTTPError as e:
        return {"ok": False, "error": f"http {e.code}", "status": e.code, "offline": e.code >= 500}
    except Exception:
        return {"ok": False, "error": "honcho offline", "offline": True}


def _mock_http(method: str, path: str, body: Any) -> dict:
    store = _MOCK if _MOCK is not None else []
    path = path.split("?", 1)[0]
    if method == "GET" and path.endswith("/health"):
        return {"ok": True, "status": 200, "data": {"status": "ok"}}
    if method == "POST" and path.endswith("/conclusions"):
        rows = []
        for item in (body or {}).get("conclusions") or []:
            rec = {
                "id": "mock_" + hex(len(store) + 1)[2:],
                "content": item.get("content") or "",
                "observer_id": item.get("observer_id"),
                "observed_id": item.get("observed_id"),
                "level": "explicit",
                "session_id": None,
                "source_ids": None,
                "times_derived": 1,
                "created_at": "2026-10-04T00:00:00",
            }
            store.append(rec)
            rows.append(rec)
        return {"ok": True, "status": 201, "data": rows}
    if method == "POST" and path.endswith("/conclusions/list"):
        return {
            "ok": True,
            "status": 200,
            "data": {"items": list(store), "total": len(store), "page": 1, "size": 100, "pages": 1},
        }
    if method == "DELETE" and "/conclusions/" in path:
        cid = path.rsplit("/", 1)[-1]
        keep = [x for x in store if x.get("id") != cid]
        if len(keep) == len(store):
            return {"ok": False, "error": "not found", "status": 404}
        store[:] = keep
        return {"ok": True, "status": 204, "data": None}
    return {"ok": False, "error": "denied", "denied": True}


def honcho_status() -> dict:
    if _DOWN:
        return {"ok": True, "honcho": "OFFLINE", "workspace": _cfg()["workspace"]}
    if _MOCK is not None:
        return {"ok": True, "honcho": "MOCK", "workspace": _cfg()["workspace"]}
    r = _http("GET", "/health")
    return {
        "ok": True,
        "honcho": "ONLINE" if r.get("ok") else "OFFLINE",
        "workspace": _cfg()["workspace"],
    }


def _decode(content: str) -> dict | None:
    raw = content or ""
    if not raw.startswith(PREFIX):
        return None
    try:
        data = json.loads(raw[len(PREFIX):])
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict) or data.get("helix") != "PREF":
        return None
    if data.get("class") not in CLASSES:
        return None
    return data


def _public(row: dict, honcho_id: str | None = None) -> dict:
    return {
        "id": row.get("pref_id"),
        "class": row.get("class"),
        "target": row.get("target"),
        "target_label": row.get("target_label") or row.get("target"),
        "key": row.get("key"),
        "value": row.get("value"),
        "when": row.get("when") or "always",
        "label": row.get("label"),
        "stored": bool(honcho_id),
    }


def _secret(val: str) -> bool:
    return bool(SECRET_RE.search(val or ""))


def _pref_id(cls: str, target: str, key: str, when: str = "always") -> str:
    return f"{cls.lower()}:{target}:{key}:{when or 'always'}"


def _label(target_label: str, key: str, value: Any, when: str) -> str:
    extra = f" AT {when.upper()}" if when and when != "always" else ""
    return f"{target_label}  {str(key).upper()}  {str(value).upper()}{extra}".strip()


def list_preferences(*, target: str | None = None, cls: str | None = None) -> dict:
    hs = honcho_status()
    if hs.get("honcho") == "OFFLINE":
        return {"ok": True, "honcho": "OFFLINE", "preferences": [], "count": 0}
    cfg = _cfg()
    r = _http("POST", f"/v3/workspaces/{cfg['workspace']}/conclusions/list?size=100", {})
    if not r.get("ok"):
        return {"ok": True, "honcho": "OFFLINE", "preferences": [], "count": 0, "error": r.get("error")}
    payload = r.get("data")
    items = (payload.get("items") if isinstance(payload, dict) else payload) or []
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        rec = _decode(str(it.get("content") or ""))
        if not rec:
            continue
        if target and rec.get("target") != target:
            continue
        if cls and rec.get("class") != cls:
            continue
        pub = _public(rec, it.get("id"))
        pub["_hid"] = it.get("id")
        out.append(pub)
    slim = [{k: v for k, v in row.items() if k != "_hid"} for row in out]
    return {"ok": True, "honcho": hs.get("honcho"), "preferences": slim, "count": len(slim), "_rows": out}


def get_preference(pref_id: str) -> dict:
    if not pref_id or pref_id in ("*", "all"):
        return {"ok": False, "error": "specific preference identifier required"}
    listed = list_preferences()
    for row in listed.get("preferences") or []:
        if row.get("id") == pref_id:
            return {"ok": True, "preference": row, "honcho": listed.get("honcho")}
    return {"ok": False, "error": "not found", "honcho": listed.get("honcho")}


def lookup(*, target: str | None = None, cls: str | None = None) -> dict:
    listed = list_preferences(target=target, cls=cls)
    return {
        "ok": True,
        "honcho": listed.get("honcho"),
        "preferences": listed.get("preferences") or [],
        "count": listed.get("count") or 0,
    }


def set_preference(payload: dict, *, explicit: bool = True) -> dict:
    if not explicit:
        return {"ok": False, "error": "explicit intent required", "wrote": False}
    cls = str(payload.get("class") or "PREFERENCE").upper()
    if cls not in CLASSES:
        return {"ok": False, "error": "invalid class"}
    key = str(payload.get("key") or "").lower()
    if key == "color":
        key = "colour"
    if key not in KEYS:
        return {"ok": False, "error": "invalid key"}
    target = str(payload.get("target") or "").strip()
    value = payload.get("value")
    when = str(payload.get("when") or "always").lower()
    if when not in ("always", "night"):
        return {"ok": False, "error": "invalid when"}
    if not target:
        return {"ok": False, "error": "invalid target"}
    if value is None or str(value).strip() == "":
        return {"ok": False, "error": "invalid value"}
    sval = str(value).strip()
    if _secret(sval) or _secret(target) or len(sval) > 80:
        return {"ok": False, "error": "forbidden value"}
    if key == "colour":
        from helix_control import resolve_colour
        cr = resolve_colour(sval)
        if not cr.get("ok"):
            return {"ok": False, "error": "invalid colour"}
        sval = cr["name"]
    if key == "brightness":
        from helix_control import resolve_brightness
        br = resolve_brightness(sval)
        if not br.get("ok"):
            return {"ok": False, "error": "invalid brightness"}
        sval = br["brightness"]
    if key == "policy":
        p = sval.upper().replace("LOCAL FIRST", "LOCAL-FIRST")
        if p == "LOCAL":
            p = "LOCAL-FIRST"
        if p not in POLICIES:
            return {"ok": False, "error": "invalid policy"}
        sval = p
        target = "compute"
        cls = "COMPUTE_PREFERENCE"
    if key == "alias":
        from helix_control import resolve_room
        rr = resolve_room(target)
        if not rr.get("ok"):
            return {"ok": False, "error": "invalid target"}
        target = rr["id"]
        cls = "ALIAS"
    if cls == "PREFERENCE":
        from helix_control import resolve_room
        rr = resolve_room(target)
        if not rr.get("ok"):
            return {"ok": False, "error": "invalid target"}
        target = rr["id"]
        target_label = rr["label"]
    elif cls == "SCENE_PREFERENCE":
        from helix_control import SCENES
        sid = target.strip().lower().replace(" ", "-")
        if sid not in SCENES:
            return {"ok": False, "error": "invalid target"}
        target = sid
        target_label = SCENES[sid]["name"]
    elif cls == "COMPUTE_PREFERENCE":
        target = "compute"
        target_label = "COMPUTE"
    else:
        from helix_control import ROOMS
        target_label = (ROOMS.get(target) or {}).get("label") or target.upper()

    pref_id = _pref_id(cls, target, key, when)
    rec = {
        "helix": "PREF",
        "v": 1,
        "class": cls,
        "pref_id": pref_id,
        "target": target,
        "target_label": target_label,
        "key": key,
        "value": sval,
        "when": when,
        "label": _label(target_label, key, sval, when),
    }
    hs = honcho_status()
    if hs.get("honcho") == "OFFLINE":
        return {"ok": False, "error": "honcho offline", "wrote": False, "honcho": "OFFLINE"}
    listed = list_preferences()
    for row in listed.get("_rows") or []:
        if row.get("id") == pref_id and row.get("_hid"):
            _delete_hid(row["_hid"])
    cfg = _cfg()
    body = {
        "conclusions": [{
            "content": PREFIX + json.dumps(rec, ensure_ascii=False, separators=(",", ":")),
            "observer_id": cfg["observer"],
            "observed_id": cfg["peer"],
        }]
    }
    r = _http("POST", f"/v3/workspaces/{cfg['workspace']}/conclusions", body)
    if not r.get("ok"):
        return {"ok": False, "error": r.get("error") or "honcho write failed", "wrote": False, "honcho": hs.get("honcho")}
    return {"ok": True, "wrote": True, "preference": _public(rec, "new"), "honcho": hs.get("honcho")}


def _delete_hid(hid: str) -> dict:
    if not hid or hid in ("*", "all"):
        return {"ok": False, "error": "specific preference identifier required"}
    cfg = _cfg()
    return _http("DELETE", f"/v3/workspaces/{cfg['workspace']}/conclusions/{hid}")


def delete_preference(pref_id: str) -> dict:
    if not pref_id or pref_id in ("*", "all", "everything"):
        return {"ok": False, "error": "specific preference identifier required"}
    listed = list_preferences()
    if listed.get("honcho") == "OFFLINE":
        return {"ok": False, "error": "honcho offline", "honcho": "OFFLINE"}
    hid = None
    for row in listed.get("_rows") or []:
        if row.get("id") == pref_id:
            hid = row.get("_hid")
            break
    if not hid:
        return {"ok": False, "error": "not found"}
    r = _delete_hid(str(hid))
    if not r.get("ok"):
        return {"ok": False, "error": r.get("error") or "delete failed"}
    return {"ok": True, "deleted": pref_id, "honcho": listed.get("honcho")}


def apply_preference(*, target: str | None = None, cls: str | None = None, dry_run: bool = False, mock=None) -> dict:
    listed = lookup(target=target, cls=cls)
    prefs = listed.get("preferences") or []
    actions = []
    hour = datetime.now().hour
    night = hour >= 21 or hour < 7
    for p in prefs:
        when = p.get("when") or "always"
        if when == "night" and not night:
            continue
        key = p.get("key")
        if p.get("class") == "COMPUTE_PREFERENCE" and key == "policy":
            if not dry_run:
                import helix_compute_v2 as v2
                v2.set_policy(str(p.get("value")))
            actions.append({"capability": "compute.policy", "value": p.get("value"), "read": True})
            continue
        if key == "colour" and p.get("target") and p.get("class") == "PREFERENCE":
            actions.append({"capability": "home.room.lights.colour", "params": {"room": p["target"], "colour": p["value"]}})
        elif key == "brightness" and p.get("target") and p.get("class") == "PREFERENCE":
            actions.append({"capability": "home.room.lights.brightness", "params": {"room": p["target"], "brightness": p["value"]}})
        elif p.get("class") == "SCENE_PREFERENCE" and key == "scene":
            actions.append({"capability": "home.scene.apply", "params": {"scene": p["target"]}})
    results = []
    if not dry_run:
        import helix_control as hctl
        for a in actions:
            if a.get("capability") == "compute.policy":
                results.append(a)
                continue
            results.append(hctl.invoke(a["capability"], a.get("params") or {}, mock=mock, dry_run=False))
    return {
        "ok": True,
        "read": True,
        "wrote": False,
        "honcho": listed.get("honcho"),
        "preferences": prefs,
        "actions": actions,
        "results": results,
        "speak": "Applied stored preferences." if prefs else "No stored preference for that target.",
    }


def _explicit_store(t: str) -> bool:
    if re.search(r"\b(make|turn|set|dim|switch)\b", t) and "remember" not in t and "prefer" not in t:
        return False
    return bool(re.search(r"\b(remember|prefer|normally|my usual)\b", t))


def handle_utterance(text: str, *, voice: bool = False) -> dict | None:
    t = (text or "").lower().replace("’", "'")
    t = re.sub(r"[?!.,]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    if not t:
        return None

    if re.search(r"\b(forget|delete|erase|wipe)\b", t) and re.search(
        r"\b(preference|remember|colour|color|brightness|usual)\b", t
    ):
        if voice:
            return {
                "ok": False,
                "error": "voice cannot delete memory",
                "capability": "memory.preferences.delete",
                "blocked": True,
            }
        pref_id = _id_from_forget(t)
        if not pref_id:
            return {"ok": False, "error": "specific preference identifier required"}
        return {"ok": True, "capability": "memory.preferences.delete", "params": {"id": pref_id}, "read": False}

    if t in ("memory status",) or t.startswith("memory status"):
        return {"ok": True, "capability": "memory.status", "params": {}, "read": True}
    if t in ("preferences", "what do you remember"):
        return {"ok": True, "capability": "memory.preferences.list", "params": {}, "read": True}
    if "what do you remember about" in t:
        from helix_control import resolve_room
        rr = resolve_room(t.split("about", 1)[-1])
        if not rr.get("ok"):
            return {"ok": False, "error": "unknown room"}
        return {"ok": True, "capability": "memory.preferences.list", "params": {"target": rr["id"]}, "read": True}

    if re.search(r"how i like|the way i like|how i like it", t) or (
        re.search(r"\bmy usual\b", t) and "remember" not in t and "prefer" not in t
    ):
        if re.search(r"\b(compute|local-first|balanced|fast)\b", t):
            return {
                "ok": True,
                "capability": "memory.preferences.apply",
                "params": {"target": "compute", "class": "COMPUTE_PREFERENCE"},
                "read": True,
            }
        from helix_control import ALIASES
        room = None
        for alias, rid in sorted(ALIASES.items(), key=lambda kv: -len(kv[0])):
            if alias in t:
                room = rid
                break
        if not room:
            return {"ok": False, "error": "unknown room"}
        return {"ok": True, "capability": "memory.preferences.apply", "params": {"target": room}, "read": True}

    if re.search(r"\b(use|switch)\b", t) and re.search(r"\b(normal|usual|preferred)\s+compute\b", t):
        return {
            "ok": True,
            "capability": "memory.preferences.apply",
            "params": {"target": "compute", "class": "COMPUTE_PREFERENCE"},
            "read": True,
        }

    if not _explicit_store(t):
        return None

    recs = parse_remember(text)
    if not recs:
        return {"ok": False, "error": "unmapped preference"}
    return {
        "ok": True,
        "capability": "memory.preferences.set",
        "params": {"records": recs, "explicit": True},
        "read": False,
        "write": True,
    }


def _id_from_forget(t: str) -> str | None:
    from helix_control import ALIASES
    room = None
    for alias, rid in sorted(ALIASES.items(), key=lambda kv: -len(kv[0])):
        if alias in t:
            room = rid
            break
    key = None
    if re.search(r"\b(colour|color)\b", t):
        key = "colour"
    elif "brightness" in t or "percent" in t:
        key = "brightness"
    if re.search(r"\bcompute\b", t):
        return _pref_id("COMPUTE_PREFERENCE", "compute", "policy", "always")
    if room and key:
        return _pref_id("PREFERENCE", room, key, "night" if "night" in t else "always")
    if room:
        return _pref_id("PREFERENCE", room, "colour", "always")
    return None


def parse_remember(text: str) -> list[dict]:
    t = (text or "").lower().replace("’", "'")
    t = re.sub(r"[?!.,]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    recs: list[dict] = []
    when = "night" if re.search(r"\bat night\b", t) else "always"

    if re.search(r"\b(local compute|local-first|prefer local)\b", t):
        recs.append({"class": "COMPUTE_PREFERENCE", "target": "compute", "key": "policy", "value": "LOCAL-FIRST", "when": "always"})
    elif re.search(r"\bfast compute\b", t):
        recs.append({"class": "COMPUTE_PREFERENCE", "target": "compute", "key": "policy", "value": "FAST", "when": "always"})
    elif re.search(r"\bbalanced compute\b", t):
        recs.append({"class": "COMPUTE_PREFERENCE", "target": "compute", "key": "policy", "value": "BALANCED", "when": "always"})

    from helix_control import COLOURS, ALIASES, SCENES
    room = None
    for alias, rid in sorted(ALIASES.items(), key=lambda kv: -len(kv[0])):
        if alias in t:
            room = rid
            break
    colour = None
    for name in sorted(COLOURS, key=len, reverse=True):
        if name in t:
            colour = name
            break
    m_pct = re.search(r"(\d{1,3})\s*(%|percent)", t)
    pct = int(m_pct.group(1)) if m_pct else None

    scene = None
    for sid in SCENES:
        if sid.replace("-", " ") in t or sid in t:
            scene = sid
            break

    if re.search(r"\balias\b", t) and room:
        m = re.search(r"alias (\w+) for", t)
        if m:
            recs.append({"class": "ALIAS", "target": room, "key": "alias", "value": m.group(1), "when": "always"})

    if scene and (pct is not None or colour) and not room:
        if colour:
            recs.append({"class": "SCENE_PREFERENCE", "target": scene, "key": "colour", "value": colour, "when": when})
        if pct is not None:
            recs.append({"class": "SCENE_PREFERENCE", "target": scene, "key": "brightness", "value": pct, "when": when})
    elif room:
        if colour:
            recs.append({"class": "PREFERENCE", "target": room, "key": "colour", "value": colour, "when": when})
        if pct is not None:
            recs.append({"class": "PREFERENCE", "target": room, "key": "brightness", "value": pct, "when": when})
    return recs


def invoke(name: str, params: dict | None = None, **kwargs) -> dict:
    params = dict(params or {})
    if name in ("memory.ping", "memory.status"):
        hs = honcho_status()
        listed = list_preferences() if hs.get("honcho") != "OFFLINE" else {"count": 0, "preferences": []}
        return {
            "ok": True,
            "version": VERSION,
            "honcho": hs.get("honcho"),
            "workspace": hs.get("workspace"),
            "classes": list(CLASSES),
            "capabilities": list(CAPS),
            "count": listed.get("count") or 0,
        }
    if name == "memory.preferences.list":
        out = list_preferences(target=params.get("target"), cls=params.get("class") or params.get("cls"))
        out.pop("_rows", None)
        return out
    if name == "memory.preferences.get":
        return get_preference(str(params.get("id") or ""))
    if name == "memory.preferences.delete":
        return delete_preference(str(params.get("id") or ""))
    if name == "memory.preferences.set":
        recs = params.get("records")
        if recs:
            wrote = []
            for rec in recs:
                wrote.append(set_preference(rec, explicit=bool(params.get("explicit", True))))
            return {"ok": all(x.get("ok") for x in wrote), "wrote": any(x.get("wrote") for x in wrote), "results": wrote}
        return set_preference(params, explicit=bool(params.get("explicit", True)))
    if name == "memory.preferences.apply":
        return apply_preference(
            target=params.get("target"),
            cls=params.get("class"),
            dry_run=bool(params.get("dry_run") or kwargs.get("dry_run")),
            mock=kwargs.get("mock"),
        )
    return {"ok": False, "error": "unknown capability", "capability": name}


def snapshot() -> dict:
    st = invoke("memory.status")
    listed = list_preferences()
    prefs = listed.get("preferences") or []
    return {
        "ok": True,
        "honcho": st.get("honcho"),
        "count": len(prefs),
        "preferences": prefs,
        "classes": list(CLASSES),
        "capabilities": [k for k in CAPS if k.startswith("memory.preferences")],
        "version": VERSION,
    }
