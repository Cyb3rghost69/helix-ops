"""Standalone isolated Helix Relay (dev). Loopback/in-process only. Dummy platforms."""
from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Optional

from ha_controller import AuthorityError, Controller
from helix_relay import HelixRelay

# Matches installed Hermes v0.22.2 gateway/relay/descriptor.py — not imported (no production load).
CONTRACT_VERSION = 1
DESCRIPTORS = {
    "telegram": {
        "contract_version": CONTRACT_VERSION,
        "platform": "telegram",
        "label": "SIM Telegram",
        "max_message_length": 4096,
        "supports_draft_streaming": False,
        "supports_edit": True,
        "supports_threads": True,
        "markdown_dialect": "markdown_v2",
        "len_unit": "utf16",
        "supported_ops": ["send", "edit", "typing", "follow_up"],
    },
    "discord": {
        "contract_version": CONTRACT_VERSION,
        "platform": "discord",
        "label": "SIM Discord",
        "max_message_length": 2000,
        "supports_draft_streaming": True,
        "supports_edit": True,
        "supports_threads": True,
        "markdown_dialect": "discord",
        "len_unit": "chars",
        "supported_ops": ["send", "edit", "typing", "follow_up"],
    },
}


class DurableRelay(HelixRelay):
    """SQLite-backed queue + dummy TG/Discord sockets that survive backend handover."""

    def __init__(self, ctl: Controller, db_path: str):
        super().__init__(ctl)
        self.db_path = db_path
        self.relay_process_up = True
        self.platforms = {"telegram": True, "discord": True}
        self.seen: set[str] = set()
        self._db = sqlite3.connect(db_path)
        self._db.execute(
            """CREATE TABLE IF NOT EXISTS msgs (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 mid TEXT,
                 platform TEXT,
                 direction TEXT,
                 epoch INTEGER,
                 backend TEXT,
                 text TEXT,
                 status TEXT,
                 reason TEXT
               )"""
        )
        self._db.execute("CREATE UNIQUE INDEX IF NOT EXISTS uq_in ON msgs(mid) WHERE direction='in'")
        self._db.commit()
        self._load()

    def _load(self) -> None:
        cur = self._db.execute("SELECT mid FROM msgs WHERE direction='in'")
        self.seen = {r[0] for r in cur.fetchall()}
        n = self._db.execute("SELECT COUNT(*) FROM msgs").fetchone()[0]
        self.seq = n

    def handshake(self, platform: str) -> dict:
        if platform not in DESCRIPTORS:
            raise AuthorityError("unknown_platform")
        return dict(DESCRIPTORS[platform])

    def inbound(self, text: str, platform: str = "telegram", mid: Optional[str] = None):
        if not self.relay_process_up:
            return None
        if not self.platforms.get(platform):
            return None
        if mid and mid in self.seen:
            self.ctl.log("dedup", mid=mid)
            return None
        q = super().inbound(text)
        if q is None:
            return None
        if mid:
            q.mid = mid
        self.seen.add(q.mid)
        self._put(q, platform, "in")
        return q

    def outbound(self, mid: str, epoch: int, backend: str, reply: str, platform: str = "telegram"):
        if not self.relay_process_up:
            from helix_relay import Queued
            q = Queued(mid=mid, epoch=epoch, backend=backend, text=reply, dropped=True, reason="relay_down")
            return q
        q = super().outbound(mid, epoch, backend, reply)
        self._put(q, platform, "out")
        return q

    def _put(self, q, platform: str, direction: str) -> None:
        st = "dropped" if q.dropped else ("delivered" if q.delivered else "queued")
        self._db.execute(
            "INSERT INTO msgs (mid, platform, direction, epoch, backend, text, status, reason) VALUES (?,?,?,?,?,?,?,?)",
            (q.mid, platform, direction, q.epoch, q.backend, q.text, st, q.reason),
        )
        self._db.commit()

    def crash_connector(self) -> None:
        self.relay_process_up = False
        self.ctl.log("connector_crash")
        # dummy platform sockets stay conceptually up on the host — process is down

    def recover_connector(self) -> None:
        self.relay_process_up = True
        self._load()
        self.ctl.log("connector_recover")

    def snapshot(self) -> dict:
        s = super().snapshot()
        s.update(
            {
                "contract_version": CONTRACT_VERSION,
                "relay_process_up": self.relay_process_up,
                "platforms": dict(self.platforms),
                "db": self.db_path,
                "seen": len(self.seen),
            }
        )
        return s

    def close(self) -> None:
        self._db.close()


def snapshot_html(snap: dict) -> str:
    return json.dumps(snap, indent=2)
