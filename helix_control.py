"""HELIX CONTROL v1 — home.* on top of existing WiZ lighting.

Does not replace helix_lights or HELIX COMPUTE. No generic HA service calls.
Natural language never becomes a shell or an arbitrary entity_id.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

VERSION = "1.0"
READ = "READ"
SAFE = "SAFE-ACTION"
PRIVILEGED = "PRIVILEGED"
DESTRUCTIVE = "DESTRUCTIVE"
HIGH = "HIGH-RISK"

CTX_TTL = 90.0
CTX_SESSION = "helix-main"

# Canonical rooms currently live in Helix. Do not revive removed rooms.
ROOMS = {
    "bedroom": {"id": "bedroom", "name": "Bedroom", "label": "BEDROOM"},
    "blaines-room": {"id": "blaines-room", "name": "Blaine's Room", "label": "BLAINES ROOM"},
    "violets-room": {"id": "violets-room", "name": "Violet's Room", "label": "VIOLETS ROOM"},
    "unassigned": {"id": "unassigned", "name": "Unassigned", "label": "UNASSIGNED"},
}

ALIASES = {
    "bedroom": "bedroom",
    "bed room": "bedroom",
    "the bedroom": "bedroom",
    "blaines-room": "blaines-room",
    "blaine's room": "blaines-room",
    "blaines room": "blaines-room",
    "blaine room": "blaines-room",
    "blaine's bedroom": "blaines-room",
    "blaines bedroom": "blaines-room",
    "blaine": "blaines-room",
    "blaines": "blaines-room",
    "violets-room": "violets-room",
    "violet's room": "violets-room",
    "violets room": "violets-room",
    "violet room": "violets-room",
    "violet's bedroom": "violets-room",
    "violets bedroom": "violets-room",
    "violet": "violets-room",
    "violets": "violets-room",
    "unassigned": "unassigned",
}

REMOVED_ROOMS = ("lounge", "office", "workshop", "outside", "kitchen", "garage", "living room")

COLOURS = {
    "purple": [160, 32, 240],
    "blue": [40, 80, 220],
    "red": [200, 16, 8],
    "green": [124, 255, 122],
    "helix green": [124, 255, 122],
    "pink": [255, 80, 160],
    "orange": [255, 120, 20],
    "yellow": [255, 210, 40],
    "cyan": [40, 200, 220],
    "white": [255, 255, 255],
}

# Helix-owned scenes — map onto existing lighting scenes; do not overwrite HA (none).
SCENES = {
    "good-night": {"name": "GOOD NIGHT", "helix_scene": "night", "lighting_only": True},
    "movie": {"name": "MOVIE", "helix_scene": "movie", "lighting_only": True},
    "all-lights-off": {"name": "ALL LIGHTS OFF", "action": "all_off", "lighting_only": True},
}

BLOCKED = {
    "home.call_service",
    "home.lock",
    "home.unlock",
    "home.garage",
    "home.alarm",
    "home.alarm.disarm",
    "home.climate",
    "home.heater",
    "home.oven",
}

CAPS = {
    "home.status": {"risk": READ, "params": [], "approval": False},
    "home.rooms": {"risk": READ, "params": [], "approval": False},
    "home.devices": {"risk": READ, "params": [], "approval": False},
    "home.room.status": {"risk": READ, "params": ["room"], "approval": False},
    "home.device.status": {"risk": READ, "params": ["id"], "approval": False},
    "home.lights.status": {"risk": READ, "params": [], "approval": False},
    "home.light.on": {"risk": SAFE, "params": ["id"], "approval": False},
    "home.light.off": {"risk": SAFE, "params": ["id"], "approval": False},
    "home.light.toggle": {"risk": SAFE, "params": ["id"], "approval": False},
    "home.light.brightness": {"risk": SAFE, "params": ["id", "brightness"], "approval": False},
    "home.light.colour": {"risk": SAFE, "params": ["id", "colour"], "approval": False},
    "home.room.lights.on": {"risk": SAFE, "params": ["room"], "approval": False},
    "home.room.lights.off": {"risk": SAFE, "params": ["room"], "approval": False},
    "home.room.lights.brightness": {"risk": SAFE, "params": ["room", "brightness"], "approval": False},
    "home.room.lights.colour": {"risk": SAFE, "params": ["room", "colour"], "approval": False},
    "home.scene.apply": {"risk": SAFE, "params": ["scene"], "approval": False},
}

_LOCK = threading.Lock()
_CTX: dict[str, dict] = {}
_EVENTS: deque = deque(maxlen=80)
_UNAVAILABLE = False  # test injection

# Last commanded lighting — survives ops restart. Never auto-filled from HA history.
PREFS_FILE = Path(__file__).resolve().parent / "helix-home-prefs.json"
PREFS_SCHEMA = {
    "preferred_brightness": {},
    "preferred_colour": {},
    "preferred_scene": None,
    "power": {},
}


def load_prefs() -> dict:
    data: dict = {}
    if PREFS_FILE.is_file():
        try:
            raw = json.loads(PREFS_FILE.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                data = raw
        except (OSError, json.JSONDecodeError):
            data = {}
    return {
        "preferred_brightness": dict(data.get("preferred_brightness") or {}),
        "preferred_colour": dict(data.get("preferred_colour") or {}),
        "preferred_scene": data.get("preferred_scene"),
        "power": dict(data.get("power") or {}),
    }


def save_prefs(prefs: dict) -> None:
    rec = {
        "preferred_brightness": dict(prefs.get("preferred_brightness") or {}),
        "preferred_colour": dict(prefs.get("preferred_colour") or {}),
        "preferred_scene": prefs.get("preferred_scene"),
        "power": dict(prefs.get("power") or {}),
    }
    tmp = PREFS_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(rec, indent=2), encoding="utf-8")
    tmp.replace(PREFS_FILE)
    try:
        os.chmod(PREFS_FILE, 0o600)
    except OSError:
        pass


def note_room_pref(room: str | None, **fields: Any) -> None:
    if not room or room not in ROOMS:
        return
    prefs = load_prefs()
    if "brightness" in fields and fields["brightness"] is not None:
        prefs["preferred_brightness"][room] = int(fields["brightness"])
    if fields.get("colour"):
        prefs["preferred_colour"][room] = str(fields["colour"])
    if "power" in fields and fields["power"] is not None:
        prefs["power"][room] = bool(fields["power"])
    if fields.get("scene"):
        prefs["preferred_scene"] = str(fields["scene"])
    save_prefs(prefs)


def emit(kind: str, **fields: Any) -> None:
    rec = {"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "kind": kind}
    for k, v in fields.items():
        if re.search(r"token|password|secret|api[_-]?key|credential", k, re.I):
            continue
        rec[k] = v
    with _LOCK:
        _EVENTS.append(rec)


def events(limit: int = 40) -> list[dict]:
    with _LOCK:
        return list(_EVENTS)[-max(1, min(limit, 80)):]


def remember(room: str | None, *, session: str = CTX_SESSION, ids: list | None = None) -> None:
    if not room or room not in ROOMS:
        return
    with _LOCK:
        _CTX[session] = {"room": room, "ids": list(ids or []), "ts": time.time()}


def clear_context(session: str = CTX_SESSION) -> None:
    with _LOCK:
        _CTX.pop(session, None)


def context_room(session: str = CTX_SESSION, now: float | None = None) -> str | None:
    with _LOCK:
        row = _CTX.get(session) or {}
    if not row:
        return None
    ts = float(row.get("ts") or 0)
    if (now if now is not None else time.time()) - ts > CTX_TTL:
        return None
    return row.get("room")


def _norm(text: str) -> str:
    t = (text or "").lower().strip()
    t = t.replace("helix,", " ").replace("helix ", " ")
    t = t.replace("’", "'")
    t = re.sub(r"[?!.,]+", " ", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t


def resolve_room(raw: str | None) -> dict:
    if raw is None or str(raw).strip() == "":
        return {"ok": False, "error": "unknown room"}
    t = _norm(str(raw))
    t = t.replace("_", " ").replace("-", " ")
    compact = t.replace(" ", "")
    for gone in REMOVED_ROOMS:
        if gone in t:
            return {"ok": False, "error": "unknown room", "room": gone}
    if t in ALIASES:
        rid = ALIASES[t]
        return {"ok": True, "id": rid, **ROOMS[rid]}
    spaced = t
    for alias, rid in sorted(ALIASES.items(), key=lambda kv: -len(kv[0])):
        if alias == t or alias in t or alias.replace(" ", "") == compact:
            return {"ok": True, "id": rid, **ROOMS[rid]}
        if alias.replace("'", "") == t.replace("'", ""):
            return {"ok": True, "id": rid, **ROOMS[rid]}
    if spaced in ("all", "everything", "every light"):
        return {"ok": True, "id": None, "name": "ALL", "label": "ALL"}
    return {"ok": False, "error": "unknown room", "room": raw}


def resolve_colour(raw: Any) -> dict:
    if raw is None or raw == "":
        return {"ok": False, "error": "invalid colour"}
    if isinstance(raw, (list, tuple)) and len(raw) >= 3:
        try:
            rgb = [max(0, min(255, int(raw[0]))), max(0, min(255, int(raw[1]))), max(0, min(255, int(raw[2])))]
        except (TypeError, ValueError):
            return {"ok": False, "error": "invalid colour"}
        return {"ok": True, "rgb": rgb, "name": "rgb"}
    t = _norm(str(raw))
    if t in COLOURS:
        return {"ok": True, "rgb": list(COLOURS[t]), "name": t}
    m = re.fullmatch(r"#?([0-9a-f]{6})", t)
    if m:
        h = m.group(1)
        rgb = [int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)]
        return {"ok": True, "rgb": rgb, "name": "#" + h}
    return {"ok": False, "error": "invalid colour"}


def resolve_brightness(raw: Any) -> dict:
    if raw is None or raw == "":
        return {"ok": False, "error": "invalid brightness"}
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return {"ok": False, "error": "invalid brightness"}
    if n < 1 or n > 100:
        return {"ok": False, "error": "invalid brightness"}
    return {"ok": True, "brightness": n}


def _id_ok(did: str) -> bool:
    return bool(re.fullmatch(r"[a-z0-9][a-z0-9._-]{1,40}", did or ""))


def set_unavailable(flag: bool) -> None:
    global _UNAVAILABLE
    _UNAVAILABLE = bool(flag)


def _live_snap() -> dict | None:
    if _UNAVAILABLE:
        return None
    from pathlib import Path
    p = Path(__file__).resolve().parent / "helix-lights.json"
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data, dict) and (data.get("devices") or data.get("groups")):
            devs = data.get("devices") or {}
            if isinstance(devs, dict):
                data = {**data, "devices": list(devs.values())}
            return data
    except Exception:
        pass
    try:
        from helix_lights import snapshot
        return snapshot()
    except Exception:
        return None


def _devices_from_snap(snap: dict, mock: dict | None = None) -> list[dict]:
    if mock is not None:
        return list(mock.get("devices") or [])
    out = []
    for d in (snap or {}).get("devices") or []:
        did = str(d.get("id") or "")
        gid = d.get("group") or "unassigned"
        room = ROOMS.get(gid, ROOMS["unassigned"])
        caps = ["on", "off", "toggle", "brightness"]
        if d.get("rgb") is not None or True:
            caps.append("colour")
        out.append({
            "id": did,
            "name": d.get("name") or did,
            "room": gid,
            "room_name": room["name"],
            "platform": d.get("provider") or "wiz",
            "entity_id": "wiz." + did,
            "type": "LIGHT",
            "capabilities": caps,
            "online": bool(d.get("online")),
            "state": {
                "power": d.get("power"),
                "brightness": d.get("brightness"),
                "colour": d.get("rgb"),
                "temp": d.get("temp"),
            },
        })
    return out


def registry(*, mock: dict | None = None) -> dict:
    snap = None if mock is not None else _live_snap()
    if mock is None and snap is None:
        return {"ok": False, "error": "HOME CONTROL UNAVAILABLE", "online": False, "rooms": [], "devices": []}
    devices = _devices_from_snap(snap or {}, mock)
    prefs = load_prefs()
    rooms = []
    for rid, meta in ROOMS.items():
        members = [d for d in devices if d.get("room") == rid]
        online = sum(1 for d in members if d.get("online"))
        on = sum(1 for d in members if d.get("online") and (d.get("state") or {}).get("power"))
        live_b = []
        for d in members:
            b = (d.get("state") or {}).get("brightness")
            if isinstance(b, (int, float)):
                live_b.append(int(b))
        rooms.append({
            **meta,
            "lights": len(members),
            "online": online,
            "offline": len(members) - online,
            "power_on": on,
            "state": "ONLINE" if online else ("EMPTY" if not members else "OFFLINE"),
            "brightness": prefs["preferred_brightness"].get(rid) or (int(sum(live_b) / len(live_b)) if live_b else None),
            "colour": prefs["preferred_colour"].get(rid),
            "last_power": prefs["power"].get(rid),
        })
    online_n = sum(1 for d in devices if d.get("online"))
    return {
        "ok": True,
        "online": True,
        "platform": "wiz",
        "home_assistant": {"configured": False, "status": "not configured"},
        "rooms": rooms,
        "devices": devices,
        "telemetry": {
            "devices": len(devices),
            "online": online_n,
            "offline": len(devices) - online_n,
        },
        "scenes": [{"id": k, "name": v["name"]} for k, v in SCENES.items()],
        "version": VERSION,
    }


def _room_members(reg: dict, room_id: str) -> list[dict]:
    return [d for d in (reg.get("devices") or []) if d.get("room") == room_id]


def _public_status(reg: dict) -> dict:
    return {
        "ok": True,
        "home": "ONLINE" if reg.get("online") else "OFFLINE",
        "platform": "wiz",
        "home_assistant": "not configured",
        "rooms": [{
            "id": r["id"], "name": r["name"], "label": r["label"], "lights": r["lights"],
            "online": r["online"], "offline": r["offline"], "power_on": r["power_on"],
            "state": r.get("state"), "brightness": r.get("brightness"), "colour": r.get("colour"),
            "last_power": r.get("last_power"),
        } for r in reg.get("rooms") or []],
        "telemetry": reg.get("telemetry") or {},
        "scenes": reg.get("scenes") or [],
        "last_scene": load_prefs().get("preferred_scene"),
        "version": VERSION,
    }


def resolve_utterance(text: str, *, session: str = CTX_SESSION, now: float | None = None) -> dict:
    t = _norm(text)
    if not t:
        return {"ok": False, "error": "empty"}
    if re.search(r"\b(lock|unlock|garage|alarm|disarm|oven|heater|stove)\b", t):
        return {"ok": False, "error": "blocked capability", "risk": HIGH}
    if "call_service" in t or "home.call_service" in t:
        return {"ok": False, "error": "unknown capability", "capability": "home.call_service"}
    try:
        import helix_prefs as hp
        mem = hp.handle_utterance(text, voice=False)
        if mem is not None:
            return mem
    except Exception:
        pass

    room_hit = None
    for alias, rid in sorted(ALIASES.items(), key=lambda kv: -len(kv[0])):
        if alias in t:
            room_hit = rid
            break
    for gone in REMOVED_ROOMS:
        if gone in t:
            return {"ok": False, "error": "unknown room", "room": gone}

    follow = bool(re.search(r"\b(them|those|those lights|the lights|it)\b", t)) and not room_hit
    if follow:
        room_hit = context_room(session, now=now)
        if not room_hit:
            return {"ok": False, "error": "no target context"}

    m_pct = re.search(r"(\d{1,3})\s*(%|percent)", t)
    pct = int(m_pct.group(1)) if m_pct else None
    colour = None
    for name in sorted(COLOURS, key=len, reverse=True):
        if name in t:
            colour = name
            break

    if re.search(r"\bgood\s*night\b", t):
        return {"ok": True, "capability": "home.scene.apply", "params": {"scene": "good-night"}, "read": False, "why": "GOOD NIGHT lighting only"}
    if re.search(r"\b(movie mode|movie time|movie scene)\b", t):
        return {"ok": True, "capability": "home.scene.apply", "params": {"scene": "movie"}, "read": False}
    if re.search(r"\ball lights off\b", t) and not room_hit:
        return {"ok": True, "capability": "home.scene.apply", "params": {"scene": "all-lights-off"}, "read": False}

    if room_hit and re.search(r"\b(what'?s on|what is on|status|what'?s happening)\b", t):
        return {"ok": True, "capability": "home.room.status", "params": {"room": room_hit}, "read": True}

    if colour and (room_hit or follow):
        if room_hit is None:
            return {"ok": False, "error": "unknown room"}
        return {"ok": True, "capability": "home.room.lights.colour", "params": {"room": room_hit, "colour": colour}, "read": False}

    if pct is not None and room_hit:
        return {"ok": True, "capability": "home.room.lights.brightness", "params": {"room": room_hit, "brightness": pct}, "read": False}

    if room_hit and re.search(r"\b(off|disable)\b", t):
        return {"ok": True, "capability": "home.room.lights.off", "params": {"room": room_hit}, "read": False}
    if room_hit and re.search(r"\b(on|enable)\b", t):
        return {"ok": True, "capability": "home.room.lights.on", "params": {"room": room_hit}, "read": False}

    if t.startswith("home status") or t in ("home", "home status"):
        return {"ok": True, "capability": "home.status", "params": {}, "read": True}
    if t.startswith("home rooms"):
        return {"ok": True, "capability": "home.rooms", "params": {}, "read": True}
    if t.startswith("home devices"):
        return {"ok": True, "capability": "home.devices", "params": {}, "read": True}
    m = re.match(r"room (.+) status$", t)
    if m:
        rr = resolve_room(m.group(1))
        if not rr.get("ok") or not rr.get("id"):
            return {"ok": False, "error": "unknown room"}
        return {"ok": True, "capability": "home.room.status", "params": {"room": rr["id"]}, "read": True}
    m = re.match(r"lights (.+) (on|off)$", t)
    if m:
        rr = resolve_room(m.group(1))
        if not rr.get("ok") or not rr.get("id"):
            return {"ok": False, "error": "unknown room"}
        cap = "home.room.lights.on" if m.group(2) == "on" else "home.room.lights.off"
        return {"ok": True, "capability": cap, "params": {"room": rr["id"]}, "read": False}

    return {"ok": False, "error": "unmapped"}


def _verify_room(reg: dict, room_id: str, want_power: bool | None = None) -> dict:
    members = _room_members(reg, room_id)
    online = [d for d in members if d.get("online")]
    offline = [d for d in members if not d.get("online")]
    if not members:
        return {"confirmed": True, "partial": False, "online": 0, "total": 0, "note": "no devices"}
    if not online:
        return {"confirmed": False, "partial": True, "online": 0, "total": len(members), "unavailable": len(offline), "note": "ACTION SENT STATE UNCONFIRMED"}
    if want_power is None:
        return {"confirmed": True, "partial": bool(offline), "online": len(online), "total": len(members), "unavailable": len(offline)}
    matched = [d for d in online if bool((d.get("state") or {}).get("power")) == bool(want_power)]
    confirmed = len(matched) == len(online)
    partial = bool(offline) or (len(matched) != len(online))
    return {
        "confirmed": confirmed and not offline,
        "partial": partial,
        "online": len(online),
        "matched": len(matched),
        "total": len(members),
        "unavailable": len(offline),
        "note": None if confirmed and not offline else ("PARTIAL" if online else "ACTION SENT STATE UNCONFIRMED"),
    }


def _apply_lights(action: str, data: dict, *, dry_run: bool, mock: dict | None) -> dict:
    if dry_run or mock is not None:
        ids = list(data.get("ids") or [])
        if mock is not None:
            devices = list(mock.get("devices") or [])
            if action == "all_off":
                ids = [d["id"] for d in devices]
            elif data.get("group"):
                ids = [d["id"] for d in devices if d.get("room") == data["group"]]
            elif data.get("id"):
                ids = [str(data["id"])]
            results = []
            for did in ids:
                d = next((x for x in devices if x["id"] == did), None)
                if not d:
                    results.append({"id": did, "ok": False, "error": "unknown entity"})
                    continue
                if not d.get("online"):
                    results.append({"id": did, "ok": False, "error": "unavailable"})
                    continue
                st = dict(d.get("state") or {})
                if action == "on":
                    st["power"] = True
                elif action == "off":
                    st["power"] = False
                elif action == "brightness":
                    st["brightness"] = data.get("brightness")
                    st["power"] = True
                elif action == "color":
                    st["colour"] = data.get("rgb")
                    st["power"] = True
                d["state"] = st
                results.append({"id": did, "ok": True})
            ok_n = sum(1 for r in results if r.get("ok"))
            fail_n = len(results) - ok_n
            status = "COMPLETE" if fail_n == 0 else ("PARTIAL" if ok_n else "FAILED")
            return {"ok": ok_n > 0, "status": status, "results": results, "dry_run": dry_run, "applied": ok_n, "unavailable": fail_n}
        return {"ok": True, "dry_run": True, "would": action, "group": data.get("group"), "id": data.get("id")}
    try:
        from helix_lights import act as lights_act, snapshot as lights_snap
        body = {"action": action}
        body.update({k: v for k, v in data.items() if k in ("id", "group", "ids", "value", "brightness", "rgb", "scene") and v is not None})
        if action == "brightness" and data.get("brightness") is not None:
            body["value"] = data["brightness"]
        emit("JOB_STARTED", action=action, group=data.get("group"))
        out = lights_act(body)
        snap = lights_snap()
        emit("JOB_COMPLETED", action=action)
        return {"ok": bool(out.get("ok", True)), "result": {"telemetry": (snap or {}).get("telemetry")}, "raw_ok": out.get("ok")}
    except Exception:
        emit("JOB_FAILED", action=action)
        return {"ok": False, "error": "HOME CONTROL UNAVAILABLE"}


def invoke(name: str, params: dict | None = None, *, mock: dict | None = None, dry_run: bool = False, session: str = CTX_SESSION) -> dict:
    params = dict(params or {})
    dry_run = bool(dry_run or params.pop("dry_run", False))
    if name.startswith("memory."):
        import helix_prefs as hp
        return hp.invoke(name, params, mock=mock, dry_run=dry_run)
    if name in BLOCKED or name == "home.call_service":
        return {"ok": False, "error": "unknown capability" if name == "home.call_service" else "blocked capability", "capability": name, "risk": HIGH}
    if name not in CAPS:
        return {"ok": False, "error": "unknown capability", "capability": name}
    spec = CAPS[name]
    if spec["risk"] in (DESTRUCTIVE, HIGH) or spec.get("approval"):
        return {"ok": False, "error": "blocked capability", "risk": spec["risk"]}
    for p in spec.get("params") or []:
        if p not in params or params.get(p) in (None, ""):
            return {"ok": False, "error": "malformed parameters", "missing": p}

    emit("DEVICE_STATE_CHANGED" if spec["risk"] == SAFE else "JOB_STARTED", capability=name)

    if name in ("home.light.on", "home.light.off", "home.light.toggle", "home.light.brightness", "home.light.colour", "home.device.status"):
        did = str(params.get("id") or "")
        if not _id_ok(did):
            return {"ok": False, "error": "unknown entity"}

    room_id = None
    if "room" in (spec.get("params") or []):
        rr = resolve_room(params.get("room"))
        if not rr.get("ok") or not rr.get("id"):
            return {"ok": False, "error": "unknown room"}
        room_id = str(rr["id"])
        params["room"] = room_id

    colour = None
    if "colour" in (spec.get("params") or []) or "color" in params:
        cr = resolve_colour(params.get("colour") or params.get("color"))
        if not cr.get("ok"):
            return {"ok": False, "error": "invalid colour"}
        colour = cr

    brightness = None
    if "brightness" in (spec.get("params") or []):
        br = resolve_brightness(params.get("brightness"))
        if not br.get("ok"):
            return {"ok": False, "error": "invalid brightness"}
        brightness = br["brightness"]

    if mock is None and _UNAVAILABLE and spec["risk"] == SAFE:
        return {"ok": False, "error": "HOME CONTROL UNAVAILABLE"}

    reg = registry(mock=mock)
    if not reg.get("ok"):
        return {"ok": False, "error": "HOME CONTROL UNAVAILABLE"}

    if name == "home.status":
        return _public_status(reg)
    if name == "home.rooms":
        return {"ok": True, "rooms": _public_status(reg)["rooms"]}
    if name == "home.devices":
        slim = [{k: d.get(k) for k in ("id", "name", "room", "room_name", "platform", "entity_id", "type", "capabilities", "online", "state")} for d in reg.get("devices") or []]
        return {"ok": True, "devices": slim}
    if name == "home.lights.status":
        lights = [d for d in reg.get("devices") or [] if d.get("type") == "LIGHT"]
        return {"ok": True, "lights": len(lights), "online": sum(1 for d in lights if d.get("online")), "devices": [{k: d[k] for k in ("id", "name", "room", "online", "state")} for d in lights]}
    if name == "home.room.status":
        if not room_id:
            return {"ok": False, "error": "unknown room"}
        members = _room_members(reg, room_id)
        meta = ROOMS[room_id]
        on = [d for d in members if d.get("online") and (d.get("state") or {}).get("power")]
        remember(room_id, session=session, ids=[d["id"] for d in members])
        return {
            "ok": True,
            "room": meta["label"],
            "id": room_id,
            "lights": len(members),
            "online": sum(1 for d in members if d.get("online")),
            "power_on": len(on),
            "devices": [{"id": d["id"], "name": d["name"], "online": d["online"], "power": (d.get("state") or {}).get("power")} for d in members],
        }
    if name == "home.device.status":
        did = str(params.get("id") or "")
        d = next((x for x in (reg.get("devices") or []) if x.get("id") == did), None)
        if not d:
            return {"ok": False, "error": "unknown entity"}
        return {"ok": True, "device": d}

    # Actions
    if name.startswith("home.light."):
        did = str(params.get("id") or "")
        d = next((x for x in (reg.get("devices") or []) if x.get("id") == did), None)
        if not d:
            return {"ok": False, "error": "unknown entity"}
        action = {"on": "on", "off": "off", "toggle": "toggle", "brightness": "brightness", "colour": "color"}[name.rsplit(".", 1)[1]]
        payload = {"id": did}
        if action == "brightness":
            payload["brightness"] = brightness
        if action == "color":
            if not colour:
                return {"ok": False, "error": "invalid colour"}
            payload["rgb"] = colour["rgb"]
        out = _apply_lights(action, payload, dry_run=dry_run, mock=mock)
        remember(d.get("room"), session=session, ids=[did])
        out["capability"] = name
        if dry_run:
            out["resolved"] = {"id": did, "room": d.get("room"), "action": action}
        return out

    if name.startswith("home.room.lights."):
        if not room_id:
            return {"ok": False, "error": "unknown room"}
        verb = name.rsplit(".", 1)[1]
        action = {"on": "on", "off": "off", "brightness": "brightness", "colour": "color"}[verb]
        payload: dict[str, Any] = {"group": room_id}
        if action == "brightness":
            payload["brightness"] = brightness
        if action == "color":
            if not colour:
                return {"ok": False, "error": "invalid colour"}
            payload["rgb"] = colour["rgb"]
        out = _apply_lights(action, payload, dry_run=dry_run, mock=mock)
        remember(room_id, session=session)
        if not dry_run:
            if verb == "brightness":
                note_room_pref(room_id, brightness=brightness, power=True)
            elif verb == "colour":
                note_room_pref(room_id, colour=colour["name"] if colour else None, power=True)
            elif verb == "on":
                note_room_pref(room_id, power=True)
            elif verb == "off":
                note_room_pref(room_id, power=False)
        meta = ROOMS[room_id]
        verify = _verify_room(registry(mock=mock) if mock is not None else registry(), room_id, True if verb == "on" else (False if verb == "off" else None))
        label = meta["label"]
        speak = f"{label} LIGHTS {verb.upper()}"
        if verify.get("partial"):
            speak = f"PARTIAL {verify.get('online')}/{verify.get('total')} LIGHTS {verb.upper()} · {verify.get('unavailable') or 0} DEVICE UNAVAILABLE"
        elif not verify.get("confirmed"):
            speak = f"ACTION SENT STATE UNCONFIRMED · {label}"
        out.update({"capability": name, "room": label, "verify": verify, "speak": speak, "status": "PARTIAL" if verify.get("partial") else out.get("status") or "COMPLETE"})
        if dry_run:
            out["resolved"] = {"room": room_id, "action": action, "colour": colour["name"] if colour else None, "brightness": brightness}
            out["ok"] = True
        return out

    if name == "home.scene.apply":
        sid = str(params.get("scene") or "").strip().lower().replace(" ", "-")
        if sid in ("good night", "goodnight"):
            sid = "good-night"
        if sid in ("all off", "all-off"):
            sid = "all-lights-off"
        scene = SCENES.get(sid)
        if not scene:
            return {"ok": False, "error": "unknown entity", "missing": "scene"}
        if not scene.get("lighting_only"):
            return {"ok": False, "error": "blocked capability"}
        if scene.get("action") == "all_off":
            out = _apply_lights("all_off", {}, dry_run=dry_run, mock=mock)
        else:
            out = _apply_lights("activate_scene", {"scene": scene.get("helix_scene")}, dry_run=dry_run, mock=mock)
        out.update({"capability": name, "scene": scene["name"], "lighting_only": True, "ok": True if dry_run else out.get("ok")})
        if not dry_run:
            prefs = load_prefs()
            prefs["preferred_scene"] = sid
            save_prefs(prefs)
        if dry_run:
            out["resolved"] = {"scene": sid, "helix_scene": scene.get("helix_scene") or scene.get("action")}
        return out

    return {"ok": False, "error": "unknown capability"}


def extra_doctor_checks() -> list[dict]:
    checks = []
    checks.append({"name": "Home Assistant", "state": "HEALTHY", "reason": "not configured — WiZ LAN"})
    try:
        from pathlib import Path
        lights = Path(__file__).resolve().parent / "helix-lights.json"
        checks.append({"name": "Home registry", "state": "HEALTHY" if lights.is_file() else "DEGRADED", "reason": "helix-lights.json" if lights.is_file() else "missing persist"})
    except Exception:
        checks.append({"name": "Home registry", "state": "DEGRADED", "reason": "unreadable"})
    try:
        import helix_voice  # noqa: F401
        checks.append({"name": "Voice", "state": "HEALTHY", "reason": "helix_voice"})
    except Exception:
        checks.append({"name": "Voice", "state": "FAILED", "reason": "import"})
    checks.append({"name": "Capability registry", "state": "HEALTHY" if "home.status" in CAPS else "FAILED", "reason": str(len(CAPS))})
    checks.append({"name": "Compute router", "state": "HEALTHY", "reason": "v2"})
    try:
        import helix_prefs as hp
        hs = hp.honcho_status()
        checks.append({"name": "Preference memory", "state": "HEALTHY" if hs.get("honcho") != "OFFLINE" else "DEGRADED", "reason": str(hs.get("honcho"))})
    except Exception:
        checks.append({"name": "Preference memory", "state": "DEGRADED", "reason": "import"})
    return checks


def doctor() -> dict:
    import helix_compute_v2 as v2
    base = v2.doctor()
    checks = list(base.get("checks") or [])
    seen = {c.get("name") for c in checks}
    for c in extra_doctor_checks():
        if c.get("name") not in seen:
            checks.append(c)
            seen.add(c.get("name"))
    failed = [c for c in checks if c.get("state") == "FAILED"]
    degraded = [c for c in checks if c.get("state") == "DEGRADED"]
    overall = "FAILED" if failed else ("DEGRADED" if degraded else "HEALTHY")
    if failed and len(failed) < len(checks) / 2:
        overall = "DEGRADED"
    return {"ok": True, "version": VERSION, "overall": overall, "checks": checks, "home_assistant": "not configured", "control": VERSION}


def mock_home(n_violet_online: int = 3, n_violet_off: int = 1) -> dict:
    devices = []
    for i in range(n_violet_online + n_violet_off):
        devices.append({
            "id": f"violet{i+1}",
            "name": f"Violet {i+1}",
            "room": "violets-room",
            "platform": "wiz",
            "entity_id": f"wiz.violet{i+1}",
            "type": "LIGHT",
            "capabilities": ["on", "off", "brightness", "colour"],
            "online": i < n_violet_online,
            "state": {"power": True, "brightness": 80, "colour": [255, 255, 255], "temp": 2700},
        })
    devices.append({
        "id": "blaine1",
        "name": "Blaine 1",
        "room": "blaines-room",
        "platform": "wiz",
        "entity_id": "wiz.blaine1",
        "type": "LIGHT",
        "capabilities": ["on", "off", "brightness", "colour"],
        "online": True,
        "state": {"power": False, "brightness": 10, "colour": None, "temp": 2200},
    })
    return {"devices": devices}
