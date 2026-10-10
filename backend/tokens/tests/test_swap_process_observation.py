import io
import json
import os
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.test import SimpleTestCase

from tokens.tests import test_swap_process_concurrency as workers

QUERY = "SELECT * FROM tokens_transferorder FOR UPDATE"


class RowLockObservationPollingTest(SimpleTestCase):
    def run_observations(self, observations, times):
        cursor = Mock()
        cursor.fetchone.side_effect = observations
        context = MagicMock()
        context.__enter__.return_value = cursor
        with (
            patch.object(workers, "connection", SimpleNamespace(cursor=Mock(return_value=context))),
            patch.object(workers.time, "monotonic", side_effect=times),
            patch.object(workers.time, "sleep") as sleep,
        ):
            workers.SwapWorkersUseOneCurrentClaimTest.wait_for_row_lock(
                self, SimpleNamespace(database_pid=31), "tokens_transferorder", 17
            )
        return cursor.fetchone.call_count, sleep.call_count

    def test_partial_activity_samples_are_retried_until_all_required_evidence_agrees(self):
        observations = [("BEGIN", True, None), (QUERY, True, None), (QUERY, True, "Lock")]
        self.assertEqual(self.run_observations(observations, [0, 1, 2, 3]), (3, 2))

    def test_incomplete_evidence_still_fails_at_the_original_deadline(self):
        for observed in (
            None,
            ("BEGIN", True, "Lock"),
            (QUERY, False, "Lock"),
            ("SELECT * FROM tokens_swaporder FOR UPDATE", True, "Lock"),
            ("UPDATE tokens_transferorder SET filled_quantity = 0", True, "Lock"),
            (QUERY, True, None),
        ):
            with self.subTest(observed=observed):
                with self.assertRaisesRegex(
                    AssertionError, "Worker never waited for the held tokens_transferorder row"
                ):
                    self.run_observations([observed], [0, 1, 11])

    def test_complete_evidence_returns_without_another_poll(self):
        self.assertEqual(self.run_observations([(QUERY, True, "Lock")], [0, 1]), (1, 0))


class SwapWorkerMessageTest(SimpleTestCase):
    def worker(self, payload, *, exit_code=0, close_writer=True):
        read_fd, write_fd = os.pipe()
        output = os.fdopen(read_fd, "rb", buffering=0)
        self.addCleanup(output.close)
        if payload:
            os.write(write_fd, payload)
        if close_writer:
            os.close(write_fd)
        else:
            self.addCleanup(os.close, write_fd)
        child = workers.SwapProcess.__new__(workers.SwapProcess)
        child.test = self
        child.errors = io.BytesIO(b"Synthetic worker initialization failed")
        child.process = SimpleNamespace(pid=431, stdout=output, poll=lambda: exit_code)
        child.pending_output = b""
        return child

    def test_exit_before_loaded_reports_the_test_stage_exit_and_stderr(self):
        child = self.worker(b"", exit_code=77)
        with self.assertRaises(AssertionError) as refused:
            child.receive("loaded")
        for detail in (self.id(), "loaded", "77", "Synthetic worker initialization failed"):
            self.assertIn(detail, str(refused.exception))

    def test_malformed_json_reports_a_named_worker_failure(self):
        child = self.worker(b"not-json\n")
        with self.assertRaises(AssertionError) as refused:
            child.receive("loaded")
        self.assertIn(self.id(), str(refused.exception))
        self.assertIn("loaded", str(refused.exception))
        self.assertIn("invalid JSON", str(refused.exception))

    def test_eof_during_a_partial_message_reports_the_incomplete_stage(self):
        child = self.worker(b'{"stage": "loaded"', exit_code=78)
        with self.assertRaises(AssertionError) as refused:
            child.receive("loaded")
        for detail in (self.id(), "loaded", "incomplete", "78"):
            self.assertIn(detail, str(refused.exception))

    def test_an_invalid_event_shape_is_refused_before_reading_its_pid(self):
        for value in ([], {"stage": "loaded"}, {"stage": "loaded", "pid": False}):
            with self.subTest(value=value):
                child = self.worker(json.dumps(value).encode() + b"\n")
                with self.assertRaises(AssertionError) as refused:
                    child.receive("loaded")
                self.assertIn(self.id(), str(refused.exception))
                self.assertIn("invalid worker event", str(refused.exception))

    def test_two_complete_messages_are_delivered_in_order(self):
        child = self.worker(b'{"stage": "loaded", "pid": 42}\n{"stage": "done", "pid": 42}\n')
        self.assertEqual(child.receive("loaded"), {"stage": "loaded", "pid": 42})
        self.assertEqual(child.receive("done"), {"stage": "done", "pid": 42})
        self.assertEqual(child.database_pid, 42)

    def test_an_open_pipe_with_only_a_partial_line_expires_without_blocking_readline(self):
        child = self.worker(b'{"stage": "loaded"', exit_code=None, close_writer=False)
        with patch.object(workers.time, "monotonic", side_effect=[0, 0, 26]):
            with self.assertRaises(AssertionError) as refused:
                child.receive("loaded")
        for detail in (self.id(), "loaded", "timed out", "incomplete"):
            self.assertIn(detail, str(refused.exception))

    def test_an_unexpected_stage_reports_its_event_and_expected_stage(self):
        child = self.worker(b'{"stage": "error", "pid": 42, "refused": "Synthetic refusal"}\n', exit_code=1)
        with self.assertRaises(AssertionError) as refused:
            child.receive("loaded")
        for detail in (self.id(), "loaded", "unexpected", "Synthetic refusal"):
            self.assertIn(detail, str(refused.exception))

    def test_transaction_commands_keep_their_existing_deadline(self):
        child = self.worker(b"", exit_code=None, close_writer=False)
        with (
            patch.object(workers.time, "monotonic", return_value=100),
            patch.object(workers.select, "select", return_value=([], [], [])) as observe,
            self.assertRaises(AssertionError),
        ):
            child.receive("verified")
        self.assertEqual(observe.call_args.args[3], 25)
