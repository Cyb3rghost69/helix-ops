import unittest

import helix_approvals
import helix_jobs


class TestApprovals(unittest.TestCase):
    def test_queue_shape(self):
        q = helix_approvals.list_queue()
        self.assertTrue(q.get("ok"))
        self.assertIn("items", q)
        self.assertIn("count", q)
        self.assertEqual(q["count"], len(q["items"]))

    def test_missing_id(self):
        d = helix_approvals.decide("", True)
        self.assertFalse(d.get("ok"))

    def test_not_waiting(self):
        jobs = helix_jobs.list_jobs().get("jobs") or []
        if not jobs:
            self.skipTest("no jobs")
        d = helix_approvals.decide(jobs[0]["id"], True)
        self.assertFalse(d.get("ok"))


if __name__ == "__main__":
    unittest.main()
