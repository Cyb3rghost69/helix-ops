"""HELIX/OPS lighting — WiZ LAN UDP as a LightingProvider. No cloud. No secrets."""
from __future__ import annotations

import json
import os
import socket
import threading
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
STATE_FILE = ROOT / "helix-lights.json"
WIZ_PORT = 38899
IP_OK = __import__("re").compile(r"^(?:\d{1,3}\.){3}\d{1,3}$")

WIZ_SCENES = {
    1: "Ocean", 2: "Romance", 3: "Sunset", 4: "Party", 5: "Fireplace",
    6: "Cozy", 7: "Forest", 8: "Pastel", 9: "Wake up", 10: "Bedtime",
    11: "Warm White", 12: "Daylight", 13: "Cool white", 14: "Night light",
    15: "Focus", 16: "Relax", 17: "True colors", 18: "TV time",
    19: "Plantgrowth", 20: "Spring", 21: "Summer", 22: "Fall",
    23: "Deepdive", 24: "Jungle", 25: "Mojito", 26: "Club",
    27: "Christmas", 28: "Halloween", 29: "Candlelight", 30: "Golden white",
    31: "Pulse", 32: "Steampunk",
}

DEFAULT_SCENES = [
    {"id": "full-bright", "name": "FULL BRIGHT", "power": True, "brightness": 100, "temp": 4000},
    {"id": "night", "name": "NIGHT", "power": True, "brightness": 12, "temp": 2200},
    {"id": "movie", "name": "MOVIE", "power": True, "brightness": 25, "temp": 2700, "wiz_scene": 18},
    {"id": "warm", "name": "WARM", "power": True, "brightness": 60, "temp": 2700},
    {"id": "cool", "name": "COOL", "power": True, "brightness": 80, "temp": 5000},
    {"id": "red-alert", "name": "RED ALERT", "power": True, "brightness": 80, "rgb": [200, 16, 8]},
    {"id": "helix-green", "name": "HELIX GREEN", "power": True, "brightness": 70, "rgb": [124, 255, 122]},
    {"id": "all-off", "name": "ALL OFF", "power": False},
]

DEFAULT_GROUPS = [
    {"id": "lounge", "name": "Lounge", "lights": []},
    {"id": "bedroom", "name": "Bedroom", "lights": []},
    {"id": "office", "name": "Office", "lights": []},
    {"id": "outside", "name": "Outside", "lights": []},
    {"id": "workshop", "name": "Workshop", "lights": []},
    {"id": "unassigned", "name": "Unassigned", "lights": []},
]


def _env(name: str, default: str = "") -> str:
    v = (os.environ.get(name) or "").strip()
    if v:
        return v
    p = ROOT / "ops.env"
    if p.is_file():
        for line in p.read_text(encoding="utf-8").splitlines():
            if line.startswith(name + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return default


def enabled() -> bool:
    return (_env("WIZ_ENABLED", "true") or "true").lower() not in ("0", "false", "off", "no")


def discovery_on() -> bool:
    return (_env("WIZ_DISCOVERY_ENABLED", "true") or "true").lower() not in ("0", "false", "off")


def _int_env(name: str, default: int) -> int:
    try:
        return max(5, int(_env(name, str(default)) or default))
    except ValueError:
        return default


def broadcast_addr() -> str:
    raw = _env("WIZ_BROADCAST_ADDRESS", "")
    if raw and IP_OK.match(raw):
        return raw
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("192.168.1.1", 80))
        ip = s.getsockname()[0]
        s.close()
        parts = ip.split(".")
        if len(parts) == 4:
            return ".".join(parts[:3] + ["255"])
    except OSError:
        pass
    return "255.255.255.255"


def wiz_rpc(ip: str, method: str, params: dict | None = None, timeout: float = 1.6) -> dict:
    if not IP_OK.match(ip):
        raise ValueError("bad ip")
    msg = json.dumps({"method": method, "params": params or {}}).encode()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.settimeout(timeout)
    try:
        sock.sendto(msg, (ip, WIZ_PORT))
        data, _ = sock.recvfrom(4096)
        return json.loads(data.decode("utf-8", "replace") or "{}")
    finally:
        sock.close()


def wiz_discover(timeout: float = 2.2) -> list[tuple[str, dict]]:
    payload = json.dumps({"method": "getSystemConfig", "params": {}}).encode()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.settimeout(timeout)
    found: dict[str, dict] = {}
    try:
        for dest in {broadcast_addr(), "255.255.255.255"}:
            try:
                sock.sendto(payload, (dest, WIZ_PORT))
            except OSError:
                continue
        t_end = time.time() + timeout
        while time.time() < t_end:
            try:
                data, addr = sock.recvfrom(4096)
            except socket.timeout:
                break
            except OSError:
                break
            ip = addr[0]
            try:
                body = json.loads(data.decode("utf-8", "replace") or "{}")
            except json.JSONDecodeError:
                continue
            found[ip] = body if isinstance(body, dict) else {}
    finally:
        sock.close()
    return list(found.items())


def _pilot_to_state(pilot: dict, syscfg: dict | None = None) -> dict:
    raw_r = pilot.get("result")
    r: dict = raw_r if isinstance(raw_r, dict) else (pilot if isinstance(pilot, dict) else {})
    raw_s = (syscfg or {}).get("result")
    s: dict = raw_s if isinstance(raw_s, dict) else (syscfg if isinstance(syscfg, dict) else {})
    rgb = None
    if all(k in r for k in ("r", "g", "b")):
        rgb = [int(r.get("r") or 0), int(r.get("g") or 0), int(r.get("b") or 0)]
    scene_id = r.get("sceneId")
    mac = (r.get("mac") or s.get("mac") or "").lower()
    name = s.get("moduleName") or r.get("moduleName") or ""
    dim = r.get("dimming")
    try:
        dim_i = int(dim) if dim is not None else None
    except (TypeError, ValueError):
        dim_i = None
    temp = r.get("temp")
    try:
        temp_i = int(temp) if temp is not None else None
    except (TypeError, ValueError):
        temp_i = None
    rssi = r.get("rssi")
    try:
        rssi_i = int(rssi) if rssi is not None else None
    except (TypeError, ValueError):
        rssi_i = None
    return {
        "name": str(name)[:80],
        "model": str(s.get("moduleName") or "")[:80],
        "mac": mac[:32],
        "online": True,
        "power": bool(r.get("state")) if "state" in r else None,
        "brightness": dim_i,
        "rgb": rgb,
        "temp": temp_i,
        "scene_id": int(scene_id) if isinstance(scene_id, int) else None,
        "scene": WIZ_SCENES.get(int(scene_id)) if isinstance(scene_id, int) else None,
        "rssi": rssi_i,
        "fw": str(s.get("fwVersion") or "")[:32],
    }


class LightingProvider:
    id = "base"

    def discover(self) -> list[dict]:
        return []

    def read(self, ip: str) -> dict:
        raise NotImplementedError

    def apply(self, ip: str, cmd: dict) -> dict:
        raise NotImplementedError


class WizProvider(LightingProvider):
    id = "wiz"

    def discover(self) -> list[dict]:
        out = []
        for ip, body in wiz_discover():
            st = _pilot_to_state({}, body)
            st["ip"] = ip
            st["provider"] = self.id
            out.append(st)
        return out

    def read(self, ip: str) -> dict:
        try:
            pilot = wiz_rpc(ip, "getPilot")
        except (OSError, ValueError, json.JSONDecodeError, TimeoutError, socket.timeout):
            return {"ip": ip, "provider": self.id, "online": False}
        syscfg = {}
        try:
            syscfg = wiz_rpc(ip, "getSystemConfig", timeout=1.2)
        except (OSError, ValueError, json.JSONDecodeError, TimeoutError, socket.timeout):
            syscfg = {}
        st = _pilot_to_state(pilot, syscfg)
        st["ip"] = ip
        st["provider"] = self.id
        st["online"] = True
        return st

    def apply(self, ip: str, cmd: dict) -> dict:
        params: dict[str, Any] = {}
        if "power" in cmd and cmd["power"] is not None:
            params["state"] = bool(cmd["power"])
        if cmd.get("brightness") is not None:
            b = int(cmd["brightness"])
            params["dimming"] = max(10, min(100, b))
            params["state"] = True
        if cmd.get("rgb") and isinstance(cmd["rgb"], (list, tuple)) and len(cmd["rgb"]) >= 3:
            params["r"] = max(0, min(255, int(cmd["rgb"][0])))
            params["g"] = max(0, min(255, int(cmd["rgb"][1])))
            params["b"] = max(0, min(255, int(cmd["rgb"][2])))
            params["state"] = True
        if cmd.get("temp") is not None:
            params["temp"] = max(2200, min(6500, int(cmd["temp"])))
            params["state"] = True
        if cmd.get("wiz_scene") is not None:
            params["sceneId"] = int(cmd["wiz_scene"])
            params["state"] = True
        if not params:
            return self.read(ip)
        try:
            wiz_rpc(ip, "setPilot", params)
        except (OSError, ValueError, json.JSONDecodeError, TimeoutError, socket.timeout) as e:
            st = self.read(ip)
            st["error"] = type(e).__name__
            return st
        return self.read(ip)


PROVIDERS: dict[str, LightingProvider] = {"wiz": WizProvider()}

_LOCK = threading.Lock()
_STATE: dict = {"devices": {}, "groups": [], "scenes": [], "last_discovery": None}
_POLL_T = 0.0
_DISC_T = 0.0
_BG_ONCE = False


def _load() -> dict:
    if not STATE_FILE.is_file():
        return {
            "devices": {},
            "groups": [dict(g) for g in DEFAULT_GROUPS],
            "scenes": [dict(s) for s in DEFAULT_SCENES],
            "last_discovery": None,
        }
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        data = {}
    data.setdefault("devices", {})
    if not data.get("groups"):
        data["groups"] = [dict(g) for g in DEFAULT_GROUPS]
    if not data.get("scenes"):
        data["scenes"] = [dict(s) for s in DEFAULT_SCENES]
    return data


def _save(st: dict) -> None:
    tmp = STATE_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, indent=2), encoding="utf-8")
    tmp.replace(STATE_FILE)
    try:
        os.chmod(STATE_FILE, 0o600)
    except OSError:
        pass


def _did(dev: dict) -> str:
    mac = (dev.get("mac") or "").replace(":", "").lower()
    if mac:
        return mac
    return "ip-" + str(dev.get("ip") or "")


def _merge_device(st: dict, incoming: dict) -> str:
    did = _did(incoming)
    old = st["devices"].get(did) or {}
    ip = incoming.get("ip") or old.get("ip")
    row = {**old, **{k: v for k, v in incoming.items() if v is not None}}
    row["id"] = did
    row["ip"] = ip
    row["provider"] = incoming.get("provider") or old.get("provider") or "wiz"
    row["last_seen"] = time.strftime("%Y-%m-%dT%H:%M:%S") if incoming.get("online") else old.get("last_seen")
    if incoming.get("online") is False:
        row["online"] = False
    if not row.get("group"):
        row["group"] = old.get("group") or "unassigned"
    st["devices"][did] = row
    # keep group membership
    gid = row["group"]
    for g in st["groups"]:
        lights = g.setdefault("lights", [])
        if g["id"] == gid:
            if did not in lights:
                lights.append(did)
        elif did in lights:
            lights.remove(did)
    return did


def _refresh_one(st: dict, did: str) -> None:
    d = st["devices"].get(did) or {}
    ip = d.get("ip")
    prov = PROVIDERS.get(d.get("provider") or "wiz") or PROVIDERS["wiz"]
    if not ip:
        return
    got = prov.read(ip)
    got["ip"] = ip
    _merge_device(st, got)


def snapshot() -> dict:
    global _STATE, _POLL_T, _BG_ONCE
    with _LOCK:
        if not _STATE.get("devices") and not _STATE.get("groups"):
            _STATE = _load()
        now = time.time()
        poll = _int_env("WIZ_STATE_POLL_INTERVAL", 20)
        if enabled() and _STATE["devices"] and now - _POLL_T > poll:
            _POLL_T = now
            for did in list(_STATE["devices"]):
                try:
                    _refresh_one(_STATE, did)
                except Exception:
                    _STATE["devices"][did]["online"] = False
            _save(_STATE)
        if not _BG_ONCE:
            _BG_ONCE = True
            threading.Thread(target=_bg, name="helix-lights", daemon=True).start()
        return _public(_STATE)


def _public(st: dict) -> dict:
    devmap = st.get("devices")
    if not isinstance(devmap, dict):
        devmap = {}
    devices = list(devmap.values())
    online = sum(1 for d in devices if d.get("online"))
    active = sum(1 for d in devices if d.get("online") and d.get("power"))
    groups = []
    for g in st.get("groups") or []:
        members = [st["devices"][i] for i in g.get("lights") or [] if i in st["devices"]]
        on_n = sum(1 for m in members if m.get("online"))
        groups.append({
            **g,
            "count": len(members),
            "online": on_n,
            "power": any(m.get("power") for m in members if m.get("online")),
            "brightness": _avg([m.get("brightness") for m in members if m.get("online")]),
        })
    return {
        "enabled": enabled(),
        "provider": "wiz",
        "broadcast": broadcast_addr(),
        "last_discovery": st.get("last_discovery"),
        "devices": sorted(devices, key=lambda d: (d.get("group") or "", d.get("name") or d.get("ip") or "")),
        "groups": groups,
        "scenes": st.get("scenes") or [],
        "wiz_scenes": [{"id": k, "name": v} for k, v in WIZ_SCENES.items()],
        "telemetry": {
            "devices": len(devices),
            "online": online,
            "offline": len(devices) - online,
            "active": active,
            "last_discovery": st.get("last_discovery"),
        },
    }


def _avg(vals: list) -> int | None:
    nums = [int(v) for v in vals if isinstance(v, (int, float))]
    if not nums:
        return None
    return int(sum(nums) / len(nums))


def _bg() -> None:
    global _DISC_T
    while True:
        time.sleep(8)
        if not enabled():
            continue
        interval = _int_env("WIZ_DISCOVERY_INTERVAL", 300)
        if discovery_on() and time.time() - _DISC_T > interval:
            try:
                act({"action": "discover"})
            except Exception:
                pass
            _DISC_T = time.time()


def act(data: dict) -> dict:
    global _STATE, _DISC_T
    if not enabled() and data.get("action") not in ("snapshot", None, ""):
        return {"ok": False, "error": "disabled", **snapshot()}
    action = str(data.get("action") or "").strip().lower()
    with _LOCK:
        st = _STATE if _STATE.get("groups") else _load()
        _STATE = st
        prov = PROVIDERS.get(str(data.get("provider") or "wiz")) or PROVIDERS["wiz"]
        err = None
        if action == "discover":
            if not discovery_on():
                err = "discovery_disabled"
            else:
                found = prov.discover()
                for row in found:
                    try:
                        got = prov.read(row.get("ip") or "")
                        _merge_device(st, {**row, **got})
                    except Exception:
                        _merge_device(st, row)
                st["last_discovery"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                _DISC_T = time.time()
                _save(st)
        elif action == "add":
            ip = str(data.get("ip") or "").strip()
            if not IP_OK.match(ip):
                err = "bad_ip"
            else:
                got = prov.read(ip)
                got["ip"] = ip
                if data.get("name"):
                    got["name"] = str(data["name"])[:80]
                _merge_device(st, got)
                _save(st)
        elif action == "assign":
            did = str(data.get("id") or "")
            gid = str(data.get("group") or "unassigned")
            if did not in st["devices"]:
                err = "unknown_device"
            else:
                if not any(g["id"] == gid for g in st["groups"]):
                    st["groups"].append({"id": gid, "name": gid, "lights": []})
                st["devices"][did]["group"] = gid
                _merge_device(st, st["devices"][did])
                _save(st)
        elif action in ("on", "off", "toggle", "brightness", "color", "temperature", "scene", "wiz_scene"):
            ids = _target_ids(st, data)
            cmd = _cmd_from(action, data, st)
            for did in ids:
                d = st["devices"].get(did)
                if not d or not d.get("ip"):
                    continue
                got = prov.apply(d["ip"], cmd)
                _merge_device(st, {**d, **got, "ip": d["ip"]})
            _save(st)
        elif action == "all_off":
            cmd = {"power": False}
            for did, d in list(st["devices"].items()):
                if d.get("ip"):
                    got = prov.apply(d["ip"], cmd)
                    _merge_device(st, {**d, **got, "ip": d["ip"]})
            _save(st)
        elif action == "activate_scene":
            sid = str(data.get("scene") or data.get("id") or "")
            scene = next((s for s in st["scenes"] if s.get("id") == sid), None)
            if not scene:
                err = "unknown_scene"
            else:
                ids = _target_ids(st, data) or list(st["devices"])
                cmd = {
                    "power": scene.get("power"),
                    "brightness": scene.get("brightness"),
                    "rgb": scene.get("rgb"),
                    "temp": scene.get("temp"),
                    "wiz_scene": scene.get("wiz_scene"),
                }
                if scene.get("power") is False:
                    cmd = {"power": False}
                for did in ids:
                    d = st["devices"].get(did)
                    if d and d.get("ip"):
                        got = prov.apply(d["ip"], cmd)
                        _merge_device(st, {**d, **got, "ip": d["ip"]})
                _save(st)
        elif action == "save_scene":
            sid = str(data.get("id") or f"scene-{int(time.time())}")[:40]
            rec = {
                "id": sid,
                "name": str(data.get("name") or sid)[:40],
                "power": data.get("power"),
                "brightness": data.get("brightness"),
                "rgb": data.get("rgb"),
                "temp": data.get("temp"),
                "wiz_scene": data.get("wiz_scene"),
            }
            st["scenes"] = [s for s in st["scenes"] if s.get("id") != sid] + [rec]
            _save(st)
        out = _public(st)
        if err:
            out["ok"] = False
            out["error"] = err
        else:
            out["ok"] = True
        return out


def _target_ids(st: dict, data: dict) -> list[str]:
    if data.get("id"):
        return [str(data["id"])]
    if data.get("group"):
        g = next((x for x in st["groups"] if x["id"] == data["group"]), None)
        return list(g.get("lights") or []) if g else []
    if data.get("ids") and isinstance(data["ids"], list):
        return [str(x) for x in data["ids"]]
    return []


def _cmd_from(action: str, data: dict, st: dict) -> dict:
    if action == "on":
        return {"power": True}
    if action == "off":
        return {"power": False}
    if action == "toggle":
        did = str(data.get("id") or "")
        cur = (st["devices"].get(did) or {}).get("power")
        return {"power": not cur}
    if action == "brightness":
        return {"brightness": data.get("value") if data.get("value") is not None else data.get("brightness")}
    if action == "color":
        rgb = data.get("rgb") or data.get("value")
        return {"rgb": rgb}
    if action == "temperature":
        return {"temp": data.get("value") if data.get("value") is not None else data.get("temp")}
    if action == "wiz_scene":
        return {"wiz_scene": data.get("value") if data.get("value") is not None else data.get("wiz_scene")}
    if action == "scene":
        return {"wiz_scene": data.get("value") if data.get("value") is not None else data.get("scene")}
    return {}
