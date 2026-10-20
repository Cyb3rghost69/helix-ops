"""Server-side Hermes Agent API client.

Helix frontend never sees HERMES_API_KEY. Keys are not logged.
Ordinary chat uses /v1/chat/completions. Runs API is stubbed for later.
"""
from __future__ import annotations

import json
import os
import re
import socket
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
HERMES_HOME = Path.home() / ".hermes"
DEFAULT_URL = "http://127.0.0.1:8642"
DEFAULT_SESSION = "helix-main"
CHAT_TIMEOUT = 180
STATUS_TIMEOUT = 4
_SESSION_RE = re.compile(r"^[A-Za-z0-9._:-]{1,64}$")


def _parse_env_file(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.is_file():
        return out
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return out
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip("'").strip('"')
    return out


def _cfg() -> tuple[str, str]:
    env = dict(os.environ)
    ops = _parse_env_file(ROOT / "ops.env")
    home = _parse_env_file(HERMES_HOME / ".env")
    url = (
        (env.get("HERMES_API_URL") or "").strip()
        or (ops.get("HERMES_API_URL") or "").strip()
        or (home.get("HERMES_API_URL") or "").strip()
        or DEFAULT_URL
    )
    key = (
        (env.get("HERMES_API_KEY") or "").strip()
        or (ops.get("HERMES_API_KEY") or "").strip()
        or (env.get("API_SERVER_KEY") or "").strip()
        or (ops.get("API_SERVER_KEY") or "").strip()
        or (home.get("HERMES_API_KEY") or "").strip()
        or (home.get("API_SERVER_KEY") or "").strip()
    )
    return url.rstrip("/"), key


def _session_id(raw: str | None) -> str:
    s = (raw or "").strip() or DEFAULT_SESSION
    if not _SESSION_RE.match(s):
        return DEFAULT_SESSION
    return s


def _session_key(session_id: str) -> str:
    return f"helix:{_session_id(session_id)}"


def _scrub(text: str) -> str:
    t = text or ""
    t = re.sub(r"(?i)(bearer\s+)[^\s]+", r"\1[redacted]", t)
    t = re.sub(r"(?i)(api[_-]?key\s*[=:]\s*)\S+", r"\1[redacted]", t)
    t = re.sub(r"(?i)sk-[A-Za-z0-9_\-]{8,}", "[redacted]", t)
    return t[:400]


class HermesError(Exception):
    def __init__(self, code: str, http: int = 502):
        super().__init__(code)
        self.code = code
        self.http = http


def _request(
    method: str,
    path: str,
    *,
    body: dict | None = None,
    timeout: float = 15,
    session_id: str | None = None,
    auth: bool = True,
) -> tuple[int, object, float]:
    url, key = _cfg()
    if auth and not key:
        raise HermesError("authentication", 502)
    target = url + path
    data = None if body is None else json.dumps(body).encode("utf-8")
    headers = {"Accept": "application/json"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    if auth:
        headers["Authorization"] = "Bearer " + key
    if session_id:
        headers["X-Hermes-Session-Key"] = _session_key(session_id)
        headers["X-Hermes-Session-Id"] = _session_id(session_id)
    req = Request(target, data=data, headers=headers, method=method)
    t0 = time.time()
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            code = getattr(resp, "status", 200) or 200
    except socket.timeout as exc:
        raise HermesError("timeout", 504) from exc
    except HTTPError as exc:
        ms = int((time.time() - t0) * 1000)
        if exc.code in (401, 403):
            raise HermesError("authentication", 502) from exc
        raise HermesError("unavailable", 502) from exc
    except URLError as exc:
        reason = str(getattr(exc, "reason", exc))
        if "timed out" in reason.lower():
            raise HermesError("timeout", 504) from exc
        raise HermesError("unavailable", 502) from exc
    except OSError as exc:
        raise HermesError("network", 502) from exc
    ms = int((time.time() - t0) * 1000)
    if not raw:
        return code, {}, ms
    try:
        parsed = json.loads(raw.decode("utf-8", "replace"))
    except json.JSONDecodeError as exc:
        raise HermesError("invalid", 502) from exc
    return code, parsed, ms


def status() -> dict:
    """GET /health — no credentials in the payload."""
    try:
        _code, data, ms = _request("GET", "/health", timeout=STATUS_TIMEOUT, auth=False)
        online = isinstance(data, dict) and (
            data.get("status") in ("ok", "healthy", "up") or data.get("ok") is True
        )
        if not online and _code == 200:
            online = True
        return {
            "online": bool(online),
            "service": "Hermes Agent",
            "latency": ms,
            "session": DEFAULT_SESSION,
        }
    except HermesError:
        return {
            "online": False,
            "service": "Hermes Agent",
            "latency": None,
            "session": DEFAULT_SESSION,
        }


def models() -> dict:
    code, data, ms = _request("GET", "/v1/models", timeout=STATUS_TIMEOUT, auth=True)
    return {"ok": code == 200, "data": data, "latency": ms}


def _extract_message(payload: object) -> str | None:
    if not isinstance(payload, dict):
        return None
    choices = payload.get("choices")
    if isinstance(choices, list) and choices:
        ch0 = choices[0] if isinstance(choices[0], dict) else {}
        raw_msg = ch0.get("message") if isinstance(ch0, dict) else None
        msg = raw_msg if isinstance(raw_msg, dict) else {}
        content = msg.get("content")
        if isinstance(content, str) and content.strip():
            return content.strip()
        if isinstance(content, list):
            parts = []
            for p in content:
                if isinstance(p, dict) and p.get("type") == "text":
                    parts.append(str(p.get("text") or ""))
                elif isinstance(p, str):
                    parts.append(p)
            joined = "".join(parts).strip()
            if joined:
                return joined
        text = ch0.get("text")
        if isinstance(text, str) and text.strip():
            return text.strip()
    for key in ("message", "output", "content"):
        v = payload.get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def chat(message: str, session_id: str | None = None) -> dict:
    text = (message or "").strip()
    if not text:
        return {"success": False, "error": "invalid", "source": "hermes"}
    sid = _session_id(session_id)
    payload = {
        "model": "hermes-agent",
        "messages": [{"role": "user", "content": text}],
        "stream": False,
    }
    try:
        _code, data, _ms = _request(
            "POST",
            "/v1/chat/completions",
            body=payload,
            timeout=CHAT_TIMEOUT,
            session_id=sid,
            auth=True,
        )
    except HermesError as exc:
        return {"success": False, "error": exc.code, "source": "hermes"}
    msg = _extract_message(data)
    if not msg:
        return {"success": False, "error": "invalid", "source": "hermes"}
    return {"success": True, "message": msg, "source": "hermes", "sessionId": sid}


class HermesRuns:
    """Prepared for native Runs API. Ordinary chat does not use this yet."""

    def create(self, message: str, session_id: str | None = None) -> dict:
        sid = _session_id(session_id)
        body = {
            "model": "hermes-agent",
            "input": (message or "").strip(),
            "session_id": sid,
        }
        _code, data, _ms = _request(
            "POST", "/v1/runs", body=body, timeout=CHAT_TIMEOUT, session_id=sid, auth=True
        )
        return data if isinstance(data, dict) else {"raw": data}

    def get(self, run_id: str) -> dict:
        rid = urllib_quote(run_id)
        _code, data, _ms = _request("GET", f"/v1/runs/{rid}", timeout=STATUS_TIMEOUT, auth=True)
        return data if isinstance(data, dict) else {"raw": data}

    def events(self, run_id: str) -> dict:
        rid = urllib_quote(run_id)
        _code, data, _ms = _request(
            "GET", f"/v1/runs/{rid}/events", timeout=STATUS_TIMEOUT, auth=True
        )
        return data if isinstance(data, dict) else {"raw": data}

    def approval(self, run_id: str, body: dict | None = None) -> dict:
        rid = urllib_quote(run_id)
        _code, data, _ms = _request(
            "POST",
            f"/v1/runs/{rid}/approval",
            body=body or {},
            timeout=STATUS_TIMEOUT,
            auth=True,
        )
        return data if isinstance(data, dict) else {"raw": data}

    def steer(self, run_id: str, message: str) -> dict:
        rid = urllib_quote(run_id)
        _code, data, _ms = _request(
            "POST",
            f"/v1/runs/{rid}/steer",
            body={"message": message},
            timeout=STATUS_TIMEOUT,
            auth=True,
        )
        return data if isinstance(data, dict) else {"raw": data}

    def stop(self, run_id: str) -> dict:
        rid = urllib_quote(run_id)
        _code, data, _ms = _request(
            "POST", f"/v1/runs/{rid}/stop", body={}, timeout=STATUS_TIMEOUT, auth=True
        )
        return data if isinstance(data, dict) else {"raw": data}


def urllib_quote(s: str) -> str:
    from urllib.parse import quote

    return quote(str(s or ""), safe="")


RUNS = HermesRuns()


def error_http(code: str) -> int:
    return {"timeout": 504, "invalid": 400, "authentication": 502}.get(code, 502)
