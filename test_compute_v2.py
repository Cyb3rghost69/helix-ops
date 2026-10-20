import unittest

import helix_compute_v2 as v2
from helix_compute import route_compute


class Caps(unittest.TestCase):
    def test_unknown(self):
        r = v2.invoke("bigboi.shell")
        self.assertFalse(r["ok"])
        self.assertEqual(r["error"], "unknown capability")

    def test_malformed(self):
        r = v2.invoke("bigboi.docker.logs", {})
        self.assertFalse(r["ok"])
        self.assertEqual(r["error"], "malformed parameters")

    def test_bad_name(self):
        r = v2.invoke("bigboi.docker.logs", {"name": "; rm -rf /"})
        self.assertFalse(r["ok"])

    def test_read_mock(self):
        r = v2.invoke("bigboi.cpu", mock={"out": "128"})
        self.assertTrue(r["ok"])

    def test_destructive_absent(self):
        self.assertNotIn("bigboi.docker.rm", v2.CAPS)
        r = v2.invoke("bigboi.docker.delete", {"name": "x"})
        self.assertEqual(r["error"], "unknown capability")

    def test_privileged_needs_approval(self):
        r = v2.invoke("bigboi.docker.restart", {"name": "plex"})
        self.assertEqual(r.get("error"), "approval required")


class Plans(unittest.TestCase):
    def test_slow_plan(self):
        p = v2.make_plan("Check why bigboi is running slowly.")
        targets = [s["target"] for s in p["steps"]]
        self.assertIn("BIGBOI", targets)
        self.assertGreaterEqual(len(p["steps"]), 4)

    def test_docker(self):
        p = v2.make_plan("Show Docker containers.")
        self.assertEqual(p["steps"][0]["target"], "BIGBOI")
        self.assertEqual(p["steps"][0]["action"], "bigboi.docker.list")

    def test_summarise_local(self):
        p = v2.make_plan("Summarise this text locally.")
        self.assertEqual(p["steps"][0]["target"], "OLLAMA-LOCAL")

    def test_route_docker(self):
        r = route_compute("Show Docker containers")
        self.assertEqual(r["suggested"], "BIGBOI")


class Breaker(unittest.TestCase):
    def test_mock_degraded(self):
        v2.breaker_ok("ollama")
        v2.breaker_mock_fail("ollama", 3)
        self.assertEqual(v2.breaker_state("ollama"), "DEGRADED")
        v2.breaker_ok("ollama")


class Compress(unittest.TestCase):
    def test_records_truncation(self):
        c = v2.compress("ok\nERROR boom\n" + ("x" * 9000))
        self.assertTrue(c["truncated"])
        self.assertGreater(c["kept_errors"], 0)


if __name__ == "__main__":
    unittest.main()
