#!/usr/bin/env python3
import unittest

import helix_compute as hc


class ClassifyTests(unittest.TestCase):
    def test_restart_helix_is_mac(self):
        r = hc.classify("restart Helix")
        self.assertEqual(r["target"], "mac")

    def test_docker_bigboi_is_unraid(self):
        r = hc.classify("check Docker containers on bigboi")
        self.assertEqual(r["target"], "unraid")

    def test_summarise_is_ollama(self):
        r = hc.classify("summarise this short text")
        self.assertEqual(r["target"], "ollama")

    def test_architecture_is_cloud(self):
        r = hc.classify("analyse this complicated architecture")
        self.assertEqual(r["target"], "cloud")

    def test_no_exec_restart(self):
        self.assertTrue(hc._NO_EXEC.search("restart Helix"))

    def test_pick_embed(self):
        m = hc.pick_ollama_model("embed this", ["qwen3:8b", "nomic-embed-text:latest", "gemma4:26b"])
        self.assertIsNotNone(m)
        self.assertIn("nomic", m or "")

    def test_pick_quick(self):
        m = hc.pick_ollama_model("summarise this short text", ["qwen3:8b", "gemma4:26b"])
        self.assertEqual(m, "qwen3:8b")

    def test_status_has_no_secrets(self):
        # classify path only — no keys in module source
        t = open(hc.__file__, encoding="utf-8").read()
        self.assertNotIn("sk-", t)
        self.assertNotIn("Bearer ey", t)


if __name__ == "__main__":
    unittest.main()
