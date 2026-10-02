#!/usr/bin/env python3
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch

import adze_openai
import adze_orchestrator as orch


class AdzeTests(unittest.TestCase):
    def test_sanitize_strips_secrets(self):
        s = orch.sanitize("use OPENAI_API_KEY=sk-secret and Bearer abc.token")
        self.assertNotIn("sk-secret", s)
        self.assertIn("[redacted]", s)

    def test_offline_without_key(self):
        env = {k: v for k, v in os.environ.items() if k != "OPENAI_API_KEY"}
        with patch.dict(os.environ, env, clear=True):
            os.environ["ADZE_MODE"] = "always"
            r = orch.review({"user_request": "debug the server"}, force=True)
        self.assertFalse(r["ok"])
        self.assertIn("OFFLINE", r["state"])
        self.assertTrue(r.get("hermes_may_continue"))

    def test_mode_off(self):
        with patch.dict(os.environ, {"ADZE_MODE": "off"}, clear=False):
            r = orch.review({"user_request": "hello"})
        self.assertEqual(r["state"], "ADZE OFF")

    def test_malformed_provider(self):
        with patch.object(adze_openai, "openai_configured", return_value=True), patch.object(
            orch, "openai_configured", return_value=True
        ), patch.object(orch, "complete", side_effect=orch.AdzeProviderError("malformed", "malformed provider response")):
            os.environ["ADZE_MODE"] = "always"
            r = orch.review({"user_request": "architecture change"}, force=True)
        self.assertFalse(r["ok"])
        self.assertTrue(r.get("hermes_may_continue"))

    def test_three_round_cap_and_loop(self):
        calls = {"n": 0}

        def fake(messages, timeout=60, max_tokens=2500):
            calls["n"] += 1
            return {"text": "CONCERNS: same point again.\nRECOMMENDATION: wait.", "model": "gpt-4o", "usage": {"total": 10}}

        with patch.object(orch, "openai_configured", return_value=True), patch.object(orch, "complete", side_effect=fake):
            os.environ["ADZE_MODE"] = "always"
            os.environ["MAX_DELIBERATION_ROUNDS"] = "3"
            r = orch.review({"user_request": "rewrite the website"}, force=True)
        self.assertTrue(r["ok"])
        self.assertLessEqual(r["round_count"], 3)
        self.assertEqual(r["consensus"], "NOT REACHED")

    def test_status_has_no_key_material(self):
        blob = json.dumps(orch.status())
        self.assertNotIn("sk-", blob)
        self.assertIn("key_present", blob)
        self.assertNotIn("OPENAI_API_KEY=", blob)

    def test_status_file_not_leaking_env(self):
        p = Path(__file__).with_name("adze_openai.py")
        t = p.read_text()
        self.assertNotIn("sk-proj", t)
        self.assertIn("os.environ.get(\"OPENAI_API_KEY\")", t)


if __name__ == "__main__":
    unittest.main()
