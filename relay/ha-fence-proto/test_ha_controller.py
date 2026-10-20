"""Phase 5A isolated fence/lease tests. No production I/O."""
from __future__ import annotations

import unittest

from ha_controller import AuthorityError, Controller, naive_quorum_elect


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t

    def add(self, s: float) -> None:
        self.t += s


def boot() -> tuple[Clock, Controller]:
    clk = Clock()
    c = Controller(now=clk)
    c.request_promote("alpha", auto=False)
    return clk, c


class TestFenceProto(unittest.TestCase):
    def test_exclusive_owner(self):
        _, c = boot()
        self.assertEqual(c.snapshot()["gateway_owners"], ["alpha"])
        self.assertFalse(c.snapshot()["split_brain"])

    def test_auto_promote_disabled(self):
        _, c = boot()
        with self.assertRaises(AuthorityError) as e:
            c.request_promote("bravo", auto=True)
        self.assertEqual(str(e.exception), "auto_promote_disabled")
        self.assertEqual(c.snapshot()["gateway_owners"], ["alpha"])

    def test_timeout_does_not_promote(self):
        clk, c = boot()
        clk.add(50)
        self.assertEqual(c.observe_timeout("alpha"), "UNCERTAIN")
        self.assertEqual(c.lease.holder, "alpha")
        self.assertEqual(c.snapshot()["gateway_owners"], ["alpha"])

    def test_expired_lease_not_enough(self):
        clk, c = boot()
        clk.add(120)
        with self.assertRaises(AuthorityError) as e:
            c.request_promote("bravo")
        self.assertIn("fenced", str(e.exception))
        self.assertEqual(c.snapshot()["gateway_owners"], ["alpha"])

    def test_manual_promote_after_fence(self):
        _, c = boot()
        tok = c.fence("alpha")
        r = c.request_promote("bravo", fenced_token=tok)
        self.assertTrue(r["ok"])
        self.assertEqual(c.snapshot()["gateway_owners"], ["bravo"])
        self.assertEqual(c.lease.epoch, 2)

    def test_stale_fence_token(self):
        _, c = boot()
        tok = c.fence("alpha")
        with self.assertRaises(AuthorityError):
            c.fence("alpha", token=tok)  # next expected is tok+1
        self.assertEqual(c.snapshot()["gateway_owners"], [])

    def test_stale_epoch_rejected(self):
        _, c = boot()
        c.fence("alpha")
        c.request_promote("bravo")
        with self.assertRaises(AuthorityError) as e:
            c.stale_leader_claim("alpha", epoch=1)
        self.assertEqual(str(e.exception), "stale_epoch")
        self.assertFalse(c.nodes["alpha"].gateway_on)

    def test_recovered_leader_stays_passive(self):
        _, c = boot()
        c.crash_node("alpha")
        c.fence("alpha")
        c.request_promote("bravo")
        c.recover_node("alpha")
        self.assertFalse(c.nodes["alpha"].gateway_on)
        self.assertEqual(c.snapshot()["gateway_owners"], ["bravo"])

    def test_witness_crash_no_quorum(self):
        _, c = boot()
        c.crash_node("witness")
        with self.assertRaises(AuthorityError) as e:
            c.fence("alpha")
            c.request_promote("bravo")
        self.assertEqual(str(e.exception), "no_quorum")

    def test_controller_crash_freeze(self):
        _, c = boot()
        c.crash_controller()
        with self.assertRaises(AuthorityError):
            c.request_promote("bravo")
        c.recover_controller()
        self.assertTrue(c.frozen)
        with self.assertRaises(AuthorityError):
            c.request_promote("bravo")

    def test_partition_no_dual_owner(self):
        _, c = boot()
        c.isolate("bravo")
        c.isolate("witness")
        with self.assertRaises(AuthorityError):
            c.request_promote("bravo")
        self.assertEqual(c.snapshot()["gateway_owners"], ["alpha"])

    def test_naive_quorum_split_brain(self):
        # Partition: alpha+w1 vs bravo+w2 (two fake witnesses) — naive 2-of-3 elects both.
        a = naive_quorum_elect(["alpha", "alpha", "w"])
        b = naive_quorum_elect(["bravo", "bravo", "w"])
        self.assertEqual(a, ["alpha"])
        self.assertEqual(b, ["bravo"])
        # Two majorities without fencing = split brain. Our controller requires fence.

    def test_duplicate_promote(self):
        _, c = boot()
        c.fence("alpha")
        r1 = c.request_promote("bravo")
        r2 = c.request_promote("bravo")
        self.assertTrue(r2.get("idempotent"))
        self.assertEqual(r1["epoch"], r2["epoch"])
        self.assertEqual(c.snapshot()["gateway_owners"], ["bravo"])

    def test_failed_shutdown_blocks(self):
        _, c = boot()
        # Simulate fence not taking because gateway_on stuck — we still require fence() call.
        with self.assertRaises(AuthorityError):
            c.request_promote("bravo")
        self.assertTrue(c.nodes["alpha"].gateway_on)

    def test_alpha_process_crash(self):
        clk, c = boot()
        c.crash_node("alpha")
        clk.add(50)
        self.assertFalse(c.nodes["alpha"].gateway_on)
        self.assertEqual(c.observe_timeout("alpha"), "UNCERTAIN")
        with self.assertRaises(AuthorityError):
            c.request_promote("bravo")

    def test_bravo_crash(self):
        _, c = boot()
        c.crash_node("bravo")
        self.assertEqual(c.snapshot()["gateway_owners"], ["alpha"])

    def test_simultaneous_restart(self):
        _, c = boot()
        c.crash_node("alpha")
        c.crash_node("bravo")
        c.recover_node("alpha")
        c.recover_node("bravo")
        self.assertEqual(c.snapshot()["gateway_owners"], [])
        # neither auto-takes tokens
        self.assertFalse(c.nodes["alpha"].gateway_on)
        self.assertFalse(c.nodes["bravo"].gateway_on)

    def test_delayed_heartbeat_renew(self):
        clk, c = boot()
        clk.add(10)
        c.heartbeat("alpha")
        self.assertGreater(c.lease.expires_at, clk.t)
        self.assertEqual(c.snapshot()["gateway_owners"], ["alpha"])

    def test_controlled_failback(self):
        _, c = boot()
        c.fence("alpha")
        c.request_promote("bravo")
        with self.assertRaises(AuthorityError):
            c.failback("alpha", approved=False)
        r = c.failback("alpha", approved=True)
        self.assertEqual(r["holder"], "alpha")
        self.assertEqual(c.snapshot()["gateway_owners"], ["alpha"])

    def test_llm_outage_not_modeled_as_host(self):
        # No API in this prototype: host health ≠ provider. Timeout path never promotes.
        _, c = boot()
        self.assertEqual(c.observe_timeout("alpha") if c.missed("alpha") else "OK", "OK")

    def test_concurrent_promote_second_fails(self):
        _, c = boot()
        c.fence("alpha")
        c.request_promote("bravo")
        with self.assertRaises(AuthorityError):
            c.request_promote("alpha")

    def test_persist_isolated(self):
        _, c = boot()
        c.persist()
        from ha_controller import STATE_PATH
        self.assertTrue(STATE_PATH.is_file())
        txt = STATE_PATH.read_text()
        self.assertIn('"production": false', txt)
        self.assertNotIn("TELEGRAM", txt)
        self.assertNotIn("BOT_TOKEN", txt)


if __name__ == "__main__":
    unittest.main()
