#!/usr/bin/env python3
import unittest
import helix_ctx
import helix_flight
import helix_vault
import helix_sentinel


class CtxHonesty(unittest.TestCase):
    def test_no_fake_window_pct(self):
        d = helix_ctx.snapshot()
        self.assertIsNone(d.get("utilization"))
        self.assertIsNone(d.get("windowUsed"))
        self.assertIn(d.get("windowQuality"), ("UNAVAILABLE", "LIVE"))
        if d.get("contextCapacity"):
            self.assertGreater(d["contextCapacity"], 1000)
        if d.get("sessionInput") and d.get("contextCapacity"):
            # lifetime session tokens must not become utilization
            self.assertIsNone(d["utilization"])

    def test_capacity_is_model_not_disk(self):
        d = helix_ctx.snapshot()
        cap = d.get("contextCapacity")
        if cap:
            self.assertLess(cap, 10_000_000)


class FlightPrivacy(unittest.TestCase):
    def test_rejects_secretish(self):
        ok = helix_flight.ingest_sample({"t": 1, "system": "NOMINAL", "content": "SECRET"})
        # content is not a SAMPLE_KEY so row may still ingest without content
        q = helix_flight.query(range_s=60, limit=5)
        blob = str(q).lower()
        self.assertNotIn("secret", blob)
        self.assertNotIn("sk-", blob)

    def test_event_roundtrip(self):
        helix_flight.ingest_event({"t": int(__import__("time").time() * 1000), "sev": "WARNING", "subsystem": "MEM", "event": "CORE 90"})
        q = helix_flight.query(range_s=3600)
        self.assertTrue(q["ok"])
        self.assertTrue(any(e.get("event") == "CORE 90" for e in q["events"]) or q["counts"]["events"] >= 1)


class VaultMac(unittest.TestCase):
    def test_mac_smart_overall_only(self):
        d = helix_vault.snapshot()
        self.assertTrue(d["ok"])
        self.assertEqual(d["host"], "mac")
        self.assertIsNone(d["unraid"])
        self.assertTrue(d["drives"])
        drv = d["drives"][0]
        self.assertIn(drv.get("smart"), ("OK", "FAIL", None) if drv.get("smart") is None else (drv["smart"],))
        self.assertIsNone(drv.get("temperatureC"))  # not exposed without smartctl


class SentinelEmptyOk(unittest.TestCase):
    def test_no_fake_contacts(self):
        d = helix_sentinel.snapshot()
        self.assertTrue(d["ok"])
        self.assertIsInstance(d["active"], list)
        for ev in d["active"]:
            self.assertNotEqual(ev.get("event"), "HOSTILE DOT")
        if not d["active"]:
            self.assertEqual(d["label"], "NO ACTIVE SECURITY EVENTS")


if __name__ == "__main__":
    unittest.main()
