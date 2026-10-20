import pathlib
import unittest


class TestAvatar(unittest.TestCase):
    def test_assets(self):
        root = pathlib.Path(__file__).parent
        js = (root / "helix-avatar.js").read_text(encoding="utf-8")
        html = (root / "index.html").read_text(encoding="utf-8")
        self.assertIn("hx-av-cv", html)
        self.assertIn("hos0524", html)
        self.assertTrue((root / "helix-avatar-pixels.js").is_file())
        self.assertIn("HelixAvatarPixels", (root / "helix-avatar-pixels.js").read_text(encoding="utf-8")[:80])
        self.assertIn("helix-avatar.js", html)
        for e in ("ready", "listen", "think", "speak", "happy", "curious", "concern", "wait", "offline"):
            self.assertIn('"' + e + '"', js)
        self.assertTrue((root / "helix-avatar-base.jpg").is_file())
        self.assertIn("HelixAvatarPixels", js)
        hermes = (root / "helix-hermes.js").read_text(encoding="utf-8")
        self.assertIn("helix-chat", hermes)
        voice = (root / "helix-voice.js").read_text(encoding="utf-8")
        self.assertIn("helix-voice", voice)


if __name__ == "__main__":
    unittest.main()
