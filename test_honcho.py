#!/usr/bin/env python3
import unittest

from helix_honcho import snapshot


class HonchoSnap(unittest.TestCase):
    def test_shape(self):
        d = snapshot()
        self.assertEqual(d["host"], "unraid")
        self.assertTrue(d["not_on_mac"])
        self.assertIn("/health", d["endpoint"])
        self.assertIn("pending", d["queue"])
        self.assertFalse(d["policy"]["automatic_failover"])
        self.assertFalse(d["policy"]["ollama_autostart"])
        self.assertNotIn("sessions", d)
        self.assertNotIn("sessions", d["queue"])


if __name__ == "__main__":
    unittest.main()
