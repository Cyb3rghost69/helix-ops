"""Isolated Helix HA fence/lease prototype. No production I/O, credentials, or SSH."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Optional

ROOT = Path(__file__).resolve().parent
STATE_PATH = ROOT / "state.json"
EVENTS_PATH = ROOT / "events.jsonl"

NODES = ("alpha", "bravo", "witness")
LEASE_TTL = 60.0
HEARTBEAT_PERIOD = 15.0
MISSES_FOR_DOWN = 3


class AuthorityError(Exception):
    pass


@dataclass
class Node:
    name: str
    alive: bool = True
    partitioned: bool = False
    last_hb: float = 0.0
    gateway_on: bool = False
    known_epoch: int = 0


@dataclass
class Lease:
    holder: Optional[str] = None
    epoch: int = 0
    expires_at: float = 0.0
    fence_token: int = 0
    fenced_prev: Optional[str] = None


@dataclass
class Controller:
    now: Callable[[], float]
    lease_ttl: float = LEASE_TTL
    nodes: dict = field(default_factory=dict)
    lease: Lease = field(default_factory=Lease)
    events: list = field(default_factory=list)
    frozen: bool = False
    witness_up: bool = True
    controller_up: bool = True

    def __post_init__(self) -> None:
        if not self.nodes:
            t = self.now()
            self.nodes = {n: Node(n, last_hb=t) for n in NODES}

    def log(self, kind: str, **kw: Any) -> None:
        rec = {"t": self.now(), "kind": kind, **kw}
        self.events.append(rec)

    def snapshot(self) -> dict:
        n = self.nodes
        gw = [k for k, v in n.items() if v.gateway_on]
        return {
            "prototype": True,
            "production": False,
            "frozen": self.frozen or not self.controller_up,
            "witness": self.witness_up and n["witness"].alive and not n["witness"].partitioned,
            "lease": {
                "holder": self.lease.holder,
                "epoch": self.lease.epoch,
                "expires_at": self.lease.expires_at,
                "fence_token": self.lease.fence_token,
                "fenced_prev": self.lease.fenced_prev,
            },
            "gateway_owners": gw,
            "split_brain": len(gw) > 1,
            "quorum": self._quorum_ok(),
            "primary": self.lease.holder,
            "standby": "bravo" if self.lease.holder == "alpha" else ("alpha" if self.lease.holder == "bravo" else None),
        }

    def _reachable(self, name: str) -> bool:
        nd = self.nodes[name]
        return nd.alive and not nd.partitioned

    def _quorum_ok(self) -> bool:
        if not self.witness_up or not self._reachable("witness"):
            return False
        live = sum(1 for n in NODES if self._reachable(n))
        return live >= 2

    def heartbeat(self, name: str) -> None:
        if not self.controller_up:
            return
        if name not in self.nodes:
            return
        if not self._reachable(name):
            self.log("hb_drop", node=name, reason="unreachable")
            return
        self.nodes[name].last_hb = self.now()
        self.log("hb", node=name)
        if self.lease.holder == name and self.now() < self.lease.expires_at:
            self.lease.expires_at = self.now() + self.lease_ttl
            self.log("lease_renew", node=name, epoch=self.lease.epoch)

    def missed(self, name: str) -> bool:
        return self.now() - self.nodes[name].last_hb > HEARTBEAT_PERIOD * MISSES_FOR_DOWN

    def observe_timeout(self, name: str) -> str:
        """Heartbeat timeout → UNCERTAIN. Never promotes."""
        if self.missed(name):
            self.log("timeout_uncertain", node=name, promote=False)
            return "UNCERTAIN"
        return "OK"

    def fence(self, target: str, token: Optional[int] = None) -> int:
        if not self.controller_up:
            raise AuthorityError("controller_down")
        tok = self.lease.fence_token + 1
        if token is not None and token != tok:
            self.log("fence_stale", target=target, token=token, expected=tok)
            raise AuthorityError("stale_fence_token")
        self.lease.fence_token = tok
        self.nodes[target].gateway_on = False
        self.lease.fenced_prev = target
        self.log("fenced", target=target, token=tok)
        return tok

    def request_promote(self, candidate: str, *, fenced_token: Optional[int] = None, auto: bool = False) -> dict:
        if auto:
            self.log("refuse_auto", candidate=candidate)
            raise AuthorityError("auto_promote_disabled")
        if not self.controller_up:
            raise AuthorityError("controller_down")
        if self.frozen or not self._quorum_ok():
            self.log("refuse_no_quorum", candidate=candidate)
            raise AuthorityError("no_quorum")
        if not self._reachable(candidate):
            raise AuthorityError("candidate_unreachable")
        if self.lease.holder == candidate and self.nodes[candidate].gateway_on:
            self.log("promote_idempotent", node=candidate, epoch=self.lease.epoch)
            return {"ok": True, "epoch": self.lease.epoch, "holder": candidate, "idempotent": True}
        # Lease expiry / timeout is not proof of fence.
        if self.lease.holder and self.lease.holder != candidate:
            if self.lease.fenced_prev != self.lease.holder:
                self.log("refuse_unfenced", holder=self.lease.holder, candidate=candidate)
                raise AuthorityError("previous_not_fenced")
            if fenced_token is not None and fenced_token != self.lease.fence_token:
                raise AuthorityError("stale_fence_token")
        if self.now() > self.lease.expires_at and self.lease.holder and self.lease.fenced_prev != self.lease.holder:
            self.log("refuse_expired_unfenced", holder=self.lease.holder)
            raise AuthorityError("expired_lease_not_fenced")
        # Exclusive gateway: turn off everyone else first.
        for n, nd in self.nodes.items():
            if n != candidate:
                nd.gateway_on = False
        epoch = self.lease.epoch + 1
        self.lease.holder = candidate
        self.lease.epoch = epoch
        self.lease.expires_at = self.now() + self.lease_ttl
        self.nodes[candidate].known_epoch = epoch
        self.nodes[candidate].gateway_on = True
        self.lease.fenced_prev = None
        self.log("promoted", node=candidate, epoch=epoch)
        return {"ok": True, "epoch": epoch, "holder": candidate}

    def failback(self, to: str, *, approved: bool) -> dict:
        if not approved:
            raise AuthorityError("failback_not_approved")
        prev = self.lease.holder
        if prev and prev != to:
            self.fence(prev)
        return self.request_promote(to, fenced_token=self.lease.fence_token, auto=False)

    def stale_leader_claim(self, name: str, epoch: int) -> None:
        if epoch < self.lease.epoch:
            self.nodes[name].gateway_on = False
            self.log("stale_rejected", node=name, epoch=epoch, current=self.lease.epoch)
            raise AuthorityError("stale_epoch")
        raise AuthorityError("not_stale")

    def crash_controller(self) -> None:
        self.controller_up = False
        self.log("controller_crash")

    def recover_controller(self) -> None:
        self.controller_up = True
        self.frozen = True
        self.log("controller_recover_frozen")

    def isolate(self, name: str, on: bool = True) -> None:
        self.nodes[name].partitioned = on
        self.log("partition" if on else "heal", node=name)

    def crash_node(self, name: str) -> None:
        self.nodes[name].alive = False
        self.nodes[name].gateway_on = False
        self.log("crash", node=name)

    def recover_node(self, name: str) -> None:
        self.nodes[name].alive = True
        self.nodes[name].partitioned = False
        self.nodes[name].gateway_on = False
        self.log("recover_passive", node=name)

    def persist(self) -> None:
        STATE_PATH.write_text(json.dumps(self.snapshot(), indent=2) + "\n", encoding="utf-8")
        with EVENTS_PATH.open("a", encoding="utf-8") as f:
            for e in self.events[-20:]:
                f.write(json.dumps(e) + "\n")


def naive_quorum_elect(votes: list[str]) -> list[str]:
    """Naive 2-of-3 without fencing — can return two holders under partition."""
    from collections import Counter
    c = Counter(votes)
    return [k for k, v in c.items() if v >= 2]
