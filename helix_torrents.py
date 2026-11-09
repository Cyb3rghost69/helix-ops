#!/usr/bin/env python3
"""qBit list/control + Prowlarr search + Sonarr/Radarr grab. Keys stay in-process."""
from __future__ import annotations

import json
import os
import re
import subprocess
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from http.cookiejar import CookieJar

UNRAID = "192.168.1.84"
SSH_KEY = os.path.expanduser("~/.ssh/id_ed25519_unraid_hermes")
_KEYS: dict[str, str] = {}
_KEYS_AT = 0.0
_QBIT_JAR: CookieJar | None = None
_QBIT_OK = False
_QBIT_APIKEY: str = ""
_QBIT_APIKEY_AT = 0.0

# Prowlarr: 2000 movies, 5000 tv
def _kind(cats: list) -> str:
    nums = []
    for c in cats or []:
        if isinstance(c, dict):
            nums.append(int(c.get("id") or c.get("value") or 0))
        else:
            try:
                nums.append(int(c))
            except (TypeError, ValueError):
                continue
    if any(5000 <= n < 6000 for n in nums):
        return "tv"
    if any(2000 <= n < 3000 for n in nums):
        return "movie"
    return "unknown"


def _ssh_php(code: str, timeout: float = 25) -> str:
    cmd = [
        "ssh", "-i", SSH_KEY, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=8", f"root@{UNRAID}", "php",
    ]
    p = subprocess.run(cmd, input=(("<?php\n" + code).encode()), capture_output=True, timeout=timeout)
    return (p.stdout or b"").decode("utf-8", "replace")


def _ssh_lookup(cmd_arg: str, query: str, timeout: float = 35) -> str:
    """Run: php /mnt/user/appdata/helix-media/lookup.php <cmd> <query> over SSH.
    Uses argv (not stdin PHP) so the lookup script receives $argv[1]/$argv[2] correctly."""
    ssh_cmd = [
        "ssh", "-i", SSH_KEY, "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=8", f"root@{UNRAID}",
        "php", "/mnt/user/appdata/helix-media/lookup.php", cmd_arg, query,
    ]
    p = subprocess.run(ssh_cmd, capture_output=True, timeout=timeout)
    return (p.stdout or b"").decode("utf-8", "replace")


def _arr_keys() -> dict[str, str]:
    global _KEYS, _KEYS_AT
    if _KEYS and time.time() - _KEYS_AT < 300:
        return _KEYS
    raw = _ssh_php(
        r"""
        function k($p){ if(!is_file($p)) return ""; $x=@simplexml_load_file($p); return $x ? trim((string)$x->ApiKey) : ""; }
        echo json_encode([
          "sonarr"=>k("/mnt/user/appdata/sonarr/config.xml"),
          "radarr"=>k("/mnt/user/appdata/radarr/config.xml"),
          "prowlarr"=>k("/mnt/user/appdata/prowlarr/config.xml"),
        ]);
        """
    )
    try:
        d = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    _KEYS = {k: str(v) for k, v in d.items() if v}
    _KEYS_AT = time.time()
    return _KEYS


def _http(url: str, method: str = "GET", data: bytes | None = None, headers: dict | None = None, timeout: float = 20) -> tuple[int, Any]:
    h = {"Accept": "application/json", "User-Agent": "HELIX-OPS"}
    if headers:
        h.update(headers)
    req = Request(url, data=data, method=method, headers=h)
    try:
        with urlopen(req, timeout=timeout) as r:
            body = r.read()
            code = r.status
    except HTTPError as e:
        body = e.read() if e.fp else b""
        code = e.code
    except (URLError, TimeoutError, OSError) as e:
        return 0, {"error": str(e)[:120]}
    if not body:
        return code, {}
    try:
        return code, json.loads(body.decode("utf-8", "replace"))
    except json.JSONDecodeError:
        return code, {"raw": True, "n": len(body)}


def _arr(app: str, path: str, method: str = "GET", payload: dict | None = None) -> tuple[int, Any]:
    ports = {"sonarr": 8989, "radarr": 7878, "prowlarr": 9696}
    keys = _arr_keys()
    key = keys.get(app) or ""
    if not key:
        return 0, {"error": f"{app}_key_missing"}
    url = f"http://{UNRAID}:{ports[app]}{path}"
    data = json.dumps(payload).encode() if payload is not None else None
    hdr = {"X-Api-Key": key}
    if data is not None:
        hdr["Content-Type"] = "application/json"
    return _http(url, method, data, hdr)


def _qbit_apikey() -> str:
    """Read the qBit APIKey from its config via SSH, cached 5 min."""
    global _QBIT_APIKEY, _QBIT_APIKEY_AT
    if _QBIT_APIKEY and time.time() - _QBIT_APIKEY_AT < 300:
        return _QBIT_APIKEY
    raw = _ssh_php(
        r"""
        $cfg="/mnt/user/appdata/qbittorrent/qBittorrent/qBittorrent.conf";
        $key="";
        if(is_file($cfg)){
            foreach(file($cfg) as $l){
                if(preg_match('/^APIKey=(.+)$/',trim($l),$m)){ $key=trim($m[1]); break; }
            }
        }
        echo $key;
        """
    )
    k = raw.strip()
    if k:
        _QBIT_APIKEY = k
        _QBIT_APIKEY_AT = time.time()
    return _QBIT_APIKEY


def _qbit_login() -> bool:
    """Test that the Bearer API key works against app/version."""
    global _QBIT_OK
    apikey = _qbit_apikey()
    if not apikey:
        _QBIT_OK = False
        return False
    raw = _ssh_php(
        r"""
        $apikey=%s;
        $ch=curl_init("http://127.0.0.1:8080/api/v2/app/version");
        curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>1,CURLOPT_TIMEOUT=>8,
            CURLOPT_HTTPHEADER=>["Authorization: Bearer $apikey"]]);
        $b=curl_exec($ch); $c=curl_getinfo($ch,CURLINFO_HTTP_CODE);
        echo $c;
        """ % json.dumps(apikey)
    )
    _QBIT_OK = raw.strip().startswith("200")
    return _QBIT_OK


def _qbit(path: str, data: dict | None = None, timeout: float = 15) -> tuple[int, Any]:
    if not _QBIT_OK:
        _qbit_login()
    apikey = _qbit_apikey()
    if data is None:
        php = r"""
        $apikey=%s;
        $ch=curl_init("http://127.0.0.1:8080%s");
        curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>1,CURLOPT_TIMEOUT=>12,
            CURLOPT_HTTPHEADER=>["Authorization: Bearer $apikey"]]);
        $b=curl_exec($ch); $c=curl_getinfo($ch,CURLINFO_HTTP_CODE);
        echo $c."\n".$b;
        """ % (json.dumps(apikey), path)
    else:
        body = urlencode(data)
        php = r"""
        $apikey=%s;
        $ch=curl_init("http://127.0.0.1:8080%s");
        curl_setopt_array($ch,[CURLOPT_RETURNTRANSFER=>1,CURLOPT_TIMEOUT=>12,
            CURLOPT_POST=>1,CURLOPT_POSTFIELDS=>%s,
            CURLOPT_HTTPHEADER=>["Authorization: Bearer $apikey"]]);
        $b=curl_exec($ch); $c=curl_getinfo($ch,CURLINFO_HTTP_CODE);
        echo $c."\n".$b;
        """ % (json.dumps(apikey), path, json.dumps(body))
    raw = _ssh_php(php, timeout=timeout + 5)
    if not raw:
        return 0, {"error": "qbit_unreachable"}
    line, _, rest = raw.partition("\n")
    try:
        code = int(line.strip()[:3])
    except ValueError:
        return 0, {"error": "qbit_bad_response"}
    if not rest.strip():
        return code, {}
    try:
        return code, json.loads(rest)
    except json.JSONDecodeError:
        return code, {"ok": rest.strip().lower() in ("ok", "true", "")}


def snapshot() -> dict:
    code, rows = _qbit("/api/v2/torrents/info")
    items = []
    if isinstance(rows, list):
        for t in rows[:400]:
            if not isinstance(t, dict):
                continue
            items.append(
                {
                    "hash": t.get("hash") or "",
                    "name": t.get("name") or "",
                    "state": t.get("state") or "",
                    "progress": round(float(t.get("progress") or 0) * 100, 1),
                    "dlspeed": int(t.get("dlspeed") or 0),
                    "upspeed": int(t.get("upspeed") or 0),
                    "eta": int(t.get("eta") or 0),
                    "category": t.get("category") or "",
                    "size": int(t.get("size") or 0),
                    "ratio": round(float(t.get("ratio") or 0), 2),
                }
            )
    keys = _arr_keys()
    return {
        "ok": code == 200,
        "error": None if code == 200 else (rows.get("error") if isinstance(rows, dict) else f"qbit_{code}"),
        "qbit": code == 200,
        "arr": {k: bool(v) for k, v in (("sonarr", keys.get("sonarr")), ("radarr", keys.get("radarr")), ("prowlarr", keys.get("prowlarr")))},
        "torrents": items,
        "counts": {
            "n": len(items),
            "down": sum(1 for t in items if "down" in (t["state"] or "")),
            "up": sum(1 for t in items if t["state"] in ("uploading", "stalledUP", "queuedUP", "forcedUP")),
            "paused": sum(1 for t in items if "paus" in (t["state"] or "") or t["state"] == "stoppedDL"),
        },
    }


_APIKEY_RE = re.compile(r'"[Aa]pi[_-]?[Kk]ey"\s*:')


def _has_apikey(raw: str) -> bool:
    """Return True if the raw JSON string looks like it's leaking an API key field."""
    return bool(_APIKEY_RE.search(raw))


def _parse_lookup_rows(raw: str) -> list[dict]:
    """Parse lookup.php JSON output into the standard results list.
    Handles both bare arrays and envelope objects ({results:[], data:[], items:[]})."""
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return []
    if isinstance(data, dict):
        rows = data.get("results") or data.get("data") or data.get("items") or []
    elif isinstance(data, list):
        rows = data
    else:
        return []
    hits: list[dict] = []
    for r in rows[:40]:
        if not isinstance(r, dict):
            continue
        cats = r.get("categories") or r.get("category") or []
        if isinstance(cats, int):
            cats = [cats]
        kind = _kind(cats if isinstance(cats, list) else [])
        hits.append(
            {
                "title": r.get("title") or r.get("sortTitle") or "",
                "indexer": r.get("indexer") or r.get("indexerId") or "",
                "indexerId": r.get("indexerId"),
                "guid": r.get("guid") or "",
                "downloadUrl": r.get("downloadUrl") or r.get("magnetUrl") or "",
                "magnetUrl": r.get("magnetUrl") or "",
                "protocol": r.get("protocol") or "torrent",
                "publishDate": r.get("publishDate") or "",
                "seeders": r.get("seeders"),
                "size": r.get("size"),
                "kind": kind,
                "infoUrl": r.get("infoUrl") or "",
            }
        )
    return hits


def search(q: str) -> dict:
    """Search via Unraid media bot (lookup.php prowlarr → lookup.php search fallback).
    Keys never leave the Unraid process; no HTTP from Mac to Prowlarr."""
    q = (q or "").strip()[:200]
    if len(q) < 2:
        return {"ok": False, "error": "query_too_short", "results": []}
    # Primary: lookup.php prowlarr <query>
    raw = _ssh_lookup("prowlarr", q)
    if _has_apikey(raw):
        return {"ok": False, "error": "refused_apikey_leak", "results": []}
    hits = _parse_lookup_rows(raw)
    # Fallback: lookup.php search <query> if prowlarr returned no indexer hits
    if not hits:
        raw2 = _ssh_lookup("search", q)
        if _has_apikey(raw2):
            return {"ok": False, "error": "refused_apikey_leak", "results": []}
        hits = _parse_lookup_rows(raw2)
    reachable = bool(raw.strip())
    return {
        "ok": reachable,
        "error": None if reachable else "lookup_unreachable",
        "results": hits,
    }


def grab(body: dict) -> dict:
    kind = (body.get("kind") or "").strip() or _kind(body.get("categories") or [])
    app = "sonarr" if kind == "tv" else "radarr" if kind == "movie" else ""
    if not app:
        return {"ok": False, "error": "unknown_kind_pick_tv_or_movie"}
    payload = {
        "guid": body.get("guid") or "",
        "indexerId": body.get("indexerId") or 0,
        "title": body.get("title") or "",
        "downloadUrl": body.get("downloadUrl") or body.get("magnetUrl") or "",
        "protocol": body.get("protocol") or "torrent",
        "publishDate": body.get("publishDate") or "2020-01-01T00:00:00Z",
    }
    if not payload["guid"] and not payload["downloadUrl"]:
        return {"ok": False, "error": "missing_guid"}
    code, out = _arr(app, "/api/v3/release/push", "POST", payload)
    ok = code in (200, 201)
    return {"ok": ok, "app": app, "status": code, "error": None if ok else (out.get("message") if isinstance(out, dict) else f"{app}_{code}")}


def act(body: dict) -> dict:
    action = (body.get("action") or "").strip().lower()
    if action == "search":
        return search(str(body.get("q") or body.get("query") or ""))
    if action == "grab":
        return grab(body)
    if action == "add":
        url = (body.get("urls") or body.get("magnet") or body.get("url") or "").strip()
        if not url:
            return {"ok": False, "error": "missing_url"}
        cat = (body.get("category") or "").strip()
        data = {"urls": url}
        if cat:
            data["category"] = cat
        code, out = _qbit("/api/v2/torrents/add", data)
        return {"ok": code == 200, "error": None if code == 200 else (out if isinstance(out, dict) else f"qbit_{code}")}
    hashes = body.get("hashes") or body.get("hash") or ""
    if isinstance(hashes, list):
        hashes = "|".join(str(h) for h in hashes)
    hashes = str(hashes).strip()
    if not hashes:
        return {"ok": False, "error": "missing_hash"}
    path = {
        "pause": "/api/v2/torrents/pause",
        "resume": "/api/v2/torrents/resume",
        "stop": "/api/v2/torrents/pause",
        "start": "/api/v2/torrents/resume",
        "delete": "/api/v2/torrents/delete",
    }.get(action)
    if not path:
        return {"ok": False, "error": "bad_action"}
    data = {"hashes": hashes}
    if action == "delete":
        data["deleteFiles"] = "false"
    code, out = _qbit(path, data)
    # qBit 5 uses stop/start
    if code == 404 and action in ("pause", "stop"):
        code, out = _qbit("/api/v2/torrents/stop", data)
    if code == 404 and action in ("resume", "start"):
        code, out = _qbit("/api/v2/torrents/start", data)
    return {"ok": code == 200, "error": None if code == 200 else (out if isinstance(out, dict) else f"qbit_{code}")}
