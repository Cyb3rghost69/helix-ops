import unittest
from pathlib import Path
import helix_brains

ROOT = Path(__file__).resolve().parent


class TestBrains(unittest.TestCase):
    def test_files(self):
        for n in ("helix_brains.py", "helix-brains.js", "helix-brains.css"):
            self.assertTrue((ROOT / n).is_file(), n)

    def test_refuse_mutate(self):
        d = helix_brains.refuse_mutate()
        self.assertFalse(d["ok"])
        self.assertEqual(d["error"], "controls_disabled")

    def test_snapshot_shape(self):
        d = helix_brains.snapshot(force=True)
        self.assertTrue(d["ok"])
        self.assertFalse(d["policy"]["automatic_failover"])
        self.assertEqual(d["primary"], "alpha")
        self.assertEqual(d["witness"]["status"], "NONE")
        self.assertIn("hermes_api", d["alpha"])
        self.assertIn("ok", d["alpha"]["hermes_api"])
        self.assertFalse(d["failover_readiness"]["ready"])
        self.assertFalse(d["witness"]["ready"])
        self.assertIn("launchd", d["ops_persist"])
        self.assertIn("status", d["backup"])
        self.assertIsInstance(d["incidents"], list)
        self.assertIn("honcho_backup", d)
        self.assertEqual(d["readiness"]["automatic_failover"], "missing")
        self.assertEqual(d["readiness"]["scheduled_backup"], "missing")
        self.assertEqual(d["readiness_evidence"]["overall"][:9], "NOT READY")
        self.assertEqual(d["controller"]["status"], "NONE")
        self.assertIn("/health", d["readiness_evidence"].get("honcho_probe") or "")
        src = (ROOT / "helix_brains.py").read_text(encoding="utf-8")
        self.assertIn("8000/health", src)
        self.assertNotIn('8000/")', src)
        self.assertEqual(d["fencing"]["status"], "DESIGNED_NOT_ACTIVE")
        self.assertFalse(d["fencing"]["ready"])
        self.assertEqual(d["witness"].get("charlie"), "observer_candidate")
        self.assertEqual(d["honcho"].get("host"), "unraid")
        self.assertTrue(d["honcho"].get("not_on_mac"))
        self.assertEqual(d["replication"]["status"], "DUMP_ONLY")
        self.assertEqual(d["microserver"]["status"], "NOT_LOCATED")
        self.assertFalse(d["honcho_backup"].get("recoverable_claim", True))


if __name__ == "__main__":
    unittest.main()
