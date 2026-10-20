import unittest

import helix_control as hc
import helix_prefs as hp
from helix_voice import parse_intent, LOW


class Prefs(unittest.TestCase):
    def setUp(self):
        hp.set_mock([])
        hc.clear_context()
        self.reg = hc.mock_home()

    def tearDown(self):
        hp.set_mock(None, down=False)

    def test_set_get_list(self):
        w = hp.set_preference({"class": "PREFERENCE", "target": "violets-room", "key": "colour", "value": "purple"})
        self.assertTrue(w["ok"])
        self.assertTrue(w["wrote"])
        g = hp.get_preference(w["preference"]["id"])
        self.assertTrue(g["ok"])
        self.assertEqual(g["preference"]["value"], "purple")
        listed = hp.list_preferences(target="violets-room")
        self.assertEqual(listed["count"], 1)

    def test_unrelated_not_retrieved(self):
        hp.set_preference({"class": "PREFERENCE", "target": "violets-room", "key": "colour", "value": "purple"})
        hp.set_preference({"class": "COMPUTE_PREFERENCE", "target": "compute", "key": "policy", "value": "LOCAL-FIRST"})
        got = hp.lookup(target="violets-room")
        ids = [p["class"] for p in got["preferences"]]
        self.assertEqual(ids, ["PREFERENCE"])
        self.assertTrue(all(p["target"] == "violets-room" for p in got["preferences"]))

    def test_delete_specific(self):
        w = hp.set_preference({"class": "PREFERENCE", "target": "violets-room", "key": "colour", "value": "purple"})
        pid = w["preference"]["id"]
        d = hp.delete_preference(pid)
        self.assertTrue(d["ok"])
        self.assertEqual(hp.list_preferences()["count"], 0)
        self.assertFalse(hp.delete_preference("*")["ok"])
        self.assertFalse(hp.delete_preference("all")["ok"])

    def test_make_violet_purple_no_write(self):
        u = hc.resolve_utterance("Make Violet's room purple")
        self.assertEqual(u.get("capability"), "home.room.lights.colour")
        self.assertFalse(u.get("write"))
        hc.invoke(u["capability"], u["params"], mock=self.reg, dry_run=True)
        self.assertEqual(hp.list_preferences()["count"], 0)

    def test_remember_writes(self):
        u = hc.resolve_utterance("Remember I like Violet's room purple.")
        self.assertEqual(u.get("capability"), "memory.preferences.set")
        r = hc.invoke(u["capability"], u.get("params") or {})
        self.assertTrue(r.get("wrote"))
        self.assertEqual(hp.list_preferences()["count"], 1)

    def test_how_i_like_it_reads(self):
        hp.set_preference({"class": "PREFERENCE", "target": "violets-room", "key": "colour", "value": "purple"})
        u = hc.resolve_utterance("Make Violet's room how I like it.")
        self.assertEqual(u.get("capability"), "memory.preferences.apply")
        self.assertTrue(u.get("read"))
        r = hc.invoke(u["capability"], u.get("params") or {}, mock=self.reg, dry_run=True)
        self.assertTrue(r.get("read"))
        self.assertFalse(r.get("wrote"))
        self.assertTrue(any(a.get("params", {}).get("colour") == "purple" for a in r.get("actions") or []))

    def test_override_does_not_overwrite(self):
        hp.set_preference({"class": "PREFERENCE", "target": "violets-room", "key": "colour", "value": "purple"})
        hp.set_preference({"class": "PREFERENCE", "target": "violets-room", "key": "brightness", "value": 20})
        u = hc.resolve_utterance("Make Violet's room blue at 50%.")
        self.assertEqual(u.get("capability"), "home.room.lights.colour")
        self.assertEqual(u["params"]["colour"], "blue")
        hc.invoke(u["capability"], u["params"], mock=self.reg, dry_run=True)
        listed = hp.list_preferences(target="violets-room")
        vals = {p["key"]: p["value"] for p in listed["preferences"]}
        self.assertEqual(vals.get("colour"), "purple")
        self.assertEqual(vals.get("brightness"), 20)

    def test_secret_rejected(self):
        r = hp.set_preference({"class": "PREFERENCE", "target": "violets-room", "key": "colour", "value": "sk-abcTOKEN"})
        self.assertFalse(r["ok"])

    def test_honcho_down_does_not_break_home(self):
        hp.set_mock(None, down=True)
        r = hc.invoke("home.status", mock=self.reg)
        self.assertTrue(r["ok"])
        st = hp.invoke("memory.status")
        self.assertEqual(st["honcho"], "OFFLINE")
        w = hp.set_preference({"class": "PREFERENCE", "target": "violets-room", "key": "colour", "value": "purple"})
        self.assertFalse(w["ok"])
        listed = hp.list_preferences()
        self.assertEqual(listed["count"], 0)

    def test_voice_remember_not_delete(self):
        i = parse_intent("Remember I like Violet's lights purple.")
        self.assertEqual(i.get("tool"), "memory.preferences.set")
        self.assertEqual(i.get("permission"), LOW)
        i2 = parse_intent("Forget my preferred colour for Violet's room.")
        self.assertTrue(i2.get("blocked") or i2.get("error") == "voice cannot delete memory")
        self.assertNotEqual(i2.get("tool"), "memory.preferences.delete")

    def test_voice_make_is_not_remember(self):
        i = parse_intent("Make Violet's room purple")
        self.assertIn(i.get("tool"), ("home.room.lights.colour", "lights.set_color"))
        self.assertNotEqual(i.get("tool"), "memory.preferences.set")


if __name__ == "__main__":
    unittest.main()
