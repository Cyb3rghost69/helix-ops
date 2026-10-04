import unittest

import helix_medic as m


class GuardPolicy(unittest.TestCase):
    def test_unknown_cmd_denied(self):
        r = m.guard("rm", mock={"cmds": {}})
        self.assertTrue(r.get("denied"))

    def test_prune_denied(self):
        r = m.guard("prune", mock={"cmds": {"ps": "x"}})
        self.assertTrue(r.get("denied"))

    def test_exec_denied(self):
        r = m.guard("exec", extra="Plex-Media-Server; rm -rf /", mock={"cmds": {}})
        self.assertTrue(r.get("denied"))

    def test_bad_name(self):
        r = m.guard("restart", extra="; reboot", mock={"cmds": {"restart": "ok"}})
        self.assertEqual(r.get("error"), "bad name")

    def test_injection_not_cmd(self):
        self.assertFalse(m.NAME_RE.match("plex; docker rm"))
        self.assertTrue(m.NAME_RE.match("Plex-Media-Server"))


class Observe(unittest.TestCase):
    def setUp(self):
        m._MOCK = None
        st = m._load()
        st["modes"] = {}
        st["desired"] = {}
        st["restarts"] = {}
        m._save(st)

    def test_healthy_fleet(self):
        mock = {"cmds": {"ps": "Plex-Media-Server|running|Up 3h|plex|abc\nHermes-Agent|running|Up 1h|hermes|def"}}
        r = m.reconcile(mock=mock, mutate=False)
        self.assertTrue(r["ok"])
        self.assertEqual(r["fleet"], "HEALTHY")

    def test_manual_stop_not_fought(self):
        mock = {"cmds": {"ps": "transmission|exited|Exited (0)|linuxserver/transmission|aaa"}}
        r = m.reconcile(mock=mock, mutate=True)
        self.assertEqual(r["fleet"], "HEALTHY")
        st = m._load()
        self.assertEqual(st["desired"].get("transmission"), "stopped")

    def test_observe_skips_restart(self):
        mock = {"cmds": {
            "ps": "Plex-Media-Server|exited|Exited (137)|plex|abc",
            "logs:Plex-Media-Server": "error boom",
            "restart:Plex-Media-Server": "Plex-Media-Server",
        }}
        m.set_mode("Plex-Media-Server", m.OBSERVE)
        # first reconcile sets desired running? exited on first see -> stopped
        # force desired running
        st = m._load()
        st["desired"]["Plex-Media-Server"] = "running"
        m._save(st)
        r = m.reconcile(mock=mock, mutate=True)
        self.assertTrue(any((a or {}).get("skipped") == "observe" for a in r.get("actions") or []))

    def test_restart_then_storm(self):
        mock = {"cmds": {
            "ps": "demo|exited|Exited (1)|demo|abc",
            "logs:demo": "FATAL sqlite locked",
            "restart:demo": "demo",
        }}
        m.set_mode("demo", m.RESTART)
        st = m._load()
        st["desired"]["demo"] = "running"
        st["restarts"] = {"demo": [time_now() - 10, time_now() - 5]}
        m._save(st)
        r = m.reconcile(mock=mock, mutate=True)
        self.assertTrue(any((a or {}).get("status") == m.ESCALATED for a in r.get("actions") or []))

    def test_logs_signatures(self):
        a = m.analyse_logs("database is locked\nERROR sqlite")
        self.assertIn("SQLITE_LOCK", a["signatures"])

    def test_forbidden_nl(self):
        self.assertTrue(m.forbidden("docker system prune"))
        p = m.propose("recreate docker.img")
        self.assertEqual(p.get("error"), "forbidden")

    def test_denied_approval_stays_policy(self):
        p = m.propose("recreate container Plex-Media-Server")
        self.assertTrue(p.get("approval"))


def time_now():
    import time
    return time.time()


if __name__ == "__main__":
    unittest.main()
