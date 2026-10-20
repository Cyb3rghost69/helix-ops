import time
import unittest

import helix_control as hc
from helix_voice import parse_intent, LOW, READ


class Registry(unittest.TestCase):
    def setUp(self):
        hc.clear_context()
        hc.set_unavailable(False)
        self.reg = hc.mock_home()

    def test_status(self):
        r = hc.invoke("home.status", mock=self.reg)
        self.assertTrue(r["ok"])
        ids = [x["id"] for x in r["rooms"]]
        self.assertIn("blaines-room", ids)
        self.assertIn("violets-room", ids)
        self.assertIn("bedroom", ids)

    def test_rooms_devices(self):
        self.assertTrue(hc.invoke("home.rooms", mock=self.reg)["ok"])
        d = hc.invoke("home.devices", mock=self.reg)
        self.assertTrue(d["ok"])
        self.assertGreaterEqual(len(d["devices"]), 1)

    def test_known_room(self):
        r = hc.resolve_room("Violet's room")
        self.assertTrue(r["ok"])
        self.assertEqual(r["id"], "violets-room")
        self.assertEqual(r["label"], "VIOLETS ROOM")

    def test_unknown_room(self):
        self.assertEqual(hc.resolve_room("kitchen")["error"], "unknown room")
        r = hc.invoke("home.room.status", {"room": "kitchen"}, mock=self.reg)
        self.assertFalse(r["ok"])
        self.assertEqual(r["error"], "unknown room")

    def test_known_light(self):
        r = hc.invoke("home.light.off", {"id": "violet1"}, mock=self.reg, dry_run=True)
        self.assertTrue(r["ok"])

    def test_unknown_entity(self):
        r = hc.invoke("home.light.off", {"id": "nope-nope"}, mock=self.reg, dry_run=True)
        self.assertEqual(r["error"], "unknown entity")

    def test_invalid_brightness(self):
        r = hc.invoke("home.room.lights.brightness", {"room": "violets-room", "brightness": 400}, mock=self.reg)
        self.assertEqual(r["error"], "invalid brightness")
        r2 = hc.invoke("home.room.lights.brightness", {"room": "violets-room", "brightness": "hot"}, mock=self.reg)
        self.assertEqual(r2["error"], "invalid brightness")

    def test_invalid_colour(self):
        r = hc.invoke("home.room.lights.colour", {"room": "violets-room", "colour": "blurple"}, mock=self.reg)
        self.assertEqual(r["error"], "invalid colour")

    def test_alias(self):
        self.assertEqual(hc.resolve_room("Violet's room")["id"], "violets-room")
        self.assertEqual(hc.resolve_room("Blaine room")["id"], "blaines-room")
        self.assertEqual(hc.resolve_room("Blaine's bedroom")["id"], "blaines-room")

    def test_turn_violet_off_dry(self):
        u = hc.resolve_utterance("Turn Violet's lights off")
        self.assertTrue(u["ok"])
        self.assertEqual(u["capability"], "home.room.lights.off")
        self.assertEqual(u["params"]["room"], "violets-room")
        r = hc.invoke(u["capability"], u["params"], mock=self.reg, dry_run=True)
        self.assertTrue(r["ok"])
        self.assertEqual(r["resolved"]["room"], "violets-room")

    def test_context_purple(self):
        hc.invoke("home.room.lights.on", {"room": "violets-room"}, mock=self.reg, dry_run=True)
        u = hc.resolve_utterance("Make them purple.")
        self.assertEqual(u["capability"], "home.room.lights.colour")
        self.assertEqual(u["params"]["room"], "violets-room")
        self.assertEqual(u["params"]["colour"], "purple")

    def test_context_expiry(self):
        hc.remember("violets-room")
        u = hc.resolve_utterance("Make them purple.", now=time.time() + 500)
        self.assertEqual(u["error"], "no target context")

    def test_partial(self):
        r = hc.invoke("home.room.lights.off", {"room": "violets-room"}, mock=self.reg)
        self.assertEqual(r["status"], "PARTIAL")
        self.assertIn("1", r["speak"])

    def test_ha_unavailable(self):
        hc.set_unavailable(True)
        r = hc.invoke("home.room.lights.on", {"room": "bedroom"})
        self.assertEqual(r["error"], "HOME CONTROL UNAVAILABLE")
        hc.set_unavailable(False)

    def test_call_service_rejected(self):
        r = hc.invoke("home.call_service", {"domain": "light", "service": "turn_on"})
        self.assertEqual(r["error"], "unknown capability")

    def test_blocked_lock(self):
        u = hc.resolve_utterance("Unlock the front door")
        self.assertEqual(u["error"], "blocked capability")

    def test_cli_lights_violets(self):
        u = hc.resolve_utterance("lights violets room off")
        self.assertEqual(u["capability"], "home.room.lights.off")
        self.assertEqual(u["params"]["room"], "violets-room")

    def test_good_night(self):
        u = hc.resolve_utterance("Helix, good night.")
        self.assertEqual(u["capability"], "home.scene.apply")
        self.assertEqual(u["params"]["scene"], "good-night")
        r = hc.invoke(u["capability"], u["params"], mock=self.reg, dry_run=True)
        self.assertTrue(r["ok"])
        self.assertTrue(r.get("lighting_only"))


class Voice(unittest.TestCase):
    def test_blaine_on(self):
        i = parse_intent("Turn Blaine's lights on.")
        self.assertIn(i["tool"], ("lights.set_power", "home.room.lights.on"))
        self.assertEqual(i["permission"], LOW)

    def test_whats_on(self):
        i = parse_intent("What's on in Violet's room?")
        self.assertEqual(i["tool"], "home.room.status")
        self.assertEqual(i["args"]["room"], "violets-room")
        self.assertEqual(i["permission"], READ)

    def test_good_night(self):
        i = parse_intent("Helix, good night.")
        self.assertEqual(i["tool"], "home.scene.apply")

    def test_bedroom_still_works(self):
        i = parse_intent("Turn the bedroom lights on")
        self.assertEqual(i["tool"], "lights.set_power")

    def test_room_pref_persists(self):
        import tempfile
        from pathlib import Path
        tmp = Path(tempfile.mkdtemp()) / "helix-home-prefs.json"
        old = hc.PREFS_FILE
        hc.PREFS_FILE = tmp
        try:
            hc.note_room_pref("violets-room", brightness=30, colour="purple", power=True)
            p = hc.load_prefs()
            self.assertEqual(p["preferred_brightness"]["violets-room"], 30)
            self.assertEqual(p["preferred_colour"]["violets-room"], "purple")
            self.assertTrue(p["power"]["violets-room"])
            again = hc.load_prefs()
            self.assertEqual(again["preferred_brightness"]["violets-room"], 30)
        finally:
            hc.PREFS_FILE = old
            try:
                tmp.unlink()
            except OSError:
                pass


if __name__ == "__main__":
    unittest.main()
