"""ADZE orchestration. Independent of OpenAI HTTP details. Hermes remains lead."""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path

from adze_openai import AdzeProviderError, adze_model, complete, openai_configured

ROOT = Path(__file__).resolve().parent
EVENT_LOG = ROOT / "adze-events.jsonl"
ENV_FILES = (
    Path.home() / ".hermes" / ".env",
    Path.home() / ".hermes" / "profiles" / "adze" / ".env",
)
SECRETISH = re.compile(
    r"(password|passwd|token|api[_-]?key|secret|authorization|bearer\s+\S+|r3dbull)",
    re.I,
)
SYSTEM = (
    "You are ADZE, an independent critic. Hermes (Grok) is the lead agent. "
    "Return the structured review fields. Do not execute tools. "
    "Do not ask for secrets. Do not include API keys."
)


def load_env() -> None:
    """Load ADZE/OpenAI env from local files. Never logs values."""
    for path in ENV_FILES:
        if not path.is_file():
            continue
        try:
            for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
                s = line.strip()
                if not s or s.startswith("#") or "=" not in s:
                    continue
                k, v = s.split("=", 1)
                k = k.strip()
                v = v.strip().strip('"').strip("'")
                if k and k not in os.environ:
                    os.environ[k] = v
        except OSError:
            continue


def mode() -> str:
    m = (os.environ.get("ADZE_MODE") or "auto").strip().lower()
    return m if m in ("off", "auto", "always", "manual") else "auto"


def max_rounds() -> int:
    try:
        return max(1, min(int(os.environ.get("MAX_DELIBERATION_ROUNDS") or 3), 3))
    except ValueError:
        return 3


def allow_lead_failover() -> bool:
    return (os.environ.get("ALLOW_ADZE_LEAD_FAILOVER") or "false").strip().lower() in (
        "1",
        "true",
        "yes",
    )


def sanitize(text: str, n: int = 4000) -> str:
    s = SECRETISH.sub("[redacted]", text or "")
    s = re.sub(r"\x00", "", s)
    return s[: n - 1] + "…" if len(s) > n else s


def _append_event(row: dict) -> None:
    row = dict(row)
    row["t"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    EVENT_LOG.parent.mkdir(parents=True, exist_ok=True)
    with EVENT_LOG.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")


def recent_events(limit: int = 40) -> list[dict]:
    if not EVENT_LOG.is_file():
        return []
    lines = EVENT_LOG.read_text(encoding="utf-8", errors="replace").splitlines()[-limit:]
    out = []
    for ln in lines:
        try:
            out.append(json.loads(ln))
        except json.JSONDecodeError:
            continue
    return out


def status() -> dict:
    load_env()
    last = recent_events(8)
    return {
        "name": "ADZE",
        "role": "critic",
        "provider": "openai",
        "lead": "hermes",
        "lead_provider": "xai-oauth",
        "mode": mode(),
        "online": openai_configured(),
        "model": adze_model() if openai_configured() else None,
        "max_rounds": max_rounds(),
        "allow_lead_failover": allow_lead_failover(),
        "key_present": openai_configured(),
        "last": last[-1] if last else None,
        "events": last,
    }


def _hash(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()[:16]


def review(proposal: dict, *, force: bool = False) -> dict:
    """Run up to 3 deliberation rounds. Hermes remains lead. No tool execution."""
    load_env()
    t0 = time.time()
    md = mode()
    if md == "off" and not force:
        return {"ok": False, "state": "ADZE OFF", "reason": "mode off"}
    if md == "manual" and not force:
        return {"ok": False, "state": "ADZE MANUAL", "reason": "not requested"}
    if not openai_configured():
        _append_event({"kind": "offline", "state": "ADZE // OFFLINE"})
        return {
            "ok": False,
            "state": "ADZE // OFFLINE",
            "reason": "OPENAI PROVIDER UNAVAILABLE",
            "hermes_may_continue": True,
        }

    user_req = sanitize(str(proposal.get("user_request") or ""), 1500)
    plan = sanitize(str(proposal.get("initial_plan") or ""), 2000)
    ctx = sanitize(str(proposal.get("context") or ""), 1200)
    constraints = sanitize(str(proposal.get("constraints") or ""), 800)
    if not user_req:
        return {"ok": False, "state": "NO TELEMETRY", "reason": "empty request"}

    _append_event({"kind": "start", "state": "ADZE REVIEWING", "round": 1})
    rounds: list[dict] = []
    seen: set[str] = set()
    budget = int(os.environ.get("ADZE_MAX_TOKENS") or 2500)
    timeout = float(os.environ.get("ADZE_TIMEOUT_S") or 60)
    last_text = ""
    consensus = "PARTIAL"
    objection = ""

    prompt = (
        f"USER REQUEST:\n{user_req}\n\n"
        f"HERMES INITIAL PLAN:\n{plan or '(none)'}\n\n"
        f"CONTEXT:\n{ctx or '(none)'}\n\n"
        f"CONSTRAINTS:\n{constraints or '(none)'}\n\n"
        "Review independently. Structured fields only."
    )
    try:
        for i in range(1, max_rounds() + 1):
            msg = [{"role": "system", "content": SYSTEM}, {"role": "user", "content": prompt}]
            t1 = time.time()
            out = complete(msg, timeout=timeout, max_tokens=budget)
            text = sanitize(out["text"], 3000)
            h = _hash(text)
            if h in seen:
                consensus = "NOT REACHED"
                _append_event({"kind": "loop", "state": "CONSENSUS NOT REACHED", "round": i})
                break
            seen.add(h)
            last_text = text
            latency_ms = int((time.time() - t1) * 1000)
            rounds.append(
                {
                    "round": i,
                    "adze": text,
                    "model": out.get("model"),
                    "usage": out.get("usage"),
                    "latency_ms": latency_ms,
                }
            )
            _append_event(
                {
                    "kind": "adze",
                    "round": i,
                    "summary": text.splitlines()[0][:180] if text else "",
                    "latency_ms": latency_ms,
                    "tokens": (out.get("usage") or {}).get("total"),
                }
            )
            low = text.lower()
            if i == 1:
                prompt = (
                    "Hermes received your review. If you still have a material objection, "
                    "state it in one short RECOMMENDATION. If you agree, say AGREED.\n\n"
                    f"YOUR PREVIOUS REVIEW:\n{text[:1500]}"
                )
            elif "agreed" in low and "disagree" not in low:
                consensus = "REACHED"
                _append_event({"kind": "consensus", "state": "CONSENSUS REACHED", "round": i})
                break
            else:
                if "concern" in low or "disagree" in low or "risk" in low:
                    objection = text[:400]
                    consensus = "PARTIAL"
                prompt = (
                    "Final round. Either AGREED or keep a single unresolved objection. "
                    "Do not repeat the previous message."
                )
            if time.time() - t0 > 90:
                consensus = "NOT REACHED"
                _append_event({"kind": "timeout", "state": "CONSENSUS NOT REACHED"})
                break
    except AdzeProviderError as e:
        _append_event({"kind": "error", "state": "ADZE // OFFLINE", "code": e.code})
        return {
            "ok": False,
            "state": "ADZE // OFFLINE" if e.code == "offline" else e.code,
            "reason": e.message,
            "hermes_may_continue": True,
            "rounds": rounds,
            "elapsed_s": round(time.time() - t0, 2),
        }

    elapsed = round(time.time() - t0, 2)
    result = {
        "ok": True,
        "state": {
            "REACHED": "CONSENSUS ● REACHED",
            "PARTIAL": "CONSENSUS △ PARTIAL",
            "NOT REACHED": "DISAGREEMENT △ REVIEW REQUIRED",
        }.get(consensus, consensus),
        "consensus": consensus,
        "adze_review": last_text,
        "objection": objection or None,
        "rounds": rounds,
        "round_count": len(rounds),
        "elapsed_s": elapsed,
        "model": adze_model(),
        "lead": "hermes",
        "hermes_decides": True,
    }
    _append_event({"kind": "done", "state": result["state"], "rounds": len(rounds), "elapsed_s": elapsed})
    return result


if __name__ == "__main__":
    import sys

    force = "--force" in sys.argv
    raw = sys.stdin.read() if not sys.stdin.isatty() else ""
    try:
        proposal = json.loads(raw) if raw.strip() else {"user_request": " ".join(a for a in sys.argv[1:] if a != "--force")}
    except json.JSONDecodeError:
        proposal = {"user_request": raw}
    print(json.dumps(review(proposal, force=force), ensure_ascii=False, indent=2))
