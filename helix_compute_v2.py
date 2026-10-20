"""HELIX COMPUTE v2 — plans, capabilities, circuit breakers.

Does not replace helix_compute routing or helix_jobs. Adds named capabilities
and multi-stage plans. Natural language never becomes a shell string.
"""
from __future__ import annotations

import json
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATE = ROOT / "helix-compute.json"
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
KEEP = re.compile(r"(error|fail|warn|fatal|oom|killed|exit|timeout|unhealthy)", re.I)
MAX_OUT = 4000
BREAKER_FAILS = 3
BREAKER_COOL = 90
VERSION = "2.0"

READ = "READ"
SAFE = "SAFE-ACTION"
PRIVILEGED = "PRIVILEGED"
DESTRUCTIVE = "DESTRUCTIVE"

POLICIES = ("FAST", "BALANCED", "LOCAL-FIRST")
_LOCK = threading.Lock()
_BREAK: dict[str, dict] = {}


def _st() -> dict:
    try:
        data = json.loads(STATE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return {}


def _save_st(data: dict) -> None:
    tmp = STATE.with_suffix(".json.tmp")
    cur = _st()
    cur.update(data)
    tmp.write_text(json.dumps(cur, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(STATE)


def get_policy() -> str:
    p = str(_st().get("policy") or "BALANCED").upper()
    return p if p in POLICIES else "BALANCED"


def set_policy(name: str) -> dict:
    p = (name or "").upper().replace("LOCAL", "LOCAL-FIRST")
    if p in ("LOCAL-FIRST", "LOCAL FIRST"):
        p = "LOCAL-FIRST"
    if p not in POLICIES:
        return {"ok": False, "error": "bad policy"}
    st = _st()
    st["policy"] = p
    _save_st(st)
    return {"ok": True, "policy": p}


def metrics() -> dict:
    m = _st().get("metrics") or {}
    return {
        "jobs_completed": int(m.get("jobs_completed") or 0),
        "jobs_failed": int(m.get("jobs_failed") or 0),
        "jobs_partial": int(m.get("jobs_partial") or 0),
        "local_jobs": int(m.get("local_jobs") or 0),
        "cloud_jobs": int(m.get("cloud_jobs") or 0),
        "duration_ms_sum": int(m.get("duration_ms_sum") or 0),
        "duration_n": int(m.get("duration_n") or 0),
        "ollama_timeouts": int(m.get("ollama_timeouts") or 0),
        "worker_failures": int(m.get("worker_failures") or 0),
        "bytes_local": int(m.get("bytes_local") or 0),
        "bytes_cloud": int(m.get("bytes_cloud") or 0),
    }


def bump_metric(key: str, n: int = 1) -> None:
    with _LOCK:
        st = _st()
        m = dict(st.get("metrics") or {})
        m[key] = int(m.get(key) or 0) + n
        st["metrics"] = m
        _save_st(st)


# --- circuit breakers ---

def breaker_state(target: str) -> str:
    b = _BREAK.get(target) or {}
    until = float(b.get("until") or 0)
    if until and time.time() < until:
        return "DEGRADED"
    fails = int(b.get("fails") or 0)
    if fails >= BREAKER_FAILS:
        return "DEGRADED"
    if b.get("offline"):
        return "OFFLINE"
    return "ONLINE"


def breaker_fail(target: str) -> None:
    b = _BREAK.setdefault(target, {"fails": 0, "until": 0})
    b["fails"] = int(b.get("fails") or 0) + 1
    if b["fails"] >= BREAKER_FAILS:
        b["until"] = time.time() + BREAKER_COOL


def breaker_ok(target: str) -> None:
    _BREAK[target] = {"fails": 0, "until": 0, "offline": False}


def breaker_mock_fail(target: str, n: int = 3) -> None:
    """Test helper — does not touch live services."""
    for _ in range(n):
        breaker_fail(target)


def node_states() -> dict:
    from helix_compute import _mac_tele, _bigboi_tele, _ollama_tele, _cloud_tele, _unraid_hermes_tele, _honcho_tele

    mac = _mac_tele()
    bb = _bigboi_tele()
    ol = _ollama_tele()
    cl = _cloud_tele()
    uh = _unraid_hermes_tele()
    ho = _honcho_tele()

    def wrap(key: str, online: bool) -> str:
        if not online:
            _BREAK.setdefault(key, {})["offline"] = True
            return "OFFLINE"
        _BREAK.setdefault(key, {})["offline"] = False
        st = breaker_state(key)
        return st if st != "ONLINE" else "ONLINE"

    return {
        "MAC": wrap("mac", mac.get("status") == "online"),
        "BIGBOI": wrap("bigboi", bool(bb.get("ssh"))),
        "UNRAID HERMES": wrap("unraid", bool(uh.get("online"))),
        "OLLAMA": wrap("ollama", ol.get("status") == "online"),
        "CLOUD": wrap("cloud", cl.get("status") in ("available", "ONLINE", "online")),
        "HONCHO": wrap("honcho", bool(ho.get("online"))),
        "telemetry": {
            "mac": {"cpu_pct": mac.get("cpu_pct"), "load": mac.get("load"), "ncpu": mac.get("ncpu")},
            "bigboi": {
                "cpu_pct": bb.get("cpu_pct"),
                "ram": bb.get("ram"),
                "load": bb.get("load"),
                "docker": bb.get("docker"),
                "gpus": bb.get("gpus") or [],
            },
            "ollama": {"status": ol.get("status"), "models": (ol.get("models") or [])[:8], "endpoint": ol.get("endpoint")},
            "cloud": {"provider": cl.get("provider"), "model": cl.get("model"), "status": cl.get("status")},
        },
    }


# --- capabilities ---

def _recipe(cap: str) -> str:
    return {
        "bigboi.status": "identity",
        "bigboi.cpu": "cpu",
        "bigboi.memory": "ram",
        "bigboi.load": "load",
        "bigboi.processes": "processes",
        "bigboi.storage": "df",
        "bigboi.gpu.status": "gpu",
        "bigboi.docker.list": "docker-ps",
        "bigboi.docker.stats": "docker-stats",
        "bigboi.docker.inspect": "docker-inspect",
        "bigboi.docker.logs": "docker-logs",
        "bigboi.docker.start": "docker-start",
        "bigboi.docker.stop": "docker-stop",
        "bigboi.docker.restart": "docker-restart",
        "bigboi.ollama.status": "ollama-health",
        "bigboi.ollama.models": "ollama-models",
        "bigboi.hermes.status": "hermes-health",
        "bigboi.network.status": "network",
    }[cap]


CAPS = {
    "bigboi.status": {"target": "BIGBOI", "risk": READ, "timeout": 15, "params": [], "approval": False},
    "bigboi.cpu": {"target": "BIGBOI", "risk": READ, "timeout": 12, "params": [], "approval": False},
    "bigboi.memory": {"target": "BIGBOI", "risk": READ, "timeout": 12, "params": [], "approval": False},
    "bigboi.load": {"target": "BIGBOI", "risk": READ, "timeout": 12, "params": [], "approval": False},
    "bigboi.processes": {"target": "BIGBOI", "risk": READ, "timeout": 12, "params": [], "approval": False},
    "bigboi.storage": {"target": "BIGBOI", "risk": READ, "timeout": 12, "params": [], "approval": False},
    "bigboi.gpu.status": {"target": "BIGBOI", "risk": READ, "timeout": 12, "params": [], "approval": False},
    "bigboi.docker.list": {"target": "BIGBOI", "risk": READ, "timeout": 20, "params": [], "approval": False},
    "bigboi.docker.stats": {"target": "BIGBOI", "risk": READ, "timeout": 20, "params": [], "approval": False},
    "bigboi.docker.inspect": {"target": "BIGBOI", "risk": READ, "timeout": 15, "params": ["name"], "approval": False},
    "bigboi.docker.logs": {"target": "BIGBOI", "risk": READ, "timeout": 15, "params": ["name"], "approval": False},
    "bigboi.docker.start": {"target": "BIGBOI", "risk": PRIVILEGED, "timeout": 40, "params": ["name"], "approval": True},
    "bigboi.docker.stop": {"target": "BIGBOI", "risk": PRIVILEGED, "timeout": 40, "params": ["name"], "approval": True},
    "bigboi.docker.restart": {"target": "BIGBOI", "risk": PRIVILEGED, "timeout": 40, "params": ["name"], "approval": True},
    "bigboi.ollama.status": {"target": "BIGBOI", "risk": READ, "timeout": 8, "params": [], "approval": False},
    "bigboi.ollama.models": {"target": "BIGBOI", "risk": READ, "timeout": 8, "params": [], "approval": False},
    "bigboi.hermes.status": {"target": "BIGBOI", "risk": READ, "timeout": 8, "params": [], "approval": False},
    "bigboi.network.status": {"target": "BIGBOI", "risk": READ, "timeout": 12, "params": [], "approval": False},
    "ollama.summarise": {"target": "OLLAMA-LOCAL", "risk": READ, "timeout": 8, "params": ["text"], "approval": False},
    "mac.finalise": {"target": "MAC-HERMES", "risk": READ, "timeout": 8, "params": ["text"], "approval": False},
    "home.ping": {"target": "LOCAL-MAC", "risk": READ, "timeout": 1, "params": [], "approval": False},
    "home.status": {"target": "LOCAL-MAC", "risk": READ, "timeout": 4, "params": [], "approval": False},
    "home.rooms": {"target": "LOCAL-MAC", "risk": READ, "timeout": 4, "params": [], "approval": False},
    "home.devices": {"target": "LOCAL-MAC", "risk": READ, "timeout": 4, "params": [], "approval": False},
    "home.room.status": {"target": "LOCAL-MAC", "risk": READ, "timeout": 4, "params": ["room"], "approval": False},
    "home.device.status": {"target": "LOCAL-MAC", "risk": READ, "timeout": 4, "params": ["id"], "approval": False},
    "home.lights.status": {"target": "LOCAL-MAC", "risk": READ, "timeout": 4, "params": [], "approval": False},
    "home.light.on": {"target": "LOCAL-MAC", "risk": READ, "timeout": 8, "params": ["id"], "approval": False},
    "home.light.off": {"target": "LOCAL-MAC", "risk": READ, "timeout": 8, "params": ["id"], "approval": False},
    "home.light.toggle": {"target": "LOCAL-MAC", "risk": READ, "timeout": 8, "params": ["id"], "approval": False},
    "home.light.brightness": {"target": "LOCAL-MAC", "risk": READ, "timeout": 8, "params": ["id", "brightness"], "approval": False},
    "home.light.colour": {"target": "LOCAL-MAC", "risk": READ, "timeout": 8, "params": ["id", "colour"], "approval": False},
    "home.room.lights.on": {"target": "LOCAL-MAC", "risk": READ, "timeout": 8, "params": ["room"], "approval": False},
    "home.room.lights.off": {"target": "LOCAL-MAC", "risk": READ, "timeout": 8, "params": ["room"], "approval": False},
    "home.room.lights.brightness": {"target": "LOCAL-MAC", "risk": READ, "timeout": 8, "params": ["room", "brightness"], "approval": False},
    "home.room.lights.colour": {"target": "LOCAL-MAC", "risk": READ, "timeout": 8, "params": ["room", "colour"], "approval": False},
    "home.scene.apply": {"target": "LOCAL-MAC", "risk": READ, "timeout": 8, "params": ["scene"], "approval": False},
    "media.ping": {"target": "LOCAL-MAC", "risk": READ, "timeout": 1, "params": [], "approval": False},
    "network.ping": {"target": "LOCAL-MAC", "risk": READ, "timeout": 1, "params": [], "approval": False},
    "security.ping": {"target": "LOCAL-MAC", "risk": READ, "timeout": 1, "params": [], "approval": False},
    "memory.ping": {"target": "LOCAL-MAC", "risk": READ, "timeout": 1, "params": [], "approval": False},
    "memory.status": {"target": "LOCAL-MAC", "risk": READ, "timeout": 4, "params": [], "approval": False},
    "memory.preferences.list": {"target": "LOCAL-MAC", "risk": READ, "timeout": 6, "params": [], "approval": False},
    "memory.preferences.get": {"target": "LOCAL-MAC", "risk": READ, "timeout": 6, "params": ["id"], "approval": False},
    "memory.preferences.set": {"target": "LOCAL-MAC", "risk": READ, "timeout": 8, "params": [], "approval": False},
    "memory.preferences.delete": {"target": "LOCAL-MAC", "risk": READ, "timeout": 8, "params": ["id"], "approval": False},
    "memory.preferences.apply": {"target": "LOCAL-MAC", "risk": READ, "timeout": 8, "params": [], "approval": False},
}


def list_caps() -> dict:
    out = []
    for name, c in CAPS.items():
        out.append({"name": name, **c, "handler": name, "allowed_output": "text/plain truncated"})
    return {"ok": True, "version": VERSION, "capabilities": out}


def compress(text: str, *, src: str = "local") -> dict:
    raw = text or ""
    n = len(raw.encode("utf-8", "replace"))
    lines = raw.splitlines()
    kept = [ln for ln in lines if KEEP.search(ln)]
    body = "\n".join(kept if kept else lines[:80])
    truncated = n > MAX_OUT or len(body) > MAX_OUT
    if truncated:
        body = body[:MAX_OUT]
    if src == "cloud":
        bump_metric("bytes_cloud", min(n, MAX_OUT))
    else:
        bump_metric("bytes_local", n)
    return {"text": body, "bytes_in": n, "truncated": truncated, "kept_errors": len(kept)}


def invoke(name: str, params: dict | None = None, *, mock: dict | None = None) -> dict:
    params = params or {}
    if name.startswith("home.") and name != "home.ping":
        import helix_control as hctl
        return hctl.invoke(name, params, mock=mock)
    if name.startswith("memory."):
        import helix_prefs as hp
        return hp.invoke(name, params, mock=mock)
    if name not in CAPS:
        return {"ok": False, "error": "unknown capability", "capability": name}
    spec = CAPS[name]
    if spec["risk"] == DESTRUCTIVE:
        return {"ok": False, "error": "destructive rejected"}
    for p in spec.get("params") or []:
        if p not in params or params.get(p) in (None, ""):
            return {"ok": False, "error": "malformed parameters", "missing": p}
    extra = ""
    if "name" in (spec.get("params") or []):
        n = str(params.get("name") or "")
        if not NAME_RE.match(n):
            return {"ok": False, "error": "malformed parameters", "missing": "name"}
        extra = n
    if name.endswith(".ping"):
        return {"ok": True, "capability": name, "out": "namespace reserved", "risk": READ}
    if spec.get("approval") and not (params.get("approved")):
        return {"ok": False, "error": "approval required", "risk": spec["risk"], "capability": name}

    if mock is not None:
        return {"ok": True, "capability": name, "out": str(mock.get("out") or ""), "mocked": True}

    if name == "ollama.summarise":
        st = breaker_state("ollama")
        if st != "ONLINE":
            return {"ok": False, "error": "DEGRADED", "target": "OLLAMA-LOCAL", "note": "no large generate"}
        # Health only — do not start a large model.
        from helix_compute import run_bigboi
        h = run_bigboi("ollama-health", timeout=6)
        if not h.get("ok") or "200" not in str(h.get("out") or ""):
            breaker_fail("ollama")
            bump_metric("ollama_timeouts")
            return {"ok": False, "error": "DEGRADED", "note": "ollama tags not 200"}
        breaker_ok("ollama")
        text = str(params.get("text") or "")[:1500]
        c = compress(text)
        return {"ok": True, "capability": name, "out": "local filter only (no generate): " + c["text"][:600], "truncated": c["truncated"]}

    if name == "mac.finalise":
        c = compress(str(params.get("text") or ""))
        return {"ok": True, "capability": name, "out": c["text"][:1200], "truncated": c["truncated"]}

    from helix_compute import run_bigboi

    rec = _recipe(name)
    res = run_bigboi(rec, extra=extra, timeout=int(spec["timeout"]))
    if res.get("ok"):
        breaker_ok("bigboi")
    else:
        breaker_fail("bigboi")
        bump_metric("worker_failures")
    c = compress(str(res.get("out") or res.get("error") or ""))
    return {
        "ok": bool(res.get("ok")),
        "capability": name,
        "out": c["text"],
        "truncated": c["truncated"],
        "bytes_in": c["bytes_in"],
        "error": None if res.get("ok") else (res.get("error") or "fail"),
        "risk": spec["risk"],
    }


def parallel_read(names: list[str]) -> dict:
    got = []
    with ThreadPoolExecutor(max_workers=4) as ex:
        futs = {ex.submit(invoke, n): n for n in names}
        for fut in as_completed(futs):
            got.append(fut.result())
    ok = [g for g in got if g.get("ok")]
    return {"ok": bool(ok), "partial": len(ok) != len(got), "results": got}


def make_plan(task: str, *, policy: str | None = None) -> dict:
    t = (task or "").strip()
    low = t.lower()
    pol = (policy or get_policy()).upper()
    if pol not in POLICIES:
        pol = "BALANCED"
    steps = []
    why = []

    dockerish = any(k in low for k in ("docker", "container"))
    slow = any(k in low for k in ("slow", "why", "performance", "load", "ram", "cpu", "gpu"))
    local_sum = any(k in low for k in ("summar", "locally"))
    bigboi_data = any(k in low for k in ("bigboi", "unraid", "docker", "ram on", "using ram")) or slow

    if dockerish and not slow:
        steps.append({"target": "BIGBOI", "action": "bigboi.docker.list", "why": "Docker data exists on this host."})
        why.append("BIGBOI selected: Docker data exists on this host.")
    elif bigboi_data or slow:
        steps.append({"target": "BIGBOI", "action": "bigboi.status", "why": "Live host identity."})
        steps.append({"target": "BIGBOI", "action": "bigboi.cpu", "why": "CPU/load on this host."})
        steps.append({"target": "BIGBOI", "action": "bigboi.memory", "why": "RAM on this host."})
        steps.append({"target": "BIGBOI", "action": "bigboi.load", "why": "Load averages."})
        steps.append({"target": "BIGBOI", "action": "bigboi.gpu.status", "why": "GPU util on this host."})
        steps.append({"target": "BIGBOI", "action": "bigboi.docker.list", "why": "Container inventory."})
        steps.append({"target": "BIGBOI", "action": "bigboi.docker.stats", "why": "Container CPU/RAM."})
        why.append("BIGBOI selected: telemetry must be collected where it lives.")
        ol_ok = breaker_state("ollama") == "ONLINE"
        if ol_ok and pol != "FAST":
            steps.append({"target": "OLLAMA-LOCAL", "action": "ollama.summarise", "why": "Local filter before any cloud."})
            why.append("OLLAMA selected: compress collected text locally (no large generate).")
        elif not ol_ok:
            why.append("OLLAMA DEGRADED: skip generate; keep local filter.")
        if pol == "FAST" or (pol == "BALANCED" and slow and "why" in low):
            steps.append({"target": "CLOUD-AI", "action": "reason", "why": "Deeper diagnosis only if collection succeeded."})
            why.append("CLOUD selected: complex root-cause if local data exists.")
        steps.append({"target": "MAC-HERMES", "action": "mac.finalise", "why": "Primary Hermes composes the answer."})
        why.append("MAC selected: final response assembled by primary Hermes.")
    elif local_sum:
        steps.append({"target": "OLLAMA-LOCAL", "action": "ollama.summarise", "why": "Local summarisation requested."})
        why.append("OLLAMA selected: local summarisation.")
        steps.append({"target": "MAC-HERMES", "action": "mac.finalise", "why": "Compose."})
    else:
        steps.append({"target": "MAC-HERMES", "action": "mac.finalise", "why": "Default small/local."})
        why.append("MAC selected: default.")

    return {
        "ok": True,
        "version": VERSION,
        "task": t[:240],
        "mode": "auto",
        "policy": pol,
        "steps": steps,
        "explain": why,
    }


def run_plan(task: str, *, policy: str | None = None, execute: bool = True) -> dict:
    plan = make_plan(task, policy=policy)
    steps = list(plan["steps"])
    collected = []
    phase = "PLANNING"
    failed = 0
    t0 = time.time()
    if not execute:
        return {**plan, "phase": phase, "results": []}

    reads = [s for s in steps if s["action"].startswith("bigboi.") and s["action"] not in (
        "bigboi.docker.start", "bigboi.docker.stop", "bigboi.docker.restart",
    )]
    rest = [s for s in steps if s not in reads]

    phase = "COLLECTING"
    if len(reads) > 1:
        par = parallel_read([s["action"] for s in reads])
        collected.extend(par["results"])
        failed += sum(1 for r in par["results"] if not r.get("ok"))
    else:
        for s in reads:
            collected.append(invoke(s["action"]))
            if not collected[-1].get("ok"):
                failed += 1

    phase = "PROCESSING"
    blob = "\n".join(str(r.get("out") or "") for r in collected)
    for s in rest:
        if s["action"] == "ollama.summarise":
            collected.append(invoke("ollama.summarise", {"text": blob}))
        elif s["action"] == "reason":
            collected.append({"ok": True, "capability": "cloud.reason", "out": "cloud not invoked (no large prompt); collection only", "skipped": True})
        elif s["action"] == "mac.finalise":
            phase = "REASONING"
            collected.append(invoke("mac.finalise", {"text": blob[:3500]}))

    dur = int((time.time() - t0) * 1000)
    bump_metric("duration_ms_sum", dur)
    bump_metric("duration_n")
    status = "COMPLETE"
    if failed and any(r.get("ok") for r in collected):
        status = "PARTIAL"
        bump_metric("jobs_partial")
    elif failed and not any(r.get("ok") for r in collected):
        status = "FAILED"
        bump_metric("jobs_failed")
    else:
        bump_metric("jobs_completed")
        bump_metric("local_jobs")

    return {
        **plan,
        "phase": status,
        "status": status,
        "duration_ms": dur,
        "results": collected,
        "failed_steps": failed,
        "bytes_local": metrics().get("bytes_local"),
        "bytes_cloud": metrics().get("bytes_cloud"),
    }


def doctor() -> dict:
    from helix_compute import (
        SSH_USER, SSH_KEY, run_bigboi, run_local, HERMES_API, OLLAMA,
        _unraid_hermes_tele, _honcho_tele, _cloud_tele,
    )
    checks = []

    def add(name, ok, reason):
        checks.append({"name": name, "state": "HEALTHY" if ok else "FAILED", "reason": reason})

    try:
        import urllib.request
        with urllib.request.urlopen(HERMES_API + "/health", timeout=4) as r:
            add("Mac Hermes", r.status == 200, "8642")
    except Exception:
        add("Mac Hermes", False, "8642 down")
    try:
        import urllib.request
        with urllib.request.urlopen("http://127.0.0.1:8790/health", timeout=4) as r:
            add("Helix backend", r.status == 200, ":8790")
    except Exception:
        add("Helix backend", False, ":8790 down")
    idn = run_bigboi("identity", timeout=12)
    add("bigboi SSH / helix-worker", bool(idn.get("ok")) and SSH_USER == "helix-worker", SSH_USER)
    add("SSH key", SSH_KEY.is_file(), "id_ed25519_helix_worker")
    uh = _unraid_hermes_tele()
    add("Unraid Hermes", bool(uh.get("online")), "8642 worker")
    ol = run_bigboi("ollama-health", timeout=6)
    add("Ollama", "200" in str(ol.get("out") or ""), "tags")
    ho = _honcho_tele()
    add("Honcho", bool(ho.get("online")), ":8000")
    cl = _cloud_tele()
    add("Cloud config", cl.get("provider") == "xai-oauth", cl.get("model") or "")
    add("job engine", True, "helix_jobs")
    add("capability registry", "bigboi.status" in CAPS, str(len(CAPS)))
    try:
        import helix_control as hctl
        checks.extend(hctl.extra_doctor_checks())
    except Exception:
        checks.append({"name": "Home registry", "state": "DEGRADED", "reason": "control import"})
    failed = [c for c in checks if c["state"] == "FAILED"]
    overall = "FAILED" if failed else "HEALTHY"
    if failed and len(failed) < len(checks) / 2:
        overall = "DEGRADED"
    return {"ok": True, "version": VERSION, "overall": overall, "checks": checks, "policy": get_policy()}
