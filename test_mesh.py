import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class MeshTests(unittest.TestCase):
    def test_noc_silent_and_rings(self):
        js = (ROOT / "helix-noc.js").read_text(encoding="utf-8")
        self.assertIn("silent:", js)
        self.assertIn('innerIds', js)
        self.assertIn('agent.status === "silent"', js)

    def test_neon_helix_center(self):
        js = (ROOT / "helix-neon-ops.js").read_text(encoding="utf-8")
        self.assertIn("id !== \"helix\"", js)
        self.assertIn("prefect", js)
        self.assertIn('a.status === "silent"', js)

    def test_server_mesh_nodes(self):
        src = (ROOT / "server.py").read_text(encoding="utf-8")
        ast.parse(src)
        for token in ("ecc", "discord", "bluebubbles", "umbrel", '"silent"'):
            self.assertIn(token, src)

    def test_asset(self):
        html = (ROOT / "index.html").read_text(encoding="utf-8")
        self.assertIn("hos0524", html)


if __name__ == "__main__":
    unittest.main()
