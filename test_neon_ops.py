import pathlib
import unittest


class TestNeonOpsArcade(unittest.TestCase):
    def test_theme_registered(self):
        t = pathlib.Path(__file__).with_name("helix-theme.js").read_text(encoding="utf-8")
        self.assertIn('"neon-ops"', t)
        self.assertIn("NEON OPS ARCADE", t)
        self.assertIn("arcade:", t)

    def test_assets_exist(self):
        root = pathlib.Path(__file__).parent
        self.assertTrue((root / "helix-neon-ops.js").is_file())
        self.assertTrue((root / "helix-neon-ops.css").is_file())
        html = (root / "index.html").read_text(encoding="utf-8")
        self.assertIn('data-tab="floor"', html)
        self.assertIn("hos0524", html)
        self.assertIn("helix-neon-ops.js", html)


if __name__ == "__main__":
    unittest.main()
