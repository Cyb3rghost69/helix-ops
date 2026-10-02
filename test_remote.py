#!/usr/bin/env python3
import unittest
from rustdesk_remote import parse_info, parse_lan_peers, match_helix, RD_ID, strip_ip, SECRET_KEY


class RemoteSanitize(unittest.TestCase):
    def test_drops_pk(self):
        d = parse_info('{"ip":"::ffff:192.168.1.172","pk":"SECRET","hostname":"mini"}')
        self.assertEqual(d["ip"], "192.168.1.172")
        self.assertEqual(d["hostname"], "mini")
        self.assertNotIn("pk", d)

    def test_bad_json(self):
        self.assertEqual(parse_info("not-json"), {})

    def test_lan_peers(self):
        text = "[[peers]]\nid = '457549785'\nhostname = 'thinkpad'\nplatform = 'Windows'\nonline = true\n[peers.ip_mac]\n\"192.168.1.151\" = 'aa:bb'\n"
        p = parse_lan_peers(text)
        self.assertEqual(len(p), 1)
        self.assertEqual(p[0]["id"], "457549785")
        self.assertTrue(p[0]["online"])
        self.assertEqual(p[0]["ip"], "192.168.1.151")
        self.assertNotIn("aa:bb", str(p))

    def test_id_regex(self):
        self.assertTrue(RD_ID.match("54790681"))
        self.assertFalse(RD_ID.match("../etc"))
        self.assertFalse(RD_ID.match("abc"))

    def test_match_thinkpad(self):
        h = match_helix({"id": "457549785", "hostname": "thinkpad", "ip": "192.168.1.151"}, {})
        self.assertEqual(h["id"], "thinkpad")

    def test_secret_key(self):
        self.assertTrue(SECRET_KEY.search("password"))
        self.assertFalse(SECRET_KEY.search("hostname"))

    def test_strip_ip(self):
        self.assertEqual(strip_ip("::ffff:10.0.0.1"), "10.0.0.1")


if __name__ == "__main__":
    unittest.main()
