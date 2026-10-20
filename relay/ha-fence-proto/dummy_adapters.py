"""Dummy Telegram/Discord transports. No production sessions."""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Optional


@dataclass
class DummyMsg:
    platform: str
    mid: str
    text: str
    reply_to: Optional[str] = None
    attachment: Optional[str] = None


class DummyAdapter:
    def __init__(self, platform: str, rate_per_s: float = 50.0):
        self.platform = platform
        self.sent: list[DummyMsg] = []
        self.up = True
        self._last = None
        self.rate_per_s = rate_per_s
        self.seq = 0

    def inbound(self, text: str, *, reply_to: Optional[str] = None, attachment: Optional[str] = None) -> DummyMsg:
        if not self.up:
            raise RuntimeError(f"{self.platform}_down")
        self.seq += 1
        return DummyMsg(self.platform, f"{self.platform}-{self.seq}", text, reply_to, attachment)

    def send(self, text: str, *, reply_to: str | None = None) -> DummyMsg:
        if not self.up:
            raise RuntimeError(f"{self.platform}_down")
        now = time.monotonic()
        if self._last is not None and now - self._last < 1.0 / self.rate_per_s:
            raise RuntimeError("rate_limited")
        self._last = now
        self.seq += 1
        m = DummyMsg(self.platform, f"{self.platform}-out-{self.seq}", text, reply_to)
        self.sent.append(m)
        return m

    def reconnect(self) -> None:
        self.up = True
