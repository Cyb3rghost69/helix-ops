#!/usr/bin/env python3
"""Loopback Hermes ops dashboard. Bind 127.0.0.1 only. No secrets in JSON."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import socket
import subprocess
import threading
import time
import uuid
from http.cookies import SimpleCookie
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
import ssl

HOST = "0.0.0.0"
PORT = 8790
ROOT = Path(__file__).resolve().parent
HERMES = os.path.expanduser("~/.hermes/hermes-agent/venv/bin/hermes")
TS = "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
UNRAID = "192.168.1.84"
UMBREL = "192.168.1.236"
OMARCHY = "192.168.1.207"
THINKPAD = "192.168.1.151"
UDM = "192.168.1.1"
ILO = "192.168.1.82"
HOME = str(Path.home())
PAGE = 16384
STATE_DB = os.path.expanduser("~/.hermes/state.db")
SKILLS_ROOT = Path.home() / ".hermes" / "skills"
MEM_FILES = [
    ("SOUL", Path.home() / ".hermes" / "SOUL.md"),
    ("USER", Path.home() / ".hermes" / "memories" / "USER.md"),
    ("MEMORY", Path.home() / ".hermes" / "memories" / "MEMORY.md"),
]
BOT_DBS = [
    ("prefect", Path.home() / ".hermes" / "profiles" / "prefect" / "state.db"),
    ("foreman", Path.home() / ".hermes" / "profiles" / "foreman" / "state.db"),
    ("canon", Path.home() / ".hermes" / "profiles" / "canon" / "state.db"),
    ("scribe", Path.home() / ".hermes" / "profiles" / "scribe" / "state.db"),
    ("adze", Path.home() / ".hermes" / "profiles" / "adze" / "state.db"),
]
AGENT_DBS = {"helix": Path(STATE_DB), **{name: path for name, path in BOT_DBS}}
_TRACE_CACHE: dict = {"t": 0.0, "key": "", "data": None}
GRAPH_FILE = Path.home() / ".hermes" / "mindscape" / "graph.json"
PROMPT_LOG = ROOT / "prompts.jsonl"
HERDR = os.path.expanduser("~/.local/bin/herdr")
AUTH_FILE = ROOT / "ops.env"
SESSION_TTL = 12 * 3600
_SESSIONS: dict[str, dict] = {}
_SESS_LOCK = threading.Lock()
SECRETISH = re.compile(r"(password|passwd|token|api[_-]?key|secret|r3dbull)", re.I)
_FLEET_CPU: dict = {"hosts": [], "t": 0.0}
_AGENTS_CACHE: dict = {"t": 0.0, "data": None}
_REMOTE_CACHE: dict = {"t": 0.0, "data": None}

_DEMO_NODES = [
    ("Hermes Agent Architecture", "Core agent, CLI, tools, gateway adapters.", ["architecture", "core"], "reasoning"),
    ("Tool System", "Pluggable tools via ctx.register_tool.", ["tools", "architecture"], "tool-call"),
    ("Session Management", "Per-conversation state and history.", ["session", "core"], "session"),
    ("Memory Layer", "Honcho / local memory for standing facts.", ["memory", "storage"], "memory"),
    ("Helix Ops", "LAN CRT deck on :8790 — live stats + this graph.", ["dashboard", "helix"], "manual"),
    ("Mindscape Plugin", "Cognitive graph plugin — nodes, edges, hooks.", ["plugins", "mindscape"], "manual"),
    ("Honcho", "Self-hosted memory API on Unraid :8000.", ["memory", "unraid"], "memory"),
    ("Decision: Embed graph in Helix ops", "Serve the graph UI on :8790 instead of dashboard-only.", ["decision", "mindscape"], "decision"),
]
_DEMO_EDGES = [
    ("Hermes Agent Architecture", "Tool System", "contains"),
    ("Hermes Agent Architecture", "Session Management", "contains"),
    ("Hermes Agent Architecture", "Memory Layer", "uses"),
    ("Hermes Agent Architecture", "Helix Ops", "observes"),
    ("Helix Ops", "Mindscape Plugin", "embeds"),
    ("Mindscape Plugin", "Decision: Embed graph in Helix ops", "produces"),
    ("Memory Layer", "Honcho", "backed-by"),
    ("Tool System", "Mindscape Plugin", "registers"),
]


def run(cmd: list[str], timeout: float = 8) -> tuple[int, str]:
    try:
        p = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env={**os.environ, "TERM": "dumb"},
        )
        out = (p.stdout or "") + (("\n" + p.stderr) if p.stderr and p.returncode else "")
        return p.returncode, out.strip()
    except subprocess.TimeoutExpired:
        return 124, ""
    except FileNotFoundError:
        return 127, ""


def _parse_ops_env(text: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip("'").strip('"')
    return out


def ensure_ops_auth() -> None:
    if AUTH_FILE.exists():
        AUTH_FILE.chmod(0o600)
        return
    AUTH_FILE.write_text(
        "# Helix ops login — never paste this in Telegram\n"
        "HELIX_OPS_USER=helix\n"
        "HELIX_OPS_PASSWORD=\n"
        "HELIX_OPS_SETUP=1\n",
        encoding="utf-8",
    )
    AUTH_FILE.chmod(0o600)


def _ops_env() -> dict[str, str]:
    ensure_ops_auth()
    return _parse_ops_env(AUTH_FILE.read_text(encoding="utf-8"))


def _ops_creds() -> tuple[str, str]:
    env = _ops_env()
    return env.get("HELIX_OPS_USER") or "helix", env.get("HELIX_OPS_PASSWORD") or ""


def setup_needed() -> bool:
    env = _ops_env()
    if (env.get("HELIX_OPS_SETUP") or "").strip() in ("1", "true", "yes"):
        return True
    return not (env.get("HELIX_OPS_PASSWORD") or "")


def auth_open() -> bool:
    v = (_ops_env().get("HELIX_OPS_AUTH") or "").strip().lower()
    return v in ("off", "0", "false", "open", "disabled")


def write_ops_password(user: str, password: str) -> None:
    user = (user or "helix").strip() or "helix"
    auth = (_ops_env().get("HELIX_OPS_AUTH") or "").strip()
    extra = f"HELIX_OPS_AUTH={auth}\n" if auth else ""
    AUTH_FILE.write_text(
        "# Helix ops login — never paste this in Telegram\n"
        f"HELIX_OPS_USER={user}\n"
        f"HELIX_OPS_PASSWORD={password}\n"
        "HELIX_OPS_SETUP=0\n"
        + extra,
        encoding="utf-8",
    )
    AUTH_FILE.chmod(0o600)


def check_login(user: str, password: str) -> bool:
    want_user, want_pw = _ops_creds()
    if not want_pw:
        return False
    u_ok = hmac.compare_digest(hashlib.sha256(user.encode("utf-8")).digest(), hashlib.sha256(want_user.encode("utf-8")).digest())
    p_ok = hmac.compare_digest(hashlib.sha256(password.encode("utf-8")).digest(), hashlib.sha256(want_pw.encode("utf-8")).digest())
    return u_ok and p_ok


def new_session(user: str) -> str:
    tok = secrets.token_urlsafe(32)
    with _SESS_LOCK:
        _SESSIONS[tok] = {"user": user, "exp": time.time() + SESSION_TTL}
    return tok


def drop_session(tok: str) -> None:
    with _SESS_LOCK:
        _SESSIONS.pop(tok, None)


def session_user(handler: BaseHTTPRequestHandler) -> str | None:
    raw = handler.headers.get("Cookie") or ""
    jar = SimpleCookie()
    try:
        jar.load(raw)
    except Exception:
        return None
    morsel = jar.get("helix_ops")
    if not morsel:
        return None
    tok = morsel.value
    now = time.time()
    with _SESS_LOCK:
        rec = _SESSIONS.get(tok)
        if not rec or rec["exp"] < now:
            _SESSIONS.pop(tok, None)
            return None
        rec["exp"] = now + SESSION_TTL
        return rec["user"]


def http_code(url: str, timeout: float = 2.0) -> dict:
    t0 = time.time()
    try:
        req = Request(url, method="GET")
        with urlopen(req, timeout=timeout) as r:
            return {"ok": True, "status": r.status, "ms": int((time.time() - t0) * 1000)}
    except HTTPError as e:
        return {"ok": True, "status": e.code, "ms": int((time.time() - t0) * 1000)}
    except (URLError, TimeoutError, OSError):
        return {"ok": False, "status": None, "ms": int((time.time() - t0) * 1000)}


def ping_ms(host: str) -> float | None:
    code, out = run(["ping", "-c", "1", "-W", "1000", host], timeout=3)
    m = re.search(r"time=([\d.]+)\s*ms", out)
    if m:
        return float(m.group(1))
    m = re.search(r"round-trip min/avg/max/stddev = ([\d.]+)", out)
    return float(m.group(1)) if m else None


def parse_profiles(text: str) -> list[dict]:
    rows = []
    for line in text.splitlines():
        if "──" in line or line.strip().startswith("Profile") or not line.strip():
            continue
        if "◆" in line or re.match(r"^\s+\S+", line):
            parts = re.split(r"\s{2,}", line.strip())
            if len(parts) >= 3:
                name = parts[0].lstrip("◆ ").strip()
                rows.append(
                    {
                        "name": name,
                        "alias": "Helix" if name == "default" else name,
                        "model": parts[1],
                        "gateway": parts[2],
                        "active": "◆" in line,
                    }
                )
    return rows


def parse_sessions_stats(text: str) -> dict:
    d: dict = {"total": 0, "messages": 0, "db_mb": None, "by_source": {}}
    m = re.search(r"Total sessions:\s*(\d+)", text)
    if m:
        d["total"] = int(m.group(1))
    m = re.search(r"Total messages:\s*(\d+)", text)
    if m:
        d["messages"] = int(m.group(1))
    m = re.search(r"Database size:\s*([\d.]+)\s*MB", text)
    if m:
        d["db_mb"] = float(m.group(1))
    for src, n in re.findall(r"^\s+(\S+):\s+(\d+)\s+sessions", text, re.M):
        d["by_source"][src] = int(n)
    return d


def parse_session_rows(text: str) -> list[dict]:
    rows = []
    for line in text.splitlines():
        if "──" in line or line.startswith("Title") or not line.strip():
            continue
        # Title padded, workspace, last active, id at end
        m = re.match(r"(.+?)\s{2,}(\S+|\—|-)\s{2,}(.+?)\s{2,}(\d{8}_\d{6}_\w+)\s*$", line)
        if m:
            rows.append(
                {
                    "title": m.group(1).strip(),
                    "workspace": m.group(2).strip(),
                    "last_active": m.group(3).strip(),
                    "id": m.group(4),
                }
            )
    return rows[:8]


def mac_host() -> dict:
    _, name_s = run(["scutil", "--get", "ComputerName"], 2)
    _, ncpu = run(["sysctl", "-n", "hw.ncpu"], 2)
    _, mem = run(["sysctl", "-n", "hw.memsize"], 2)
    _, up = run(["uptime"], 2)
    _, df = run(["df", "-k", "/"], 2)
    load = None
    m = re.search(r"load averages?:\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)", up)
    if m:
        load = [float(m.group(1)), float(m.group(2)), float(m.group(3))]
    uptime = None
    um = re.search(r"up\s+(.+?),\s+\d+\s+users?", up)
    if um:
        uptime = um.group(1).strip()
    disk = {}
    dflines = df.splitlines()
    if len(dflines) >= 2:
        cols = dflines[-1].split()
        if len(cols) >= 5:
            disk = {
                "used_gb": round(int(cols[2]) / 1048576, 1),
                "avail_gb": round(int(cols[3]) / 1048576, 1),
                "pct": cols[4],
            }
    # vm_stat
    _, vm = run(["vm_stat"], 2)
    pages = {}
    for k, label in (
        ("free", r"Pages free:\s+(\d+)"),
        ("active", r"Pages active:\s+(\d+)"),
        ("inactive", r"Pages inactive:\s+(\d+)"),
        ("wired", r"Pages wired down:\s+(\d+)"),
        ("spec", r"Pages speculative:\s+(\d+)"),
    ):
        mm = re.search(label, vm)
        if mm:
            pages[k] = int(mm.group(1).replace(".", ""))
    total_pages = int(int(mem or 0) / PAGE) if mem.isdigit() else 0
    used_pages = total_pages - pages.get("free", 0) - pages.get("spec", 0)
    mem_used_gb = round(used_pages * PAGE / (1024**3), 2) if total_pages else None
    mem_total_gb = round(int(mem) / (1024**3), 1) if mem.isdigit() else None
    hermes_procs = 0
    code, ps = run(["pgrep", "-f", "-u", str(os.getuid()), "hermes"], 3)
    if code == 0:
        hermes_procs = len([ln for ln in ps.splitlines() if ln.strip()])
    ips = []
    for iface in ("en0", "en1"):
        _, ip = run(["ipconfig", "getifaddr", iface], 2)
        if ip and re.match(r"\d+\.\d+\.\d+\.\d+", ip):
            ips.append({"iface": iface, "ip": ip})
    return {
        "id": "mac",
        "name": name_s or "Mac",
        "role": "main brain / Helix",
        "online": True,
        "host": ips[0]["ip"] if ips else None,
        "ips": ips,
        "cpus": int(ncpu) if ncpu.isdigit() else None,
        "mem_total_gb": mem_total_gb,
        "mem_used_gb": mem_used_gb,
        "disk": disk,
        "load": load,
        "uptime": uptime,
        "hermes_procs": hermes_procs,
    }


def _host_cpu_row(h: dict) -> dict:
    load = h.get("load") or []
    ncpu = int(h.get("cpus") or 0)
    l1 = float(load[0]) if load else 0.0
    pct = min(100.0, round(100.0 * l1 / ncpu, 1)) if ncpu else 0.0
    return {
        "id": h.get("id"),
        "name": h.get("name") or h.get("id"),
        "online": bool(h.get("online")),
        "cpus": ncpu,
        "load1": round(l1, 2),
        "pct": pct,
        "mem_used_gb": h.get("mem_used_gb"),
        "mem_total_gb": h.get("mem_total_gb"),
        "disk_pct": h.get("disk_pct") or ((h.get("disk") or {}).get("pct")),
        "hermes_procs": h.get("hermes_procs") or 0,
    }


def cache_fleet_cpu(hosts: list[dict]) -> None:
    _FLEET_CPU["hosts"] = [_host_cpu_row(h) for h in hosts]
    _FLEET_CPU["t"] = time.time()


def compute_now() -> dict:
    ncpu = os.cpu_count() or 1
    load = list(os.getloadavg())
    mac = {
        "id": "mac",
        "name": "Mac",
        "online": True,
        "cpus": ncpu,
        "load1": round(float(load[0]), 2),
        "pct": min(100.0, round(100.0 * float(load[0]) / ncpu, 1)),
    }
    cached_mac = next((h for h in (_FLEET_CPU.get("hosts") or []) if h.get("id") == "mac"), {})
    for k in ("mem_used_gb", "mem_total_gb", "disk_pct", "hermes_procs"):
        if cached_mac.get(k) is not None:
            mac[k] = cached_mac.get(k)
    others = [h for h in (_FLEET_CPU.get("hosts") or []) if h.get("id") != "mac"]
    hosts = [mac, *others]
    online = [h for h in hosts if h.get("online") and (h.get("cpus") or 0) > 0]
    total_cpus = sum(int(h["cpus"]) for h in online)
    total_load = sum(float(h.get("load1") or 0) for h in online)
    used_pct = min(100.0, round(100.0 * total_load / total_cpus, 1)) if total_cpus else 0.0
    return {
        "t": time.time(),
        "total_cpus": total_cpus,
        "total_load": round(total_load, 2),
        "used_pct": used_pct,
        "mac_pct": mac["pct"],
        "fleet_age_s": round(max(0.0, time.time() - float(_FLEET_CPU.get("t") or 0)), 1) if _FLEET_CPU.get("t") else None,
        "hosts": hosts,
        "mem_used_gb": round(sum(float(h.get("mem_used_gb") or 0) for h in online), 1),
        "mem_total_gb": round(sum(float(h.get("mem_total_gb") or 0) for h in online), 1),
        "hermes_procs": sum(int(h.get("hermes_procs") or 0) for h in online),
    }


def fleet_btop() -> dict:
    d = compute_now()
    mu, mt = d.get("mem_used_gb") or 0, d.get("mem_total_gb") or 0
    d["mem_pct"] = min(100.0, round(100.0 * mu / mt, 1)) if mt else 0.0
    return d


def security_now(gw_running: bool, local_svcs: dict, ts: dict, hosts: list) -> dict:
    findings = [
        {
            "level": "low",
            "title": "Ops login is on",
            "detail": "Cookie session on :8790. Password lives in ops.env on the Mini — not Telegram.",
        },
        {
            "level": "med",
            "title": "Rotate UniFi key",
            "detail": "Key lived in chat once. File unifi.env mode 600 only.",
        },
        {
            "level": "med",
            "title": "BlueBubbles Cloudflare URL dead",
            "detail": "iMessage adapter retrying a dead tunnel. Local API is 127.0.0.1:1234.",
        },
        {
            "level": "ok" if gw_running else "high",
            "title": "Telegram gateway",
            "detail": "launchd multiplexer" if gw_running else "down — Telegram will not answer",
        },
        {
            "level": "ok" if (local_svcs.get("honcho") or {}).get("status") == 200 else "high",
            "title": "Honcho memory",
            "detail": "http://192.168.1.84:8000/health",
        },
        {
            "level": "ok" if (ts or {}).get("state") in (None, "Running", "running") or (ts or {}).get("BackendState") == "Running" else "warn",
            "title": "Tailscale",
            "detail": str((ts or {}).get("state") or (ts or {}).get("BackendState") or "unknown"),
        },
    ]
    down = [h.get("name") or h.get("id") for h in (hosts or []) if not h.get("online")]
    if down:
        findings.append({"level": "warn", "title": "Hosts offline", "detail": ", ".join(down)})
    score = 100
    for f in findings:
        if f["level"] == "high":
            score -= 18
        elif f["level"] == "med":
            score -= 8
        elif f["level"] == "warn":
            score -= 5
    return {"score": max(0, score), "findings": findings}


KNOWN_OWNERS = {
    "192.168.1.1": ("network", "UDM / UniFi"),
    "192.168.1.81": ("Mat Flaherty", "Mac Mini alias"),
    "192.168.1.82": ("homelab", "HPE iLO DL385"),
    "192.168.1.84": ("homelab", "Unraid bigboi"),
    "192.168.1.151": ("homelab", "ThinkPad"),
    "192.168.1.172": ("Mat Flaherty", "Mac Mini / Helix"),
    "192.168.1.207": ("cursed", "Omarchy laptop"),
    "192.168.1.236": ("homelab", "Umbrel"),
}
OWNER_RX = [
    (re.compile(r"mat|flaherty|mac-mini|macbook|mac\.local", re.I), "Mat Flaherty"),
    (re.compile(r"bigboi|unraid", re.I), "homelab (Unraid)"),
    (re.compile(r"umbrel", re.I), "homelab (Umbrel)"),
    (re.compile(r"omarchy|start\.local", re.I), "cursed / Omarchy"),
    (re.compile(r"thinkpad", re.I), "ThinkPad"),
    (re.compile(r"ilo", re.I), "HPE iLO"),
    (re.compile(r"unifi|udm|u6-?lite|usw-|uap-|u7-", re.I), "network (UniFi)"),
    (re.compile(r"iphone|ipad|watch", re.I), "Apple household device"),
    (re.compile(r"android|pixel|galaxy", re.I), "Android household device"),
    (re.compile(r"wiz_|webostv|lgtv|roku|chromecast|apple.?tv", re.I), "household media"),
]


def _load_aliases() -> dict:
    p = ROOT / "clients-aliases.json"
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def _unifi_cfg() -> tuple[str | None, str]:
    url, key = "https://192.168.1.1", None
    p = ROOT / "unifi.env"
    if p.exists():
        try:
            for line in p.read_text().splitlines():
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                if k.strip() == "UNIFI_URL":
                    url = v.strip().rstrip("/")
                elif k.strip() == "UNIFI_API_KEY":
                    key = v.strip() or None
        except OSError:
            pass
    envk = os.environ.get("UNIFI_API_KEY")
    if envk:
        key = envk
    return key, url


def guess_owner(ip: str, hostname: str, name: str = "") -> tuple[str, str]:
    aliases = _load_aliases()
    for key in (ip, (hostname or "").lower(), (name or "").lower()):
        if key and key in aliases:
            row = aliases[key]
            if isinstance(row, dict):
                return str(row.get("owner") or "unknown"), str(row.get("note") or "")
            return str(row), "alias"
    if ip in KNOWN_OWNERS:
        return KNOWN_OWNERS[ip]
    blob = f"{hostname} {name}"
    for rx, owner in OWNER_RX:
        if rx.search(blob):
            return owner, "hostname"
    if hostname:
        short = hostname.split(".")[0].replace("-", " ")
        return "unknown", f"dhcp:{short}"
    return "unknown", "no hostname"


def ptr_clients(prefix: str = "192.168.1.") -> list[dict]:
    def one(i: int):
        ip = f"{prefix}{i}"
        code, out = run(["dig", "+time=1", "+tries=1", "+short", "-x", ip, "@192.168.1.1"], 2)
        host = (out.splitlines()[0].strip().rstrip(".")) if code == 0 and out.strip() else ""
        if not host:
            return None
        owner, how = guess_owner(ip, host)
        return {
            "ip": ip,
            "hostname": host,
            "name": host.split(".")[0],
            "owner": owner,
            "owner_how": how,
            "ap": None,
            "ssid": None,
            "wired": None,
            "mac": None,
            "vendor": None,
            "rssi": None,
            "rx_mb": None,
            "tx_mb": None,
            "source": "dns",
        }

    rows = []
    with ThreadPoolExecutor(max_workers=32) as pool:
        futs = [pool.submit(one, i) for i in range(1, 255)]
        for fut in as_completed(futs):
            r = fut.result()
            if r:
                rows.append(r)
    rows.sort(key=lambda r: tuple(int(x) for x in r["ip"].split(".")))
    return rows


def _http_json(url: str, headers: dict, timeout: int = 8):
    ctx = ssl._create_unverified_context()
    req = Request(url, headers=headers)
    with urlopen(req, timeout=timeout, context=ctx) as resp:
        return json.loads(resp.read().decode() or "{}")


def unifi_clients(key: str, base: str) -> tuple[list[dict], str | None]:
    headers = {"X-API-KEY": key, "Accept": "application/json"}
    try:
        sites = _http_json(f"{base}/proxy/network/integration/v1/sites", headers)
    except (URLError, HTTPError, TimeoutError, json.JSONDecodeError, OSError) as e:
        return [], f"unifi sites: {type(e).__name__}"
    data = sites.get("data") if isinstance(sites, dict) else sites
    if not isinstance(data, list) or not data:
        return [], "unifi: no sites"
    site_id = data[0].get("id") or data[0].get("internalReference") or "default"
    try:
        payload = _http_json(f"{base}/proxy/network/integration/v1/sites/{site_id}/clients", headers)
    except (URLError, HTTPError, TimeoutError, json.JSONDecodeError, OSError) as e:
        return [], f"unifi clients: {type(e).__name__}"
    clients = payload.get("data") if isinstance(payload, dict) else payload
    if not isinstance(clients, list) or not clients:
        return [], "unifi: empty clients"
    aps: dict[str, str] = {}
    try:
        devs = _http_json(f"{base}/proxy/network/integration/v1/sites/{site_id}/devices", headers)
        for d in (devs.get("data") if isinstance(devs, dict) else []) or []:
            did = d.get("id") or ""
            label = d.get("name") or d.get("model") or did
            if did:
                aps[did] = label
            mac = (d.get("macAddress") or d.get("mac") or "").lower()
            if mac:
                aps[mac] = label
    except (URLError, HTTPError, TimeoutError, json.JSONDecodeError, OSError):
        pass
    out = []
    for c in clients:
        ip = c.get("ipAddress") or c.get("ip") or c.get("last_ip") or ""
        host = c.get("hostname") or ""
        name = c.get("name") or host
        mac = (c.get("macAddress") or c.get("mac") or "").lower() or None
        uplink = c.get("uplinkDeviceId") or ""
        ap_mac = (c.get("ap_mac") or c.get("sw_mac") or "").lower()
        ap = aps.get(uplink) or aps.get(ap_mac) or c.get("ap_name")
        ctype = (c.get("type") or "").upper()
        wired = True if ctype == "WIRED" else False if ctype == "WIRELESS" else None
        if c.get("is_wired") is not None:
            wired = bool(c.get("is_wired"))
        owner, how = guess_owner(ip, host, name)
        acc = c.get("access") if isinstance(c.get("access"), dict) else {}
        rx = c.get("rx_bytes") or c.get("wired-rx_bytes")
        tx = c.get("tx_bytes") or c.get("wired-tx_bytes")
        out.append(
            {
                "ip": ip,
                "hostname": host or name,
                "name": name,
                "owner": owner,
                "owner_how": how,
                "ap": ap,
                "ssid": c.get("essid") or c.get("ssid") or acc.get("ssid"),
                "wired": wired,
                "mac": mac,
                "vendor": c.get("oui") or c.get("manufacturer"),
                "rssi": c.get("rssi") or c.get("signal"),
                "rx_mb": round(rx / 1048576, 1) if isinstance(rx, (int, float)) else None,
                "tx_mb": round(tx / 1048576, 1) if isinstance(tx, (int, float)) else None,
                "source": "unifi",
            }
        )
    return out, None


def lan_clients() -> dict:
    t0 = time.time()
    key, base = _unifi_cfg()
    uni, uni_err = ([], None)
    if key:
        uni, uni_err = unifi_clients(key, base)
    dns = ptr_clients()
    by_ip = {r["ip"]: r for r in dns if r.get("ip")}
    for r in uni:
        ip = r.get("ip")
        if ip and ip in by_ip:
            d = by_ip[ip]
            for k in ("ap", "ssid", "wired", "mac", "vendor", "rssi", "rx_mb", "tx_mb", "name"):
                if r.get(k) not in (None, "", []):
                    d[k] = r[k]
            d["source"] = "unifi+dns"
            if r.get("owner") and r["owner"] != "unknown":
                d["owner"], d["owner_how"] = r["owner"], r["owner_how"]
        elif ip:
            by_ip[ip] = r
        else:
            by_ip[r.get("mac") or f"noid-{len(by_ip)}"] = r
    rows = list(by_ip.values())
    rows.sort(key=lambda r: tuple(int(x) for x in str(r.get("ip") or "0.0.0.0").split(".") if x.isdigit()) or (0,))
    return {
        "collected_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "ms": int((time.time() - t0) * 1000),
        "unifi": bool(key) and not uni_err,
        "unifi_error": uni_err,
        "need_key": not bool(key),
        "count": len(rows),
        "clients": rows,
    }


PROTECT_DB = ROOT / "protect-events.db"
CAM_ID_RE = re.compile(r"^[0-9a-fA-F]{24}$")


def _protect_headers() -> tuple[dict, str] | tuple[None, str]:
    key, base = _unifi_cfg()
    if not key:
        return None, base
    return {"X-API-KEY": key, "Accept": "application/json"}, base


def _protect_init_db() -> None:
    con = sqlite3.connect(PROTECT_DB)
    con.execute(
        "CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, t REAL, cam TEXT, kind TEXT, note TEXT)"
    )
    con.commit()
    con.close()


def protect_record(cam: str, kind: str, note: str = "") -> None:
    _protect_init_db()
    con = sqlite3.connect(PROTECT_DB)
    con.execute(
        "INSERT INTO events(t, cam, kind, note) VALUES (?,?,?,?)",
        (time.time(), _snip(cam, 80), _snip(kind, 40), _snip(note, 160)),
    )
    con.commit()
    con.close()


def protect_today() -> dict:
    _protect_init_db()
    start = time.time() - 86400
    con = sqlite3.connect(PROTECT_DB)
    rows = con.execute(
        "SELECT kind, COUNT(*) FROM events WHERE t>=? GROUP BY kind ORDER BY COUNT(*) DESC",
        (start,),
    ).fetchall()
    n = con.execute("SELECT COUNT(*) FROM events WHERE t>=?", (start,)).fetchone()[0]
    recent = con.execute(
        "SELECT t, cam, kind, note FROM events ORDER BY id DESC LIMIT 12"
    ).fetchall()
    con.close()
    return {
        "total": n,
        "by_type": [{"kind": k, "n": c} for k, c in rows],
        "recent": [
            {"t": time.strftime("%H:%M:%S", time.localtime(t)), "cam": cam, "kind": kind, "note": note}
            for t, cam, kind, note in recent
        ],
    }


def protect_snapshot(cid: str) -> tuple[int, bytes, str]:
    if not CAM_ID_RE.match(cid or ""):
        return 400, b"bad id", "text/plain"
    headers, base = _protect_headers()
    if not headers:
        return 503, b"no unifi key", "text/plain"
    ctx = ssl._create_unverified_context()
    req = Request(f"{base}/proxy/protect/integration/v1/cameras/{cid}/snapshot", headers=headers)
    try:
        with urlopen(req, timeout=10, context=ctx) as resp:
            return 200, resp.read(), "image/jpeg"
    except HTTPError as e:
        return e.code, b"offline", "text/plain"
    except (URLError, TimeoutError, OSError):
        return 502, b"fetch fail", "text/plain"


def protect_status() -> dict:
    headers, base = _protect_headers()
    if not headers:
        return {"ok": False, "need_key": True, "cameras": [], "today": protect_today()}
    try:
        cams = _http_json(f"{base}/proxy/protect/integration/v1/cameras", headers)
    except (URLError, HTTPError, TimeoutError, json.JSONDecodeError, OSError) as e:
        return {"ok": False, "need_key": False, "error": type(e).__name__, "cameras": [], "today": protect_today()}
    if not isinstance(cams, list):
        cams = cams.get("data") if isinstance(cams, dict) else []
    out = []
    for c in cams or []:
        sd = c.get("smartDetectSettings") or {}
        ff = c.get("featureFlags") or {}
        objects = list(sd.get("objectTypes") or ff.get("smartDetectTypes") or [])
        audio = list(sd.get("audioTypes") or ff.get("smartDetectAudioTypes") or [])
        name = c.get("name") or ""
        if "living room" in name.lower():
            continue
        out.append(
            {
                "id": c.get("id"),
                "name": c.get("name"),
                "type": c.get("type"),
                "state": c.get("state"),
                "online": c.get("state") == "CONNECTED",
                "objects": objects,
                "audio": audio,
            }
        )
    today = protect_today()
    return {
        "ok": True,
        "need_key": False,
        "cameras": out,
        "today": today,
        "events_note": (
            "This console's Protect integration has no events/subscribe API. "
            "Daily counts fill if Protect posts webhooks to /api/protect/hook."
        ),
    }


SSH_UNRAID = [
    "ssh",
    "-i",
    os.path.expanduser("~/.ssh/id_ed25519_unraid_hermes"),
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=6",
    f"root@{UNRAID}",
]
DOCKER_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
DOCKER_WEBUI_FALLBACK = {
    "helix-command": f"http://{UNRAID}:8788/",
    "UptimeKuma": f"http://{UNRAID}:3001/",
    "honcho-api-1": f"http://{UNRAID}:8000/",
    "Hermes-Agent": f"http://{UNRAID}:9119/",
}


def _docker_webui(name: str, tpl: str, ports: str) -> str | None:
    if tpl:
        m = re.search(r"\[PORT:(\d+)\]", tpl)
        cport = m.group(1) if m else None
        hport = cport
        if cport:
            hm = re.search(rf":(\d+)->{re.escape(cport)}\b", ports or "")
            if hm:
                hport = hm.group(1)
        url = tpl.replace("[IP]", UNRAID)
        if hport:
            url = re.sub(r"\[PORT:\d+\]", hport, url)
        url = url.replace("[PORT]", hport or "")
        if url.startswith("http"):
            return url
    if name in DOCKER_WEBUI_FALLBACK:
        return DOCKER_WEBUI_FALLBACK[name]
    hm = re.search(r":(\d+)->", ports or "")
    if hm:
        return f"http://{UNRAID}:{hm.group(1)}/"
    return None


def docker_list() -> dict:
    fmt = '{{.Names}}|{{.State}}|{{.Status}}|{{.Image}}|{{.Ports}}|{{.Label "net.unraid.docker.webui"}}'
    code, out = run(SSH_UNRAID + [f"timeout 25 docker ps -a --format {fmt!r}"], 30)
    if code != 0:
        return {"ok": False, "error": "docker list failed", "containers": []}
    rows = []
    for line in out.splitlines():
        parts = line.split("|", 5)
        if len(parts) < 4:
            continue
        name, state, status, image = parts[0], parts[1], parts[2], parts[3]
        ports = parts[4] if len(parts) > 4 else ""
        tpl = parts[5] if len(parts) > 5 else ""
        rows.append(
            {
                "name": name,
                "state": state,
                "status": status,
                "image": image.split("/")[-1],
                "ports": ports[:120],
                "webui": _docker_webui(name, tpl, ports),
                "running": state == "running",
            }
        )
    rows.sort(key=lambda r: (not r["running"], r["name"].lower()))
    return {"ok": True, "host": UNRAID, "count": len(rows), "containers": rows}


def remote_now() -> dict:
    now = time.time()
    if _REMOTE_CACHE["data"] and now - float(_REMOTE_CACHE["t"] or 0) < 4:
        return _REMOTE_CACHE["data"]
    from rustdesk_remote import snapshot

    data = snapshot(run, SSH_UNRAID, _FLEET_CPU.get("hosts") or [])
    _REMOTE_CACHE["t"] = now
    _REMOTE_CACHE["data"] = data
    return data


def remote_act(body: dict, client_ip: str) -> dict:
    from rustdesk_remote import act

    out = act(run, body, client_ip)
    _REMOTE_CACHE["t"] = 0.0
    return out


def git_now() -> dict:
    gitdir = ROOT / ".git"
    if not gitdir.exists():
        return {"ok": False, "error": "no repo", "repo": None}
    def g(args: list[str], timeout: float = 8) -> tuple[int, str]:
        return run(["git", "-C", str(ROOT), *args], timeout)

    code, branch = g(["rev-parse", "--abbrev-ref", "HEAD"])
    branch = branch.strip() if code == 0 else None
    code, head = g(["rev-parse", "--short", "HEAD"])
    head = head.strip() if code == 0 else None
    code, subj = g(["log", "-1", "--pretty=%s"])
    subj = subj.strip()[:80] if code == 0 else None
    code, st = g(["status", "--porcelain"])
    dirty = [ln for ln in (st.splitlines() if code == 0 else []) if ln.strip()]
    code, url = g(["remote", "get-url", "origin"])
    remote = None
    if code == 0 and url.strip():
        remote = re.sub(r"https://[^@/]+@", "https://", url.strip())
        remote = re.sub(r"\.git$", "", remote)
        m = re.search(r"github\.com[:/](.+)$", remote)
        repo = m.group(1) if m else remote
    else:
        repo = "helix-ops"
    ahead = behind = 0
    code, ab = g(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"])
    if code == 0 and ab.strip():
        parts = ab.split()
        if len(parts) == 2:
            behind, ahead = int(parts[0] or 0), int(parts[1] or 0)
    sync = "NO REMOTE"
    if code == 0:
        if ahead and behind:
            sync = "DIVERGED"
        elif ahead:
            sync = f"AHEAD {ahead}"
        elif behind:
            sync = f"BEHIND {behind}"
        else:
            sync = "UP TO DATE"
    return {
        "ok": True,
        "repo": repo,
        "branch": branch,
        "head": head,
        "subject": subj,
        "dirty": len(dirty),
        "ahead": ahead,
        "behind": behind,
        "sync": sync,
        "clean": len(dirty) == 0,
    }


def docker_act(name: str, action: str) -> dict:
    if action not in ("start", "stop") or not DOCKER_NAME.match(name or ""):
        return {"ok": False, "error": "bad name or action"}
    if name.lower() in {"docker", "dockerd"}:
        return {"ok": False, "error": "refused"}
    code, out = run(SSH_UNRAID + [f"timeout 40 docker {action} {name}"], 45)
    return {"ok": code == 0, "name": name, "action": action, "detail": _snip(out, 160)}


def unraid_host() -> dict:
    rtt = ping_ms(UNRAID)
    agent = http_code(f"http://{UNRAID}:8642/")
    honcho = http_code(f"http://{UNRAID}:8000/")
    webui = http_code(f"http://{UNRAID}:9119/")
    return {
        "id": "unraid",
        "name": "bigboi",
        "role": "Unraid worker",
        "host": UNRAID,
        "online": rtt is not None,
        "ping_ms": rtt,
        "services": {
            "hermes_api": agent,
            "honcho": honcho,
            "unraid_webui": webui,
        },
    }


LINUX_STATS = (
    "hostname; nproc; cut -d' ' -f1-3 /proc/loadavg; "
    "awk '/MemTotal/{t=$2}/MemAvailable/{a=$2} END{printf \"MEM %.1f %.1f\\n\",(t-a)/1048576,t/1048576}' /proc/meminfo; "
    "df -P / | awk 'NR==2{print \"DISK\",$5}'; "
    "echo HERMES $(pgrep -c -f '[h]ermes' 2>/dev/null || echo 0)"
)


def ssh_linux(key: str, userhost: str) -> dict:
    cmd = [
        "ssh",
        "-i",
        os.path.expanduser(key),
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=4",
        userhost,
        LINUX_STATS,
    ]
    code, out = run(cmd, 7)
    info: dict = {"ssh_ok": code == 0}
    if code != 0:
        return info
    lines = [ln.strip() for ln in out.splitlines() if ln.strip()]
    if lines:
        info["hostname"] = lines[0]
    if len(lines) > 1 and lines[1].isdigit():
        info["cpus"] = int(lines[1])
    if len(lines) > 2:
        try:
            info["load"] = [float(x) for x in lines[2].split()[:3]]
        except ValueError:
            pass
    for ln in lines:
        if ln.startswith("MEM "):
            parts = ln.split()
            if len(parts) >= 3:
                info["mem_used_gb"] = float(parts[1])
                info["mem_total_gb"] = float(parts[2])
        if ln.startswith("DISK "):
            info["disk_pct"] = ln.split()[-1]
        if ln.startswith("HERMES "):
            try:
                info["hermes_procs"] = int(ln.split()[-1])
            except ValueError:
                pass
    return info


def tcp_open(host: str, port: int) -> bool:
    s = socket.socket()
    s.settimeout(1.2)
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


def net_stats() -> dict:
    ifaces = []
    for name, role in (("en0", "LAN"), ("en1", "LAN-2"), ("utun0", "Tailscale")):
        _, ns = run(["/usr/sbin/netstat", "-I", name, "-b"], 2)
        row = None
        for line in ns.splitlines()[1:]:
            if "Link#" not in line and "<Link" not in line:
                continue
            cols = line.split()
            if len(cols) < 10:
                continue
            try:
                ibytes = int(cols[-5])
                obytes = int(cols[-2])
                ipkts = int(cols[-7])
                opkts = int(cols[-4])
            except (ValueError, IndexError):
                continue
            row = {
                "name": name,
                "role": role,
                "rx_gb": round(ibytes / (1024**3), 2),
                "tx_gb": round(obytes / (1024**3), 2),
                "rx_pkts": ipkts,
                "tx_pkts": opkts,
            }
            break
        if row:
            ifaces.append(row)
    _, rt = run(["route", "-n", "get", "default"], 2)
    gw = None
    iface = None
    m = re.search(r"gateway:\s+(\S+)", rt)
    if m:
        gw = m.group(1)
    m = re.search(r"interface:\s+(\S+)", rt)
    if m:
        iface = m.group(1)
    return {"ifaces": ifaces, "gateway": gw, "egress_iface": iface}


def probe_host(spec: dict) -> dict:
    host = spec["host"]
    rtt = ping_ms(host)
    row = {
        "id": spec["id"],
        "name": spec["name"],
        "role": spec["role"],
        "host": host,
        "online": rtt is not None,
        "ping_ms": rtt,
        "services": {},
    }
    for name, url in spec.get("http") or []:
        row["services"][name] = http_code(url)
    for port in spec.get("tcp") or []:
        ok = tcp_open(host, port)
        row["services"][f"tcp:{port}"] = {"ok": ok, "status": port if ok else None}
    ssh = spec.get("ssh")
    if ssh and rtt is not None:
        extra = ssh_linux(ssh["key"], ssh["userhost"])
        row["ssh_ok"] = extra.get("ssh_ok")
        for k in ("hostname", "cpus", "load", "mem_used_gb", "mem_total_gb", "disk_pct"):
            if k in extra:
                row[k] = extra[k]
    return row


def lan_hosts() -> list[dict]:
    specs = [
        {
            "id": "unraid",
            "name": "bigboi",
            "role": "Unraid / Honcho / peer",
            "host": UNRAID,
            "http": [
                ("hermes_api", f"http://{UNRAID}:8642/"),
                ("honcho", f"http://{UNRAID}:8000/health"),
                ("board", f"http://{UNRAID}:8788/"),
            ],
            "ssh": {"key": f"{HOME}/.ssh/id_ed25519_unraid_hermes", "userhost": f"root@{UNRAID}"},
        },
        {
            "id": "umbrel",
            "name": "umbrel",
            "role": "Umbrel node",
            "host": UMBREL,
            "http": [("hermes_peer", f"http://{UMBREL}:8643/")],
            "ssh": {"key": f"{HOME}/.ssh/id_ed25519_umbrel", "userhost": f"umbrel@{UMBREL}"},
        },
        {
            "id": "omarchy",
            "name": "Omarchypro",
            "role": "Omarchy laptop",
            "host": OMARCHY,
            "ssh": {"key": f"{HOME}/.ssh/id_ed25519_omarchy", "userhost": f"cursed@{OMARCHY}"},
        },
        {
            "id": "thinkpad",
            "name": "THINKPAD",
            "role": "Windows / RDP",
            "host": THINKPAD,
            "tcp": [3389],
        },
        {
            "id": "udm",
            "name": "UDM Pro",
            "role": "gateway",
            "host": UDM,
        },
        {
            "id": "ilo",
            "name": "iLO DL385",
            "role": "HPE BMC",
            "host": ILO,
        },
    ]
    by_id: dict = {}
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(probe_host, s): s["id"] for s in specs}
        for fut in as_completed(futs):
            try:
                by_id[futs[fut]] = fut.result()
            except Exception:
                by_id[futs[fut]] = {"id": futs[fut], "name": futs[fut], "online": False}
    return [by_id[s["id"]] for s in specs if s["id"] in by_id]


def bot_mesh(profiles: list[dict], peers: list[dict], gw_running: bool, local_svcs: dict, sessions: dict) -> dict:
    def on(name: str) -> bool:
        for p in profiles:
            if p.get("name") == name:
                return "running" in str(p.get("gateway") or "").lower()
        return False

    src = sessions.get("by_source") or {}
    honcho_ok = (local_svcs.get("honcho") or {}).get("status") == 200
    peer_names = {p.get("name") for p in peers}
    nodes = [
        {"id": "helix", "label": "HELIX", "kind": "orchestra", "host": "mac", "online": True},
        {"id": "prefect", "label": "Prefect", "kind": "bot", "host": "mac", "online": on("prefect")},
        {"id": "foreman", "label": "Foreman", "kind": "bot", "host": "mac", "online": on("foreman")},
        {"id": "canon", "label": "Canon", "kind": "bot", "host": "mac", "online": on("canon")},
        {"id": "scribe", "label": "Scribe", "kind": "bot", "host": "mac", "online": on("scribe")},
        {"id": "adze", "label": "ADZE", "kind": "bot", "host": "mac", "online": on("adze")},
        {"id": "unraid", "label": "Unraid peer", "kind": "peer", "host": "unraid", "online": "unraid" in peer_names},
        {"id": "umbrel", "label": "Umbrel peer", "kind": "peer", "host": "umbrel", "online": "umbrel" in peer_names},
        {"id": "telegram", "label": "Telegram", "kind": "channel", "host": "mac", "online": gw_running},
        {"id": "honcho", "label": "Honcho", "kind": "memory", "host": "unraid", "online": honcho_ok},
        {"id": "user", "label": "You", "kind": "human", "host": "lan", "online": True},
    ]
    edges = [
        {"from": "user", "to": "helix", "label": "desktop", "live": True},
        {"from": "user", "to": "telegram", "label": "chat", "live": gw_running},
        {"from": "telegram", "to": "helix", "label": "gateway", "live": gw_running, "weight": src.get("telegram", 0)},
        {"from": "helix", "to": "prefect", "label": "align", "live": on("prefect")},
        {"from": "helix", "to": "foreman", "label": "kanban", "live": on("foreman")},
        {"from": "helix", "to": "canon", "label": "docs", "live": on("canon")},
        {"from": "helix", "to": "scribe", "label": "research", "live": on("scribe")},
        {"from": "helix", "to": "adze", "label": "critique", "live": on("adze")},
        {"from": "helix", "to": "unraid", "label": "peer", "live": "unraid" in peer_names},
        {"from": "helix", "to": "umbrel", "label": "peer", "live": "umbrel" in peer_names},
        {"from": "helix", "to": "honcho", "label": "memory", "live": honcho_ok},
        {"from": "unraid", "to": "honcho", "label": "api", "live": honcho_ok},
    ]
    return {"nodes": nodes, "edges": edges}


def _snip(text: str, n: int = 110) -> str:
    s = re.sub(r"\s+", " ", (text or "").replace("```", " ")).strip()
    if SECRETISH.search(s):
        return "[redacted]"
    return (s[: n - 1] + "…") if len(s) > n else s


def _cli_text(text: str, n: int = 4000) -> str:
    s = (text or "").replace("\x00", "").strip()
    if not s:
        return ""
    s = SECRETISH.sub("[redacted]", s)
    if len(s) > n:
        return s[: n - 1] + "…"
    return s


def _tool_call_names(raw: str) -> list[str]:
    names: list[str] = []
    if not raw:
        return names
    try:
        arr = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return names
    if isinstance(arr, dict):
        arr = [arr]
    for tc in arr or []:
        if not isinstance(tc, dict):
            continue
        fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
        name = (fn.get("name") or tc.get("name") or "tool")
        names.append(str(name))
    return names


def _hhmmss(ts) -> str:
    try:
        t = float(ts)
        if t > 1e12:
            t /= 1000.0
        return time.strftime("%H:%M:%S", time.localtime(t))
    except (TypeError, ValueError, OSError, OverflowError):
        return "--:--:--"


def _reason_summary(text: str, n: int = 180) -> str:
    s = _cli_text(text or "", n)
    s = re.sub(r"\s+", " ", s).strip()
    if not s:
        return ""
    parts = re.split(r"(?<=[.!?])\s+", s)
    return (parts[0] if parts else s)[:n]


def _redact_val(obj, depth: int = 0):
    if depth > 4:
        return "…"
    if isinstance(obj, dict):
        out = {}
        for k, v in list(obj.items())[:10]:
            ks = str(k)
            if SECRETISH.search(ks):
                out[ks] = "[redacted]"
            else:
                out[ks] = _redact_val(v, depth + 1)
        return out
    if isinstance(obj, list):
        return [_redact_val(x, depth + 1) for x in obj[:8]]
    if obj is None or isinstance(obj, (int, float, bool)):
        return obj
    s = str(obj)
    if SECRETISH.search(s):
        return "[redacted]"
    if len(s) > 140:
        return s[:139] + "…"
    return s


def _tool_details(raw: str) -> list[dict]:
    out: list[dict] = []
    if not raw:
        return out
    try:
        arr = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return out
    if isinstance(arr, dict):
        arr = [arr]
    for tc in arr or []:
        if not isinstance(tc, dict):
            continue
        fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
        name = str(fn.get("name") or tc.get("name") or "tool")
        args = fn.get("arguments") if "arguments" in fn else tc.get("arguments")
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except (json.JSONDecodeError, TypeError):
                args = {"raw": args[:140]}
        out.append({"name": name, "arguments": _redact_val(args)})
    return out


def _bus_for_tool(name: str) -> str:
    n = (name or "").lower()
    if "prefect" in n:
        return "prefect"
    if "adze" in n:
        return "adze"
    if "scribe" in n:
        return "scribe"
    if "foreman" in n:
        return "foreman"
    if "canon" in n:
        return "canon"
    if n in ("web_search", "web_extract", "browser_exec", "hermes_web_search") or n.startswith("browser_"):
        return "network"
    if n in ("terminal", "execute_code", "computer_use"):
        return "tool"
    if n == "delegate_task":
        return "prefect"
    return "tool"


def _last_from_db(db: str) -> dict:
    out = {
        "title": "",
        "source": "",
        "thinking": "",
        "doing": "",
        "age_s": None,
        "online": False,
    }
    if not os.path.exists(db):
        return out
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=1.5)
        con.row_factory = sqlite3.Row
        s = con.execute(
            """
            SELECT id, title, source, last_activity_at
            FROM sessions
            WHERE IFNULL(archived,0)=0 AND IFNULL(hidden,0)=0
            ORDER BY IFNULL(last_activity_at,0) DESC LIMIT 1
            """
        ).fetchone()
        if not s:
            con.close()
            return out
        sid = s["id"]
        age = None
        ts = s["last_activity_at"]
        if ts and float(ts) > 1_000_000:
            age = max(0, int(time.time() - float(ts)))
        thought = con.execute(
            """
            SELECT IFNULL(reasoning_content, reasoning) AS t
            FROM messages
            WHERE session_id=? AND IFNULL(active,1)=1
              AND length(IFNULL(reasoning_content, IFNULL(reasoning,'')))>0
            ORDER BY id DESC LIMIT 1
            """,
            (sid,),
        ).fetchone()
        tools = con.execute(
            """
            SELECT tool_calls FROM messages
            WHERE session_id=? AND IFNULL(active,1)=1
              AND length(IFNULL(tool_calls,''))>0
            ORDER BY id DESC LIMIT 1
            """,
            (sid,),
        ).fetchone()
        reply = con.execute(
            """
            SELECT content FROM messages
            WHERE session_id=? AND role='assistant' AND IFNULL(active,1)=1
              AND length(IFNULL(content,''))>0
            ORDER BY id DESC LIMIT 1
            """,
            (sid,),
        ).fetchone()
        con.close()
        names = _tool_call_names((tools["tool_calls"] if tools else "") or "")
        doing = ("⚙ " + ", ".join(names[:4])) if names else _snip((reply["content"] if reply else "") or "", 140)
        out.update(
            {
                "title": _snip(s["title"] or "", 80),
                "source": s["source"] or "",
                "thinking": _reason_summary((thought["t"] if thought else "") or ""),
                "doing": doing or _snip(s["title"] or "", 80),
                "age_s": age,
                "online": age is not None and age < 180,
            }
        )
        return out
    except sqlite3.Error:
        return out


def agents_now() -> dict:
    now = time.time()
    if _AGENTS_CACHE["data"] is not None and now - _AGENTS_CACHE["t"] < 1.2:
        return _AGENTS_CACHE["data"]
    specs = [
        ("helix", "Helix", "mac", STATE_DB, "orchestra", "Telegram + desktop brain"),
        ("prefect", "Prefect", "mac", os.path.expanduser("~/.hermes/profiles/prefect/state.db"), "bot", "align · silent"),
        ("foreman", "Foreman", "mac", os.path.expanduser("~/.hermes/profiles/foreman/state.db"), "bot", "kanban · silent"),
        ("canon", "Canon", "mac", os.path.expanduser("~/.hermes/profiles/canon/state.db"), "bot", "docs · silent"),
        ("scribe", "Scribe", "mac", os.path.expanduser("~/.hermes/profiles/scribe/state.db"), "bot", "research · silent"),
        ("adze", "ADZE", "mac", os.path.expanduser("~/.hermes/profiles/adze/state.db"), "bot", "openai critic · silent"),
    ]
    agents = []
    for aid, label, host, db, kind, role in specs:
        row = _last_from_db(db)
        age = row["age_s"]
        if row["online"]:
            status = "busy"
        elif age is not None and age < 3600:
            status = "idle"
        elif os.path.exists(db):
            status = "dark"
        else:
            status = "dark"
        thinking = row["thinking"] or ("thinking…" if status == "busy" else "no live thought")
        doing = row["doing"] or role
        if status == "dark" and not row["title"]:
            thinking = "silent · no session"
            doing = role
        agents.append(
            {
                "id": aid,
                "label": label,
                "host": host,
                "kind": kind,
                "role": role,
                "status": status,
                "online": row["online"],
                "thinking": thinking,
                "doing": doing,
                "title": row["title"],
                "source": row["source"],
                "age_s": age,
            }
        )
    honcho = http_code(f"http://{UNRAID}:8000/health", 1.2)
    agents.append(
        {
            "id": "honcho",
            "label": "Honcho",
            "host": "unraid",
            "kind": "memory",
            "role": "memory API :8000",
            "status": "busy" if honcho.get("status") == 200 else "dark",
            "online": honcho.get("status") == 200,
            "thinking": "storing standing facts" if honcho.get("status") == 200 else "unreachable",
            "doing": f"health {honcho.get('status') or '—'}",
            "title": "",
            "source": "",
            "age_s": None,
        }
    )
    agents.append(
        {
            "id": "unraid",
            "label": "Unraid peer",
            "host": "unraid",
            "kind": "peer",
            "role": "web/peer only · no Telegram",
            "status": "idle",
            "online": False,
            "thinking": "no local thought stream",
            "doing": "standing by",
            "title": "",
            "source": "",
            "age_s": None,
        }
    )
    data = {"agents": agents, "t": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    _AGENTS_CACHE["t"] = now
    _AGENTS_CACHE["data"] = data
    return data


def memory_files() -> dict:
    files = []
    for name, path in MEM_FILES:
        if not path.is_file():
            files.append({"name": name, "text": "", "mtime": None, "bytes": 0, "missing": True})
            continue
        st = path.stat()
        raw = path.read_text(encoding="utf-8", errors="replace")
        files.append(
            {
                "name": name,
                "text": SECRETISH.sub("[redacted]", raw),
                "mtime": int(st.st_mtime),
                "bytes": st.st_size,
                "missing": False,
            }
        )
    return {"files": files}


def _skill_desc(text: str) -> str:
    if text.startswith("---"):
        parts = text.split("---", 2)
        if len(parts) >= 2:
            m = re.search(r"^description:\s*[\"']?(.*?)[\"']?\s*$", parts[1], re.M)
            if m:
                return _snip(m.group(1), 140)
    for line in text.splitlines():
        line = line.strip()
        if line.startswith("# "):
            return _snip(line[2:], 140)
    return ""


def skills_index() -> dict:
    rows = []
    if SKILLS_ROOT.is_dir():
        for skill_md in SKILLS_ROOT.rglob("SKILL.md"):
            try:
                rel = skill_md.parent.relative_to(SKILLS_ROOT).as_posix()
                raw = skill_md.read_text(encoding="utf-8", errors="replace")[:8000]
                st = skill_md.stat()
                cat = rel.split("/", 1)[0] if "/" in rel else ""
                rows.append(
                    {
                        "id": rel,
                        "name": skill_md.parent.name,
                        "category": cat,
                        "description": _skill_desc(raw),
                        "mtime": int(st.st_mtime),
                    }
                )
            except OSError:
                continue
    rows.sort(key=lambda r: (r["category"], r["name"]))
    return {"skills": rows, "count": len(rows)}


def skill_body(rel: str) -> dict:
    rel = (rel or "").strip().replace("\\", "/")
    if not rel or rel.startswith("/") or any(p == ".." or p == "" for p in rel.split("/")):
        return {"error": "bad name"}
    root = SKILLS_ROOT.resolve()
    path = (SKILLS_ROOT / rel / "SKILL.md").resolve()
    if root not in path.parents:
        return {"error": "bad name"}
    if not path.is_file():
        return {"error": "missing"}
    st = path.stat()
    text = SECRETISH.sub("[redacted]", path.read_text(encoding="utf-8", errors="replace")[:12000])
    return {"id": rel, "name": path.parent.name, "text": text, "mtime": int(st.st_mtime), "bytes": st.st_size}


def bot_talk(limit: int = 80) -> dict:
    items: list[dict] = []
    for bot, db in BOT_DBS:
        if not db.is_file():
            continue
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=1.5)
            con.row_factory = sqlite3.Row
            sessions = con.execute(
                """
                SELECT id, title, source, last_activity_at
                FROM sessions
                WHERE IFNULL(archived,0)=0
                ORDER BY IFNULL(last_activity_at,0) DESC LIMIT 24
                """
            ).fetchall()
            for s in sessions:
                rows = con.execute(
                    """
                    SELECT role, content, reasoning_content, timestamp
                    FROM messages
                    WHERE session_id=? AND IFNULL(active,1)=1
                      AND role IN ('user','assistant')
                    ORDER BY id ASC
                    """,
                    (s["id"],),
                ).fetchall()
                if not rows:
                    continue
                for r in rows:
                    role = r["role"]
                    text = _cli_text((r["content"] or r["reasoning_content"] or ""), 500)
                    if not text:
                        if role == "assistant":
                            text = "(no reply)"
                        else:
                            continue
                    ts = r["timestamp"] or s["last_activity_at"] or 0
                    items.append(
                        {
                            "from": "helix" if role == "user" else bot,
                            "to": bot if role == "user" else "helix",
                            "text": text,
                            "title": _snip(s["title"] or "", 70),
                            "source": s["source"] or "",
                            "t": float(ts) if ts else 0,
                            "sid": s["id"],
                        }
                    )
            con.close()
        except sqlite3.Error:
            continue
    items.sort(key=lambda x: x["t"])
    bots = sorted({b for b, db in BOT_DBS if db.is_file()})
    return {"items": items[-limit:], "bots": bots}


def herdr_now() -> dict:
    out = {
        "installed": os.path.isfile(HERDR),
        "running": False,
        "version": None,
        "socket": None,
        "agents": [],
        "workspaces": [],
        "tabs": [],
        "panes": [],
        "error": None,
    }
    if not out["installed"]:
        out["error"] = "not installed"
        return out
    code, st = run([HERDR, "status"], 5)
    vm = re.search(r"version:\s+(\S+)", st)
    if vm:
        out["version"] = vm.group(1)
    sm = re.search(r"socket:\s+(\S+)", st)
    if sm:
        out["socket"] = sm.group(1)
    out["running"] = bool(re.search(r"^server:\s*$[\s\S]*?status:\s+running", st, re.M)) or (
        "\n  status: running" in st
    )
    if not out["running"]:
        out["error"] = "server not running"
        return out
    c2, snap_raw = run([HERDR, "api", "snapshot"], 5)
    try:
        payload = json.loads(snap_raw or "{}")
    except json.JSONDecodeError:
        out["error"] = "snapshot not json"
        return out
    if payload.get("error"):
        err = payload["error"]
        out["error"] = err.get("message") if isinstance(err, dict) else str(err)
        return out
    snap = ((payload.get("result") or {}).get("snapshot")) or payload.get("snapshot") or {}
    def _rows(key: str) -> list:
        rows = []
        for a in snap.get(key) or []:
            if not isinstance(a, dict):
                rows.append({"name": str(a)})
                continue
            rows.append(
                {
                    "id": a.get("id") or a.get("name") or "",
                    "name": a.get("name") or a.get("title") or a.get("id") or key,
                    "status": a.get("status") or a.get("state") or "",
                    "kind": a.get("kind") or a.get("type") or a.get("agent") or "",
                    "cwd": a.get("cwd") or a.get("path") or "",
                }
            )
        return rows
    out["agents"] = _rows("agents")
    out["workspaces"] = _rows("workspaces")
    out["tabs"] = _rows("tabs")
    out["panes"] = _rows("panes")
    out["counts"] = {
        "agents": len(out["agents"]),
        "workspaces": len(out["workspaces"]),
        "tabs": len(out["tabs"]),
        "panes": len(out["panes"]),
    }
    return out


def waiting_prompts() -> list[dict]:
    rows: list[dict] = []
    if not os.path.exists(STATE_DB):
        return rows
    try:
        con = sqlite3.connect(f"file:{STATE_DB}?mode=ro", uri=True, timeout=2)
        con.row_factory = sqlite3.Row
        q = """
        SELECT s.id, s.source, s.title, s.display_name,
               (SELECT content FROM messages
                 WHERE session_id=s.id AND role='user'
                 ORDER BY id DESC LIMIT 1) AS last_user,
               (SELECT MAX(timestamp) FROM messages
                 WHERE session_id=s.id AND role='user') AS last_user_ts,
               (SELECT MAX(timestamp) FROM messages
                 WHERE session_id=s.id AND role='assistant'
                   AND length(IFNULL(content,''))>0) AS last_as_ts
        FROM sessions s
        WHERE IFNULL(s.archived,0)=0 AND IFNULL(s.hidden,0)=0
        ORDER BY IFNULL(s.last_activity_at,0) DESC
        LIMIT 40
        """
        for r in con.execute(q):
            lu, la = r["last_user_ts"], r["last_as_ts"]
            if lu is None:
                continue
            if la is not None and float(la) >= float(lu):
                continue
            rows.append(
                {
                    "kind": "prompt",
                    "priority": "high",
                    "source": r["source"] or "?",
                    "title": (r["title"] or r["display_name"] or r["id"] or "session")[:80],
                    "detail": _snip(r["last_user"] or ""),
                    "id": r["id"],
                }
            )
            if len(rows) >= 8:
                break
        undel = con.execute(
            "SELECT platform, state, content, created_at FROM delivery_obligations "
            "WHERE state NOT IN ('delivered','acked') ORDER BY created_at DESC LIMIT 6"
        ).fetchall()
        for u in undel:
            rows.append(
                {
                    "kind": "delivery",
                    "priority": "high",
                    "source": u["platform"] or "gw",
                    "title": f"undelivered ({u['state']})",
                    "detail": _snip(u["content"] or ""),
                    "id": "",
                }
            )
        con.close()
    except sqlite3.Error:
        pass
    return rows


def action_queue(gw_running: bool, kstats: str, cron_jobs: int, local_svcs: dict) -> list[dict]:
    items = waiting_prompts()
    if not gw_running:
        items.append(
            {
                "kind": "system",
                "priority": "high",
                "source": "gateway",
                "title": "gateway down",
                "detail": "Telegram/Discord will not answer until launchd gateway is up.",
                "id": "",
            }
        )
    honcho = local_svcs.get("honcho") or {}
    if honcho.get("status") != 200:
        items.append(
            {
                "kind": "system",
                "priority": "high",
                "source": "honcho",
                "title": "honcho API down",
                "detail": "http://192.168.1.84:8000/health is not 200.",
                "id": "",
            }
        )
    webui = local_svcs.get("webui") or {}
    if not webui.get("ok"):
        items.append(
            {
                "kind": "system",
                "priority": "med",
                "source": "webui",
                "title": "Hermes WebUI down",
                "detail": "127.0.0.1:8787/health failed.",
                "id": "",
            }
        )
    deck = local_svcs.get("control_deck") or {}
    if deck.get("status") not in (200, 401):
        items.append(
            {
                "kind": "system",
                "priority": "med",
                "source": "deck",
                "title": "Control Deck down",
                "detail": "127.0.0.1:4240 not answering.",
                "id": "",
            }
        )
    for line in (kstats or "").splitlines():
        m = re.match(r"\s*(triage|todo|ready|blocked|running|scheduled)\s+(\d+)", line, re.I)
        if m and int(m.group(2)) > 0:
            items.append(
                {
                    "kind": "kanban",
                    "priority": "med",
                    "source": "kanban",
                    "title": f"{m.group(2)} {m.group(1)} task(s)",
                    "detail": "Open hermes kanban list.",
                    "id": "",
                }
            )
    if cron_jobs:
        items.append(
            {
                "kind": "cron",
                "priority": "low",
                "source": "cron",
                "title": f"{cron_jobs} cron job(s) scheduled",
                "detail": "Watch for stalled fires.",
                "id": "",
            }
        )
    items.append(
        {
            "kind": "security",
            "priority": "low",
            "source": "ops",
            "title": "Helix ops login",
            "detail": "Session cookie required. Username/password in ~/.hermes/reports/ops-dashboard/ops.env — do not paste in Telegram.",
            "id": "",
        }
    )
    items.append(
        {
            "kind": "security",
            "priority": "med",
            "source": "unifi",
            "title": "Rotate UniFi API key",
            "detail": "A key was pasted in chat earlier. Create a new local key in UniFi; ops reads unifi.env only.",
            "id": "",
        }
    )
    items.append(
        {
            "kind": "idea",
            "priority": "low",
            "source": "herdr",
            "title": "Herdr 0.9.3 on ops",
            "detail": "Headless server running. Panel on DECK. Attach in a terminal with: herdr",
            "id": "",
        }
    )
    return items[:20]


def tailscale() -> dict:
    if not os.path.exists(TS):
        return {"installed": False, "state": "missing"}
    code, out = run([TS, "status", "--json"], 8)
    if code != 0 or not out.startswith("{"):
        _, st = run([TS, "status"], 5)
        return {"installed": True, "state": "unknown", "raw": st[:200]}
    try:
        data = json.loads(out)
    except json.JSONDecodeError:
        return {"installed": True, "state": "parse_error"}
    self = data.get("Self") or {}
    return {
        "installed": True,
        "state": data.get("BackendState"),
        "online": bool(self.get("Online")),
        "dns": (self.get("DNSName") or "").rstrip("."),
    }


def mindscape() -> dict:
    plugin = Path.home() / ".hermes" / "plugins" / "mindscape"
    yaml_path = plugin / "plugin.yaml"
    version = None
    if yaml_path.exists():
        m = re.search(r'version:\s*"?([^"\n]+)', yaml_path.read_text())
        if m:
            version = m.group(1).strip()
    g = load_ms_graph()
    nodes = g.get("nodes") or []
    edges = g.get("edges") or []
    c = Counter()
    for n in nodes:
        tags = n.get("tags") or []
        kind = (n.get("metadata") or {}).get("type") or (tags[0] if tags else "node")
        c[str(kind)] += 1
    dash = http_code("http://127.0.0.1:9119/")
    return {
        "installed": plugin.is_dir(),
        "enabled": True,
        "version": version,
        "nodes": len(nodes),
        "edges": len(edges),
        "types": dict(c.most_common(8)),
        "recent": [
            {
                "title": _snip(n.get("title") or "", 60),
                "updated": (n.get("updated_at") or n.get("created_at") or "")[:19],
            }
            for n in sorted(nodes, key=lambda x: x.get("updated_at") or "", reverse=True)[:6]
        ],
        "dashboard": dash,
        "dashboard_url": "http://127.0.0.1:9119/",
        "graph_file": str(GRAPH_FILE),
    }


def load_ms_graph() -> dict:
    if not GRAPH_FILE.exists():
        return {"nodes": [], "edges": []}
    try:
        data = json.loads(GRAPH_FILE.read_text() or "{}")
    except (OSError, json.JSONDecodeError):
        return {"nodes": [], "edges": []}
    if not isinstance(data, dict):
        return {"nodes": [], "edges": []}
    nodes, edges = data.get("nodes") or [], data.get("edges") or []
    out_nodes = []
    for n in nodes:
        if not isinstance(n, dict):
            continue
        content = n.get("content") or ""
        if SECRETISH.search(content) or SECRETISH.search(n.get("title") or ""):
            content = "[redacted]"
        out_nodes.append(
            {
                "id": n.get("id"),
                "title": n.get("title") or "Untitled",
                "content": content[:2000],
                "tags": n.get("tags") or [],
                "metadata": n.get("metadata") or {},
                "created_at": n.get("created_at"),
                "updated_at": n.get("updated_at"),
            }
        )
    out_edges = []
    for e in edges:
        if isinstance(e, dict) and e.get("source") and e.get("target"):
            out_edges.append(
                {
                    "source": e["source"],
                    "target": e["target"],
                    "relation": e.get("relation") or "related",
                }
            )
    return {"nodes": out_nodes, "edges": out_edges}


def seed_ms_graph(force: bool = False) -> dict:
    GRAPH_FILE.parent.mkdir(parents=True, exist_ok=True)
    current = load_ms_graph()
    if current["nodes"] and not force:
        return {"created": False, "reason": "graph not empty", "graph": current}
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    title_to_id = {}
    nodes = []
    for title, content, tags, ntype in _DEMO_NODES:
        nid = str(uuid.uuid4())
        title_to_id[title] = nid
        nodes.append(
            {
                "id": nid,
                "title": title,
                "content": content,
                "tags": tags,
                "metadata": {"type": ntype},
                "created_at": now,
                "updated_at": now,
            }
        )
    edges = []
    for src, tgt, rel in _DEMO_EDGES:
        if src in title_to_id and tgt in title_to_id:
            edges.append(
                {"source": title_to_id[src], "target": title_to_id[tgt], "relation": rel}
            )
    GRAPH_FILE.write_text(json.dumps({"nodes": nodes, "edges": edges}, indent=2))
    return {"created": True, "graph": load_ms_graph()}


def thoughts_feed() -> list[dict]:
    items: list[dict] = []
    if os.path.exists(STATE_DB):
        try:
            con = sqlite3.connect(f"file:{STATE_DB}?mode=ro", uri=True, timeout=2)
            con.row_factory = sqlite3.Row
            sid = con.execute(
                """
                SELECT id FROM sessions
                WHERE IFNULL(archived,0)=0 AND IFNULL(hidden,0)=0
                ORDER BY IFNULL(last_activity_at,0) DESC LIMIT 1
                """
            ).fetchone()
            if sid:
                rows = con.execute(
                    """
                    SELECT role, content, reasoning, reasoning_content,
                           tool_calls, tool_name, timestamp
                    FROM messages
                    WHERE session_id=? AND IFNULL(active,1)=1
                      AND IFNULL(_compressed_summary,0)=0
                    ORDER BY id DESC LIMIT 200
                    """,
                    (sid["id"],),
                ).fetchall()
                for r in reversed(rows):
                    ts = str(r["timestamp"] or "")[:19]
                    role = r["role"] or "?"
                    if role == "user":
                        txt = _cli_text(r["content"] or "", 800)
                        if txt:
                            items.append({"kind": "user", "text": txt, "t": ts})
                        continue
                    if role == "tool":
                        continue
                    for name in _tool_call_names(r["tool_calls"] or ""):
                        items.append({"kind": "tool", "text": f"TOOL // {name}", "t": ts})
                    reply = _cli_text(r["content"] or "", 2000)
                    if reply:
                        items.append({"kind": "assistant", "text": "RESPONSE", "t": ts})
            con.close()
        except sqlite3.Error:
            pass
    if PROMPT_LOG.exists():
        try:
            for ln in PROMPT_LOG.read_text().splitlines()[-8:]:
                try:
                    row = json.loads(ln)
                except json.JSONDecodeError:
                    continue
                txt = _cli_text(str(row.get("text") or ""), 400)
                if txt:
                    items.append({"kind": "prompt", "text": txt, "t": row.get("t") or ""})
        except OSError:
            pass
    return items[-300:]


def cognitive_trace(agent: str = "helix", run_id: str = "", retain: int = 24) -> dict:
    agent = (agent or "helix").strip().lower()
    if agent not in AGENT_DBS:
        agent = "helix"
    try:
        retain = max(4, min(int(retain or 24), 48))
    except (TypeError, ValueError):
        retain = 24
    run_id = re.sub(r"[^A-Za-z0-9_\-]", "", run_id or "")[:80]
    key = f"{agent}|{run_id}|{retain}"
    now = time.time()
    if _TRACE_CACHE["data"] is not None and _TRACE_CACHE["key"] == key and now - _TRACE_CACHE["t"] < 0.8:
        return _TRACE_CACHE["data"]

    stages = ["REQUEST", "INTERPRET", "PLAN", "TOOL", "OBSERVATION", "DECISION", "RESPONSE"]
    empty = {
        "agent": agent,
        "live": False,
        "stage": "IDLE",
        "stages": {s: False for s in stages},
        "objective": "",
        "plan": [],
        "tool": None,
        "result": None,
        "next": "NO TELEMETRY",
        "elapsed_s": None,
        "model": None,
        "tokens": None,
        "tokens_per_s": None,
        "reasoning_summary": "",
        "stream": [],
        "stream_available": False,
        "timeline": [],
        "packets": [],
        "matrix": [],
        "archive": [],
        "session_id": None,
        "hel_line": "HΞL-01 standing by.",
        "delegates": [],
    }

    db = AGENT_DBS[agent]
    if not db.is_file():
        empty["hel_line"] = f"{agent} has no session database."
        _TRACE_CACHE.update({"t": now, "key": key, "data": empty})
        return empty

    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=2)
        con.row_factory = sqlite3.Row
    except sqlite3.Error:
        empty["hel_line"] = "NO TELEMETRY"
        _TRACE_CACHE.update({"t": now, "key": key, "data": empty})
        return empty

    sess = None
    if run_id:
        sess = con.execute(
            "SELECT * FROM sessions WHERE id=? LIMIT 1", (run_id,)
        ).fetchone()
    if sess is None:
        sess = con.execute(
            """
            SELECT * FROM sessions
            WHERE IFNULL(archived,0)=0 AND IFNULL(hidden,0)=0
            ORDER BY IFNULL(last_activity_at,0) DESC LIMIT 1
            """
        ).fetchall()
        sess = sess[0] if sess else None
    archive_rows = con.execute(
        """
        SELECT id, title, started_at, ended_at, last_activity_at, last_activity_description,
               message_count, tool_call_count, model, source
        FROM sessions
        WHERE IFNULL(hidden,0)=0
        ORDER BY IFNULL(last_activity_at,0) DESC LIMIT ?
        """,
        (retain,),
    ).fetchall()
    archive = []
    for a in archive_rows:
        dur = None
        try:
            last_user = con.execute(
                """
                SELECT timestamp FROM messages
                WHERE session_id=? AND role='user' AND IFNULL(active,1)=1
                ORDER BY id DESC LIMIT 1
                """,
                (a["id"],),
            ).fetchone()
            last_any = con.execute(
                """
                SELECT timestamp FROM messages
                WHERE session_id=? AND IFNULL(active,1)=1
                ORDER BY id DESC LIMIT 1
                """,
                (a["id"],),
            ).fetchone()
            if last_user and last_any:
                dur = max(0, int(float(last_any["timestamp"]) - float(last_user["timestamp"])))
            elif a["ended_at"] and a["started_at"]:
                dur = max(0, int(float(a["ended_at"]) - float(a["started_at"])))
            if dur is not None and dur > 3600:
                dur = None
        except (TypeError, ValueError, sqlite3.Error):
            dur = None
        archive.append(
            {
                "id": a["id"],
                "title": _snip(a["title"] or a["last_activity_description"] or "untitled", 70),
                "t": _hhmmss(a["last_activity_at"]),
                "duration_s": dur,
                "model": a["model"],
                "source": a["source"] or "",
                "tools": a["tool_call_count"] or 0,
            }
        )

    matrix = []
    for aid, path in AGENT_DBS.items():
        row = _last_from_db(str(path))
        st = "DARK"
        if row["online"]:
            st = "WORKING"
            if (row["doing"] or "").startswith("⚙"):
                st = "TOOL"
            elif row["thinking"]:
                st = "THINKING"
        elif row["age_s"] is not None and row["age_s"] < 3600:
            st = "IDLE"
        elif path.is_file():
            st = "READY"
        matrix.append(
            {
                "id": aid,
                "label": aid.upper() if aid != "helix" else "HERMES",
                "status": st,
                "online": row["online"],
                "age_s": row["age_s"],
                "doing": row["doing"] or "",
                "title": row["title"] or "",
            }
        )

    if sess is None:
        con.close()
        empty["matrix"] = matrix
        empty["archive"] = archive
        _TRACE_CACHE.update({"t": now, "key": key, "data": empty})
        return empty

    sid = sess["id"]
    rows = con.execute(
        """
        SELECT id, role, content, tool_calls, tool_name, timestamp, token_count,
               finish_reason, reasoning, reasoning_content
        FROM messages
        WHERE session_id=? AND IFNULL(active,1)=1 AND IFNULL(_compressed_summary,0)=0
        ORDER BY id DESC LIMIT 160
        """,
        (sid,),
    ).fetchall()
    rows = list(reversed(rows))

    timeline: list[dict] = []
    stream: list[dict] = []
    packets: list[dict] = []
    lit = {s: False for s in stages}
    plan: list[str] = []
    last_tool = None
    last_result = None
    reason_sum = ""
    stream_available = False
    turn_start = None
    pending: list[dict] = []
    last_user = ""
    last_assistant_tokens = None
    last_assistant_dt = None
    prev_ts = None

    def push_packet(src: str, dst: str, ts) -> None:
        packets.append({"from": src, "to": dst, "t": _hhmmss(ts), "id": f"{src}-{dst}-{len(packets)}"})

    for r in rows:
        ts = r["timestamp"]
        clock = _hhmmss(ts)
        role = r["role"] or ""
        if role == "user":
            last_user = _cli_text(r["content"] or "", 160)
            turn_start = ts
            lit["REQUEST"] = True
            lit["INTERPRET"] = True
            timeline.append({"id": r["id"], "kind": "REQUEST", "label": "REQUEST RECEIVED", "t": clock, "summary": last_user, "detail": None})
            stream.append({"tag": "PLAN", "text": last_user[:120] or "request"})
            push_packet("command", "hermes", ts)
            continue
        if role == "tool":
            name = r["tool_name"] or "tool"
            summary = _cli_text(r["content"] or "", 160)
            dur = None
            args = None
            for i, p in enumerate(pending):
                if p["name"] == name:
                    try:
                        dur = max(0.0, float(ts) - float(p["t"]))
                    except (TypeError, ValueError):
                        dur = None
                    args = p.get("arguments")
                    pending.pop(i)
                    break
            lit["TOOL"] = True
            lit["OBSERVATION"] = True
            last_result = {"tool": name, "summary": summary, "duration_s": round(dur, 2) if dur is not None else None, "status": "OK"}
            timeline.append({
                "id": r["id"],
                "kind": "RESULT",
                "label": "TOOL RESULT",
                "t": clock,
                "summary": f"{name} // {summary[:80]}" if summary else name,
                "detail": {"tool": name, "arguments": args, "duration_s": last_result["duration_s"], "status": "OK", "result": summary},
            })
            stream.append({"tag": "RESULT", "text": f"{name} // {summary[:100]}"})
            bus = _bus_for_tool(name)
            push_packet("tool", "result", ts)
            push_packet("result", "hermes", ts)
            if bus not in ("tool", "result"):
                push_packet(bus, "hermes", ts)
            continue
        if role != "assistant":
            continue
        reason = (r["reasoning_content"] or r["reasoning"] or "").strip()
        if reason:
            stream_available = True
            reason_sum = _reason_summary(reason)
            lit["PLAN"] = True
            lit["DECISION"] = True
            if not timeline or timeline[-1].get("kind") != "PLAN":
                timeline.append({"id": f"{r['id']}-plan", "kind": "PLAN", "label": "PLAN CREATED", "t": clock, "summary": reason_sum, "detail": None})
            stream.append({"tag": "TRACE", "text": reason_sum[:120]})
            push_packet("hermes", "plan", ts)
        details = _tool_details(r["tool_calls"] or "")
        if details:
            lit["TOOL"] = True
            names = [d["name"] for d in details]
            for n in names:
                if n not in plan:
                    plan.append(n)
            last_tool = names[-1]
            for d in details:
                pending.append({"name": d["name"], "t": ts, "arguments": d.get("arguments")})
                dest = _bus_for_tool(d["name"])
                timeline.append({
                    "id": f"{r['id']}-{d['name']}",
                    "kind": "TOOL",
                    "label": f"TOOL CALL // {d['name']}",
                    "t": clock,
                    "summary": d["name"],
                    "detail": {"tool": d["name"], "arguments": d.get("arguments"), "duration_s": None, "status": "PENDING", "result": None},
                })
                stream.append({"tag": "TOOL", "text": d["name"]})
                push_packet("hermes", dest, ts)
                if dest in ("prefect", "scribe", "foreman", "canon", "adze"):
                    timeline.append({
                        "id": f"{r['id']}-del-{dest}",
                        "kind": "DELEGATE",
                        "label": f"{dest.upper()} ACTIVATED",
                        "t": clock,
                        "summary": d["name"],
                        "detail": None,
                    })
            if any(d["name"] == "delegate_task" for d in details):
                push_packet("hermes", "prefect", ts)
        reply = _cli_text(r["content"] or "", 200)
        tok = r["token_count"]
        if tok and prev_ts is not None:
            try:
                dt = float(ts) - float(prev_ts)
                if dt > 0.2 and tok > 0:
                    last_assistant_dt = dt
                    last_assistant_tokens = int(tok)
            except (TypeError, ValueError):
                pass
        if reply:
            lit["RESPONSE"] = True
            lit["DECISION"] = True
            timeline.append({"id": r["id"], "kind": "RESPONSE", "label": "RESPONSE STREAMING" if not r["finish_reason"] else "COMPLETE", "t": clock, "summary": reply[:160], "detail": None})
            stream.append({"tag": "RESPONSE", "text": "RESPONSE"})
            push_packet("hermes", "response", ts)
        prev_ts = ts

    con.close()

    age = None
    live = False
    try:
        la = sess["last_activity_at"]
        if la and float(la) > 1_000_000:
            age = max(0, int(now - float(la)))
            live = age < 180
    except (TypeError, ValueError):
        age = None

    stage = "IDLE"
    for s in reversed(stages):
        if lit[s]:
            stage = s
            break
    if live and stage == "RESPONSE":
        stage = "RESPONSE"
    elif not live and lit["RESPONSE"]:
        stage = "RESPONSE"
        lit["RESPONSE"] = True

    nxt = "NO TELEMETRY"
    order = {s: i for i, s in enumerate(stages)}
    if live:
        idx = order.get(stage, 0)
        if idx + 1 < len(stages):
            nxt = stages[idx + 1]
    desc = _snip(sess["last_activity_description"] or "", 80)
    if desc and desc.lower() not in ("", "none"):
        if live:
            nxt = desc

    tokens = None
    inn, outt = sess["input_tokens"], sess["output_tokens"]
    if inn is not None or outt is not None:
        tokens = {"in": inn, "out": outt, "reasoning": sess["reasoning_tokens"]}
    tps = None
    if last_assistant_tokens and last_assistant_dt:
        tps = round(last_assistant_tokens / last_assistant_dt, 1)

    elapsed = None
    if turn_start is not None:
        try:
            elapsed = max(0, int((sess["last_activity_at"] or now) - float(turn_start)))
        except (TypeError, ValueError):
            elapsed = age

    delegates = [m["id"] for m in matrix if m["id"] != "helix" and m["status"] in ("WORKING", "TOOL", "THINKING")]
    replay = bool(run_id)
    outcome = "WORKING" if live else ("OK" if lit.get("RESPONSE") else ("TOOL" if last_tool else "IDLE"))
    if last_result and last_result.get("status") == "OK" and not live:
        outcome = "OK"
    hel = "HΞL-01 standing by."
    label = "Hermes" if agent == "helix" else agent.title()
    if replay:
        hel = f"Replaying { _snip(sess['title'] or 'archived run', 48) }."
    elif live and last_tool:
        hel = f"{label} is using {last_tool}."
    elif live and stage in ("PLAN", "INTERPRET", "DECISION"):
        blob = f"{reason_sum} {last_user} {sess['title'] or ''}".lower()
        hel = f"{label} is analysing system telemetry." if "telemetry" in blob else f"{label} is analysing the request."
    elif delegates:
        hel = f"{delegates[0].title()} has been delegated a task."
    elif live:
        hel = f"{label} is active."
    elif lit["RESPONSE"]:
        hel = f"{label} returned to idle."

    data = {
        "agent": agent,
        "live": live,
        "stage": stage if live or any(lit.values()) else "IDLE",
        "stages": lit,
        "objective": _snip(sess["title"] or last_user or "", 90),
        "plan": plan[:8],
        "tool": last_tool,
        "result": last_result,
        "next": nxt,
        "elapsed_s": elapsed if elapsed is not None else age,
        "model": sess["model"] or None,
        "tokens": tokens,
        "tokens_per_s": tps,
        "reasoning_summary": reason_sum,
        "stream": stream[-40:],
        "stream_available": stream_available,
        "timeline": timeline[-80:],
        "packets": packets[-24:],
        "matrix": matrix,
        "archive": archive,
        "session_id": sid,
        "hel_line": hel,
        "delegates": delegates,
        "source": sess["source"] or "",
        "replay": replay,
        "outcome": outcome,
    }
    _TRACE_CACHE.update({"t": now, "key": key, "data": data})
    return data


def collect() -> dict:
    t0 = time.time()
    _, ver = run([HERMES, "--version"], 6)
    _, model_cfg = run([HERMES, "config", "get", "model"], 6)
    _, prov_cfg = run([HERMES, "config", "get", "model.provider"], 6)
    version = None
    commits_behind = None
    m = re.search(r"Hermes Agent (v[\d.]+)", ver)
    if m:
        version = m.group(1)
    m = re.search(r"(\d+) commits behind", ver)
    if m:
        commits_behind = int(m.group(1))
    model_name = None
    mm = re.search(r"default:\s+(\S+)", model_cfg)
    if mm:
        model_name = mm.group(1)
    provider_name = (prov_cfg or "").strip() or None
    _, plist = run([HERMES, "profile", "list"], 10)
    _, gw = run([HERMES, "gateway", "status"], 6)
    _, sstats = run([HERMES, "sessions", "stats"], 8)
    _, slist = run([HERMES, "sessions", "list"], 8)
    _, peers = run([HERMES, "peer", "list"], 6)
    _, mem = run([HERMES, "memory", "status"], 8)
    _, cron = run([HERMES, "cron", "list"], 6)
    _, dash = run([HERMES, "dashboard", "--status"], 6)
    _, kstats = run([HERMES, "kanban", "stats"], 6)
    mem_provider = None
    mm = re.search(r"Provider:\s+(\S+)", mem)
    if mm:
        mem_provider = mm.group(1)
    gw_running = (
        "Gateway is running" in gw
        or "supervised by launchd" in gw
        or ("✓" in gw and "running" in gw.lower())
    )
    gw_pid = None
    pm = re.search(r"PID:?\s*(\d+)", gw)
    if pm:
        gw_pid = int(pm.group(1))
    peer_rows = []
    for line in peers.splitlines():
        if not line.strip() or line.startswith("usage:"):
            continue
        # unraid\thttp://...\t[key set] — desc
        bits = line.split("\t")
        if bits:
            peer_rows.append(
                {
                    "name": bits[0].strip(),
                    "url": bits[1].strip() if len(bits) > 1 else "",
                    "note": re.sub(r"\[key set\]\s*—\s*", "", bits[2]).strip() if len(bits) > 2 else "",
                }
            )
    local_svcs = {
        "webui": http_code("http://127.0.0.1:8787/health"),
        "hermes_dashboard": http_code("http://127.0.0.1:9119/"),
        "honcho": http_code(f"http://{UNRAID}:8000/health"),
        "control_deck": http_code("http://127.0.0.1:4240/"),
        "command_board": http_code(f"http://{UNRAID}:8788/"),
    }
    cron_jobs = 0 if "No scheduled jobs" in cron else len(
        [ln for ln in cron.splitlines() if ln.strip() and not ln.startswith("No ")]
    )
    gw_running = (
        "Gateway is running" in gw
        or "supervised by launchd" in gw
        or ("✓" in gw and "running" in gw.lower())
    )
    actions = action_queue(gw_running, kstats, cron_jobs, local_svcs)
    profiles = parse_profiles(plist)
    sess = parse_sessions_stats(sstats)
    hosts = [mac_host(), *lan_hosts()]
    cache_fleet_cpu(hosts)
    ts = tailscale()
    return {
        "collected_at": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "collect_ms": int((time.time() - t0) * 1000),
        "hermes": {
            "version": version,
            "commits_behind": commits_behind,
            "model": model_name,
            "provider": provider_name,
            "memory": mem_provider,
            "gateway_running": gw_running,
            "gateway_pid": gw_pid,
            "dashboard": dash.splitlines()[0] if dash else "",
            "cron_jobs": cron_jobs,
            "kanban": kstats,
        },
        "profiles": profiles,
        "peers": peer_rows,
        "sessions": sess,
        "recent_sessions": parse_session_rows(slist),
        "hosts": hosts,
        "network": net_stats(),
        "bot_mesh": bot_mesh(profiles, peer_rows, gw_running, local_svcs, sess),
        "tailscale": ts,
        "local_services": local_svcs,
        "actions": actions,
        "security": security_now(gw_running, local_svcs, ts, hosts),
        "mindscape": mindscape(),
    }


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        return

    def _send(self, code: int, body: bytes, ctype: str, extra: list[tuple[str, str]] | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in extra or []:
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _prefix(self) -> str:
        raw = self.path.split("?", 1)[0]
        if raw == "/ops" or raw.startswith("/ops/"):
            return "/ops"
        host = (self.headers.get("Host") or "").lower()
        if "ts.net" in host:
            return "/ops"
        return ""

    def _canon(self) -> str:
        p = self.path.split("?", 1)[0]
        if p == "/ops":
            return "/"
        if p.startswith("/ops/"):
            p = p[4:]
        return p or "/"

    def _https(self) -> bool:
        xf = (self.headers.get("X-Forwarded-Proto") or "").lower()
        host = (self.headers.get("Host") or "").lower()
        return xf == "https" or "ts.net" in host

    def _login_page(self, err: str = "") -> bytes:
        setup = setup_needed()
        pfx = self._prefix()
        html = (ROOT / "login.html").read_text(encoding="utf-8")
        html = html.replace("__PREFIX__", pfx or "")
        html = html.replace("__ERR__", err)
        html = html.replace("__TITLE__", "SET PASSWORD" if setup else "LOGIN")
        html = html.replace("__WELCOME__", "SET YOUR PASSWORD" if setup else "ようこそ · AUTHORIZED PERSONNEL")
        html = html.replace("__HINT__", "Choose a login and password on this page. It stays on the Mini.")
        html = html.replace("__SETUP_DISP__", "block" if setup else "none")
        html = html.replace("__LOGIN_DISP__", "none" if setup else "block")
        return html.encode("utf-8")

    def _cookie(self, token: str | None) -> str:
        extra = "; Secure" if self._https() else ""
        if not token:
            return f"helix_ops=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax{extra}"
        return f"helix_ops={token}; Path=/; Max-Age={SESSION_TTL}; HttpOnly; SameSite=Lax{extra}"

    def _need_auth(self, path: str, method: str) -> bool:
        if auth_open():
            return False
        if path in ("/login", "/logout", "/health"):
            return False
        if method == "POST" and path == "/api/protect/hook":
            return False
        return True

    def _gate(self, path: str, method: str) -> bool:
        if not self._need_auth(path, method):
            return True
        if session_user(self):
            return True
        pfx = self._prefix()
        if path.startswith("/api/"):
            self._send(401, b'{"error":"login"}', "application/json; charset=utf-8")
        else:
            self._send(302, b"", "text/plain", [("Location", f"{pfx}/login" if pfx else "/login")])
        return False

    def do_GET(self):
        raw = self.path
        path = self._canon()
        qs = parse_qs(raw.split("?", 1)[1]) if "?" in raw else {}
        pfx = self._prefix()
        if path == "/login":
            if auth_open():
                self._send(302, b"", "text/plain", [("Location", f"{pfx}/" if pfx else "/")])
                return
            self._send(200, self._login_page(), "text/html; charset=utf-8")
            return
        if path == "/logout":
            rawc = self.headers.get("Cookie") or ""
            jar = SimpleCookie()
            try:
                jar.load(rawc)
            except Exception:
                pass
            tok = jar.get("helix_ops")
            if tok:
                drop_session(tok.value)
            self._send(302, b"", "text/plain", [("Location", f"{pfx}/login" if pfx else "/login"), ("Set-Cookie", self._cookie(None))])
            return
        if not self._gate(path, "GET"):
            return
        if path in ("/", "/index.html"):
            html = (ROOT / "index.html").read_bytes()
            self._send(200, html, "text/html; charset=utf-8")
            return
        if path == "/mindscape.js":
            js = (ROOT / "mindscape.js").read_bytes()
            self._send(200, js, "application/javascript; charset=utf-8")
            return
        static = {
            "/helix-ops-wordmark.js": ("helix-ops-wordmark.js", "application/javascript; charset=utf-8"),
            "/helix-ops-wordmark.css": ("helix-ops-wordmark.css", "text/css; charset=utf-8"),
            "/helix-ops-wordmark.svg": ("helix-ops-wordmark.svg", "image/svg+xml"),
            "/helix-ops-slash.svg": ("helix-ops-slash.svg", "image/svg+xml"),
            "/helix-core-mark.svg": ("helix-core-mark.svg", "image/svg+xml"),
            "/helix-crt.css": ("helix-crt.css", "text/css; charset=utf-8"),
            "/helix-noc.css": ("helix-noc.css", "text/css; charset=utf-8"),
            "/helix-noc.js": ("helix-noc.js", "application/javascript; charset=utf-8"),
            "/helix-field.css": ("helix-field.css", "text/css; charset=utf-8"),
            "/helix-trace.css": ("helix-trace.css", "text/css; charset=utf-8"),
            "/helix-trace.js": ("helix-trace.js", "application/javascript; charset=utf-8"),
            "/helix-adze.css": ("helix-adze.css", "text/css; charset=utf-8"),
            "/helix-adze.js": ("helix-adze.js", "application/javascript; charset=utf-8"),
            "/helix-remote.css": ("helix-remote.css", "text/css; charset=utf-8"),
            "/helix-remote.js": ("helix-remote.js", "application/javascript; charset=utf-8"),
        }
        if path in static:
            name, ctype = static[path]
            self._send(200, (ROOT / name).read_bytes(), ctype)
            return
        if path.startswith("/api/stats"):
            try:
                data = collect()
                body = json.dumps(data, ensure_ascii=False).encode()
                self._send(200, body, "application/json; charset=utf-8")
            except Exception as e:
                body = json.dumps({"error": type(e).__name__}).encode()
                self._send(500, body, "application/json")
            return
        if path == "/api/mindscape/graph":
            g = load_ms_graph()
            if not g["nodes"]:
                g = seed_ms_graph().get("graph") or g
            self._send(200, json.dumps(g, ensure_ascii=False).encode(), "application/json; charset=utf-8")
            return
        if path == "/api/thoughts":
            self._send(
                200,
                json.dumps({"items": thoughts_feed()}, ensure_ascii=False).encode(),
                "application/json; charset=utf-8",
            )
            return
        if path == "/api/agents":
            self._send(
                200,
                json.dumps(agents_now(), ensure_ascii=False).encode(),
                "application/json; charset=utf-8",
            )
            return
        if path == "/api/trace":
            agent = (qs.get("agent") or ["helix"])[0]
            run = (qs.get("run") or [""])[0]
            retain = (qs.get("retain") or ["24"])[0]
            self._send(
                200,
                json.dumps(cognitive_trace(agent, run, retain), ensure_ascii=False).encode(),
                "application/json; charset=utf-8",
            )
            return
        if path == "/api/adze":
            try:
                from adze_orchestrator import load_env, status as adze_status

                load_env()
                payload = adze_status()
            except Exception:
                payload = {"online": False, "state": "ADZE // OFFLINE", "key_present": False}
            self._send(
                200,
                json.dumps(payload, ensure_ascii=False).encode(),
                "application/json; charset=utf-8",
            )
            return
        if path == "/api/talk":
            self._send(
                200,
                json.dumps(bot_talk(), ensure_ascii=False).encode(),
                "application/json; charset=utf-8",
            )
            return
        if path == "/api/herdr":
            self._send(
                200,
                json.dumps(herdr_now(), ensure_ascii=False).encode(),
                "application/json; charset=utf-8",
            )
            return
        if path == "/api/memory":
            self._send(
                200,
                json.dumps(memory_files(), ensure_ascii=False).encode(),
                "application/json; charset=utf-8",
            )
            return
        if path == "/api/skills":
            name = (qs.get("name") or [""])[0]
            payload = skill_body(name) if name else skills_index()
            code = 400 if payload.get("error") else 200
            self._send(
                code,
                json.dumps(payload, ensure_ascii=False).encode(),
                "application/json; charset=utf-8",
            )
            return
        if path == "/api/compute":
            self._send(
                200,
                json.dumps(compute_now(), ensure_ascii=False).encode(),
                "application/json; charset=utf-8",
            )
            return
        if path == "/api/btop":
            self._send(
                200,
                json.dumps(fleet_btop(), ensure_ascii=False).encode(),
                "application/json; charset=utf-8",
            )
            return
        if path == "/api/clients":
            self._send(
                200,
                json.dumps(lan_clients(), ensure_ascii=False).encode(),
                "application/json; charset=utf-8",
            )
            return
        if path == "/api/docker":
            self._send(
                200,
                json.dumps(docker_list(), ensure_ascii=False).encode(),
                "application/json; charset=utf-8",
            )
            return
        if path == "/api/remote":
            self._send(
                200,
                json.dumps(remote_now(), ensure_ascii=False).encode(),
                "application/json; charset=utf-8",
            )
            return
        if path == "/api/git":
            self._send(
                200,
                json.dumps(git_now(), ensure_ascii=False).encode(),
                "application/json; charset=utf-8",
            )
            return
        if path == "/api/protect":
            self._send(
                200,
                json.dumps(protect_status(), ensure_ascii=False).encode(),
                "application/json; charset=utf-8",
            )
            return
        if path.startswith("/api/protect/snapshot/"):
            cid = path.rsplit("/", 1)[-1].split("?", 1)[0]
            code, body, ctype = protect_snapshot(cid)
            self._send(code, body, ctype)
            return
        if path == "/health":
            self._send(200, b'{"ok":true}', "application/json")
            return
        self._send(404, b"not found", "text/plain")

    def do_POST(self):
        path = self._canon()
        pfx = self._prefix()
        if path == "/login":
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(max(0, min(n, 4000))).decode("utf-8", "replace")
            form = parse_qs(raw)
            user = (form.get("user") or [""])[0]
            password = (form.get("password") or [""])[0]
            password2 = (form.get("password2") or [""])[0]
            if setup_needed():
                if len(password) < 8:
                    self._send(400, self._login_page("PASSWORD TOO SHORT (8+)"), "text/html; charset=utf-8")
                    return
                if password != password2:
                    self._send(400, self._login_page("PASSWORDS DO NOT MATCH"), "text/html; charset=utf-8")
                    return
                write_ops_password(user, password)
                tok = new_session(user.strip() or "helix")
                self._send(
                    302,
                    b"",
                    "text/plain",
                    [("Location", f"{pfx}/" if pfx else "/"), ("Set-Cookie", self._cookie(tok))],
                )
                return
            if check_login(user, password):
                tok = new_session(user)
                self._send(
                    302,
                    b"",
                    "text/plain",
                    [("Location", f"{pfx}/" if pfx else "/"), ("Set-Cookie", self._cookie(tok))],
                )
                return
            self._send(401, self._login_page("ACCESS DENIED"), "text/html; charset=utf-8")
            return
        if not self._gate(path, "POST"):
            return
        if path == "/api/mindscape/seed":
            body = json.dumps(seed_ms_graph(force=True), ensure_ascii=False).encode()
            self._send(200, body, "application/json; charset=utf-8")
            return
        if path == "/api/prompt":
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(max(0, min(n, 8000)))
            try:
                data = json.loads(raw.decode() or "{}")
            except json.JSONDecodeError:
                data = {}
            text = _snip(str(data.get("text") or "").strip(), 400)
            if not text or text == "[redacted]":
                self._send(400, b'{"ok":false}', "application/json")
                return
            rec = {"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "text": text}
            with PROMPT_LOG.open("a") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            self._send(200, json.dumps({"ok": True, "item": rec}, ensure_ascii=False).encode(), "application/json; charset=utf-8")
            return
        if path == "/api/docker":
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(max(0, min(n, 2000)))
            try:
                data = json.loads(raw.decode() or "{}")
            except json.JSONDecodeError:
                data = {}
            body = json.dumps(docker_act(str(data.get("name") or ""), str(data.get("action") or "")), ensure_ascii=False).encode()
            self._send(200, body, "application/json; charset=utf-8")
            return
        if path == "/api/remote":
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(max(0, min(n, 2000)))
            try:
                data = json.loads(raw.decode() or "{}")
            except json.JSONDecodeError:
                data = {}
            ip = self.client_address[0] if self.client_address else ""
            body = json.dumps(remote_act(data if isinstance(data, dict) else {}, ip), ensure_ascii=False).encode()
            self._send(200, body, "application/json; charset=utf-8")
            return
        if path == "/api/protect/hook":
            n = int(self.headers.get("Content-Length") or 0)
            raw = self.rfile.read(max(0, min(n, 16000)))
            try:
                data = json.loads(raw.decode() or "{}")
            except json.JSONDecodeError:
                data = {}
            kind = str(
                data.get("type")
                or data.get("event")
                or (data.get("item") or {}).get("type")
                or "event"
            )
            cam = str(
                data.get("camera")
                or data.get("device")
                or (data.get("item") or {}).get("camera")
                or ""
            )
            protect_record(cam, kind, str(data.get("name") or "")[:80])
            self._send(200, b'{"ok":true}', "application/json")
            return
        self._send(404, b"not found", "text/plain")


def main():
    ensure_ops_auth()
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    httpd.serve_forever()


if __name__ == "__main__":
    main()
