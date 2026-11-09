#!/usr/bin/env python3
"""RAGNAR SHIELD — checks run against throwaway local services on 127.0.0.1."""
import json
import os
import socket
import socketserver
import ssl
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import helix_shield as sh

TMP = Path(tempfile.mkdtemp(prefix="shield-test-"))
sh.DB = TMP / "shield.db"
sh.BASELINE = TMP / "baseline.json"


def _free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


class _Line(socketserver.BaseRequestHandler):
    reply = b""

    def handle(self):
        try:
            self.request.recv(256)
            self.request.sendall(self.reply)
        except OSError:
            pass


def _tcp(reply: bytes) -> int:
    h = type("H", (_Line,), {"reply": reply})
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), h)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]


class _Login(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        body = b'<html><title>Cam Admin</title><form><input type="password" name="pw"></form></html>'
        self.send_response(200)
        self.send_header("Content-Type", "text/html")
        self.send_header("Server", "lighttpd/1.4.35")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def _http(tls: bool = False) -> int:
    srv = HTTPServer(("127.0.0.1", 0), _Login)
    srv.handle_error = lambda *a: None
    if tls:
        key, crt = TMP / "k.pem", TMP / "c.pem"
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", str(key), "-out", str(crt),
                        "-days", "10", "-subj", "/CN=helix-test"], check=True, capture_output=True)
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(crt, key)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv.server_address[1]


class Shield(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["SHIELD_SCOPE"] = "127.0.0.0/8"
        cls.redis = _tcp(b"+PONG\r\n")
        cls.mqtt = _tcp(b"\x20\x02\x00\x00")
        cls.web = _http()
        cls.tls = _http(tls=True)
        cls.closed = _free_port()
        sh.PORTS.update({
            cls.redis: ("redis", "med", "t"), cls.mqtt: ("mqtt", "med", "t"),
            cls.web: ("http-alt", "info", "t"), cls.tls: ("https-alt", "info", "t"), cls.closed: ("ftp", "med", "t"),
        })
        sh.WEB_PORTS.update({cls.web, cls.tls})
        cls.ports = [cls.redis, cls.mqtt, cls.web, cls.tls, cls.closed]

    def test_scope_never_public(self):
        os.environ["SHIELD_SCOPE"] = "0.0.0.0/0"
        try:
            self.assertFalse(sh.in_scope("8.8.8.8"))
            self.assertTrue(sh.in_scope("192.168.1.5"))
        finally:
            os.environ["SHIELD_SCOPE"] = "127.0.0.0/8"
        self.assertFalse(sh.in_scope("192.168.1.5"))
        self.assertFalse(sh.in_scope("not-an-ip"))

    def test_host_audit(self):
        h = sh.audit_host({"ip": "127.0.0.1", "name": "lab"}, self.ports)
        got = {c["check"] for c in h["checks"]}
        self.assertNotIn(f"port-{self.closed}", got)
        for want in ("redis-noauth", "mqtt-anon", "login-cleartext", "clickjack", "server-version", "cert-self", "no-hsts"):
            self.assertIn(want, got)
        self.assertEqual(h["worst"], "high")
        tls = next(p for p in h["open"] if p["port"] == self.tls)["tls"]
        self.assertTrue(tls["pfs"])
        self.assertEqual(tls["cert"]["cn"], "helix-test")
        self.assertLessEqual(tls["cert"]["days_left"], 10)
        # HTTPS login form is not "cleartext"
        self.assertFalse(any(c["check"] == "login-cleartext" and c["port"] == self.tls for c in h["checks"]))

    def test_scan_baseline_mute_and_privacy(self):
        if sh.BASELINE.exists():
            sh.BASELINE.unlink()
        targets = [{"ip": "127.0.0.1", "name": "lab", "mac": "aa:bb:cc:00:00:01"}]
        no_unifi = lambda: (None, "https://192.168.1.1")
        r1 = sh.run_scan(lambda: targets + [{"ip": "8.8.8.8"}], no_unifi, ports=self.ports)
        self.assertTrue(r1["baseline_seeded_now"])
        self.assertEqual(r1["skipped_out_of_scope"], 1)
        self.assertEqual([h["ip"] for h in r1["hosts"]], ["127.0.0.1"])
        self.assertLess(r1["score"], 100)
        # new device appears on the 2nd scan
        targets2 = targets + [{"ip": "127.0.0.2", "name": "mystery", "mac": "de:ad:be:ef:00:01"}]
        r2 = sh.run_scan(lambda: targets2, no_unifi, ports=[self.closed])
        self.assertEqual([d["dev"] for d in r2["new_devices"]], ["de:ad:be:ef:00:01"])
        self.assertTrue(any(f["check"] == "new-device" and f["new"] for f in r2["findings"]))
        # ack + mute
        sh.act({"action": "ack_device", "dev": "de:ad:be:ef:00:01"}, None, None)
        hi = next(f for f in r1["findings"] if f["check"] == "redis-noauth")
        sh.act({"action": "mute", "key": hi["key"]}, None, None)
        r3 = sh.run_scan(lambda: targets2, no_unifi, ports=self.ports)
        self.assertEqual(r3["new_devices"], [])
        self.assertTrue(next(f for f in r3["findings"] if f["key"] == hi["key"])["muted"])
        self.assertGreater(r3["score"], r1["score"])
        snap = json.dumps(sh.snapshot())
        self.assertNotIn("UNIFI_API_KEY", snap)
        self.assertEqual(len(sh.history()), 3)
        self.assertEqual(oct(sh.BASELINE.stat().st_mode & 0o777), "0o600")


if __name__ == "__main__":
    unittest.main()
