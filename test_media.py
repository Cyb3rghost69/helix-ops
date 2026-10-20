"""HELIX MEDIA pane presence tests. No live Unraid required for HTML/asset checks."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class TestMediaPane(unittest.TestCase):
    def test_assets(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('data-tab="media"', html)
        self.assertIn("pane-media", html)
        self.assertIn("hos0524", html)
        self.assertIn("helix-media.js", html)
        self.assertTrue((ROOT / "helix-media.js").is_file())
        self.assertTrue((ROOT / "helix-media.css").is_file())
        self.assertTrue((ROOT / "helix_media.py").is_file())
        src = (ROOT / "helix_media.py").read_text(encoding="utf-8")
        self.assertNotIn("Preferences.xml", src)
        self.assertIn("unraid/media", src)


if __name__ == "__main__":
    unittest.main()
