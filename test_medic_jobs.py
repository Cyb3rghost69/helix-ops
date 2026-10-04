import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import helix_compute as compute
import helix_jobs as jobs


class IsolatedJobs(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory(prefix="medic-jobs-")
        self.addCleanup(tmp.cleanup)
        p = patch.object(jobs, "STATE", Path(tmp.name) / "jobs.json")
        p.start()
        self.addCleanup(p.stop)
        p = patch.object(jobs, "_THREADS", {})
        p.start()
        self.addCleanup(p.stop)
        self.route = patch.object(compute, "route_compute", return_value={"target": "LOCAL-MAC"}).start()
        self.remote = patch.object(compute, "run_bigboi", return_value={"ok": True, "out": "remote"}).start()
        self.addCleanup(patch.stopall)


class MedicJobs(IsolatedJobs):
    def test_pull_image_is_not_read(self):
        self.assertEqual(jobs.classify_policy("pull a new image for Plex"), jobs.PRIVILEGED)
        self.assertEqual(jobs.classify_policy("change environment variables"), jobs.PRIVILEGED)
        self.assertEqual(jobs.classify_policy("recreate container Plex"), jobs.DESTRUCTIVE)

    def test_repair_job_waits_and_does_not_route(self):
        out = jobs.create_medic_job(
            "restart helix-medic-probe",
            "docker_repair",
            True,
            card={"what_failed": "probe down", "risk": "LOW"},
        )
        self.assertTrue(out["ok"])
        job = out["job"]
        self.assertEqual(job["status"], jobs.WAITING_APPROVAL)
        self.assertEqual(job["kind"], "docker_repair")
        self.assertEqual(job["card"]["risk"], "LOW")
        self.route.assert_not_called()
        self.remote.assert_not_called()

    def test_diagnosis_runs_without_ssh(self):
        out = jobs.create_medic_job("diagnose helix-medic-probe", "docker_diagnosis", False)
        self.assertEqual(out["job"]["status"], jobs.RUNNING)
        self.remote.assert_not_called()

    def test_deny_stays_denied(self):
        job = jobs.create_medic_job("recreate container demo", "docker_repair", True)["job"]
        denied = jobs.approve_job(job["id"], allow=False)
        self.assertEqual(denied["job"]["status"], jobs.STOPPED)
        again = jobs.approve_job(job["id"], allow=True)
        self.assertFalse(again["ok"])
        self.assertEqual(jobs.get_job(job["id"])["job"]["status"], jobs.STOPPED)

    def test_stop_cancels_waiting_approval(self):
        job = jobs.create_medic_job("recreate container demo", "docker_repair", True)["job"]
        stopped = jobs.stop_job(job["id"])
        self.assertEqual(stopped["job"]["status"], jobs.STOPPED)

    def test_update_cannot_resurrect(self):
        job = jobs.create_medic_job("diagnose x", "docker_diagnosis", False)["job"]
        jobs.update_medic_job(job["id"], jobs.STOPPED)
        bad = jobs.update_medic_job(job["id"], jobs.COMPLETE, result="nope")
        self.assertFalse(bad["ok"])
        self.assertEqual(jobs.get_job(job["id"])["job"]["status"], jobs.STOPPED)


if __name__ == "__main__":
    unittest.main()
