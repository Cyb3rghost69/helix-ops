"""Dummy TG/Discord + durable queue + fencing. Isolated."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from dummy_adapters import DummyAdapter
from durable_queue import DurableQueue
from helix_relay_svc import DurableRelay
from test_ha_controller import boot


class TestDummyAndQueue(unittest.TestCase):
    def test_telegram_discord_text_reply_attach(self):
        tg = DummyAdapter("telegram", rate_per_s=1e6)
        dc = DummyAdapter("discord", rate_per_s=1e6)
        a = tg.inbound("hi", attachment="file.png")
        self.assertEqual(a.platform, "telegram")
        r = tg.send("yo", reply_to=a.mid)
        self.assertTrue(r.mid.startswith("telegram-out"))
        d = dc.inbound("hello")
        self.assertEqual(d.platform, "discord")
        tg.up = False
        with self.assertRaises(RuntimeError):
            tg.send("no")
        tg.reconnect()
        tg.send("back")

    def test_queue_dedup_dlq_expire(self):
        p = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        p.close()
        q = DurableQueue(p.name)
        self.assertTrue(q.put_in("m1", 1, "x"))
        self.assertFalse(q.put_in("m1", 1, "x"))
        for _ in range(5):
            q.fail("m1", "boom")
        self.assertEqual(q.counts().get("dlq"), 1)
        q.put_in("old", 1, "y", ttl=-1)
        self.assertGreaterEqual(q.expire(), 1)
        q.close()
        Path(p.name).unlink(missing_ok=True)

    def test_e2e_dummy_to_relay_handover(self):
        clk, c = boot()
        p = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        p.close()
        r = DurableRelay(c, p.name)
        r.connect_backend("alpha")
        tg = DummyAdapter("telegram")
        msg = tg.inbound("ping")
        qin = r.inbound(msg.text, platform="telegram", mid=msg.mid)
        self.assertIsNotNone(qin)
        r.handover("bravo")
        late = r.outbound(msg.mid, 1, "alpha", "stale")
        self.assertTrue(late.dropped)
        fresh = tg.inbound("pong")
        q2 = r.inbound(fresh.text, platform="telegram", mid=fresh.mid)
        ok = r.outbound(q2.mid, c.lease.epoch, "bravo", "ok")
        self.assertTrue(ok.delivered)
        r.close()
        Path(p.name).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
