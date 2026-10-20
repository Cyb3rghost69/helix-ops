"""Community bot pane presence tests."""
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class TestCommunityPane(unittest.TestCase):
    def test_assets(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn('data-tab="community"', html)
        self.assertIn("pane-community", html)
        self.assertIn("hos0524", html)
        self.assertIn("helix-community.js", html)
        self.assertTrue((ROOT / "helix_community.py").is_file())
        src = (ROOT / "helix_community.py").read_text(encoding="utf-8")
        self.assertNotIn("MATRIX_ACCESS_TOKEN=", src)


if __name__ == "__main__":
    unittest.main()
