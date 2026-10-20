import unittest
from pathlib import Path

import helix_ecc


class TestEccSnapshot(unittest.TestCase):
    def test_snapshot_has_no_secrets(self):
        d = helix_ecc.snapshot()
        blob = str(d).lower()
        self.assertTrue(d.get("ok"))
        self.assertEqual(d.get("profile"), "ecc")
        self.assertFalse(d.get("telegram"))
        self.assertNotIn("sk-", blob)
        self.assertNotIn("password", blob)
        self.assertNotIn("api_key", blob)
        self.assertIn("skills", d)

    def test_consult_empty(self):
        d = helix_ecc.consult("  ")
        self.assertFalse(d.get("ok"))

    def test_vendor_exists(self):
        self.assertTrue(Path.home().joinpath(".hermes/vendor/ecc").is_dir())


if __name__ == "__main__":
    unittest.main()
