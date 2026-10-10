import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from blockchain.tests import outgoing_worker
from shared.tests import process_readiness
from tokens.tests import test_capital_execution_processes as capital
from tokens.tests import test_issuance_execution_processes as issuance


class ParentWorkerReadinessTest(SimpleTestCase):
    def test_a_ready_file_does_not_admit_a_worker_that_already_exited(self):
        process = SimpleNamespace(pid=431, poll=lambda: 23, communicate=lambda **kwargs: ("out", "failed startup"))
        with tempfile.TemporaryDirectory(prefix="process-readiness-") as temporary:
            path = Path(temporary) / "ready-431"
            path.touch()
            for parent in (issuance.IssuanceExecutionProcessTest, capital.CapitalExecutionProcessTest):
                with self.subTest(parent=parent.__name__):
                    with self.assertRaises(AssertionError) as refused:
                        parent.await_file(self, path, process)
                    for detail in (self.id(), "431", "23", "failed startup"):
                        self.assertIn(detail, str(refused.exception))


class WorkerCohortReadinessTest(SimpleTestCase):
    def test_every_live_worker_must_be_ready_before_the_parent_returns(self):
        clock = {"at": 0}
        with tempfile.TemporaryDirectory(prefix="process-cohort-") as temporary:
            first = Path(temporary) / "ready-431"
            second = Path(temporary) / "ready-432"
            process = SimpleNamespace(poll=lambda: None)

            def advance(_):
                clock["at"] += 2
                (first if clock["at"] == 2 else second).touch()

            with (
                patch.object(process_readiness.time, "monotonic", side_effect=lambda: clock["at"]),
                patch.object(process_readiness.time, "sleep", side_effect=advance),
            ):
                process_readiness.wait_for_worker_files(self, [(first, process), (second, process)], timeout=10)
            self.assertEqual(clock["at"], 4)
            self.assertTrue(first.is_file())
            self.assertTrue(second.is_file())

    def test_late_first_readiness_does_not_restart_the_second_workers_deadline(self):
        clock = {"at": 0}
        with tempfile.TemporaryDirectory(prefix="process-cohort-budget-") as temporary:
            first = Path(temporary) / "ready-431"
            second = Path(temporary) / "ready-432"
            process = SimpleNamespace(poll=lambda: None)

            def advance(_):
                clock["at"] = 9 if clock["at"] == 0 else clock["at"] + 1
                first.touch()
                if clock["at"] > 10:
                    second.touch()

            with (
                patch.object(process_readiness.time, "monotonic", side_effect=lambda: clock["at"]),
                patch.object(process_readiness.time, "sleep", side_effect=advance),
                self.assertRaises(AssertionError) as refused,
            ):
                process_readiness.wait_for_worker_files(self, [(first, process), (second, process)], timeout=10)
            self.assertEqual(clock["at"], 10)
            self.assertIn(self.id(), str(refused.exception))
            self.assertIn(str(second), str(refused.exception))
            self.assertNotIn(str(first), str(refused.exception))

    def test_a_ready_cohort_still_refuses_its_exited_member(self):
        live = SimpleNamespace(pid=431, poll=lambda: None)
        exited = SimpleNamespace(pid=432, poll=lambda: 24, communicate=lambda **kwargs: ("", "second worker failed"))
        with tempfile.TemporaryDirectory(prefix="process-cohort-exit-") as temporary:
            first = Path(temporary) / "ready-431"
            second = Path(temporary) / "ready-432"
            first.touch()
            second.touch()
            with self.assertRaises(AssertionError) as refused:
                process_readiness.wait_for_worker_files(self, [(first, live), (second, exited)])
            for detail in (self.id(), "432", "24", "second worker failed"):
                self.assertIn(detail, str(refused.exception))

    def test_a_childs_explicit_release_budget_outlasts_late_cohort_readiness(self):
        clock = {"at": 0}
        path = SimpleNamespace(exists=lambda: clock["at"] >= 62)

        def advance(_):
            clock["at"] += 31

        with (
            patch.object(outgoing_worker.time, "monotonic", side_effect=lambda: clock["at"]),
            patch.object(outgoing_worker.time, "sleep", side_effect=advance),
        ):
            outgoing_worker.await_file(path, timeout=process_readiness.WORKER_RELEASE_TIMEOUT)
        self.assertEqual(clock["at"], 62)

    def test_unrelated_child_gates_keep_their_original_default_budget(self):
        clock = {"at": 0}
        path = SimpleNamespace(exists=lambda: False)

        def advance(_):
            clock["at"] = 21

        with (
            patch.object(outgoing_worker.time, "monotonic", side_effect=lambda: clock["at"]),
            patch.object(outgoing_worker.time, "sleep", side_effect=advance),
            self.assertRaisesRegex(RuntimeError, "never released"),
        ):
            outgoing_worker.await_file(path)
        self.assertEqual(clock["at"], 21)
