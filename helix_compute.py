"""HELIX COMPUTE — route work to Mac / BigBoi / Ollama / cloud.

Hermes Agent stays on the Mac. This module never flips terminal.backend to ssh.
The browser never sees keys. BigBoi SSH is allowlisted recipes only (no freeform root).
"""
from __future__ import annotations

import json
import os
import re
import socket
import subprocess
import time
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent
STATE = ROOT / "helix-compute.json"
SSH_KEY = Path.home() / ".ssh" / "id_ed25519_helix_worker"
SSH_KEY_ROOT = Path.home() / ".ssh" / "id_ed25519_unraid_hermes"
CONTROL = "/tmp/hc-%C"
UNRAID = os.environ.get("HELIX_COMPUTE_HOST", "192.168.1.84").strip() or "192.168.1.84"
SSH_USER = os.environ.get("HELIX_COMPUTE_SSH_USER", "helix-worker").strip() or "helix-worker"
OLLAMA = os.environ.get("HELIX_COMPUTE_OLLAMA", f"http://{UNRAID}:11434").rstrip("/")
HERMES_API = "http://127.0.0.1:8642"
CLOUD_PROVIDER = "xai-oauth"
CLOUD_MODEL = "grok-4.6"
OLLAMA_DELEGATE = "gemma4:26b"

TARGETS = ("AUTO", "LOCAL-MAC", "BIGBOI", "OLLAMA-LOCAL", "CLOUD-AI")
CANON = ("auto", "mac", "unraid", "ollama", "cloud")
ALIASES = {
    "AUTO": "auto",
    "MAC": "mac",
    "MAC-HERMES": "mac",
    "LOCAL-MAC": "mac",
    "UNRAID": "unraid",
    "BIGBOI": "unraid",
    "UNRAID-HERMES": "unraid",
    "OLLAMA": "ollama",
    "OLLAMA-LOCAL": "ollama",
    "CLOUD": "cloud",
    "CLOUD-AI": "cloud",
}
MAX_JOBS = 40
_CACHE: dict = {}
TELE_TTL = 15.0
HONCHO = os.environ.get("HELIX_COMPUTE_HONCHO", f"http://{UNRAID}:8000").rstrip("/")
UNRAID_API = os.environ.get("HELIX_COMPUTE_UNRAID_API", f"http://{UNRAID}:8642").rstrip("/")

# Named recipes only. UI cannot send arbitrary shell. helix-worker sudo wrapper.
_READ = "sudo -n /usr/local/sbin/helix-read "
RECIPES = {
    "identity": _READ + "identity",
    "cpu": _READ + "cpu",
    "ram": _READ + "ram",
    "load": _READ + "load",
    "df": _READ + "df",
    "gpu": _READ + "gpu",
    "python": _READ + "python",
    "docker": _READ + "docker-count",
    "docker-ps": _READ + "docker-ps",
    "docker-stats": _READ + "docker-stats",
    "docker-inspect": _READ + "docker-inspect",
    "docker-logs": _READ + "docker-logs",
    "docker-start": _READ + "docker-start",
    "docker-stop": _READ + "docker-stop",
    "docker-restart": _READ + "docker-restart",
    "processes": _READ + "processes",
    "network": _READ + "network",
    "hermes-health": _READ + "hermes-health",
    "ollama-health": _READ + "ollama-health",
    "ollama-models": _READ + "ollama-models",
}

_BLOCK = re.compile(
    r"(rm\s+-rf|reboot|shutdown|mkfs|dd\s+if=|passwd|useradd|userdel|"
    r"rc\.docker|killall\s+dockerd|docker\s+rm\b|wipefs)",
    re.I,
)


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def _load() -> dict:
    try:
        data = json.loads(STATE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            data.setdefault("override", "AUTO")
            data.setdefault("jobs", [])
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return {"override": "AUTO", "jobs": []}


def _save(data: dict) -> None:
    tmp = STATE.with_suffix(".json.tmp")
    cur = {}
    try:
        cur = json.loads(STATE.read_text(encoding="utf-8"))
        if not isinstance(cur, dict):
            cur = {}
    except (OSError, json.JSONDecodeError):
        cur = {}
    cur.update(data)
    tmp.write_text(json.dumps(cur, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(STATE)


def _job(kind: str, target: str, task: str, status: str, detail: str = "") -> dict:
    return {
        "id": f"j{int(time.time() * 1000)}",
        "t": _now(),
        "kind": kind,
        "target": target,
        "task": (task or "")[:240],
        "status": status,
        "detail": (detail or "")[:800],
    }


def _push(job: dict) -> dict:
    st = _load()
    jobs = list(st.get("jobs") or [])
    jobs.append(job)
    st["jobs"] = jobs[-MAX_JOBS:]
    _save(st)
    return st


def route_compute(
    task: str,
    *,
    cpu: str = "",
    ram: str = "",
    runtime: str = "",
    privacy: str = "",
    latency: str = "",
    gpu: str = "",
    override: str | None = None,
) -> dict:
    """Pick LOCAL-MAC / BIGBOI / OLLAMA-LOCAL / CLOUD-AI. Never routes Helix self-care off-Mac."""
    text = (task or "").strip()
    low = text.lower()
    ov = (override or _load().get("override") or "AUTO").upper()
    if ov not in TARGETS:
        ov = "AUTO"

    reasons: list[str] = []
    target = "LOCAL-MAC"

    helix_self = any(
        k in low
        for k in (
            "restart helix",
            "update hermes",
            "hermes config",
            "helix config",
            "helix management",
            "gateway",
            "voice",
            "stt",
            "ops-dashboard",
            "self-maintenance",
        )
    )
    heavy = any(
        k in low
        for k in (
            "docker",
            "container",
            "log analysis",
            "5gb",
            "index",
            "vector",
            "batch",
            "compile",
            "database",
            "diagnos",
            "nproc",
            "bigboi",
            "unraid",
            "parallel",
            "storage analysis",
            "python job",
            "cpu-intensive",
            "ram-intensive",
            "background job",
        )
    )
    local_ai = any(
        k in low
        for k in ("summar", "classif", "interpret", "embed", "private", "ollama", "short text")
    )
    hard = any(
        k in low
        for k in (
            "architect",
            "architecture",
            "complicated",
            "complex",
            "difficult",
            "plan",
            "debug",
            "reason",
            "advanced coding",
            "weather",
        )
    )
    latency_need = any(k in low for k in ("voice", "mic", "latency", "small shell", "simple file"))
    if (cpu or "").lower() in ("high", "heavy") or (ram or "").lower() in ("high", "large"):
        heavy = True
    if (runtime or "").lower() in ("long", "batch"):
        heavy = True
    if (privacy or "").lower() in ("private", "local"):
        local_ai = True
    if (latency or "").lower() in ("low", "interactive"):
        latency_need = True
    if (gpu or "").lower() in ("yes", "required", "nvidia"):
        heavy = True
        local_ai = True

    if helix_self or latency_need:
        target = "LOCAL-MAC"
        reasons.append("Helix/Hermes self-care and latency-sensitive work stay on the Mac")
    elif hard and not local_ai:
        target = "CLOUD-AI"
        reasons.append("hard reasoning / planning / debugging")
    elif local_ai and not helix_self:
        target = "OLLAMA-LOCAL"
        reasons.append("inexpensive / private local model")
        if "embed" in low or "index" in low:
            reasons.append("embeddings/index also want BigBoi RAM — primary still Ollama for the model")
    elif heavy:
        target = "BIGBOI"
        reasons.append("CPU/RAM/Docker/logs/batch belong on BigBoi")
    else:
        target = "LOCAL-MAC"
        reasons.append("default small/local")

    chosen = target if ov == "AUTO" else ov
    canon = ALIASES.get(chosen, "mac")
    suggested_canon = ALIASES.get(target, "mac")
    return {
        "ok": True,
        "task": text[:240],
        "suggested": target,
        "target": chosen,
        "canon": canon,
        "suggested_canon": suggested_canon,
        "override": ov,
        "reason": "; ".join(reasons) or "default",
        "auto": ov == "AUTO",
    }


def classify(message: str, target: str | None = None) -> dict:
    """Deterministic target pick. Does not execute anything."""
    raw = (target or "auto").strip().upper() or "AUTO"
    if raw in ALIASES:
        want = ALIASES[raw]
    else:
        want = (target or "auto").strip().lower() or "auto"
        if want not in CANON:
            want = "auto"
    ovmap = {"mac": "LOCAL-MAC", "unraid": "BIGBOI", "ollama": "OLLAMA-LOCAL", "cloud": "CLOUD-AI"}
    r = route_compute(message or "", override="AUTO" if want == "auto" else ovmap.get(want, "AUTO"))
    if want == "auto":
        canon = r.get("suggested_canon") or "mac"
    else:
        canon = want
    return {
        "target": canon,
        "reason": r.get("reason") or "default",
        "pinned": want != "auto",
        "suggested": r.get("suggested_canon"),
    }


def _env_name(name: str) -> str:
    home = Path.home() / ".hermes" / ".env"
    ops = ROOT / "ops.env"
    for path in (ops, home):
        if not path.is_file():
            continue
        try:
            for line in path.read_text(encoding="utf-8").splitlines():
                s = line.strip()
                if s.startswith(name + "="):
                    return s.split("=", 1)[1].strip().strip("'").strip('"')
        except OSError:
            continue
    return (os.environ.get(name) or "").strip()


def _http_json(url: str, *, method: str = "GET", body: dict | None = None, headers: dict | None = None, timeout: float = 6):
    data = None if body is None else json.dumps(body).encode("utf-8")
    hdrs = {"Accept": "application/json"}
    if data is not None:
        hdrs["Content-Type"] = "application/json"
    if headers:
        hdrs.update(headers)
    req = Request(url, data=data, headers=hdrs, method=method)
    t0 = time.time()
    with urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        code = getattr(resp, "status", 200) or 200
    ms = int((time.time() - t0) * 1000)
    parsed = {}
    if raw:
        try:
            parsed = json.loads(raw.decode("utf-8", "replace"))
        except json.JSONDecodeError:
            parsed = {}
    return code, parsed, ms


def _ping(url: str, timeout: float = 4) -> dict:
    try:
        code, data, ms = _http_json(url, timeout=timeout)
        ok = code == 200
        return {"online": ok, "latency": ms, "http": code}
    except Exception:
        return {"online": False, "latency": None, "http": None}


def _ollama_models() -> list[str]:
    info = _ollama_tele()
    return list(info.get("models") or [])


def pick_ollama_model(task: str, models: list[str] | None = None) -> str | None:
    names = models if models is not None else _ollama_models()
    if not names:
        return None
    low = (task or "").lower()
    def find(*needles: str) -> str | None:
        for n in names:
            nl = n.lower()
            if any(nd in nl for nd in needles):
                return n
        return None
    if any(k in low for k in ("embed", "embedding", "vector")):
        return find("nomic", "embed") or names[0]
    if any(k in low for k in ("summar", "classif", "quick", "short", "simple")):
        return find("qwen3:8b", "qwen3:8") or find("dolphin-mistral") or find("qwen3") or names[0]
    return find("hermes-gemma", "gemma4:26b", "qwen3:30b", "gemma4") or find("qwen3") or names[0]


_NO_EXEC = re.compile(r"restart\s+helix|update\s+hermes|gateway restart", re.I)


def send_to_mac_hermes(message: str, session_id: str = "helix-compute-mac") -> dict:
    import helix_hermes
    out = helix_hermes.chat(message, session_id)
    return {
        "ok": bool(out.get("success")),
        "result": out.get("message") or out.get("error") or "",
        "model": "hermes-agent",
        "worker": "mac",
        "error": None if out.get("success") else out.get("error"),
    }


def send_to_unraid_hermes(message: str, session_id: str = "helix-compute-unraid") -> dict:
    key = _env_name("HERMES_PEER_UNRAID_KEY")
    if not key:
        return {"ok": False, "result": "", "error": "unavailable", "worker": "unraid", "model": "hermes-agent"}
    payload = {
        "model": "hermes-agent",
        "messages": [{"role": "user", "content": message}],
        "stream": False,
    }
    headers = {
        "Authorization": "Bearer " + key,
        "X-Hermes-Session-Key": f"helix:{session_id}",
        "X-Hermes-Session-Id": session_id,
    }
    try:
        code, data, _ms = _http_json(
            UNRAID_API + "/v1/chat/completions",
            method="POST",
            body=payload,
            headers=headers,
            timeout=90,
        )
    except Exception:
        return {"ok": False, "result": "", "error": "unavailable", "worker": "unraid", "model": "hermes-agent"}
    if code in (401, 403):
        return {"ok": False, "result": "", "error": "authentication", "worker": "unraid", "model": "hermes-agent"}
    text = ""
    if isinstance(data, dict):
        ch = (data.get("choices") or [{}])
        msg = (ch[0] or {}).get("message") if ch else {}
        if isinstance(msg, dict):
            text = str(msg.get("content") or "")
    if not text:
        return {"ok": False, "result": "", "error": "invalid", "worker": "unraid", "model": "hermes-agent"}
    return {"ok": True, "result": text, "worker": "unraid", "model": "hermes-agent", "error": None}


def send_to_ollama(message: str, task_hint: str = "") -> dict:
    models = _ollama_models()
    model = pick_ollama_model(task_hint or message, models)
    if not model:
        return {"ok": False, "result": "", "error": "unavailable", "worker": "ollama", "model": None}
    if any(k in (task_hint or message).lower() for k in ("embed", "embedding")):
        body = {"model": model, "prompt": (message or "")[:2000]}
        try:
            _code, data, _ms = _http_json(OLLAMA + "/api/embeddings", method="POST", body=body, timeout=30)
            vec = data.get("embedding") if isinstance(data, dict) else None
            n = len(vec) if isinstance(vec, list) else 0
            return {"ok": True, "result": f"embedding dims {n}", "worker": "ollama", "model": model, "error": None}
        except Exception:
            return {"ok": False, "result": "", "error": "unavailable", "worker": "ollama", "model": model}
    body = {
        "model": model,
        "prompt": (message or "")[:4000],
        "stream": False,
        "keep_alive": 0,
        "options": {"num_predict": 128},
    }
    try:
        _code, data, _ms = _http_json(OLLAMA + "/api/generate", method="POST", body=body, timeout=60)
        resp = str((data or {}).get("response") or "")[:2000]
        return {"ok": bool(resp), "result": resp or "", "worker": "ollama", "model": model, "error": None if resp else "invalid"}
    except Exception:
        return {"ok": False, "result": "", "error": "unavailable", "worker": "ollama", "model": model}


def send_to_cloud(message: str, session_id: str = "helix-compute-cloud") -> dict:
    out = send_to_mac_hermes(message, session_id=session_id)
    out["worker"] = "cloud"
    out["model"] = CLOUD_MODEL
    return out


def _honcho_tele() -> dict:
    now = time.time()
    hit = _CACHE.get("honcho")
    if hit and now - hit[0] < TELE_TTL:
        return hit[1]
    p = _ping(HONCHO + "/health")
    info = {"name": "HONCHO", "endpoint": HONCHO, "online": p["online"], "status": "ONLINE" if p["online"] else "OFFLINE", "latency": p["latency"]}
    _CACHE["honcho"] = (now, info)
    return info


def _mac_hermes_tele() -> dict:
    now = time.time()
    hit = _CACHE.get("mac_hermes")
    if hit and now - hit[0] < 5:
        return hit[1]
    p = _ping(HERMES_API + "/health")
    info = {
        "name": "MAC HERMES",
        "endpoint": HERMES_API,
        "online": p["online"],
        "status": "ONLINE" if p["online"] else "OFFLINE",
        "latency": p["latency"],
        "role": "orchestrator",
    }
    _CACHE["mac_hermes"] = (now, info)
    return info


def _unraid_hermes_tele() -> dict:
    now = time.time()
    hit = _CACHE.get("unraid_hermes")
    if hit and now - hit[0] < TELE_TTL:
        return hit[1]
    p = _ping(UNRAID_API + "/health")
    info = {
        "name": "UNRAID WORKER",
        "endpoint": UNRAID_API,
        "online": p["online"],
        "status": "ONLINE" if p["online"] else "OFFLINE",
        "latency": p["latency"],
        "role": "remote worker",
    }
    _CACHE["unraid_hermes"] = (now, info)
    return info


def apply_fallback(canon: str, task: str = "") -> tuple[str | None, str]:
    """If a worker is down, pick a safe substitute. Never kills Mac-Hermes.
    Machine-specific BigBoi commands do not fail over to Mac Docker.
    """
    low = (task or "").lower()
    machine = any(
        k in low
        for k in (
            "on bigboi",
            "on unraid",
            "docker on bigboi",
            "bigboi docker",
            "unraid docker",
            "check docker",
            "check all docker",
        )
    )
    if canon == "unraid":
        bb = _CACHE.get("bigboi")
        online = False
        if bb and (time.time() - bb[0] < 30):
            online = bool((bb[1] or {}).get("ssh"))
        else:
            ident = run_bigboi("identity", timeout=12)
            online = bool(ident.get("ok"))
        if not online:
            if machine:
                return None, "BIGBOI UNAVAILABLE"
            return "mac", "unraid offline → mac"
    if canon == "ollama" and not (_ollama_tele().get("status") == "online"):
        if _mac_hermes_tele().get("online"):
            return "cloud", "ollama offline → cloud"
        return "mac", "ollama offline → mac"
    if canon == "cloud" and not _mac_hermes_tele().get("online"):
        if _ollama_tele().get("status") == "online":
            return "ollama", "cloud offline → ollama"
        return "mac", "cloud offline → mac"
    return canon, ""


def status_api() -> dict:
    st = snapshot()
    mac_h = _mac_hermes_tele()
    un_h = _unraid_hermes_tele()
    ol = st.get("ollama") or {}
    ho = _honcho_tele()
    cl = st.get("cloud") or {}
    bb = st.get("bigboi") or {}
    gpus = list(bb.get("gpus") or [])
    while len(gpus) < 4:
        gpus.append({"name": "GPU " + str(len(gpus)), "vram": None, "util": None, "present": False})
    gpus = [{**g, "id": i, "present": g.get("present", True if g.get("name") else False)} for i, g in enumerate(gpus[:4])]
    ov = (st.get("override") or "AUTO")
    mode = ALIASES.get(str(ov).upper(), "auto")
    last = (st.get("completed") or st.get("active") or [None])
    lastj = last[-1] if last else None
    out = {
        "ok": True,
        "mode": mode,
        "override": ov,
        "mac_hermes": {k: mac_h.get(k) for k in ("online", "status", "latency", "endpoint", "role")},
        "unraid_hermes": {k: un_h.get(k) for k in ("online", "status", "latency", "endpoint", "role")},
        "ollama": {
            "online": ol.get("status") == "online",
            "status": "ONLINE" if ol.get("status") == "online" else "OFFLINE",
            "models": ol.get("models") or [],
            "endpoint": ol.get("endpoint"),
        },
        "honcho": {k: ho.get(k) for k in ("online", "status", "latency", "endpoint")},
        "cloud": {
            "online": cl.get("status") in ("available", "ONLINE", "online"),
            "status": "ONLINE" if cl.get("status") in ("available", "ONLINE", "online") else "OFFLINE",
            "provider": cl.get("provider"),
            "model": cl.get("model"),
        },
        "bigboi": {
            "online": bb.get("status") == "online",
            "cpu": bb.get("cpu_pct"),
            "load": bb.get("load"),
            "ram_used": (bb.get("ram") or {}).get("used_gb"),
            "ram_total": (bb.get("ram") or {}).get("total_gb"),
            "docker": bb.get("docker"),
            "gpus": gpus,
        },
        "active_target": (lastj or {}).get("target") or mode,
        "active_model": (lastj or {}).get("model") or cl.get("model"),
        "current_task": (lastj or {}).get("task"),
        "duration": None,
        "version": "2.0",
        "policy": "BALANCED",
        "nodes": {},
        "metrics": {},
        "explain": [],
    }
    try:
        import helix_compute_v2 as v2
        out["policy"] = v2.get_policy()
        ns = v2.node_states()
        out["nodes"] = {k: ns[k] for k in ("MAC", "BIGBOI", "UNRAID HERMES", "OLLAMA", "CLOUD") if k in ns}
        out["metrics"] = v2.metrics()
        m = out["metrics"]
        n = int(m.get("duration_n") or 0)
        out["avg_duration_ms"] = int(m["duration_ms_sum"] / n) if n else 0
    except Exception:
        pass
    return out


def route_api(message: str, target: str = "auto", *, execute: bool = True, session_id: str = "helix-main") -> dict:
    t0 = time.time()
    pin = (target or "auto").strip() or "auto"
    if pin.strip().lower() in CANON and not (message or "").strip():
        mapped = {
            "mac": "LOCAL-MAC",
            "unraid": "BIGBOI",
            "ollama": "OLLAMA-LOCAL",
            "cloud": "CLOUD-AI",
            "auto": "AUTO",
        }[pin.strip().lower()]
        st = _load()
        st["override"] = mapped
        _save(st)
        return {
            "target": pin.strip().lower(),
            "reason": "session target pinned",
            "result": "",
            "duration": int((time.time() - t0) * 1000),
            "model": None,
            "worker": None,
            "executed": False,
        }
    cls = classify(message, pin)
    canon = cls["target"]
    reason = cls["reason"]
    used, fb = apply_fallback(canon, task=message)
    if used is None:
        return {
            "target": "unraid",
            "reason": fb or "BIGBOI UNAVAILABLE",
            "result": "",
            "duration": int((time.time() - t0) * 1000),
            "model": None,
            "worker": None,
            "executed": False,
            "error": fb or "BIGBOI UNAVAILABLE",
        }
    if fb:
        reason = reason + "; " + fb
    result = ""
    model = None
    worker = used
    executed = False
    err = None
    if _NO_EXEC.search(message or ""):
        execute = False
        reason = reason + "; classified only (no Helix restart)"
    if execute:
        executed = True
        if used == "unraid":
            out = send_to_unraid_hermes(message, session_id="helix-compute-unraid")
        elif used == "ollama":
            out = send_to_ollama(message, message)
        elif used == "cloud":
            out = send_to_cloud(message)
        else:
            out = send_to_mac_hermes(message)
        if not out.get("ok") and used != "mac":
            fb2 = "mac"
            reason = reason + f"; {used} failed → mac"
            used = fb2
            worker = "mac"
            out = send_to_mac_hermes(message)
        result = str(out.get("result") or "")
        model = out.get("model")
        worker = out.get("worker") or used
        err = out.get("error")
        executed = True
    dur = int((time.time() - t0) * 1000)
    job = _job("route", used, message, "ok" if not err else "fail", reason)
    job["model"] = model
    _push(job)
    out = {
        "target": used,
        "reason": reason,
        "result": result,
        "duration": dur,
        "model": model,
        "worker": worker,
        "executed": executed,
    }
    if err:
        out["error"] = err
    return out


def _ssh_base() -> list[str] | None:
    if not SSH_KEY.is_file():
        return None
    return [
        "ssh",
        "-i",
        str(SSH_KEY),
        "-o",
        "IdentitiesOnly=yes",
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=8",
        "-o",
        "ControlMaster=auto",
        "-o",
        f"ControlPath={CONTROL}",
        "-o",
        "ControlPersist=60",
        f"{SSH_USER}@{UNRAID}",
    ]


def run_local(command: str, timeout: int = 12) -> dict:
    cmd = (command or "").strip()
    if not cmd or _BLOCK.search(cmd):
        return {"ok": False, "target": "LOCAL-MAC", "error": "blocked"}
    try:
        p = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        out = ((p.stdout or "") + (p.stderr or "")).strip()[:800]
        return {
            "ok": p.returncode == 0,
            "target": "LOCAL-MAC",
            "code": p.returncode,
            "out": out,
            "host": socket.gethostname(),
        }
    except (subprocess.TimeoutExpired, OSError) as e:
        return {"ok": False, "target": "LOCAL-MAC", "error": type(e).__name__}


def run_bigboi(recipe: str, extra: str = "", timeout: int = 25) -> dict:
    name = (recipe or "").strip()
    if name not in RECIPES:
        return {"ok": False, "target": "BIGBOI", "error": "unknown recipe"}
    remote = RECIPES[name]
    extra = (extra or "").strip()
    if extra:
        if not re.match(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$", extra):
            return {"ok": False, "target": "BIGBOI", "error": "bad name"}
        remote = remote + " " + extra
    if _BLOCK.search(remote):
        return {"ok": False, "target": "BIGBOI", "error": "blocked"}
    base = _ssh_base()
    if not base:
        return {"ok": False, "target": "BIGBOI", "error": "no ssh key"}
    try:
        p = subprocess.run(
            base + [remote],
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        out = ((p.stdout or "") + (p.stderr or "")).strip()[:1200]
        ok = p.returncode == 0
        return {
            "ok": ok,
            "target": "BIGBOI",
            "recipe": name,
            "code": p.returncode,
            "out": out,
            "host": UNRAID,
            "user": SSH_USER,
        }
    except (subprocess.TimeoutExpired, OSError) as e:
        return {"ok": False, "target": "BIGBOI", "error": type(e).__name__}


def run_ollama(prompt: str, timeout: int = 20) -> dict:
    text = (prompt or "ping").strip()[:200]
    body = json.dumps(
        {
            "model": OLLAMA_DELEGATE,
            "prompt": text,
            "stream": False,
            "keep_alive": 0,
            "options": {"num_predict": 8},
        }
    ).encode()
    try:
        req = Request(
            OLLAMA + "/api/generate",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(req, timeout=timeout) as r:
            raw = r.read()[:4000]
        data = json.loads(raw.decode("utf-8", "replace") or "{}")
        resp = str(data.get("response") or "")[:400]
        return {
            "ok": True,
            "target": "OLLAMA-LOCAL",
            "endpoint": OLLAMA,
            "model": OLLAMA_DELEGATE,
            "out": resp or "(empty)",
        }
    except Exception as e:
        return {
            "ok": False,
            "target": "OLLAMA-LOCAL",
            "endpoint": OLLAMA,
            "error": type(e).__name__,
            "note": "ollama container is not started from Helix (Tesla M10 fan load)",
        }


def run_cloud(task: str) -> dict:
    """Availability only — does not spend a paid completion."""
    health = False
    try:
        with urlopen(HERMES_API + "/health", timeout=4) as r:
            health = r.status == 200
    except (URLError, OSError, TimeoutError):
        health = False
    return {
        "ok": health,
        "target": "CLOUD-AI",
        "provider": CLOUD_PROVIDER,
        "model": CLOUD_MODEL,
        "hermes_api": health,
        "task": (task or "")[:200],
        "note": "lead stays grok-4.6; this check does not call the model",
    }


def _mac_tele() -> dict:
    ncpu = os.cpu_count() or 0
    load = os.getloadavg()
    mem = {"total_gb": None, "used_gb": None, "pct": None}
    try:
        p = subprocess.run(
            ["sysctl", "-n", "hw.memsize", "machdep.cpu.brand_string"],
            capture_output=True,
            text=True,
            timeout=3,
        )
        lines = [x.strip() for x in (p.stdout or "").splitlines() if x.strip()]
        total = int(lines[0]) if lines and lines[0].isdigit() else None
        brand = lines[1] if len(lines) > 1 else "Apple"
        if total:
            # vm_stat page size 16384 on Apple Silicon
            v = subprocess.run(["vm_stat"], capture_output=True, text=True, timeout=3)
            page = 16384
            m = re.search(r"page size of (\d+)", v.stdout or "")
            if m:
                page = int(m.group(1))
            free = 0
            for key in ("Pages free", "Pages speculative"):
                mm = re.search(rf"{key}:\s+(\d+)", v.stdout or "")
                if mm:
                    free += int(mm.group(1))
            used = max(0, total - free * page)
            mem = {
                "total_gb": round(total / 1e9, 1),
                "used_gb": round(used / 1e9, 1),
                "pct": round(100 * used / total, 1) if total else None,
            }
        else:
            brand = "Apple"
    except (subprocess.TimeoutExpired, OSError, ValueError):
        brand = "Apple"
    cpu_pct = None
    if ncpu:
        cpu_pct = round(min(100.0, 100.0 * load[0] / ncpu), 1)
    return {
        "name": "MAC",
        "host": socket.gethostname(),
        "status": "online",
        "cpu": brand,
        "ncpu": ncpu,
        "load": list(load),
        "cpu_pct": cpu_pct,
        "ram": mem,
        "role": "control brain",
    }


def _bigboi_tele() -> dict:
    now = time.time()
    hit = _CACHE.get("bigboi")
    if hit and now - hit[0] < TELE_TTL:
        return hit[1]
    out = {
        "name": "BIGBOI",
        "host": UNRAID,
        "status": "offline",
        "ssh": False,
        "user": SSH_USER,
        "cpu": None,
        "ncpu": None,
        "load": None,
        "cpu_pct": None,
        "ram": {},
        "gpus": [],
        "docker": None,
        "role": "primary compute",
    }
    ident = run_bigboi("identity", timeout=15)
    if ident.get("ok"):
        out["status"] = "online"
        out["ssh"] = True
        lines = [x.strip() for x in str(ident.get("out") or "").splitlines() if x.strip()]
        if lines:
            out["nodename"] = lines[0]
        for ln in lines:
            if ln.isdigit():
                out["ncpu"] = int(ln)
                break
        cpu = run_bigboi("cpu", timeout=12)
        if cpu.get("ok"):
            cl = [x.strip() for x in str(cpu.get("out") or "").splitlines() if x.strip()]
            for ln in cl:
                if "MemTotal" in ln:
                    kb = int(re.sub(r"\D", "", ln) or "0")
                    gb = round(kb / 1024 / 1024)
                    out["ram"] = {"total_gb": gb}
                parts = ln.split()
                if len(parts) >= 3 and parts[0].replace(".", "", 1).isdigit() and "Mem" not in ln:
                    try:
                        loads = [float(parts[0]), float(parts[1]), float(parts[2])]
                        out["load"] = loads
                        n = out.get("ncpu") or 128
                        out["cpu_pct"] = round(min(100.0, 100.0 * loads[0] / n), 1)
                    except ValueError:
                        pass
        out["cpu"] = "2× AMD EPYC 7601"
        dock = run_bigboi("docker", timeout=22)
        if dock.get("ok"):
            nums = [x.strip() for x in str(dock.get("out") or "").splitlines() if x.strip()]
            try:
                out["docker"] = {
                    "all": int(nums[0]) if nums else None,
                    "up": int(nums[1]) if len(nums) > 1 else None,
                    "ok": True,
                }
            except ValueError:
                out["docker"] = {"ok": True, "raw": str(dock.get("out"))[:80]}
        else:
            out["docker"] = {"ok": False, "error": dock.get("error") or "timeout"}
        ram = run_bigboi("ram", timeout=12)
        if ram.get("ok"):
            for ln in str(ram.get("out") or "").splitlines():
                if "MemTotal" in ln:
                    kb = int(re.sub(r"\D", "", ln) or "0")
                    out["ram"] = {"total_gb": round(kb / 1024 / 1024)}
        gpu = run_bigboi("gpu", timeout=12)
        if gpu.get("ok"):
            gpus = []
            for ln in str(gpu.get("out") or "").splitlines():
                parts = [p.strip() for p in ln.split(",")]
                if len(parts) >= 3:
                    gpus.append({"name": parts[0], "vram": parts[1], "util": parts[2], "present": True})
            out["gpus"] = gpus
    else:
        out["error"] = ident.get("error") or "ssh failed"
    _CACHE["bigboi"] = (now, out)
    return out


def _ollama_tele() -> dict:
    now = time.time()
    hit = _CACHE.get("ollama")
    if hit and now - hit[0] < TELE_TTL:
        return hit[1]
    info = {
        "name": "OLLAMA",
        "endpoint": OLLAMA,
        "status": "offline",
        "models": [],
        "delegate": OLLAMA_DELEGATE,
        "gpu": None,
        "note": "LAN only — not exposed to the internet",
    }
    try:
        with urlopen(OLLAMA + "/api/tags", timeout=4) as r:
            data = json.loads(r.read().decode("utf-8", "replace") or "{}")
        names = []
        for m in data.get("models") or []:
            n = str((m or {}).get("name") or "")
            if n:
                names.append(n)
        info["status"] = "online"
        info["models"] = names[:24]
    except Exception:
        info["status"] = "stopped"
        info["note"] = "container ollama is Exited — not started (Tesla M10 fans). Approval to start."
    _CACHE["ollama"] = (now, info)
    return info


def _cloud_tele() -> dict:
    c = run_cloud("status")
    return {
        "name": "CLOUD AI",
        "provider": c.get("provider"),
        "model": c.get("model"),
        "status": "available" if c.get("ok") else "down",
        "hermes_api": c.get("hermes_api"),
        "note": "primary reasoning — not replaced by Ollama",
    }


def snapshot() -> dict:
    st = _load()
    jobs = list(st.get("jobs") or [])
    active = [j for j in jobs if j.get("status") == "running"]
    queued = [j for j in jobs if j.get("status") == "queued"]
    done = [j for j in jobs if j.get("status") in ("ok", "fail", "done")]
    last = jobs[-1] if jobs else None
    ov = st.get("override") or "AUTO"
    return {
        "ok": True,
        "subsystem": "HELIX COMPUTE",
        "override": ov,
        "active_target": (last or {}).get("target") or ("AUTO" if ov == "AUTO" else ov),
        "mac": _mac_tele(),
        "bigboi": _bigboi_tele(),
        "ollama": _ollama_tele(),
        "cloud": _cloud_tele(),
        "honcho": _honcho_tele(),
        "active": active[-8:],
        "queued": queued[-8:],
        "completed": done[-12:],
        "ssh_user": SSH_USER,
        "ssh_root_default": SSH_USER == "root",
        "ssh_recovery_root_kept": SSH_KEY_ROOT.is_file(),
        "hermes_terminal_backend": "local",
        "note": "Hermes terminal.backend stays local. BigBoi is opt-in via this layer.",
    }


def act(data: dict) -> dict:
    action = str((data or {}).get("action") or "snapshot").strip().lower()
    if action in ("snapshot", "status", ""):
        return snapshot()
    if action == "override":
        t = str(data.get("target") or "AUTO").upper()
        if t not in TARGETS:
            return {"ok": False, "error": "bad target"}
        st = _load()
        st["override"] = t
        _save(st)
        return {"ok": True, "override": t, **snapshot()}
    if action == "route":
        task = str(data.get("task") or "")
        r = route_compute(task, override=str(data.get("override") or "") or None)
        job = _job("route", r["target"], task, "done", r["reason"])
        _push(job)
        r["job"] = job
        return r
    if action == "run":
        kind = str(data.get("kind") or "identity").strip()
        task = str(data.get("task") or kind)
        routed = route_compute(task)
        target = routed["target"]
        if kind in ("identity", "cpu", "python", "docker") or target == "BIGBOI":
            rec = kind if kind in RECIPES else "identity"
            res = run_bigboi(rec)
            st = "ok" if res.get("ok") else "fail"
            job = _job(kind, "BIGBOI", task, st, res.get("out") or res.get("error") or "")
            _push(job)
            res["job"] = job
            res["route"] = routed
            return res
        if kind == "ollama" or target == "OLLAMA-LOCAL":
            res = run_ollama(str(data.get("prompt") or task))
            st = "ok" if res.get("ok") else "fail"
            job = _job("ollama", "OLLAMA-LOCAL", task, st, res.get("out") or res.get("error") or "")
            _push(job)
            res["job"] = job
            res["route"] = routed
            return res
        if kind == "cloud" or target == "CLOUD-AI":
            res = run_cloud(task)
            job = _job("cloud", "CLOUD-AI", task, "ok" if res.get("ok") else "fail", res.get("note") or "")
            _push(job)
            res["job"] = job
            return res
        res = run_local("hostname; sysctl -n hw.ncpu")
        job = _job("local", "LOCAL-MAC", task, "ok" if res.get("ok") else "fail", res.get("out") or "")
        _push(job)
        res["job"] = job
        res["route"] = routed
        return res
    return {"ok": False, "error": "unknown action"}
