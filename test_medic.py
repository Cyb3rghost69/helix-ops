import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import helix_jobs
import helix_medic as m


class IsolatedMedicTest(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix="medic-test-")
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        for module, attr, filename in (
            (m, "STATE", "medic.json"),
            (m, "INCIDENTS", "incidents.json"),
            (helix_jobs, "STATE", "jobs.json"),
        ):
            p = patch.object(module, attr, root / filename)
            p.start()
            self.addCleanup(p.stop)
        p = patch.object(m, "_MOCK", None)
        p.start()
        self.addCleanup(p.stop)
        st = m._load()
        st["modes"] = {}
        st["desired"] = {}
        st["restarts"] = {}
        st["fail_counts"] = {}
        pol = dict(st.get("policy") or {})
        pol["auto_restart"] = True
        pol["never_autorepair"] = ["ollama", "transmission"]
        pol["failure_threshold"] = 3
        st["policy"] = pol
        m._save(st)


class GuardPolicy(IsolatedMedicTest):
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

    def test_plain_cmd_rejects_extra(self):
        r = m.guard("ps", extra="--all", mock={"cmds": {"ps": "x"}})
        self.assertTrue(r.get("denied"))


class Observe(IsolatedMedicTest):
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
        st["restarts"] = {"demo": [time.time() - 10, time.time() - 5]}
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

    def test_below_threshold_no_restart(self):
        mock = {"cmds": {
            "ps": "Plex-Media-Server|exited|Exited (137)|plex|abc",
            "logs:Plex-Media-Server": "error boom",
            "restart:Plex-Media-Server": "Plex-Media-Server",
        }}
        st = m._load()
        st["desired"]["Plex-Media-Server"] = "running"
        st["fail_counts"] = {"Plex-Media-Server": 1}
        m._save(st)
        r = m.reconcile(mock=mock, mutate=True)
        self.assertTrue(any((a or {}).get("skipped") == "threshold" for a in r.get("actions") or []))

    def test_auto_restart_after_threshold(self):
        mock = {"cmds": {
            "ps": "Plex-Media-Server|exited|Exited (137)|plex|abc",
            "logs:Plex-Media-Server": "error boom",
            "restart:Plex-Media-Server": "Plex-Media-Server",
        }}
        st = m._load()
        st["desired"]["Plex-Media-Server"] = "running"
        st["fail_counts"] = {"Plex-Media-Server": 2}
        m._save(st)
        r = m.reconcile(mock=mock, mutate=True)
        self.assertTrue(any((a or {}).get("status") == "RECOVERING" for a in r.get("actions") or []))
        jobs = helix_jobs.list_jobs()
        completed = jobs.get("completed") or []
        self.assertTrue(any(j.get("kind") == "docker_diagnosis" and j.get("status") == helix_jobs.COMPLETE for j in completed))

    def test_ghost_desired_pruned(self):
        mock = {"cmds": {"ps": "Hermes-Agent|running|Up 1h|hermes|def"}}
        st = m._load()
        st["desired"]["helix-medic-probe"] = "running"
        st["fail_counts"]["helix-medic-probe"] = 3
        m._save(st)
        m.reconcile(mock=mock, mutate=False, tick=True)
        st2 = m._load()
        self.assertNotIn("helix-medic-probe", st2.get("desired") or {})
        self.assertNotIn("helix-medic-probe", st2.get("fail_counts") or {})

    def test_ollama_never_autorepair(self):
        mock = {"cmds": {
            "ps": "ollama|exited|Exited (1)|ollama/ollama|abc",
            "logs:ollama": "fatal",
            "restart:ollama": "ollama",
        }}
        st = m._load()
        st["desired"]["ollama"] = "running"
        st["fail_counts"] = {"ollama": 9}
        m._save(st)
        r = m.reconcile(mock=mock, mutate=True)
        self.assertTrue(any((a or {}).get("skipped") == "observe" for a in r.get("actions") or []))

    def test_auto_does_not_start_stopped(self):
        mock = {"cmds": {
            "ps": "transmission|exited|Exited (137)|linuxserver/transmission|aaa",
            "restart:transmission": "transmission",
        }}
        r = m.reconcile(mock=mock, mutate=True)
        self.assertEqual(r["fleet"], "HEALTHY")
        self.assertFalse(any((a or {}).get("status") == "RECOVERING" for a in r.get("actions") or []))

    def test_snapshot_does_not_tick_failures(self):
        mock = {"cmds": {"ps": "Plex-Media-Server|exited|Exited (137)|plex|abc"}}
        st = m._load()
        st["desired"]["Plex-Media-Server"] = "running"
        st["fail_counts"] = {"Plex-Media-Server": 1}
        m._save(st)
        m.snapshot(mock=mock)
        self.assertEqual(m._load()["fail_counts"].get("Plex-Media-Server"), 1)

    def test_guard_down_is_not_healthy(self):
        r = m.reconcile(mock={"cmds": {}}, mutate=False)
        self.assertFalse(r["ok"])
        self.assertEqual(r["fleet"], "CRITICAL")
        self.assertNotEqual(m._load().get("fleet"), "HEALTHY")


if __name__ == "__main__":
    unittest.main()
