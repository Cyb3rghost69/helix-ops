#!/usr/bin/env python3
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from io import BytesIO

import helix_hermes as hh


class _Resp:
    def __init__(self, body, status=200):
        self.status = status
        self._body = body if isinstance(body, bytes) else json.dumps(body).encode()

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


class HermesApiTests(unittest.TestCase):
    def test_status_online_no_key_in_payload(self):
        with patch.object(hh, "_request", return_value=(200, {"status": "ok"}, 42)):
            d = hh.status()
        blob = json.dumps(d)
        self.assertTrue(d["online"])
        self.assertEqual(d["service"], "Hermes Agent")
        self.assertEqual(d["latency"], 42)
        self.assertNotIn("Bearer", blob)
        self.assertNotIn("API_KEY", blob)
        self.assertNotIn("sk-", blob)

    def test_status_offline_on_error(self):
        with patch.object(hh, "_request", side_effect=hh.HermesError("unavailable", 502)):
            d = hh.status()
        self.assertFalse(d["online"])
        self.assertIsNone(d["latency"])

    def test_chat_success(self):
        payload = {"choices": [{"message": {"role": "assistant", "content": "PONG"}}]}
        with patch.object(hh, "_request", return_value=(200, payload, 10)):
            d = hh.chat("ping", "helix-main")
        self.assertTrue(d["success"])
        self.assertEqual(d["message"], "PONG")
        self.assertEqual(d["source"], "hermes")

    def test_chat_timeout(self):
        with patch.object(hh, "_request", side_effect=hh.HermesError("timeout", 504)):
            d = hh.chat("ping")
        self.assertFalse(d["success"])
        self.assertEqual(d["error"], "timeout")
        self.assertNotIn("message", d)

    def test_chat_auth(self):
        with patch.object(hh, "_request", side_effect=hh.HermesError("authentication", 502)):
            d = hh.chat("ping")
        self.assertEqual(d["error"], "authentication")

    def test_chat_invalid_empty(self):
        d = hh.chat("  ")
        self.assertFalse(d["success"])
        self.assertEqual(d["error"], "invalid")

    def test_session_key_format(self):
        self.assertEqual(hh._session_key("helix-main"), "helix:helix-main")
        self.assertEqual(hh._session_id("bad session!!"), "helix-main")

    def test_scrub_strips_bearer(self):
        s = hh._scrub("Authorization: Bearer supersecretvalue")
        self.assertNotIn("supersecretvalue", s)

    def test_js_has_no_key_material(self):
        js = (hh.ROOT / "helix-hermes.js").read_text()
        self.assertNotIn("HERMES_API_KEY", js)
        self.assertNotIn("API_SERVER_KEY", js)
        self.assertNotIn("Bearer ", js)

    def test_module_has_no_hardcoded_key(self):
        t = (hh.ROOT / "helix_hermes.py").read_text()
        self.assertNotIn("sk-proj", t)
        self.assertIn("HERMES_API_KEY", t)

    def test_urlopen_401_maps_auth(self):
        err = HTTPError("http://127.0.0.1:8642/v1/models", 401, "no", hdrs={}, fp=BytesIO(b"{}"))
        with patch.object(hh, "_cfg", return_value=("http://127.0.0.1:8642", "x")), patch(
            "helix_hermes.urlopen", side_effect=err
        ):
            with self.assertRaises(hh.HermesError) as ctx:
                hh._request("GET", "/v1/models")
        self.assertEqual(ctx.exception.code, "authentication")

    def test_urlopen_refused_unavailable(self):
        with patch.object(hh, "_cfg", return_value=("http://127.0.0.1:8642", "x")), patch(
            "helix_hermes.urlopen", side_effect=URLError("Connection refused")
        ):
            with self.assertRaises(hh.HermesError) as ctx:
                hh._request("GET", "/health", auth=False)
        self.assertEqual(ctx.exception.code, "unavailable")

    def test_runs_class_exists(self):
        self.assertTrue(hasattr(hh.RUNS, "create"))
        self.assertTrue(hasattr(hh.RUNS, "get"))
        self.assertTrue(hasattr(hh.RUNS, "events"))
        self.assertTrue(hasattr(hh.RUNS, "approval"))
        self.assertTrue(hasattr(hh.RUNS, "steer"))
        self.assertTrue(hasattr(hh.RUNS, "stop"))


if __name__ == "__main__":
    unittest.main()
