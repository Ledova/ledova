from concurrent.futures import Future
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.test import SimpleTestCase

from shared.tests import row_contention

QUERY = 'SELECT "companies_company"."uuid" FROM "companies_company" FOR UPDATE'
ROW = SimpleNamespace(_meta=SimpleNamespace(db_table="companies_company", label="companies.Company"), pk="company")


class RowContentionObservationTest(row_contention.RealRowContention, SimpleTestCase):
    def observe(self, observations, times, **kwargs):
        cursor = Mock()
        cursor.fetchone.side_effect = observations
        inspection = MagicMock()
        inspection.cursor.return_value.__enter__.return_value = cursor
        with (
            patch.object(row_contention, "monotonic", side_effect=times),
            patch.object(row_contention, "sleep") as sleep,
        ):
            self.wait_for_pid(inspection, 31, 17, row=ROW, **kwargs)
        return cursor.fetchone.call_count, sleep.call_count

    def run_held_row(self, future, started, *, times):
        row = type("HeldRow", (), {"objects": Mock(), "pk": ROW.pk, "_meta": ROW._meta})()
        connections = MagicMock()
        connections.__getitem__.return_value.cursor.return_value.__enter__.return_value.fetchone.return_value = (17,)
        pool = MagicMock()

        def submit(run):
            if not future.done():
                run()
            return future

        pool.__enter__.return_value.submit.side_effect = submit
        with (
            patch.object(row_contention, "connections", connections),
            patch.object(row_contention, "ThreadPoolExecutor", return_value=pool),
            patch.object(row_contention, "Event", return_value=started),
            patch.object(row_contention, "use_migrate", return_value=MagicMock()),
            patch.object(row_contention, "use_operator", return_value=MagicMock()),
            patch.object(row_contention, "current_alias", return_value="default"),
            patch.object(row_contention, "atomic", return_value=MagicMock()),
            patch.object(row_contention, "monotonic", side_effect=times),
        ):
            return self.while_row_is_held(Mock(), row)

    def test_a_worker_failure_before_start_preserves_the_original_error_and_test_context(self):
        future = Future()
        error = RuntimeError("The worker could not initialize its database role")
        future.set_exception(error)
        started = Mock()
        started.is_set.return_value = False
        started.wait.return_value = False
        with self.assertRaises(RuntimeError) as caught:
            self.run_held_row(future, started, times=[0, 1])
        self.assertIs(caught.exception, error)
        self.assertIn(self.id(), " ".join(error.__notes__))
        self.assertIn("startup", " ".join(error.__notes__))
        started.wait.assert_not_called()

    def test_a_worker_failure_during_observation_is_reported_before_another_database_poll(self):
        future = Future()
        error = ValueError("The admitted command has invalid synthetic input")
        future.set_exception(error)
        with self.assertRaises(ValueError) as caught:
            self.observe([], [1], deadline=10, future=future)
        self.assertIs(caught.exception, error)
        self.assertIn(self.id(), " ".join(error.__notes__))
        self.assertIn("lock observation", " ".join(error.__notes__))

    def test_a_successfully_finished_worker_cannot_satisfy_observation(self):
        future = Future()
        future.set_result("finished without waiting")
        with self.assertRaisesRegex(AssertionError, "finished before lock observation"):
            self.observe([], [1], deadline=10, future=future)

    def test_partial_samples_are_retried_until_the_blocker_lock_and_query_agree(self):
        observations = [([42], "Lock", QUERY), ([17], None, QUERY), ([17], "Lock", "BEGIN"), ([17], "Lock", QUERY)]
        self.assertEqual(self.observe(observations, [0, 1, 2, 3, 4]), (4, 3))

    def test_wrong_blockers_missing_activity_and_wrong_queries_fail_at_the_deadline(self):
        for observed in (
            None,
            ([42], "Lock", QUERY),
            ([17], None, QUERY),
            ([17], "Lock", "BEGIN"),
            ([17], "Lock", 'SELECT "tokens_sharetoken"."uuid" FROM "tokens_sharetoken" FOR UPDATE'),
        ):
            with self.subTest(observed=observed):
                with self.assertRaisesRegex(AssertionError, "PID 31 did not wait on PID 17"):
                    self.observe([observed], [0, 1, 11])

    def test_complete_evidence_returns_without_another_poll(self):
        self.assertEqual(self.observe([([17], "Lock", QUERY)], [0, 1]), (1, 0))

    def test_a_same_table_update_cannot_prove_the_expected_row_select(self):
        with self.assertRaisesRegex(AssertionError, "PID 31 did not wait on PID 17"):
            self.observe([([17], "Lock", "UPDATE \"companies_company\" SET status = 'active'")], [0, 1, 11])

    def test_an_explicit_update_query_remains_valid_for_trigger_observation(self):
        query = "UPDATE \"companies_company\" SET status = 'active'"
        self.assertEqual(self.observe([([17], "Lock", query)], [0, 1], query=query), (1, 0))

    def test_an_explicit_query_must_match_even_when_the_expected_row_is_already_named(self):
        self.assertEqual(
            self.observe([([17], "Lock", QUERY), ([17], "Lock", "COMMIT")], [0, 1, 2], query="COMMIT"), (2, 1)
        )

    def test_observation_uses_the_existing_coordination_deadline(self):
        with self.assertRaisesRegex(AssertionError, "PID 31 did not wait on PID 17"):
            self.observe([], [10], deadline=10)

    def test_startup_and_observation_share_one_coordination_deadline(self):
        future = Future()
        started = Mock()
        started.is_set.side_effect = [False, True]

        def observe(inspection, waiter, blocker, **kwargs):
            self.assertEqual(kwargs["deadline"], 10)
            self.assertIs(kwargs["future"], future)
            return None

        with patch.object(self, "wait_for_pid", side_effect=observe):
            with self.assertRaisesRegex(AssertionError, "coordination deadline"):
                self.run_held_row(future, started, times=[0, 9, 9.5, 10])
        started.wait.assert_called_once_with(0.01)
