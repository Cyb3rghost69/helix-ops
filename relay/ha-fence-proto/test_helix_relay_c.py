"""Phase 5C durable relay tests. Dummy TG/Discord. No production credentials."""
from __future__ import annotations

import json
import tempfile
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread

from ha_controller import AuthorityError
from helix_relay_svc import CONTRACT_VERSION, DurableRelay
from test_ha_controller import boot


class TestDurableRelay(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        self.tmp.close()
        clk, c = boot()
        self.clk, self.ctl = clk, c
        self.r = DurableRelay(c, self.tmp.name)
        self.r.connect_backend("alpha")

    def tearDown(self):
        self.r.close()
        Path(self.tmp.name).unlink(missing_ok=True)

    def test_handshake_v1(self):
        d = self.r.handshake("telegram")
        self.assertEqual(d["contract_version"], CONTRACT_VERSION)
        self.assertEqual(d["platform"], "telegram")
        self.assertEqual(d["len_unit"], "utf16")
        d2 = self.r.handshake("discord")
        self.assertEqual(d2["platform"], "discord")

    def test_handover_keeps_dummy_sockets(self):
        self.assertTrue(self.r.platforms["telegram"] and self.r.platforms["discord"])
        self.r.handover("bravo")
        self.assertTrue(self.r.platforms["telegram"] and self.r.platforms["discord"])
        self.assertTrue(self.r.connected["bravo"])

    def test_dedup(self):
        a = self.r.inbound("hi", mid="tg-1")
        b = self.r.inbound("hi", mid="tg-1")
        self.assertIsNotNone(a)
        self.assertIsNone(b)

    def test_delayed_stale_reply(self):
        q = self.r.inbound("x", mid="tg-2")
        old = self.ctl.lease.epoch
        self.r.handover("bravo")
        out = self.r.outbound(q.mid, old, "alpha", "late")
        self.assertTrue(out.dropped)
        self.assertEqual(out.reason, "stale_epoch")

    def test_connector_crash_and_recover(self):
        self.r.inbound("a", mid="tg-3")
        self.r.crash_connector()
        self.assertIsNone(self.r.inbound("b", mid="tg-4"))
        self.assertTrue(self.r.platforms["telegram"])
        self.r.recover_connector()
        self.assertIsNone(self.r.inbound("a", mid="tg-3"))  # still deduped from sqlite
        c = self.r.inbound("c", mid="tg-5")
        self.assertIsNotNone(c)

    def test_partition_no_second_backend(self):
        self.ctl.isolate("bravo")
        with self.assertRaises(AuthorityError):
            self.r.handover("bravo")
        self.assertTrue(self.r.connected["alpha"])
        self.assertTrue(self.r.platforms["discord"])

    def test_simultaneous_backend_recovery(self):
        self.r.handover("bravo")
        self.ctl.crash_node("alpha")
        self.ctl.crash_node("bravo")
        self.r.connected["bravo"] = False
        self.ctl.recover_node("alpha")
        self.ctl.recover_node("bravo")
        self.assertFalse(self.ctl.nodes["alpha"].gateway_on)
        with self.assertRaises(AuthorityError):
            self.r.connect_backend("alpha")

    def test_loopback_status_only(self):
        snap = self.r.snapshot()

        class H(BaseHTTPRequestHandler):
            def do_GET(self):
                body = json.dumps(snap).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *a):
                return

        httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        t = Thread(target=httpd.serve_forever, daemon=True)
        t.start()
        import urllib.request

        url = f"http://127.0.0.1:{httpd.server_address[1]}/"
        data = json.loads(urllib.request.urlopen(url, timeout=2).read())
        httpd.shutdown()
        httpd.server_close()
        self.assertTrue(data["prototype"])
        self.assertEqual(data["label"], "SIM")
        self.assertEqual(httpd.server_address[0], "127.0.0.1")
