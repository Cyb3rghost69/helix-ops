#!/usr/bin/env python3
import json, os, tempfile, unittest
from pathlib import Path
import helix_auth as A


class Auth(unittest.TestCase):
    def setUp(self):
        self.d = Path(tempfile.mkdtemp())
        A.USERS_FILE, A.AUDIT_FILE, A.OPS_ENV = self.d / "u.json", self.d / "a.jsonl", self.d / "ops.env"
        A._SESSIONS.clear(); A._FAILS.clear(); A._LOCKS.clear(); A._PWCHANGE.clear()

    def test_hash_roundtrip_and_salt(self):
        h1, h2 = A.hash_password("correct horse battery"), A.hash_password("correct horse battery")
        self.assertNotEqual(h1, h2)
        self.assertNotIn("correct", h1)
        self.assertTrue(A.verify_password("correct horse battery", h1))
        self.assertFalse(A.verify_password("wrong", h1))
        self.assertFalse(A.verify_password("x", "garbage"))

    def test_migrate_keeps_other_settings(self):
        A.OPS_ENV.write_text("HELIX_OPS_USER=mat\nHELIX_OPS_PASSWORD=supersecret99\nHELIX_OPS_SETUP=0\nHELIX_CHAT_KEY=abc\n")
        A.migrate()
        env = A.OPS_ENV.read_text()
        self.assertNotIn("supersecret99", env)
        self.assertIn("HELIX_CHAT_KEY=abc", env)
        raw = A.USERS_FILE.read_text()
        self.assertNotIn("supersecret99", raw)
        self.assertEqual(oct(os.stat(A.USERS_FILE).st_mode & 0o777), "0o600")
        r = A.login("mat", "supersecret99", "1.2.3.4")
        self.assertTrue(r["ok"] and r.get("token"))
        self.assertEqual(A.session(r["token"])["role"], "admin")

    def test_setup_then_lockout(self):
        self.assertTrue(A.setup_needed())
        self.assertFalse(A.setup_first_admin("mat", "short", "ip")["ok"])
        self.assertTrue(A.setup_first_admin("mat", "neon-pixel-comet-42", "ip")["ok"])
        self.assertFalse(A.setup_needed())
        for _ in range(A.MAX_FAILS_IP):
            self.assertFalse(A.login("mat", "nope-nope-nope", "9.9.9.9")["ok"])
        r = A.login("mat", "neon-pixel-comet-42", "9.9.9.9")
        self.assertEqual(r["error"], "locked")
        self.assertTrue(A.login("mat", "neon-pixel-comet-42", "8.8.8.8")["ok"])

    def test_admin_flow(self):
        A.setup_first_admin("mat", "neon-pixel-comet-42", "ip")
        r = A.admin_act("mat", "ip", {"action": "add", "username": "blaine", "role": "viewer"})
        self.assertTrue(r["ok"]); tmp = r["temp_password"]
        r = A.login("blaine", tmp, "ip")
        self.assertTrue(r["must_change"])
        self.assertFalse(A.complete_change(r["change_token"], tmp, "ip")["ok"])
        done = A.complete_change(r["change_token"], "violet-laser-orbit-7", "ip")
        self.assertTrue(done["ok"])
        self.assertEqual(A.session(done["token"])["role"], "viewer")
        self.assertFalse(A.admin_act("mat", "ip", {"action": "delete", "username": "mat"})["ok"])
        self.assertFalse(A.admin_act("mat", "ip", {"action": "role", "username": "mat", "role": "viewer"})["ok"])
        self.assertTrue(A.admin_act("mat", "ip", {"action": "disable", "username": "blaine"})["ok"])
        self.assertIsNone(A.session(done["token"]))
        self.assertFalse(A.login("blaine", "violet-laser-orbit-7", "ip2")["ok"])
        self.assertTrue(A.admin_act("mat", "ip", {"action": "delete", "username": "blaine"})["ok"])
        self.assertFalse(A.admin_act("mat", "ip", {"action": "add", "username": "Bad Name!", "role": "viewer"})["ok"])
        events = [json.loads(l)["event"] for l in A.AUDIT_FILE.read_text().splitlines()]
        self.assertIn("user_deleted", events)
        self.assertNotIn(tmp, A.AUDIT_FILE.read_text())

    def test_reset_admin_forces_change_and_rename(self):
        A.setup_first_admin("mat", "neon-pixel-comet-42", "ip")
        A.reset_admin()
        r = A.login("admin", "admin", "ip")
        self.assertTrue(r["must_change"])
        self.assertFalse(A.complete_change(r["change_token"], "admin", "ip")["ok"])
        done = A.complete_change(r["change_token"], "cobalt-ember-drift-9", "ip")
        self.assertTrue(done["ok"])
        self.assertTrue(A.admin_act("admin", "ip", {"action": "rename", "username": "admin", "new": "mat2"})["ok"])
        self.assertEqual(A.session(done["token"])["user"], "mat2")
        self.assertTrue(A.login("mat2", "cobalt-ember-drift-9", "ip")["ok"])

    def test_password_rules(self):
        self.assertIsNotNone(A.password_problem("password123"))
        self.assertIsNotNone(A.password_problem("mat-is-great-1", "mat"))
        self.assertIsNotNone(A.password_problem("aaaaaaaaaaaa"))
        self.assertIsNone(A.password_problem("cobalt-ember-drift-9", "mat"))


if __name__ == "__main__":
    unittest.main()
