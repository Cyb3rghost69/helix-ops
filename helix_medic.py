"""HELIX Medic — deterministic Docker observer/repair on top of helix-docker-guard.

LLM never talks to docker.sock. Desired-running containers auto-restart after
consecutive failures. Manual/desired stops are not fought. Forbidden ops stay denied.
"""
from __future__ import annotations

import json
import re
import threading
import time
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
STATE = ROOT / "helix-medic.json"
INCIDENTS = ROOT / "helix-medic-incidents.json"
VERSION = "1.2"

HEALTHY = "HEALTHY"
SUSPECT = "SUSPECT"
DIAGNOSING = "DIAGNOSING"
RECOVERING = "RECOVERING"
VERIFYING = "VERIFYING"
ESCALATED = "ESCALATED"

OBSERVE = "observe"
RESTART = "restart"
REPAIR = "repair"

FORBIDDEN = (
    "prune", "volume prune", "system prune", "docker.img", "appdata",
    "format", "mkfs", "reboot", "shutdown", "rm -rf", "delete volume",
    "delete appdata", "update unraid", "update docker", "expose docker",
    "2375", "docker rm", "remove container", "pull image", "rollback",
)

NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")

LOG_SIGS = (
    (r"out of memory|oom", "OOM"),
    (r"sqlite.*(lock|busy)", "SQLITE_LOCK"),
    (r"no space left", "DISK_FULL"),
    (r"connection refused", "CONN_REFUSED"),
    (r"unhealthy", "UNHEALTHY"),
    (r"database is locked", "SQLITE_LOCK"),
    (r"i/o error|read-only file system", "FS_ERROR"),
)

DEFAULTS = {
    "failure_threshold": 3,
    "verify_seconds": 45,
    "max_restarts": 2,
    "restart_window_sec": 600,
    "cooldown_sec": 300,
    "poll_sec": 30,
    "auto_restart": True,
    "never_autorepair": ["ollama", "transmission"],
    "dependencies": {
        "honcho-api-1": ["honcho-database-1", "honcho-redis-1"],
        "immich": ["immich-postgres", "Immich_Valkey"],
        "radarr": ["prowlarr"],
        "Sonarr": ["prowlarr"],
        "Seerr": ["radarr", "Sonarr"],
    },
    "http_probes": {
        "Hermes-Agent": "http://192.168.1.84:8642/health",
        "helix-command": "http://192.168.1.84:8788/",
        "honcho-api-1": "http://192.168.1.84:8000/health",
    },
}

_LOCK = threading.Lock()
_STOP = threading.Event()
_THREAD: threading.Thread | None = None
_MOCK: dict | None = None


def _load() -> dict:
    try:
        data = json.loads(STATE.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return {
        "version": VERSION,
        "policy": dict(DEFAULTS),
        "containers": {},
        "desired": {},
        "modes": {},
        "restarts": {},
        "fleet": "UNKNOWN",
        "last_reconcile": None,
        "watchdog_ok": True,
    }


def _save(data: dict) -> None:
    tmp = STATE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(STATE)
    try:
        STATE.chmod(0o600)
    except OSError:
        pass


def _inc_load() -> list[dict]:
    try:
        data = json.loads(INCIDENTS.read_text(encoding="utf-8"))
        if isinstance(data, list):
            return data[-80:]
    except (OSError, json.JSONDecodeError):
        pass
    return []


def _inc_save(rows: list[dict]) -> None:
    tmp = INCIDENTS.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(rows[-80:], ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(INCIDENTS)


def record_incident(**fields: Any) -> dict:
    row = {"id": "inc_" + hex(int(time.time() * 1000))[2:], "t": time.strftime("%Y-%m-%dT%H:%M:%S"), **fields}
    with _LOCK:
        rows = _inc_load()
        rows.append(row)
        _inc_save(rows)
    return row


def analyse_logs(text: str) -> dict:
    raw = text or ""
    hits = []
    for pat, name in LOG_SIGS:
        if re.search(pat, raw, re.I):
            hits.append(name)
    lines = [ln for ln in raw.splitlines() if re.search(r"error|fail|fatal|oom|lock|unhealthy|refused", ln, re.I)]
    excerpt = "\n".join((lines or raw.splitlines())[-12:])[:2000]
    truncated = len(raw) > 2000
    return {"signatures": hits, "excerpt": excerpt, "truncated": truncated, "bytes_in": len(raw.encode())}


def forbidden(task: str) -> bool:
    t = (task or "").lower()
    return any(k in t for k in FORBIDDEN)


def mode_of(st: dict, name: str, desired: str | None = None) -> str:
    never = ({**DEFAULTS, **(st.get("policy") or {})}).get("never_autorepair") or []
    if name in never:
        return OBSERVE
    m = (st.get("modes") or {}).get(name)
    if m in (OBSERVE, RESTART, REPAIR):
        return m
    pol = {**DEFAULTS, **(st.get("policy") or {})}
    want = desired if desired is not None else (st.get("desired") or {}).get(name)
    if pol.get("auto_restart") and want == "running":
        return RESTART
    return OBSERVE


def set_auto(enabled: bool) -> dict:
    with _LOCK:
        st = _load()
        pol = {**DEFAULTS, **(st.get("policy") or {})}
        pol["auto_restart"] = bool(enabled)
        st["policy"] = pol
        _save(st)
    return {"ok": True, "auto_restart": bool(enabled)}


def set_mode(name: str, mode: str) -> dict:
    if not NAME_RE.match(name or ""):
        return {"ok": False, "error": "bad name"}
    if mode not in (OBSERVE, RESTART, REPAIR):
        return {"ok": False, "error": "bad mode"}
    with _LOCK:
        st = _load()
        st.setdefault("modes", {})[name] = mode
        _save(st)
    return {"ok": True, "name": name, "mode": mode}


def guard(cmd: str, extra: str = "", *, mock: dict | None = None, timeout: int = 25) -> dict:
    named = ("inspect", "mounts", "logs", "health", "start", "restart")
    plain = ("version", "info", "ps", "stats", "ping")
    if not isinstance(cmd, str) or not isinstance(extra, str):
        return {"ok": False, "error": "bad arguments", "denied": True}
    if cmd in named:
        if not NAME_RE.fullmatch(extra):
            return {"ok": False, "error": "bad name", "denied": True}
    elif cmd in plain:
        if extra:
            return {"ok": False, "error": "unexpected arguments", "denied": True}
    elif cmd == "events":
        if extra and not (re.fullmatch(r"[1-9][0-9]{0,3}s", extra) and int(extra[:-1]) <= 3600):
            return {"ok": False, "error": "bad event window", "denied": True}
    else:
        return {"ok": False, "error": "denied", "denied": True}
    mock = mock if mock is not None else _MOCK
    if mock is not None:
        key = cmd if not extra else f"{cmd}:{extra}"
        row = (mock.get("cmds") or {}).get(key) or (mock.get("cmds") or {}).get(cmd)
        if row is None:
            return {"ok": False, "error": "denied", "denied": True}
        return {"ok": True, "out": str(row), "mocked": True}
    import subprocess
    from helix_compute import SSH_KEY, SSH_USER, UNRAID
    ssh = [
        "ssh", "-i", str(SSH_KEY), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=10", "-o", "ForwardAgent=no", "-o", "ForwardX11=no",
        "-o", "ControlMaster=auto", "-o", "ControlPath=/tmp/hc-%C", "-o", "ControlPersist=60",
        f"{SSH_USER}@{UNRAID}",
    ]
    remote = "sudo -n /usr/local/sbin/helix-docker-guard " + cmd + ((" " + extra) if extra else "")
    try:
        p = subprocess.run(ssh + [remote], capture_output=True, text=True, timeout=timeout)
    except Exception as e:
        return {"ok": False, "error": type(e).__name__}
    out = (p.stdout or "")[-12000:]
    if p.returncode != 0:
        err = (p.stderr or out or "fail")[:400]
        denied = "denied" in err.lower() or "denied" in out.lower()
        return {"ok": False, "error": "denied" if denied else err.strip(), "denied": denied, "out": out}
    return {"ok": True, "out": out}


def parse_ps(text: str) -> list[dict]:
    rows = []
    for ln in (text or "").splitlines():
        parts = ln.split("|")
        if len(parts) < 2:
            continue
        rows.append({
            "name": parts[0].strip(),
            "state": (parts[1] if len(parts) > 1 else "").strip().lower(),
            "status": (parts[2] if len(parts) > 2 else "").strip(),
            "image": (parts[3] if len(parts) > 3 else "").strip(),
            "id": (parts[4] if len(parts) > 4 else "").strip()[:12],
        })
    return rows


def _http_ok(url: str, timeout: float = 3.0) -> bool:
    try:
        import urllib.request
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return 200 <= r.status < 400
    except Exception:
        return False


def reconcile(*, mock: dict | None = None, mutate: bool = False, tick: bool = True) -> dict:
    st = _load()
    pol = {**DEFAULTS, **(st.get("policy") or {})}
    g = guard("ps", mock=mock)
    if not g.get("ok"):
        st["fleet"] = "CRITICAL"
        st["guard"] = "OFFLINE"
        st["stale"] = True
        for c in (st.get("containers") or {}).values():
            if isinstance(c, dict):
                c["stale"] = True
                c["phase"] = "UNKNOWN"
        _save(st)
        return {"ok": False, "error": g.get("error") or "guard down", "fleet": "CRITICAL"}
    rows = parse_ps(g.get("out") or "")
    desired = dict(st.get("desired") or {})
    fails = dict(st.get("fail_counts") or {})
    containers = {}
    running = 0
    thresh = int(pol.get("failure_threshold") or 3)
    for row in rows:
        name = row["name"]
        state = row["state"]
        if tick and name not in desired:
            desired[name] = "running" if state == "running" else "stopped"
        phase = HEALTHY
        if state == "running":
            running += 1
            if tick:
                fails[name] = 0
        elif desired.get(name) == "stopped":
            if tick:
                fails[name] = 0
            phase = HEALTHY  # intentionally stopped
        else:
            if tick:
                fails[name] = int(fails.get(name) or 0) + 1
            fc = int(fails.get(name) or 0)
            phase = DIAGNOSING if fc >= thresh else SUSPECT
        containers[name] = {
            **row,
            "host": "bigboi",
            "mode": mode_of(st, name, desired.get(name)),
            "desired": desired.get(name),
            "phase": phase,
            "fails": int(fails.get(name) or 0),
            "http": None,
        }
    live_names = {r["name"] for r in rows}
    if tick and rows:
        desired = {k: v for k, v in desired.items() if k in live_names}
        fails = {k: v for k, v in fails.items() if k in live_names}
    if tick:
        for name, url in (pol.get("http_probes") or {}).items():
            if name in containers and containers[name].get("state") == "running" and mock is None:
                ok = _http_ok(url)
                containers[name]["http"] = ok
                if not ok:
                    fails[name] = int(fails.get(name) or 0) + 1
                    containers[name]["fails"] = fails[name]
                    containers[name]["phase"] = DIAGNOSING if fails[name] >= thresh else SUSPECT
    fleet = HEALTHY
    suspect = [n for n, c in containers.items() if c.get("phase") in (SUSPECT, DIAGNOSING, RECOVERING, ESCALATED)]
    if suspect:
        fleet = "DEGRADED"
    if not rows:
        fleet = "CRITICAL"
    st["containers"] = containers
    if tick:
        st["desired"] = desired
        st["fail_counts"] = fails
        st["last_reconcile"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    st["fleet"] = fleet
    st["guard"] = "ONLINE"
    st["stale"] = False
    st["counts"] = {"total": len(rows), "running": running, "healthy": len(rows) - len(suspect), "suspect": len(suspect)}
    _save(st)

    actions = []
    if mutate:
        for name in suspect:
            actions.append(_maybe_repair(st, name, mock=mock, pol=pol))
        st = _load()
    return {
        "ok": True,
        "fleet": st.get("fleet"),
        "counts": st.get("counts"),
        "suspect": suspect,
        "actions": [a for a in actions if a],
        "version": VERSION,
    }


def _maybe_repair(st: dict, name: str, *, mock: dict | None, pol: dict) -> dict | None:
    mode = mode_of(st, name)
    desired = (st.get("desired") or {}).get(name)
    if desired != "running":
        return {"name": name, "skipped": "manual-or-desired-stopped"}
    if mode == OBSERVE:
        return {"name": name, "skipped": "observe"}
    deps = (pol.get("dependencies") or {}).get(name) or []
    for dep in deps:
        d = (st.get("containers") or {}).get(dep) or {}
        if d.get("state") != "running":
            record_incident(host="bigboi", container=name, symptoms="dependency down", diagnosis=f"{dep} not running")
            return {"name": name, "skipped": "dependency", "dep": dep}
    window = int(pol.get("restart_window_sec") or 600)
    max_r = int(pol.get("max_restarts") or 2)
    hist = [t for t in (st.get("restarts") or {}).get(name) or [] if time.time() - t < window]
    if len(hist) >= max_r:
        record_incident(host="bigboi", container=name, symptoms="restart storm", diagnosis="escalated", result="ESCALATED")
        import helix_jobs
        helix_jobs.create_medic_job(
            f"medic escalate {name} restart loop",
            "docker_repair",
            True,
            card={
                "what_failed": f"{name} restart loop",
                "theory": "automatic restart cap reached",
                "evidence": "restart window exceeded",
                "proposed": "stop automatic repair; operator recreate/inspect",
                "impact": "container stays down until approved",
                "rollback": "re-enable observe/restart after fix",
                "risk": "PRIVILEGED",
            },
        )
        return {"name": name, "status": ESCALATED}
    thresh = int(pol.get("failure_threshold") or 3)
    fails = int((st.get("fail_counts") or {}).get(name) or 0)
    if fails < thresh:
        return {"name": name, "skipped": "threshold", "fails": fails, "need": thresh}
    logs = guard("logs", name, mock=mock)
    sig = analyse_logs(logs.get("out") or "")
    record_incident(
        host="bigboi", container=name, symptoms="suspect not running",
        signatures=sig.get("signatures"), excerpt=sig.get("excerpt"),
        diagnosis="container not in desired running state",
    )
    if mode == REPAIR:
        import helix_jobs
        helix_jobs.create_medic_job(
            f"medic recreate {name}",
            "docker_repair",
            True,
            card={
                "what_failed": f"{name} not running",
                "theory": "repair mode requested recreate",
                "evidence": sig.get("excerpt") or "",
                "proposed": f"recreate {name}",
                "impact": "brief outage; config/template compare required",
                "rollback": "Unraid DockerMan template",
                "risk": "PRIVILEGED",
            },
        )
        return {"name": name, "status": "WAITING_APPROVAL"}
    import helix_jobs
    diag = helix_jobs.create_medic_job(
        f"medic diagnose {name}",
        "docker_diagnosis",
        False,
        card={
            "what_failed": f"{name} not in desired running state",
            "theory": "consecutive failed polls",
            "evidence": sig.get("excerpt") or "",
            "proposed": f"restart {name}",
            "impact": "brief interruption; no recreate",
            "rollback": "container remains on existing image",
            "risk": "LOW",
        },
        metadata={"container": name, "signatures": sig.get("signatures")},
    )
    jid = (diag.get("job") or {}).get("id") if isinstance(diag, dict) else None
    r = guard("restart", name, mock=mock, timeout=45)
    hist.append(time.time())
    with _LOCK:
        st2 = _load()
        st2.setdefault("restarts", {})[name] = hist[-8:]
        _save(st2)
    if r.get("ok"):
        if jid:
            helix_jobs.update_medic_job(jid, helix_jobs.COMPLETE, result="restart issued")
        return {"name": name, "status": "RECOVERING", "job": jid}
    if jid:
        helix_jobs.update_medic_job(jid, helix_jobs.FAILED, error=str(r.get("error") or "restart failed"))
    return {"name": name, "status": "FAILED", "error": r.get("error")}


def snapshot(*, mock: dict | None = None) -> dict:
    # Dashboard GET is a projection. Failure counters only advance in the loop.
    rec = reconcile(mock=mock, mutate=False, tick=False)
    st = _load()
    rows = list((st.get("containers") or {}).values())
    compact = rec.get("fleet") == HEALTHY or rec.get("fleet") == "HEALTHY"
    incidents = _inc_load()[-12:]
    waiting = 0
    try:
        import helix_jobs
        waiting = len(helix_jobs.list_jobs().get("waiting_approval") or [])
    except Exception:
        waiting = 0
    return {
        "ok": True,
        "version": VERSION,
        "fleet": rec.get("fleet") or st.get("fleet"),
        "guard": st.get("guard"),
        "compact": bool(compact and waiting == 0),
        "counts": rec.get("counts") or st.get("counts") or {},
        "host": {"name": "bigboi", "os": "Unraid 7.3.2", "docker": "Engine 29.5.3", "mac_docker": False},
        "containers": rows,
        "incidents": incidents,
        "waiting_approval": waiting,
        "watchdog_ok": True,
        "auto_restart": bool(({**DEFAULTS, **(st.get("policy") or {})}).get("auto_restart")),
        "never_autorepair": list(({**DEFAULTS, **(st.get("policy") or {})}).get("never_autorepair") or []),
        "mac": {"docker": False, "role": "control-plane"},
    }


def propose(task: str) -> dict:
    if forbidden(task):
        return {
            "ok": False,
            "error": "forbidden",
            "risk": "HIGH",
            "note": "Medic will not autonomously prune, delete appdata, recreate docker.img, or reboot.",
        }
    t = (task or "").lower()
    m = re.search(r"\b([A-Za-z0-9][A-Za-z0-9_.-]{0,40})\b", t)
    name = m.group(1) if m else ""
    if any(k in t for k in ("recreate", "remove", "pull", "rollback", "network", "env", "volume", "engine", "desktop")):
        import helix_jobs
        job = helix_jobs.create_medic_job(
            task,
            "docker_repair",
            True,
            card={
                "what_failed": task,
                "theory": "Higher-risk Docker change requested.",
                "evidence": "policy: WAITING_APPROVAL",
                "proposed": task,
                "impact": "Service interruption possible.",
                "rollback": "Re-apply Unraid template / previous container.",
                "risk": "PRIVILEGED",
            },
        )
        return {
            "ok": True,
            "approval": True,
            "job": job,
            "card": {
                "what_failed": task,
                "theory": "Higher-risk Docker change requested.",
                "evidence": "policy: WAITING_APPROVAL",
                "proposed": task,
                "impact": "Service interruption possible.",
                "rollback": "Re-apply Unraid template / previous container.",
                "risk": "PRIVILEGED",
            },
        }
    if "restart" in t or "repair" in t:
        rec = reconcile(mutate=False)
        return {"ok": True, "approval": False, "note": "low-risk restart for desired-running after consecutive failures", "fleet": rec.get("fleet")}
    return {"ok": True, "read": True, "snapshot": snapshot()}


def query(text: str) -> dict:
    t = (text or "").lower()
    snap = snapshot()
    rows = snap.get("containers") or []
    if "unhealthy" in t or "what's wrong" in t or "what is wrong" in t:
        bad = [c for c in rows if c.get("phase") != HEALTHY]
        return {"ok": True, "speak": (bad[0]["name"] + " " + bad[0].get("status", "")) if bad else "No unhealthy containers.", "items": bad}
    if "repair overnight" in t or "did medic repair" in t:
        inc = snap.get("incidents") or []
        return {"ok": True, "speak": f"{len(inc)} incidents recorded.", "items": inc}
    if "waiting for approval" in t:
        return {"ok": True, "speak": f"{snap.get('waiting_approval') or 0} waiting.", "waiting": snap.get("waiting_approval")}
    if "enable auto repair" in t or "make medic automatic" in t:
        return set_auto(True)
    if t.strip() in ("disable auto repair", "observe mode") or t.startswith("disable auto repair") and len(t.split()) <= 3:
        return set_auto(False)
    if t.startswith("observe ") or "observe mode" in t or "disable auto repair" in t:
        m = re.search(r"\b([A-Za-z0-9][A-Za-z0-9_.-]{0,40})\b", text or "")
        name = m.group(1) if m else ""
        if name.lower() in ("put", "disable", "auto", "repair", "observe", "mode"):
            name = ""
        toks = [w for w in re.findall(r"[A-Za-z0-9_.-]+", text or "") if w.lower() not in ("put", "into", "observe", "mode", "disable", "auto", "repair", "for", "this", "container")]
        name = toks[-1] if toks else name
        return set_mode(name, OBSERVE) if name else set_auto(False)
    if forbidden(text):
        return {"ok": False, "error": "forbidden", "speak": "That operation is forbidden for Medic."}
    return {"ok": True, "speak": f"Fleet {snap.get('fleet')}.", "snapshot": {"fleet": snap.get("fleet"), "counts": snap.get("counts")}}


def watchdog_tick() -> dict:
    g = guard("ping")
    ok = bool(g.get("ok") and "pong" in (g.get("out") or ""))
    with _LOCK:
        st = _load()
        st["watchdog_ok"] = ok
        _save(st)
    return {"ok": ok, "guard": "ONLINE" if ok else "OFFLINE"}


def _loop() -> None:
    while not _STOP.is_set():
        try:
            reconcile(mutate=True)
            watchdog_tick()
        except Exception:
            pass
        _STOP.wait(int((_load().get("policy") or {}).get("poll_sec") or 30))


def start_loop() -> None:
    global _THREAD
    if _THREAD and _THREAD.is_alive():
        return
    _STOP.clear()
    _THREAD = threading.Thread(target=_loop, name="helix-medic", daemon=True)
    _THREAD.start()


def doctor() -> dict:
    g = guard("ping")
    mac_docker = False
    return {
        "ok": True,
        "overall": "HEALTHY" if g.get("ok") else "DEGRADED",
        "checks": [
            {"name": "helix-docker-guard", "state": "HEALTHY" if g.get("ok") else "FAILED", "reason": (g.get("out") or g.get("error") or "")[:80]},
            {"name": "Mac Docker", "state": "HEALTHY", "reason": "not installed — control plane only; not required"},
            {"name": "policy default", "state": "HEALTHY", "reason": "auto-restart desired-running after 3 fails"},
        ],
    }
