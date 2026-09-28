import os
import select
import subprocess
import sys
from queue import Queue
from threading import Thread
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import patch

from tokens.tests.order_process_fixtures import OrderChild


class OrderChildPipeTest(TestCase):
    def child(self, output, finish=False, tail=b""):
        self.tenant = SimpleNamespace(
            user=SimpleNamespace(pk=17),
            deployed_token=SimpleNamespace(contract_address="synthetic-contract"),
        )
        ready_reader, ready_writer = os.pipe()
        self.addCleanup(os.close, ready_reader)
        program = "\n".join(
            (
                "import json, os, sys",
                "payload = json.loads(sys.stdin.readline())",
                "assert payload['phase'] == 'pipe-control' and payload['user_id'] == 17",
                f"os.write(1, {output!r})",
                f"os.write({ready_writer}, b'R')",
                "sys.exit(0)" if finish else "assert sys.stdin.readline() == 'continue\\n'",
                f"os.write(1, {tail!r})",
            )
        )
        popen = subprocess.Popen
        try:
            with (
                patch("tokens.tests.order_process_fixtures.worker_databases", return_value={}),
                patch(
                    "tokens.tests.order_process_fixtures.subprocess.Popen",
                    side_effect=lambda args, **kwargs: popen(
                        [sys.executable, "-c", program], pass_fds=(ready_writer,), **kwargs
                    ),
                ),
            ):
                child = OrderChild(self, "pipe-control", "pipe-control", "/tmp")
        finally:
            os.close(ready_writer)
        self.assertTrue(select.select([ready_reader], [], [], 5)[0], child.error_output())
        self.assertEqual(os.read(ready_reader, 1), b"R", child.error_output())
        return child

    def test_coalesced_frames_are_read_while_the_writer_waits(self):
        child = self.child(b'{"stage":"projection-locking"}\n{"stage":"projected"}\n')
        self.assertIsNone(child.process.poll())
        ready = select.select
        with patch(
            "tokens.tests.order_process_fixtures.select.select",
            side_effect=lambda readers, writers, errors, timeout: ready(readers, writers, errors, 0),
        ):
            self.assertEqual(child.read(), {"stage": "projection-locking"})
            self.assertEqual(child.read(), {"stage": "projected"})
        self.assertIsNone(child.process.poll())
        child.release()
        self.assertEqual(child.wait(), 0, child.error_output())

    def test_silent_live_writer_reaches_the_stage_deadline(self):
        child = self.child(b"")
        ready = select.select
        with (
            patch("tokens.tests.order_process_fixtures.time.monotonic", return_value=0),
            patch(
                "tokens.tests.order_process_fixtures.select.select",
                side_effect=lambda readers, writers, errors, timeout: ready(readers, writers, errors, 0),
            ) as wait,
        ):
            with self.assertRaisesRegex(AssertionError, "did not reach its expected stage"):
                child.read()
        wait.assert_called_once_with([child.process.stdout], [], [], 20)
        child.release()
        self.assertEqual(child.wait(), 0, child.error_output())

    def test_eof_reports_that_the_worker_ended(self):
        child = self.child(b"", finish=True)
        self.assertEqual(child.wait(), 0, child.error_output())
        with self.assertRaisesRegex(AssertionError, "ended before its result"):
            child.read()

    def test_partial_frame_obeys_one_deadline_and_retains_its_bytes(self):
        child = self.child(b'{"stage":', tail=b'"projected"}\n')
        observed = Queue()

        def read():
            try:
                observed.put(child.read())
            except Exception as error:
                observed.put(error)

        with patch("tokens.tests.order_process_fixtures.time.monotonic", side_effect=(0, 0, 20)):
            reader = Thread(target=read, daemon=True)
            reader.start()
            reader.join(timeout=1)
            try:
                self.assertFalse(reader.is_alive(), "Reading a partial frame ignored the overall deadline")
                failure = observed.get_nowait()
                self.assertIsInstance(failure, AssertionError)
                self.assertIn("did not reach its expected stage", str(failure))
            finally:
                child.release()
                reader.join(timeout=5)
        self.assertEqual(child.wait(), 0, child.error_output())
        self.assertEqual(child.read(), {"stage": "projected"})
