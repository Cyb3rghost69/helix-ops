import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parent


class TestCommsModule(unittest.TestCase):
    def test_assets(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('data-tab="comms"', html)
        self.assertIn("pane-comms", html)
        self.assertIn("hos0524", html)
        self.assertIn("helix-comms.js", html)
        self.assertTrue((ROOT / "helix-comms.js").is_file())
        self.assertTrue((ROOT / "helix-comms.css").is_file())
        self.assertTrue((ROOT / "helix_comms.py").is_file())

    def test_no_secret_fields(self):
        src = (ROOT / "helix_comms.py").read_text(encoding="utf-8")
        self.assertIn("family_isolated", src)
        self.assertNotIn("MATRIX_ACCESS_TOKEN=", src)
        js = (ROOT / "helix-comms.js").read_text(encoding="utf-8")
        self.assertIn("/api/comms", js)
        self.assertNotIn("access_token", js.lower())

    def test_snapshot_shape(self):
        import helix_comms

        d = helix_comms.snapshot(force=True)
        for k in ("homeserver", "cloudflare", "gateway", "bot", "traffic", "encryption", "topology", "errors"):
            self.assertIn(k, d)
        blob = json.dumps(d)
        self.assertNotRegex(blob, r"(?i)(syt_|access_token|Bearer )")
        self.assertTrue(d.get("family_isolated"))
        self.assertEqual(d["bot"]["privileged_users"], 0)
        self.assertFalse(d["bot"]["allow_all_users"])


if __name__ == "__main__":
    unittest.main()
