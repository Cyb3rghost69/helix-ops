"""Discord gateway telemetry. Real files only. No tokens."""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

HOME = Path.home() / ".hermes"
STATE = HOME / "gateway_state.json"
ENV = HOME / ".env"
LOG = HOME / "logs" / "gateway.log"
_CACHE: dict = {"t": 0.0, "data": None}
SECRETISH = re.compile(r"(token|password|secret|bearer)", re.I)


def _env_discord() -> dict:
    out: dict[str, str] = {}
    if not ENV.is_file():
        return out
    for line in ENV.read_text(encoding="utf-8", errors="replace").splitlines():
        if not line.startswith("DISCORD_") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k] = v.strip()
    return out


def _csv_n(val: str) -> int:
    return len([x for x in (val or "").split(",") if x.strip()])


def snapshot(force: bool = False) -> dict:
    now = time.time()
    if not force and _CACHE["data"] and now - _CACHE["t"] < 8:
        return _CACHE["data"]
    env = _env_discord()
    gw = {}
    if STATE.is_file():
        try:
            raw = json.loads(STATE.read_text(encoding="utf-8"))
            gw = (raw.get("platforms") or {}).get("discord") or {}
        except Exception:
            gw = {}
    connected = str(gw.get("state") or "") == "connected"
    allow_all = env.get("DISCORD_ALLOW_ALL_USERS", "").lower() in ("1", "true", "yes")
    last_err = ""
    reconn = 0
    unauth = 0
    last_ok = ""
    if LOG.is_file():
        try:
            tail = LOG.read_text(encoding="utf-8", errors="replace")[-200000:]
        except Exception:
            tail = ""
        unauth = tail.count("Unauthorized user") and tail.count("on discord")
        reconn = tail.count("Reconnecting discord")
        for line in reversed(tail.splitlines()):
            if "Connected as skynet" in line and not last_ok:
                last_ok = line[:19]
            if "Unauthorized user" in line and "discord" in line and not last_err:
                last_err = "UNAUTHORIZED_USER"
            if "discord_websocket" in line and not last_err:
                last_err = "WEBSOCKET_STALE"
        unauth = len([ln for ln in tail.splitlines() if "Unauthorized user" in ln and "discord" in ln])
    data = {
        "ok": connected,
        "bot": "skynet#5090" if connected or last_ok else "UNKNOWN",
        "gateway": {
            "state": gw.get("state") or "UNKNOWN",
            "needs_attention": bool(gw.get("needs_attention")),
            "updated_at": gw.get("updated_at") or "",
        },
        "auth": {
            "token_present": bool(env.get("DISCORD_BOT_TOKEN")),
            "allow_all_users": allow_all,
            "allowed_users": _csv_n(env.get("DISCORD_ALLOWED_USERS", "")),
            "allowed_channels": _csv_n(env.get("DISCORD_ALLOWED_CHANNELS", "")),
            "home_channel": bool(env.get("DISCORD_HOME_CHANNEL")),
        },
        "routing": {
            "provider": "xai-oauth",
            "model": "grok-4.6",
        },
        "errors": {
            "last": last_err or ("NONE" if connected else "NOT_CONNECTED"),
            "unauthorized_log": unauth,
            "reconnects_log": reconn,
        },
        "last_connected": last_ok or None,
        "sessions_discord": 0,
        "note": "INBOUND ALLOWLIST ON DISK; GATEWAY RESTART REQUIRED IN MAC TERMINAL",
        "t": int(now),
    }
    _CACHE["t"] = now
    _CACHE["data"] = data
    return data
