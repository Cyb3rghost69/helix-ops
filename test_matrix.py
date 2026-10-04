#!/usr/bin/env python3
import json
import unittest
from helix_memory import snapshot, strip_contents, _pressure, _bank


class MatrixPrivacy(unittest.TestCase):
    def test_snapshot_has_no_file_contents(self):
        data = snapshot(lambda: {"ok": True, "repo": "t", "branch": "main", "head": "abc", "sync": "UP TO DATE"}, force=True)
        blob = json.dumps(data)
        self.assertNotIn("WebUI login is password", blob)
        self.assertNotIn("OPENAI_API_KEY", blob)
        for key in ("text", "content", "prompt", "body"):
            self.assertNotIn('"' + key + '"', blob)
        self.assertTrue(data["banks"])
        core = next(b for b in data["banks"] if b["type"] == "CORE")
        self.assertEqual(core["capacityType"], "CHARACTERS")
        self.assertIsNotNone(core["utilization"])
        sess = next(b for b in data["banks"] if b["type"] == "SESSION")
        self.assertIsNone(sess["utilization"])
        ext = next(b for b in data["banks"] if b["type"] == "EXTERNAL")
        self.assertIsNone(ext["utilization"])
        ctx = next(b for b in data["banks"] if b["type"] == "CONTEXT")
        self.assertIsNone(ctx["utilization"])

    def test_strip(self):
        d = strip_contents({"text": "SECRET", "used": 1, "nested": {"content": "x"}})
        self.assertNotIn("text", d)
        self.assertNotIn("content", d["nested"])
        self.assertEqual(d["used"], 1)

    def test_pressure(self):
        self.assertEqual(_pressure(10), "NOMINAL")
        self.assertEqual(_pressure(75), "ELEVATED")
        self.assertEqual(_pressure(85), "CONSOLIDATION ADVISED")
        self.assertEqual(_pressure(95), "CAPACITY WARNING")
        self.assertEqual(_pressure(100), "FULL")
        self.assertIsNone(_pressure(None))

    def test_unbounded_bank(self):
        b = _bank(5, name="V", type="EXTERNAL", capacityType="UNBOUNDED", used=12, limit=None)
        self.assertIsNone(b["utilization"])
        self.assertIsNone(b["pressure"])

    def test_skills_and_session_have_no_fake_pct(self):
        data = snapshot(lambda: {"ok": True, "repo": "t", "branch": "main", "head": "abc", "sync": "UP TO DATE"}, force=True)
        sk = next((b for b in data["banks"] if b["name"] == "SKILL STORE"), None)
        if sk:
            self.assertIsNone(sk["utilization"])
        idx = next((b for b in data["banks"] if b["type"] == "INDEX"), None)
        if idx:
            self.assertIsNone(idx["utilization"])
        self.assertIn("discovery", data)
        self.assertGreaterEqual(data["bankCount"], 6)
        self.assertIn("history", data)
        hist = json.dumps(data["history"])
        self.assertNotIn("WebUI login", hist)
        core = next(b for b in data["banks"] if b["type"] == "CORE")
        self.assertIn("lastWrite", core)
        self.assertIsNone(core.get("lastRead"))

    def test_memorystore_delimiter(self):
        from helix_memory import ENTRY_DELIMITER, _parse_entries
        raw = "alpha" + ENTRY_DELIMITER + "beta"
        self.assertEqual(_parse_entries(raw), ["alpha", "beta"])
        self.assertEqual(_parse_entries("keep § inside"), ["keep § inside"])
        used = len(ENTRY_DELIMITER.join(_parse_entries(raw)))
        self.assertEqual(used, len("alpha" + ENTRY_DELIMITER + "beta"))


if __name__ == "__main__":
    unittest.main()
