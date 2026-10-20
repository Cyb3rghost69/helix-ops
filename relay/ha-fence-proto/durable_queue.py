"""Durable inbound/outbound queues + DLQ. Dummy only. Not exactly-once."""
from __future__ import annotations

import sqlite3
import time


class DurableQueue:
    def __init__(self, path: str):
        self.db = sqlite3.connect(path)
        self.db.execute(
            """CREATE TABLE IF NOT EXISTS q (
                 id INTEGER PRIMARY KEY AUTOINCREMENT,
                 mid TEXT UNIQUE,
                 direction TEXT,
                 epoch INTEGER,
                 payload TEXT,
                 status TEXT,
                 tries INTEGER DEFAULT 0,
                 next_ts REAL DEFAULT 0,
                 expires REAL,
                 last_err TEXT
               )"""
        )
        self.db.commit()

    def put_in(self, mid: str, epoch: int, payload: str, ttl: float = 3600) -> bool:
        try:
            self.db.execute(
                "INSERT INTO q (mid, direction, epoch, payload, status, expires) VALUES (?,?,?,?,?,?)",
                (mid, "in", epoch, payload, "queued", time.time() + ttl),
            )
            self.db.commit()
            return True
        except sqlite3.IntegrityError:
            return False  # dedup

    def put_out(self, mid: str, epoch: int, payload: str, ttl: float = 3600) -> None:
        self.db.execute(
            "INSERT INTO q (mid, direction, epoch, payload, status, expires) VALUES (?,?,?,?,?,?)",
            (mid + ":out", "out", epoch, payload, "queued", time.time() + ttl),
        )
        self.db.commit()

    def fail(self, mid: str, err: str, max_tries: int = 5) -> None:
        row = self.db.execute("SELECT tries FROM q WHERE mid=?", (mid,)).fetchone()
        if not row:
            return
        tries = row[0] + 1
        if tries >= max_tries:
            self.db.execute(
                "UPDATE q SET status='dlq', tries=?, last_err=? WHERE mid=?",
                (tries, err, mid),
            )
        else:
            backoff = min(60.0, 0.5 * (2 ** tries))
            self.db.execute(
                "UPDATE q SET status='retry', tries=?, next_ts=?, last_err=? WHERE mid=?",
                (tries, time.time() + backoff, err, mid),
            )
        self.db.commit()

    def expire(self) -> int:
        n = self.db.execute(
            "UPDATE q SET status='expired' WHERE status IN ('queued','retry') AND expires < ?",
            (time.time(),),
        ).rowcount
        self.db.commit()
        return n

    def counts(self) -> dict:
        d = {}
        for (st, n) in self.db.execute("SELECT status, COUNT(*) FROM q GROUP BY status"):
            d[st] = n
        return d

    def close(self) -> None:
        self.db.close()
