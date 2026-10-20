"""Unified Helix approval queue. Never dumps command secrets or env.

Sources today: COMPUTE jobs in WAITING_APPROVAL. Hermes gateway pending
approvals live in-process on the gateway and are not readable from files;
those still approve from Telegram /approve.
"""
from __future__ import annotations

import helix_jobs


def list_queue() -> dict:
    jobs = helix_jobs.list_jobs()
    waiting = list(jobs.get("waiting_approval") or [])
    items = []
    for j in waiting:
        items.append(
            {
                "id": j.get("id"),
                "source": "compute",
                "task": (j.get("task") or "")[:240],
                "policy": j.get("policy"),
                "status": j.get("status"),
                "kind": j.get("kind"),
            }
        )
    return {
        "ok": True,
        "count": len(items),
        "items": items,
        "hermes_note": "Gateway command approvals stay in Telegram (/approve /deny).",
    }


def decide(jid: str, allow: bool) -> dict:
    if not jid:
        return {"ok": False, "error": "missing id"}
    return helix_jobs.approve_job(jid, allow=bool(allow))


def decide_all(allow: bool) -> dict:
    q = list_queue()
    results = []
    for item in q.get("items") or []:
        jid = item.get("id")
        if not jid:
            continue
        results.append(helix_jobs.approve_job(jid, allow=bool(allow)))
    return {"ok": True, "allow": bool(allow), "results": results, "n": len(results)}
