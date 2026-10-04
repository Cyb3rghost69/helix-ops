"""HELIX COMPUTE jobs — local lifecycle. Does not replace /api/hermes/chat.

READ jobs may run. PRIVILEGED/DESTRUCTIVE wait for a deliberate APPROVE.
DESTRUCTIVE never executes even after approve (no deletes/format/reboot).
LLM-generated shell never reaches SSH.
"""
from __future__ import annotations

import json
import threading
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STATE = ROOT / "helix-compute-jobs.json"
MAX_JOBS = 40

READ = "READ"
SAFE = "SAFE-ACTION"
PRIVILEGED = "PRIVILEGED"
DESTRUCTIVE = "DESTRUCTIVE"

PLANNING = "PLANNING"
QUEUED = "QUEUED"
COLLECTING = "COLLECTING"
PROCESSING = "PROCESSING"
REASONING = "REASONING"
RUNNING_ACTION = "RUNNING_ACTION"
PARTIAL = "PARTIAL"
ROUTING = "ROUTING"
RUNNING = "RUNNING"
WAITING_APPROVAL = "WAITING_APPROVAL"
COMPLETE = "COMPLETE"
FAILED = "FAILED"
STOPPED = "STOPPED"

_LOCK = threading.Lock()
_THREADS: dict[str, threading.Event] = {}


def classify_policy(task: str) -> str:
    t = (task or "").lower()
    if any(
        k in t
        for k in (
            "delete plex",
            "delete appdata",
            "rm -rf",
            "format disk",
            "wipe",
            "mkfs",
            "btrfs",
            "modify array",
            "reboot",
            "shut down",
            "shutdown",
            "change ssh",
            "modify ssh",
            "useradd",
            "docker rm",
            "delete container",
            "recreate container",
            "docker.img",
            "docker prune",
        )
    ):
        return DESTRUCTIVE
    if any(k in t for k in ("restart plex", "docker start", "docker stop", "docker restart", "restart container", "medic escalate", "medic recreate")):
        return PRIVILEGED
    if any(k in t for k in ("python on bigboi", "cpu identity", "sleep job", "harmless")):
        return SAFE
    return READ


def _load() -> dict:
    try:
        data = json.loads(STATE.read_text(encoding="utf-8"))
        if isinstance(data, dict) and isinstance(data.get("jobs"), list):
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return {"jobs": []}


def _save(data: dict) -> None:
    tmp = STATE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(STATE)


def _event(job: dict, msg: str) -> None:
    ev = list(job.get("events") or [])
    ev.append({"t": time.strftime("%Y-%m-%dT%H:%M:%S"), "msg": msg[:240]})
    job["events"] = ev[-80:]


def list_jobs() -> dict:
    with _LOCK:
        jobs = list(_load().get("jobs") or [])
    buckets = {
        "active": [j for j in jobs if j.get("status") == RUNNING],
        "queued": [j for j in jobs if j.get("status") in (QUEUED, ROUTING)],
        "running": [j for j in jobs if j.get("status") == RUNNING],
        "waiting_approval": [j for j in jobs if j.get("status") == WAITING_APPROVAL],
        "completed": [j for j in jobs if j.get("status") == COMPLETE],
        "partial": [j for j in jobs if j.get("status") == PARTIAL],
        "failed": [j for j in jobs if j.get("status") == FAILED],
        "stopped": [j for j in jobs if j.get("status") == STOPPED],
    }
    return {"ok": True, "jobs": jobs[-MAX_JOBS:], **{k: v[-12:] for k, v in buckets.items()}}


def get_job(jid: str) -> dict:
    with _LOCK:
        for j in _load().get("jobs") or []:
            if j.get("id") == jid:
                return {"ok": True, "job": j}
    return {"ok": False, "error": "not found"}


def events(jid: str) -> dict:
    g = get_job(jid)
    if not g.get("ok"):
        return g
    return {"ok": True, "id": jid, "events": (g["job"].get("events") or [])}


def _put(job: dict) -> dict:
    st = _load()
    jobs = [j for j in (st.get("jobs") or []) if j.get("id") != job["id"]]
    jobs.append(job)
    st["jobs"] = jobs[-MAX_JOBS:]
    _save(st)
    return job


def _machine_specific(task: str) -> bool:
    t = (task or "").lower()
    return any(k in t for k in ("on bigboi", "on unraid", "docker on bigboi", "bigboi docker", "unraid docker"))


def create_job(task: str, *, target: str = "AUTO", kind: str = "") -> dict:
    from helix_compute import route_compute, run_bigboi, run_local, apply_fallback

    jid = "job_" + uuid.uuid4().hex[:12]
    policy = classify_policy(task)
    routed = route_compute(task)
    tgt = routed.get("target") or "LOCAL-MAC"
    job = {
        "id": jid,
        "task": (task or "")[:240],
        "target": tgt,
        "kind": kind or policy,
        "model": None,
        "provider": None,
        "worker": "helix-worker" if tgt == "BIGBOI" else "mac",
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "started": None,
        "duration": None,
        "status": QUEUED,
        "progress": 0,
        "approval_required": policy in (PRIVILEGED, DESTRUCTIVE),
        "policy": policy,
        "result": "",
        "error": None,
        "events": [],
        "run_id": None,
    }
    _event(job, "created policy=" + policy)
    job["status"] = ROUTING
    used, fb = apply_fallback("unraid" if tgt == "BIGBOI" else "mac", task=task)
    if fb:
        _event(job, fb)
    if used is None:
        job["status"] = FAILED
        job["error"] = fb or "BIGBOI UNAVAILABLE"
        with _LOCK:
            _put(job)
        return {"ok": False, "job": job}

    if policy in (PRIVILEGED, DESTRUCTIVE):
        job["status"] = WAITING_APPROVAL
        _event(job, "waiting approval — not executed")
        with _LOCK:
            _put(job)
        return {"ok": True, "job": job}

    job["status"] = RUNNING
    job["started"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    with _LOCK:
        _put(job)

    stop = threading.Event()
    _THREADS[jid] = stop

    def _run() -> None:
        t0 = time.time()
        try:
            if "sleep" in (task or "").lower() or kind == "sleep":
                n = 8
                for i in range(n):
                    if stop.is_set():
                        job["status"] = STOPPED
                        job["error"] = None
                        _event(job, "stopped")
                        break
                    time.sleep(1)
                    job["progress"] = int(100 * (i + 1) / n)
                    _event(job, f"tick {i+1}/{n}")
                else:
                    job["status"] = COMPLETE
                    job["result"] = "sleeper done"
                    job["progress"] = 100
                    _event(job, "complete")
            elif tgt == "BIGBOI" or "bigboi" in (task or "").lower() or kind in (
                "identity", "cpu", "ram", "load", "docker", "gpu", "python",
            ):
                rec = kind if kind in (
                    "identity", "cpu", "ram", "load", "df", "gpu", "docker",
                    "python", "hermes-health", "ollama-health",
                ) else "identity"
                if "docker" in (task or "").lower():
                    rec = "docker"
                if "gpu" in (task or "").lower():
                    rec = "gpu"
                res = run_bigboi(rec)
                job["result"] = (res.get("out") or res.get("error") or "")[:800]
                job["status"] = COMPLETE if res.get("ok") else FAILED
                job["error"] = None if res.get("ok") else (res.get("error") or "fail")
                _event(job, "bigboi " + rec)
            else:
                res = run_local("hostname; sysctl -n hw.ncpu")
                job["result"] = (res.get("out") or "")[:800]
                job["status"] = COMPLETE if res.get("ok") else FAILED
                _event(job, "local")
        except Exception as e:
            job["status"] = FAILED
            job["error"] = type(e).__name__
            _event(job, "error " + type(e).__name__)
        job["duration"] = int((time.time() - t0) * 1000)
        with _LOCK:
            _put(job)
        _THREADS.pop(jid, None)

    threading.Thread(target=_run, name="hjob-" + jid, daemon=True).start()
    return {"ok": True, "job": job}


def approve_job(jid: str, *, allow: bool = True) -> dict:
    with _LOCK:
        g = None
        st = _load()
        for j in st.get("jobs") or []:
            if j.get("id") == jid:
                g = j
                break
        if not g:
            return {"ok": False, "error": "not found"}
        if g.get("status") != WAITING_APPROVAL:
            return {"ok": False, "error": "not waiting", "job": g}
        if not allow:
            g["status"] = STOPPED
            _event(g, "denied")
            _put(g)
            return {"ok": True, "job": g}
        if g.get("policy") == DESTRUCTIVE:
            g["status"] = FAILED
            g["error"] = "destructive not executed"
            _event(g, "approved but Helix will not run destructive actions")
            _put(g)
            return {"ok": True, "job": g}
        g["status"] = FAILED
        g["error"] = "privileged has no sudo rule"
        _event(g, "approved but no narrow sudo exists — not executed")
        _put(g)
        return {"ok": True, "job": g}


def steer_job(jid: str, message: str) -> dict:
    with _LOCK:
        g = None
        for j in _load().get("jobs") or []:
            if j.get("id") == jid:
                g = j
                break
        if not g:
            return {"ok": False, "error": "not found"}
        _event(g, "steer " + (message or "")[:200])
        _put(g)
        return {"ok": True, "job": g}


def stop_job(jid: str) -> dict:
    ev = _THREADS.get(jid)
    if ev:
        ev.set()
    with _LOCK:
        g = None
        for j in _load().get("jobs") or []:
            if j.get("id") == jid:
                g = j
                break
        if not g:
            return {"ok": False, "error": "not found"}
        if g.get("status") in (RUNNING, PLANNING, COLLECTING, PROCESSING, REASONING):
            g["status"] = STOPPED
            _event(g, "stop requested")
            _put(g)
        return {"ok": True, "job": g}


def plan_job(task: str, *, policy: str | None = None) -> dict:
    import helix_compute_v2 as v2

    jid = "job_" + uuid.uuid4().hex[:12]
    plan = v2.make_plan(task, policy=policy)
    job = {
        "id": jid,
        "task": (task or "")[:240],
        "target": "PLAN",
        "kind": "plan",
        "worker": "mac",
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "started": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "duration": None,
        "status": PLANNING,
        "progress": 0,
        "approval_required": False,
        "policy": plan.get("policy"),
        "plan": plan,
        "explain": plan.get("explain") or [],
        "result": "",
        "error": None,
        "events": [],
        "run_id": None,
    }
    _event(job, "plan " + str(len(plan.get("steps") or [])) + " steps")
    with _LOCK:
        _put(job)
    stop = threading.Event()
    _THREADS[jid] = stop

    def _run() -> None:
        job["status"] = COLLECTING
        _event(job, "collecting")
        with _LOCK:
            _put(job)
        out = v2.run_plan(task, policy=policy, execute=True)
        if stop.is_set():
            job["status"] = STOPPED
        else:
            job["status"] = out.get("status") or COMPLETE
            job["result"] = json.dumps({"explain": out.get("explain"), "failed": out.get("failed_steps")}, ensure_ascii=False)[:800]
            job["plan"] = out
        job["duration"] = out.get("duration_ms")
        with _LOCK:
            _put(job)
        _THREADS.pop(jid, None)

    threading.Thread(target=_run, name="hplan-" + jid, daemon=True).start()
    return {"ok": True, "job": job}
