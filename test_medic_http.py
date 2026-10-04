"""Real HTTP safety regression tests, no live state or Docker access."""
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from unittest.mock import patch
import server
import helix_medic
import helix_jobs


class MedicHTTP(unittest.TestCase):
    def setUp(self):
        self.auth = patch.object(server, "auth_open", return_value=True)
        self.auth.start()
        self.addCleanup(self.auth.stop)
        self.session = patch.object(server, "session_user", return_value=None)
        self.identity = self.session.start()
        self.addCleanup(self.session.stop)
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
        self.thread = threading.Thread(target=self.srv.serve_forever, daemon=True)
        self.thread.start()
        self.base = "http://127.0.0.1:%d" % self.srv.server_port
        self.addCleanup(self.close)

    def close(self):
        self.srv.shutdown()
        self.srv.server_close()
        self.thread.join(timeout=5)

    def request(self, path, body, headers=None):
        req = Request(
            self.base + path,
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json", **(headers or {})},
            method="POST",
        )
        try:
            with urlopen(req, timeout=3) as r:
                return r.status, json.loads(r.read())
        except HTTPError as e:
            return e.code, e.read().decode()

    def test_open_dashboard_cannot_enable_medic(self):
        with patch.object(helix_medic, "set_mode", return_value={"ok": True}) as mutate:
            code, _ = self.request("/api/medic", {"name": "Plex", "mode": "restart"})
        self.assertEqual(code, 401)
        mutate.assert_not_called()

    def test_cross_origin_medic_request_denied(self):
        self.identity.return_value = "operator"
        with patch.object(helix_medic, "set_mode", return_value={"ok": True}) as mutate:
            code, _ = self.request(
                "/api/medic",
                {"name": "Plex", "mode": "restart"},
                {"Origin": "https://evil.example"},
            )
        self.assertEqual(code, 403)
        mutate.assert_not_called()

    def test_approval_needs_explicit_boolean(self):
        self.identity.return_value = "operator"
        for body in ({}, {"allow": "false"}, {"allow": 1}, {"allow": None}, []):
            with self.subTest(body=body), patch.object(
                helix_jobs, "approve_job", return_value={"ok": True}
            ) as approve:
                code, _ = self.request("/api/compute/jobs/job_test/approve", body)
                self.assertEqual(code, 400)
                approve.assert_not_called()

    def test_valid_explicit_denial_remains_denial(self):
        self.identity.return_value = "operator"
        with patch.object(helix_jobs, "approve_job", return_value={"ok": True}) as approve:
            code, _ = self.request("/api/compute/jobs/job_test/approve", {"allow": False})
        self.assertEqual(code, 200)
        approve.assert_called_once_with("job_test", allow=False)


if __name__ == "__main__":
    unittest.main()
