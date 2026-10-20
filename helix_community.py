"""Helix Community Bot telemetry. No chat bodies, no tokens."""
from __future__ import annotations

import json
import time
from pathlib import Path

HOME = Path.home() / ".hermes"
PROF = HOME / "profiles" / "community"
_CACHE: dict = {"t": 0.0, "data": None}


def _yaml_get(text: str, key: str) -> str | None:
    for line in text.splitlines():
        s = line.strip()
        if s.startswith(key + ":"):
            return s.split(":", 1)[1].strip()
    return None


def snapshot(force: bool = False) -> dict:
    now = time.time()
    if not force and _CACHE["data"] and now - _CACHE["t"] < 15:
        return _CACHE["data"]
    cfg = (PROF / "config.yaml").read_text(encoding="utf-8", errors="replace") if (PROF / "config.yaml").is_file() else ""
    env_keys = []
    if (PROF / ".env").is_file():
        for line in (PROF / ".env").read_text(encoding="utf-8", errors="replace").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                env_keys.append(line.split("=", 1)[0])
    tools = []
    in_m = False
    for line in cfg.splitlines():
        if line.strip() == "matrix:":
            in_m = True
            continue
        if in_m:
            if line.startswith("  ") and line.strip().startswith("- "):
                tools.append(line.strip()[2:])
            elif line.strip() and not line.startswith(" "):
                in_m = False
            elif line.startswith("  ") and not line.strip().startswith("-") and line.strip().endswith(":"):
                if tools:
                    break
    # simpler: known matrix toolsets block
    matrix_tools = []
    grab = False
    for i, line in enumerate(cfg.splitlines()):
        if line == "  matrix:" and i > 0 and "platform_toolsets:" in cfg:
            grab = True
            continue
        if grab:
            if line.startswith("    - "):
                matrix_tools.append(line.strip()[2:])
            else:
                if matrix_tools:
                    break
                grab = False
    sessions = 0
    db = PROF / "state.db"
    if db.is_file():
        import sqlite3
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            sessions = con.execute("select count(*) from sqlite_master").fetchone()[0]
            try:
                sessions = con.execute("select count(*) from sessions").fetchone()[0]
            except Exception:
                pass
            con.close()
        except Exception:
            sessions = 0
    privileged = {"terminal", "file", "browser", "computer_use", "delegation", "cronjob", "skills", "docker"}
    out = {
        "ok": True,
        "t": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "agent": "Helix Community Bot",
        "mxid": "@community:m.kickdead.com",
        "room": "#home:m.kickdead.com",
        "provider": _yaml_get(cfg, "provider") or "xai-oauth",
        "model": _yaml_get(cfg, "default") or "grok-4.6",
        "telegram": False,
        "discord": False,
        "matrix_enabled_yaml": "enabled: true" in cfg,
        "gateway_live": False,
        "note": "MATRIX ADAPTER LIVE AFTER MAC TERMINAL hermes gateway restart",
        "tools_matrix": matrix_tools,
        "tools_privileged_present": sorted(privileged.intersection(matrix_tools)),
        "isolation": {
            "honcho_memory": False,
            "env_has_telegram": "TELEGRAM_BOT_TOKEN" in env_keys,
            "env_has_discord": "DISCORD_BOT_TOKEN" in env_keys,
            "separate_mxid": True,
        },
        "sessions_db_ok": db.is_file(),
        "mention_only": True,
        "rate_limit": "gateway_default",
    }
    blob = json.dumps(out)
    if "MATRIX_ACCESS_TOKEN" in blob or "sk-" in blob:
        out = {"ok": False, "error": "refused_secret_leak"}
    _CACHE["t"] = now
    _CACHE["data"] = out
    return out
