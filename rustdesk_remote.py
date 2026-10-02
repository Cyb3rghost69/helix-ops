#!/usr/bin/env python3
"""HELIX OPS — RustDesk OSS collector. No keys, passwords, or pk blobs in JSON."""
from __future__ import annotations

import json
import os
import re
import socket
import time
from pathlib import Path
from typing import Any, Callable

UNRAID = "192.168.1.84"
MAC_LAN = "192.168.1.172"
HBBS_PORT = 21116
HBBR_PORT = 21117
NAT_PORT = 21115
API_PORT = 21114
CONTAINER = "RustDeskServer-AiO"
DB_PATH = "/mnt/cache/appdata/rustdeskserver-aio/db_v2.sqlite3"
LAN_PEERS = Path.home() / "Library/Preferences/com.carriez.RustDesk/RustDesk_lan_peers.toml"
PREFS = Path(__file__).resolve().parent / "helix-remote.json"
AUDIT = Path(__file__).resolve().parent / "remote-audit.jsonl"
RD_ID = re.compile(r"^[0-9]{6,16}$")
HELIX_IDS = frozenset({"mac", "unraid", "umbrel", "omarchy", "thinkpad"})
INFO_KEEP = frozenset({"ip", "hostname", "username", "os", "version", "cpu", "platform"})
SECRET_KEY = re.compile(r"(password|passwd|secret|token|api[_-]?key|pk|uuid|guid|enc_id|key_pair)", re.I)

HELIX_CATALOG = [
    {"id": "mac", "name": "MAC MINI", "host": MAC_LAN, "platform": "macOS"},
    {"id": "unraid", "name": "BIGBOI", "host": UNRAID, "platform": "linux"},
    {"id": "umbrel", "name": "UMBREL", "host": "192.168.1.236", "platform": "linux"},
    {"id": "omarchy", "name": "OMARCHY", "host": "192.168.1.207", "platform": "linux"},
    {"id": "thinkpad", "name": "THINKPAD", "host": "192.168.1.151", "platform": "Windows"},
]

_PREV: dict[str, Any] = {"hbbs": None, "hbbr": None, "online": {}, "t": 0.0}
_LOCK_EVENTS: list[dict] = []


def tcp_open(host: str, port: int, timeout: float = 1.2) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        s.connect((host, port))
        return True
    except OSError:
        return False
    finally:
        try:
            s.close()
        except OSError:
            pass


def strip_ip(raw: str) -> str:
    s = (raw or "").strip()
    if s.lower().startswith("::ffff:"):
        s = s[7:]
    return s


def parse_info(raw: str) -> dict:
    raw = (raw or "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    out: dict[str, Any] = {}
    for k, v in data.items():
        if SECRET_KEY.search(str(k)):
            continue
        if str(k).lower() not in INFO_KEEP:
            continue
        if k.lower() == "ip":
            out["ip"] = strip_ip(str(v))
        else:
            s = str(v).strip()
            if s and len(s) < 120:
                out[k.lower()] = s
    return out


def load_prefs() -> dict:
    if not PREFS.exists():
        return {"favorites": [], "map": {}}
    try:
        data = json.loads(PREFS.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"favorites": [], "map": {}}
    fav = [x for x in (data.get("favorites") or []) if isinstance(x, str) and RD_ID.match(x)]
    mp = {}
    for k, v in (data.get("map") or {}).items():
        if RD_ID.match(str(k)) and str(v) in HELIX_IDS:
            mp[str(k)] = str(v)
    return {"favorites": fav, "map": mp}


def save_prefs(prefs: dict) -> None:
    PREFS.write_text(json.dumps(prefs, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    try:
        PREFS.chmod(0o600)
    except OSError:
        pass


def audit(kind: str, extra: dict | None = None) -> None:
    rec = {"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "kind": kind}
    if extra:
        rec.update(extra)
    rec = {k: v for k, v in rec.items() if not SECRET_KEY.search(str(k))}
    try:
        with AUDIT.open("a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")
    except OSError:
        pass


def parse_lan_peers(text: str) -> list[dict]:
    peers: list[dict] = []
    cur: dict[str, Any] | None = None
    in_ip = False
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("[[peers]]"):
            if cur and cur.get("id"):
                peers.append(cur)
            cur = {}
            in_ip = False
            continue
        if cur is None:
            continue
        if line.startswith("[") and "ip_mac" in line:
            in_ip = True
            continue
        if line.startswith("[") and not line.startswith("[["):
            in_ip = False
            continue
        if in_ip and "=" in line:
            left = line.split("=", 1)[0].strip().strip('"').strip("'")
            ip = strip_ip(left)
            if re.match(r"^\d{1,3}(\.\d{1,3}){3}$", ip):
                cur["ip"] = ip
            continue
        if "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        v = v.strip().strip("'").strip('"')
        if k == "id" and RD_ID.match(v):
            cur["id"] = v
        elif k == "hostname":
            cur["hostname"] = v[:80]
        elif k == "username":
            cur["username"] = v[:80]
        elif k == "platform":
            cur["platform"] = v[:40]
        elif k == "online":
            cur["online"] = v.lower() in ("true", "1", "yes")
    if cur and cur.get("id"):
        peers.append(cur)
    return peers


def match_helix(dev: dict, prefs_map: dict) -> dict | None:
    rid = dev.get("id") or ""
    if rid in prefs_map:
        hid = prefs_map[rid]
        cat = next((c for c in HELIX_CATALOG if c["id"] == hid), None)
        if cat:
            return dict(cat)
    ip = strip_ip(str(dev.get("ip") or ""))
    hostn = (dev.get("hostname") or "").lower()
    for c in HELIX_CATALOG:
        if ip and ip == c["host"]:
            return dict(c)
        if hostn and hostn in {c["name"].lower(), c["id"], c["host"]}:
            return dict(c)
        if hostn and hostn.replace(" ", "") in c["name"].lower().replace(" ", ""):
            return dict(c)
    return None


def _uptime_s(started: str) -> int | None:
    started = (started or "").strip()
    if not started:
        return None
    try:
        from datetime import datetime, timezone

        s = started.replace("Z", "+00:00")
        if "." in s:
            head, rest = s.split(".", 1)
            tz = "+00:00"
            if "+" in rest:
                tz = "+" + rest.split("+", 1)[1]
            elif rest.count("-") and rest[-6:-5] == "-":
                tz = rest[-6:]
            s = head + tz
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0, int(time.time() - dt.timestamp()))
    except Exception:
        return None


def _push_event(kind: str, text: str) -> None:
    _LOCK_EVENTS.insert(0, {"t": time.strftime("%H:%M:%S"), "kind": kind, "text": text})
    if len(_LOCK_EVENTS) > 40:
        del _LOCK_EVENTS[40:]


def snapshot(run: Callable, ssh: list[str], fleet: list[dict] | None = None) -> dict:
    fleet = fleet or []
    prefs = load_prefs()
    hbbs = tcp_open(UNRAID, HBBS_PORT)
    hbbr = tcp_open(UNRAID, HBBR_PORT)
    nat = tcp_open(UNRAID, NAT_PORT)
    api_open = tcp_open(UNRAID, API_PORT)

    docker_state = None
    docker_status = None
    image = None
    started = None
    code, out = run(ssh + [f"timeout 12 docker ps -a --filter name={CONTAINER} --format '{{{{.State}}}}|{{{{.Status}}}}|{{{{.Image}}}}'"], 16)
    if code == 0 and out.strip():
        parts = out.strip().split("|", 2)
        docker_state = parts[0] if parts else None
        docker_status = parts[1] if len(parts) > 1 else None
        image = (parts[2] if len(parts) > 2 else "").split("/")[-1] or None
    code2, started_out = run(ssh + [f"timeout 8 docker inspect --format '{{{{.State.StartedAt}}}}' {CONTAINER}"], 12)
    if code2 == 0:
        started = started_out.strip() or None

    peers_db: list[dict] = []
    q = "SELECT id, created_at, IFNULL(status,''), IFNULL(note,''), info FROM peer"
    code, dbout = run(ssh + [f"timeout 8 sqlite3 -separator '|' {DB_PATH} \"{q}\""], 12)
    if code == 0:
        for line in dbout.splitlines():
            bits = line.split("|", 4)
            if len(bits) < 1 or not RD_ID.match(bits[0].strip()):
                continue
            info = parse_info(bits[4] if len(bits) > 4 else "")
            st_raw = bits[2].strip() if len(bits) > 2 else ""
            online = None
            if st_raw in ("1", "true", "online"):
                online = True
            elif st_raw in ("0", "false", "offline"):
                online = False
            rec = {
                "id": bits[0].strip(),
                "created_at": bits[1] if len(bits) > 1 else None,
                "note": (bits[3][:80] if len(bits) > 3 else "") or None,
                "source": "hbbs",
            }
            rec.update(info)
            rec["rustdesk_online"] = online
            peers_db.append(rec)

    lan: list[dict] = []
    if LAN_PEERS.exists():
        try:
            lan = parse_lan_peers(LAN_PEERS.read_text(encoding="utf-8", errors="replace"))
        except OSError:
            lan = []

    by_id: dict[str, dict] = {}
    for p in peers_db:
        by_id[p["id"]] = dict(p)
    for p in lan:
        rid = p["id"]
        cur = by_id.get(rid) or {"id": rid, "source": "lan"}
        for k, v in p.items():
            if k == "online":
                cur["rustdesk_online"] = v
            elif v not in (None, ""):
                cur[k] = v
        if cur.get("source") == "hbbs":
            cur["source"] = "hbbs+lan"
        elif "source" not in cur:
            cur["source"] = "lan"
        by_id[rid] = cur

    fleet_by = {h.get("id"): h for h in fleet if h.get("id")}
    devices = []
    for rid, d in by_id.items():
        helix = match_helix(d, prefs["map"])
        tele = None
        helix_online = None
        if helix:
            fh = fleet_by.get(helix["id"]) or {}
            helix_online = fh.get("online")
            tele = None
            if fh:
                tele = {
                    "cpu_pct": fh.get("pct"),
                    "mem_used_gb": fh.get("mem_used_gb"),
                    "mem_total_gb": fh.get("mem_total_gb"),
                    "load1": fh.get("load1"),
                    "disk_pct": fh.get("disk_pct"),
                    "online": fh.get("online"),
                }
                if all(tele.get(k) is None for k in ("cpu_pct", "mem_used_gb", "load1")):
                    tele = {"online": fh.get("online")} if fh.get("online") is not None else None
        rd_on = d.get("rustdesk_online")
        devices.append(
            {
                "id": rid,
                "name": (helix or {}).get("name") or d.get("hostname") or rid,
                "hostname": d.get("hostname"),
                "username": d.get("username"),
                "platform": d.get("platform") or d.get("os"),
                "ip": d.get("ip"),
                "rustdesk_online": rd_on,
                "helix": helix,
                "helix_online": helix_online,
                "telemetry": tele,
                "favorite": rid in prefs["favorites"],
                "source": d.get("source"),
                "created_at": d.get("created_at"),
                "launch": f"rustdesk://connection/new/{rid}",
            }
        )

    devices.sort(key=lambda x: (not x["favorite"], x.get("rustdesk_online") is not True, (x.get("name") or "").lower()))

    online_n = sum(1 for d in devices if d.get("rustdesk_online") is True)
    offline_n = sum(1 for d in devices if d.get("rustdesk_online") is False)
    unknown_n = len(devices) - online_n - offline_n

    now_map = {d["id"]: d.get("rustdesk_online") for d in devices}
    if _PREV["hbbs"] is True and not hbbs:
        _push_event("RDESK", "HBBS SIGNAL LOST")
    if _PREV["hbbs"] is False and hbbs:
        _push_event("RDESK", "HBBS HEALTHY")
    if _PREV["hbbr"] is True and not hbbr:
        _push_event("RDESK", "HBBR SIGNAL LOST")
    if _PREV["hbbr"] is False and hbbr:
        _push_event("RDESK", "HBBR HEALTHY")
    for rid, on in now_map.items():
        prev = _PREV["online"].get(rid)
        name = next((d["name"] for d in devices if d["id"] == rid), rid)
        if prev is True and on is False:
            _push_event("REMOTE", f"{name} OFFLINE")
        if prev is False and on is True:
            _push_event("REMOTE", f"{name} ONLINE")
        if prev is None and on is True and _PREV["t"]:
            _push_event("REMOTE", f"{name} ONLINE")
    _PREV["hbbs"] = hbbs
    _PREV["hbbr"] = hbbr
    _PREV["online"] = now_map
    _PREV["t"] = time.time()

    hel01 = "standing by."
    if not hbbs or not hbbr:
        hel01 = "Remote relay unavailable." if not hbbr else "Remote ID server unavailable."
    elif _LOCK_EVENTS:
        last = _LOCK_EVENTS[0]["text"]
        if "ONLINE" in last:
            hel01 = f"Remote node {last.replace(' ONLINE', '')} is online."
        elif "OFFLINE" in last:
            hel01 = last
        elif "HBBR" in last or "HBBS" in last:
            hel01 = "Remote relay unavailable." if "LOST" in last else last

    return {
        "ok": True,
        "edition": "oss-aio",
        "pro": False,
        "container": CONTAINER,
        "image": image,
        "docker_state": docker_state,
        "docker_status": docker_status,
        "host": UNRAID,
        "uptime_s": _uptime_s(started) if docker_state == "running" else None,
        "hbbs": {"port": HBBS_PORT, "online": hbbs},
        "hbbr": {"port": HBBR_PORT, "online": hbbr},
        "nat": {"port": NAT_PORT, "online": nat},
        "capabilities": {
            "server_health": True,
            "device_directory": True,
            "online_status": any(d.get("rustdesk_online") is not None for d in devices),
            "session_data": False,
            "remote_launch": True,
            "telemetry": "helix",
            "api": False,
            "api_port_open": api_open,
        },
        "counts": {
            "devices": len(devices),
            "online": online_n,
            "offline": offline_n,
            "unknown": unknown_n,
            "sessions": None,
        },
        "devices": devices,
        "helix_hosts": HELIX_CATALOG,
        "favorites": prefs["favorites"],
        "events": list(_LOCK_EVENTS[:16]),
        "hel01": hel01,
        "map": prefs["map"],
    }


def act(run: Callable, body: dict, client_ip: str) -> dict:
    action = str(body.get("action") or "").strip().lower()
    rid = str(body.get("id") or "").strip()
    prefs = load_prefs()
    if action == "favorite":
        if not RD_ID.match(rid):
            return {"ok": False, "error": "bad id"}
        on = bool(body.get("on", True))
        fav = [x for x in prefs["favorites"] if x != rid]
        if on:
            fav.insert(0, rid)
        prefs["favorites"] = fav
        save_prefs(prefs)
        return {"ok": True, "favorites": fav}
    if action == "map":
        if not RD_ID.match(rid):
            return {"ok": False, "error": "bad id"}
        hid = str(body.get("helix_id") or "").strip()
        if hid and hid not in HELIX_IDS:
            return {"ok": False, "error": "bad host"}
        if hid:
            prefs["map"][rid] = hid
        else:
            prefs["map"].pop(rid, None)
        save_prefs(prefs)
        return {"ok": True, "map": prefs["map"]}
    if action == "launch":
        if not RD_ID.match(rid):
            return {"ok": False, "error": "bad id"}
        if not body.get("confirm"):
            return {"ok": False, "error": "confirm required"}
        url = f"rustdesk://connection/new/{rid}"
        local = client_ip in {"127.0.0.1", "::1", MAC_LAN, "localhost"}
        launched = False
        if local and body.get("execute"):
            code, _ = run(["open", url], 8)
            launched = code == 0
            audit("REMOTE CLIENT LAUNCHED" if launched else "REMOTE REQUEST", {"id": rid, "launched": launched})
        else:
            audit("REMOTE REQUEST", {"id": rid, "launched": False, "via": "url"})
        return {"ok": True, "url": url, "launched": launched, "id": rid}
    return {"ok": False, "error": "bad action"}
