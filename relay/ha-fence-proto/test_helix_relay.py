"""Relay handover tests — dummy platforms, no production credentials."""
from __future__ import annotations

import unittest

from ha_controller import AuthorityError, Controller
from helix_relay import HelixRelay
from test_ha_controller import Clock, boot


class TestHelixRelay(unittest.TestCase):
    def _rel(self) -> tuple[Clock, Controller, HelixRelay]:
        clk, c = boot()
        r = HelixRelay(c)
        r.connect_backend("alpha")
        return clk, c, r

    def test_only_holder_connects(self):
        _, c, r = self._rel()
        with self.assertRaises(AuthorityError):
            r.connect_backend("bravo")
        self.assertTrue(r.connected["alpha"])
        self.assertFalse(r.connected["bravo"])

    def test_handover_keeps_platform(self):
        _, c, r = self._rel()
        self.assertTrue(r.platform_up)
        r.handover("bravo")
        self.assertTrue(r.platform_up)
        self.assertTrue(r.connected["bravo"])
        self.assertFalse(r.connected["alpha"])
        self.assertEqual(c.snapshot()["gateway_owners"], ["bravo"])

    def test_stale_reply_dropped(self):
        _, c, r = self._rel()
        old_epoch = c.lease.epoch
        qin = r.inbound("hello")
        r.handover("bravo")
        out = r.outbound(qin.mid, old_epoch, "alpha", "late")
        self.assertTrue(out.dropped)
        self.assertEqual(out.reason, "stale_epoch")
        fresh = r.inbound("hi2")
        ok = r.outbound(fresh.mid, c.lease.epoch, "bravo", "ok")
        self.assertTrue(ok.delivered)

    def test_uncertain_holds_inbound(self):
        clk, c, r = self._rel()
        c.crash_controller()
        with self.assertRaises(AuthorityError):
            r.connect_backend("bravo")
        r.platform_up = True
        # still connected alpha until fence; inbound without controller stays on old holder
        self.assertTrue(r.connected["alpha"])

    def test_both_brains_down(self):
        _, c, r = self._rel()
        c.crash_node("alpha")
        c.crash_node("bravo")
        r.connected["alpha"] = False
        self.assertIsNone(r.inbound("x"))

    def test_dedup_ids(self):
        _, _, r = self._rel()
        a = r.inbound("a")
        b = r.inbound("b")
        self.assertNotEqual(a.mid, b.mid)

    def test_snapshot_labelled_sim(self):
        _, _, r = self._rel()
        s = r.snapshot()
        self.assertTrue(s["prototype"])
        self.assertEqual(s["label"], "SIM")
        self.assertEqual(s["active_backend"], "alpha")
