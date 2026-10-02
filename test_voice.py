#!/usr/bin/env python3
import unittest
from helix_voice import parse_intent, LOW, READ, DESTRUCTIVE


class Intent(unittest.TestCase):
    def test_bedroom_on(self):
        i = parse_intent("Turn the bedroom lights on")
        self.assertEqual(i["tool"], "lights.set_power")
        self.assertEqual(i["args"]["group"], "bedroom")
        self.assertTrue(i["args"]["power"])
        self.assertEqual(i["permission"], LOW)

    def test_dim(self):
        i = parse_intent("Turn the bedroom lights down to thirty percent")
        self.assertEqual(i["tool"], "lights.set_brightness")
        self.assertEqual(i["args"]["value"], 30)

    def test_all_off(self):
        i = parse_intent("Turn all the lights off")
        self.assertEqual(i["tool"], "lights.all_off")

    def test_scene(self):
        i = parse_intent("Set Blaine's Room to Helix green")
        self.assertEqual(i["tool"], "lights.activate_scene")
        self.assertEqual(i["args"]["scene"], "helix-green")
        self.assertEqual(i["args"]["group"], "blaines-room")

    def test_offline_count(self):
        i = parse_intent("How many WiZ lights are offline?")
        self.assertEqual(i["tool"], "lights.list")
        self.assertEqual(i["permission"], READ)

    def test_shutdown_confirm(self):
        i = parse_intent("Shut down BigBoi")
        self.assertEqual(i["permission"], DESTRUCTIVE)
        self.assertEqual(i["tool"], "server.shutdown")

    def test_empty(self):
        i = parse_intent("  ")
        self.assertFalse(i["ok"])


if __name__ == "__main__":
    unittest.main()
