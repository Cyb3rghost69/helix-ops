"""Isolated Helix Relay prototype. Dummy platforms only. No production I/O."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

from ha_controller import AuthorityError, Controller


@dataclass
class Queued:
    mid: str
    epoch: int
    backend: str
    text: str
    delivered: bool = False
    dropped: bool = False
    reason: str = ""


@dataclass
class HelixRelay:
    """Platform sockets stay on the relay. Brains are backends."""

    ctl: Controller
    platform_up: bool = True
    queue: list = field(default_factory=list)
    seq: int = 0
    connected: dict = field(default_factory=lambda: {"alpha": False, "bravo": False})

    def connect_backend(self, name: str) -> None:
        if not self.ctl.controller_up:
            raise AuthorityError("controller_down")
        if self.ctl.lease.holder != name or not self.ctl.nodes[name].gateway_on:
            self.connected[name] = False
            raise AuthorityError("not_lease_holder")
        for k in self.connected:
            self.connected[k] = False
        self.connected[name] = True

    def inbound(self, text: str) -> Optional[Queued]:
        if not self.platform_up:
            return None
        holder = self.ctl.lease.holder
        if not holder or not self.connected.get(holder):
            self.ctl.log("relay_hold", reason="no_active_backend")
            return None
        self.seq += 1
        q = Queued(mid=f"sim-{self.seq}", epoch=self.ctl.lease.epoch, backend=holder, text=text)
        self.queue.append(q)
        return q

    def outbound(self, mid: str, epoch: int, backend: str, reply: str) -> Queued:
        if epoch != self.ctl.lease.epoch or backend != self.ctl.lease.holder:
            q = Queued(mid=mid, epoch=epoch, backend=backend, text=reply, dropped=True, reason="stale_epoch")
            self.queue.append(q)
            self.ctl.log("drop_stale_reply", mid=mid, epoch=epoch, current=self.ctl.lease.epoch)
            return q
        if not self.platform_up:
            q = Queued(mid=mid, epoch=epoch, backend=backend, text=reply, dropped=True, reason="platform_down")
            self.queue.append(q)
            return q
        q = Queued(mid=mid, epoch=epoch, backend=backend, text=reply, delivered=True)
        self.queue.append(q)
        return q

    def handover(self, to: str) -> None:
        if not self.ctl._reachable(to):
            raise AuthorityError("candidate_unreachable")
        prev = self.ctl.lease.holder
        if prev:
            self.ctl.fence(prev)
            self.connected[prev] = False
        self.ctl.request_promote(to, fenced_token=self.ctl.lease.fence_token)
        self.connect_backend(to)

    def snapshot(self) -> dict:
        return {
            "prototype": True,
            "label": "SIM",
            "platform_up": self.platform_up,
            "active_backend": self.ctl.lease.holder,
            "backends_connected": dict(self.connected),
            "queue_depth": sum(1 for q in self.queue if not q.delivered and not q.dropped),
            "delivered": sum(1 for q in self.queue if q.delivered),
            "dropped_stale": sum(1 for q in self.queue if q.reason == "stale_epoch"),
            "lease_epoch": self.ctl.lease.epoch,
        }
