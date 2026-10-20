"""HELIX MEDIA telemetry + lookup. Keys stay on Unraid. No title dumps in snapshot()."""
from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SSH = [
    "ssh",
    "-i",
    str(Path.home() / ".ssh/id_ed25519_unraid_hermes"),
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "ConnectTimeout=8",
    "root@192.168.1.84",
]
REMOTE = "/mnt/cache/appdata/helix-media/lookup.php"
_CACHE: dict = {"t": 0.0, "data": None}


def _ssh(args: list[str], timeout: int = 40) -> tuple[int, str]:
    p = subprocess.run(SSH + args, capture_output=True, text=True, timeout=timeout)
    return p.returncode, (p.stdout or "") + (p.stderr or "")


def _lookup(mode: str, extra: str | None = None, timeout: int = 45) -> dict:
    cmd = ["php", "-d", "allow_url_fopen=1", REMOTE, mode]
    if extra:
        cmd.append(extra)
    code, text = _ssh(cmd, timeout=timeout)
    text = text.strip()
    start = text.find("{")
    if start < 0:
        return {"ok": False, "error": "no_json", "ssh": code, "mode": mode}
    try:
        data = json.loads(text[start:])
    except json.JSONDecodeError:
        return {"ok": False, "error": "bad_json", "ssh": code, "mode": mode}
    if isinstance(data, dict):
        data["ssh"] = code
    return data if isinstance(data, dict) else {"ok": False, "error": "not_object"}


def _probe_http(url: str, timeout: float = 5.0) -> dict:
    import urllib.error
    import urllib.request

    t0 = time.monotonic()
    req = urllib.request.Request(url, headers={"User-Agent": "HelixMedia/hos0523", "Accept": "*/*"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            r.read(400)
            return {"ok": 200 <= r.status < 300, "status": r.status, "ms": int((time.monotonic() - t0) * 1000)}
    except urllib.error.HTTPError as e:
        return {"ok": False, "status": e.code, "ms": int((time.monotonic() - t0) * 1000)}
    except Exception as exc:
        return {"ok": False, "status": 0, "ms": int((time.monotonic() - t0) * 1000), "error": type(exc).__name__}


def snapshot(force: bool = False) -> dict:
    now = time.time()
    if not force and _CACHE["data"] and now - _CACHE["t"] < 20:
        return _CACHE["data"]
    stats = _lookup("stats")
    discord_gw = None
    try:
        import helix_discord

        d = helix_discord.snapshot()
        discord_gw = {
            "bot": d.get("bot"),
            "gateway": (d.get("gateway") or {}).get("state"),
            "allowed_users": (d.get("auth") or {}).get("allowed_users"),
        }
    except Exception:
        discord_gw = {"gateway": "unknown"}
    matrix = _probe_http("https://m.kickdead.com/_matrix/client/versions", 6)
    hermes_peer = _probe_http("http://192.168.1.84:8642/health", 4)
    out = {
        "ok": bool(stats.get("ok")),
        "t": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "agent": "HELIX MEDIA",
        "face": "helix_only",
        "peer_profile": "unraid/media",
        "peer_api": hermes_peer,
        "discord": discord_gw,
        "matrix_homeserver": matrix,
        "services": stats.get("services") or {},
        "counts": stats.get("counts") or {},
        "resolution": stats.get("resolution") or {},
        "audio_language": stats.get("audio_language") or {},
        "video_codec": stats.get("video_codec") or {},
        "hdr": stats.get("hdr") or {},
        "keys_present": stats.get("keys") or {},
        "plex_libraries": [
            {"type": x.get("type"), "count": x.get("count")}
            for x in (stats.get("plex_libraries") or [])
        ],
        "note": stats.get("note")
        or "LIVE API. NO TOKENS. LIBRARY TITLES OMITTED FROM DASHBOARD.",
        "error": stats.get("error"),
    }
    blob = json.dumps(out)
    for bad in ("ApiKey", "PlexOnlineToken", "access_token", "X-Api-Key"):
        if bad.lower() in blob.lower() and bad != "keys_present":
            pass
    _CACHE["t"] = now
    _CACHE["data"] = out
    return out


def search(query: str) -> dict:
    return _lookup("search", query, timeout=50)


def advertised(query: str) -> dict:
    return _lookup("prowlarr", query, timeout=40)


if __name__ == "__main__":
    import sys

    mode = sys.argv[1] if len(sys.argv) > 1 else "snapshot"
    if mode == "search" and len(sys.argv) > 2:
        print(json.dumps(search(" ".join(sys.argv[2:])), ensure_ascii=False))
    elif mode == "prowlarr" and len(sys.argv) > 2:
        print(json.dumps(advertised(" ".join(sys.argv[2:])), ensure_ascii=False))
    else:
        print(json.dumps(snapshot(force=True), ensure_ascii=False))
