#!/usr/bin/env python3
import unittest
from helix_lights import _pilot_to_state, _did, _cmd_from, WizProvider, IP_OK, DEFAULT_SCENES


class PilotParse(unittest.TestCase):
    def test_rgb_and_mac(self):
        st = _pilot_to_state(
            {"result": {"state": True, "dimming": 40, "r": 10, "g": 20, "b": 30, "mac": "aabbccddeeff", "rssi": -50}},
            {"result": {"moduleName": "ESP01_SHRGB1C_31", "mac": "aabbccddeeff", "fwVersion": "1.2"}},
        )
        self.assertTrue(st["online"])
        self.assertEqual(st["brightness"], 40)
        self.assertEqual(st["rgb"], [10, 20, 30])
        self.assertEqual(st["mac"], "aabbccddeeff")
        self.assertEqual(st["name"], "ESP01_SHRGB1C_31")

    def test_id_prefers_mac(self):
        self.assertEqual(_did({"mac": "aa:bb", "ip": "1.2.3.4"}), "aabb")
        self.assertEqual(_did({"ip": "192.168.1.50"}), "ip-192.168.1.50")

    def test_ip_ok(self):
        self.assertTrue(IP_OK.match("192.168.1.40"))
        self.assertFalse(IP_OK.match("999.1"))
        self.assertFalse(IP_OK.match("192.168.1.40; rm"))

    def test_cmd_on(self):
        self.assertEqual(_cmd_from("on", {}, {"devices": {}}), {"power": True})
        self.assertEqual(_cmd_from("off", {}, {"devices": {}}), {"power": False})

    def test_default_scenes(self):
        ids = {s["id"] for s in DEFAULT_SCENES}
        self.assertIn("helix-green", ids)
        self.assertIn("all-off", ids)

    def test_provider_id(self):
        self.assertEqual(WizProvider().id, "wiz")

    def test_desired_survives_merge(self):
        from helix_lights import _merge_device
        st = {"devices": {}, "groups": [{"id": "bedroom", "name": "Bedroom", "lights": []}]}
        _merge_device(st, {"mac": "aabbccddeeff", "ip": "192.168.1.10", "online": True, "group": "bedroom"})
        did = "aabbccddeeff"
        st["devices"][did]["desired"] = {"brightness": 30, "power": True}
        _merge_device(st, {"mac": "aabbccddeeff", "ip": "192.168.1.10", "online": True, "brightness": 80})
        self.assertEqual(st["devices"][did]["desired"]["brightness"], 30)
        self.assertEqual(st["devices"][did]["group"], "bedroom")


if __name__ == "__main__":
    unittest.main()
