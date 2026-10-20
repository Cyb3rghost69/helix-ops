"""Isolated chaos: duplicates, partition, rate limit. No production faults."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from dummy_adapters import DummyAdapter
from durable_queue import DurableQueue
from ha_controller import AuthorityError
from test_ha_controller import boot


class TestChaosIso(unittest.TestCase):
    def test_duplicate_and_split_brain_refuse(self):
        _, c = boot()
        with self.assertRaises(AuthorityError):
            c.request_promote("bravo")
        p = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        p.close()
        q = DurableQueue(p.name)
        self.assertTrue(q.put_in("dup", 1, "a"))
        self.assertFalse(q.put_in("dup", 1, "a"))
        q.close()
        Path(p.name).unlink(missing_ok=True)

    def test_rate_limit(self):
        tg = DummyAdapter("telegram", rate_per_s=1.0)
        tg.send("a")
        with self.assertRaises(RuntimeError) as e:
            tg.send("b")
        self.assertEqual(str(e.exception), "rate_limited")

    def test_queue_corrupt_file(self):
        p = tempfile.NamedTemporaryFile(suffix=".sqlite", delete=False)
        p.write(b"not-a-sqlite")
        p.close()
        with self.assertRaises(Exception):
            DurableQueue(p.name)
        Path(p.name).unlink(missing_ok=True)
