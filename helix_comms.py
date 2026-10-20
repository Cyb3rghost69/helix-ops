"""Matrix COMMS telemetry for Helix OS. Real probes only. No tokens, bodies, or family text."""
from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HERMES_HOME = Path.home() / ".hermes"
ENV_FILE = HERMES_HOME / ".env"
STATE_DB = HERMES_HOME / "state.db"
HIST = ROOT / "comms-hist.json"
LAN = "http://192.168.1.84:6167"
PUB = "https://m.kickdead.com"
BOT_MXID = "@hermes:m.kickdead.com"
SECRETISH = re.compile(r"(password|passwd|token|api[_-]?key|secret|bearer|recovery)", re.I)
_CACHE: dict = {"t": 0.0, "data": None}


def _probe(url: str, timeout: float = 6.0) -> dict:
    t0 = time.monotonic()
    req = urllib.request.Request(
        url,
        method="GET",
        headers={"User-Agent": "HelixOps/hos0521", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read(8000)
            ms = int((time.monotonic() - t0) * 1000)
            return {"ok": 200 <= r.status < 300, "status": r.status, "ms": ms, "bytes": len(body)}
    except urllib.error.HTTPError as e:
        ms = int((time.monotonic() - t0) * 1000)
        return {"ok": False, "status": e.code, "ms": ms, "bytes": 0}
    except Exception as exc:
        ms = int((time.monotonic() - t0) * 1000)
        return {"ok": False, "status": 0, "ms": ms, "error": type(exc).__name__}


def _env_map() -> dict[str, str]:
    out: dict[str, str] = {}
    if not ENV_FILE.is_file():
        return out
    for line in ENV_FILE.read_text(encoding="utf-8", errors="replace").splitlines():
        s = line.strip()
        if not s or s.startswith("#") or "=" not in s:
            continue
        k, _, v = s.partition("=")
        if k.startswith("MATRIX_"):
            out[k] = v.strip().strip('"').strip("'")
    return out


def _gateway_matrix() -> dict:
    hermes = os.path.expanduser("~/.hermes/hermes-agent/venv/bin/hermes")
    cmd = [hermes if os.path.isfile(hermes) else "hermes", "gateway", "status"]
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=8)
        text = (p.stdout or "") + "\n" + (p.stderr or "")
        text = SECRETISH.sub("REDACTED", text)
        low = text.lower()
        enabled = "platforms.matrix.enabled" in Path.home().joinpath(".hermes/config.yaml").read_text(
            encoding="utf-8", errors="replace"
        )
        connected = ("matrix" in low) and any(w in low for w in ("connected", "online", "listening", "sync"))
        mentioned = "matrix" in low
        return {
            "ok": p.returncode == 0,
            "mentioned": mentioned,
            "connected": bool(connected),
            "enabled_yaml": "matrix:\n    enabled: true" in Path.home().joinpath(".hermes/config.yaml").read_text(
                encoding="utf-8", errors="replace"
            ) or enabled,
            "note": "GATEWAY OFF UNTIL TERMINAL RESTART" if not mentioned else "SEEN IN STATUS",
        }
    except Exception as exc:
        return {"ok": False, "mentioned": False, "connected": False, "error": type(exc).__name__}


def _session_counts() -> dict:
    if not STATE_DB.is_file():
        return {"sessions": None, "quality": "UNAVAILABLE"}
    try:
        con = sqlite3.connect(f"file:{STATE_DB}?mode=ro", uri=True, timeout=1)
        try:
            cols = [r[1] for r in con.execute("PRAGMA table_info(sessions)").fetchall()]
            if not cols:
                return {"sessions": None, "quality": "NO_TABLE"}
            n = 0
            if "source" in cols:
                n = con.execute(
                    "SELECT COUNT(*) FROM sessions WHERE CAST(source AS TEXT) LIKE '%matrix%'"
                ).fetchone()[0]
            elif "platform" in cols:
                n = con.execute(
                    "SELECT COUNT(*) FROM sessions WHERE platform = 'matrix'"
                ).fetchone()[0]
            return {"sessions": int(n), "quality": "LIVE"}
        finally:
            con.close()
    except Exception:
        return {"sessions": None, "quality": "UNAVAILABLE"}


def _hist_push(lan_ms: int | None, pub_ms: int | None) -> list:
    rows: list = []
    if HIST.is_file():
        try:
            rows = json.loads(HIST.read_text(encoding="utf-8"))
            if not isinstance(rows, list):
                rows = []
        except Exception:
            rows = []
    rows.append({"t": int(time.time()), "lan_ms": lan_ms, "pub_ms": pub_ms})
    rows = rows[-60:]
    try:
        HIST.write_text(json.dumps(rows), encoding="utf-8")
    except Exception:
        pass
    return rows


def snapshot(force: bool = False) -> dict:
    now = time.time()
    if not force and _CACHE["data"] and now - _CACHE["t"] < 8:
        return _CACHE["data"]
    env = _env_map()
    lan_v = _probe(LAN + "/_matrix/client/versions")
    pub_v = _probe(PUB + "/_matrix/client/versions")
    wk = _probe(PUB + "/.well-known/matrix/client")
    fed = _probe(PUB + "/_matrix/federation/v1/version")
    gw = _gateway_matrix()
    sess = _session_counts()
    hist = _hist_push(lan_v.get("ms"), pub_v.get("ms"))
    e2ee = env.get("MATRIX_E2EE_MODE") or "unset"
    allow_all = env.get("MATRIX_ALLOW_ALL_USERS", "false").lower() in ("1", "true", "yes")
    has_token = bool(env.get("MATRIX_ACCESS_TOKEN"))
    has_user = env.get("MATRIX_USER_ID") == BOT_MXID
    homeserver = env.get("MATRIX_HOMESERVER") == PUB
    hs_ok = bool(lan_v.get("ok"))
    cf_ok = bool(pub_v.get("ok"))
    fed_closed = fed.get("status") in (401, 403, 404)
    data = {
        "ok": hs_ok and cf_ok,
        "homeserver": {
            "name": "m.kickdead.com",
            "lan": LAN,
            "public": PUB,
            "lan_versions": lan_v,
            "status": "UP" if hs_ok else "DOWN",
        },
        "cloudflare": {
            "endpoint": PUB,
            "versions": pub_v,
            "well_known": wk,
            "status": "UP" if cf_ok else "DOWN",
        },
        "federation": {
            "enabled": False,
            "version_status": fed.get("status"),
            "closed": fed_closed,
        },
        "registration_public": False,
        "gateway": {
            "enabled_yaml": bool(gw.get("enabled_yaml")),
            "connected": bool(gw.get("connected")),
            "mentioned": bool(gw.get("mentioned")),
            "status": "ONLINE" if gw.get("connected") else "CONFIGURED_OFF",
            "note": gw.get("note") or gw.get("error") or "",
        },
        "bot": {
            "mxid": BOT_MXID if has_user else "UNSET",
            "homeserver_configured": homeserver,
            "token_present": has_token,
            "e2ee_mode": e2ee,
            "allow_all_users": allow_all,
            "privileged_users": 0,
            "home_room": "SET" if env.get("MATRIX_HOME_ROOM") else "UNSET",
            "allowed_rooms": "COMMAND_ONLY" if env.get("MATRIX_ALLOWED_ROOMS") else "UNSET",
        },
        "traffic": {
            "matrix_sessions": sess.get("sessions"),
            "session_quality": sess.get("quality"),
            "hist": hist,
        },
        "encryption": {
            "mode": e2ee,
            "recovery_file_configured": bool(env.get("MATRIX_RECOVERY_KEY_OUTPUT_FILE")),
        },
        "errors": [
            x
            for x in (
                None if hs_ok else "LAN VERSIONS FAIL",
                None if cf_ok else "PUBLIC VERSIONS FAIL",
                None if wk.get("ok") else "WELL-KNOWN FAIL",
                None if fed_closed else "FEDERATION NOT CLOSED",
                None if not allow_all else "ALLOW_ALL IS ON",
                None if gw.get("connected") else "GATEWAY NOT LIVE",
            )
            if x
        ],
        "topology": [
            {"id": "tuwunel", "label": "TUWUNEL", "ok": hs_ok},
            {"id": "cloudflare", "label": "CF m.kickdead.com", "ok": cf_ok},
            {"id": "bot", "label": BOT_MXID, "ok": has_token and has_user},
            {"id": "gateway", "label": "HERMES MATRIX GW", "ok": bool(gw.get("connected"))},
            {"id": "helix", "label": "HELIX OS", "ok": True},
        ],
        "family_isolated": True,
        "t": int(now),
    }
    _CACHE["t"] = now
    _CACHE["data"] = data
    return data
