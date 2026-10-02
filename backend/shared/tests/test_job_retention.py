import time
from unittest.mock import patch
from uuid import uuid4

from django.db import connection
from django.test import SimpleTestCase, TestCase, TransactionTestCase

from ledova_backend.procrastinate_app import app
from shared.tasks.job_retention import remove_old_jobs

PLANTED = "shared.tests.planted_job"
DAY = 24
STEPS = {
    "todo": (),
    "doing": ("doing",),
    "succeeded": ("doing", "succeeded"),
    "failed": ("doing", "failed"),
    "cancelled": ("cancelled",),
    "aborted": ("doing", "aborted"),
}
KEPT = (
    ("succeeded", 6 * DAY),
    ("failed", 29 * DAY),
    ("cancelled", 29 * DAY),
    ("aborted", 29 * DAY),
    ("todo", 400 * DAY),
    ("doing", 400 * DAY),
)
REMOVED = (
    ("succeeded", 8 * DAY),
    ("failed", 31 * DAY),
    ("cancelled", 31 * DAY),
    ("aborted", 31 * DAY),
)


def plant(queue, status, hours_ago):
    with connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO procrastinate_jobs (queue_name, task_name, args) VALUES (%s, %s, '{}') RETURNING id",
            [queue, PLANTED],
        )
        job_id = cursor.fetchone()[0]
        for step in STEPS[status]:
            cursor.execute("UPDATE procrastinate_jobs SET status = %s WHERE id = %s", [step, job_id])
        cursor.execute(
            "UPDATE procrastinate_events SET at = now() - make_interval(hours => %s) WHERE job_id = %s",
            [hours_ago, job_id],
        )
    return job_id


def surviving(job_ids):
    with connection.cursor() as cursor:
        cursor.execute("SELECT id FROM procrastinate_jobs WHERE id = ANY(%s)", [list(job_ids)])
        jobs = {row[0] for row in cursor.fetchall()}
        cursor.execute("SELECT DISTINCT job_id FROM procrastinate_events WHERE job_id = ANY(%s)", [list(job_ids)])
        return jobs, {row[0] for row in cursor.fetchall()}


class OldJobRecordsHaveTwoWindowsTest(SimpleTestCase):

    def test_succeeded_jobs_go_after_a_week_and_unsuccessful_ones_after_thirty_days(self):
        with patch.object(app.job_manager, "delete_old_jobs") as removal:
            remove_old_jobs(timestamp=int(time.time()))

        self.assertEqual(
            [call.kwargs for call in removal.await_args_list],
            [
                {"nb_hours": 7 * DAY},
                {"nb_hours": 30 * DAY, "include_failed": True, "include_cancelled": True, "include_aborted": True},
            ],
        )


class OldJobRecordsRemovedInProcessTest(TestCase):

    def test_a_direct_call_removes_only_finished_jobs_past_their_window(self):
        queue = f"planted-{uuid4().hex[:12]}"
        kept = {plant(queue, status, hours) for status, hours in KEPT}
        removed = {plant(queue, status, hours) for status, hours in REMOVED}

        remove_old_jobs(timestamp=int(time.time()))

        self.assertEqual(surviving(kept | removed), (kept, kept))


class OldJobRecordsRemovedByTheWorkerTest(TransactionTestCase):

    def setUp(self):
        self.planted = f"planted-{uuid4().hex[:12]}"
        self.addCleanup(self.remove_planted)

    def remove_planted(self):
        with connection.cursor() as cursor:
            cursor.execute("DELETE FROM procrastinate_periodic_defers WHERE task_name = %s", [PLANTED])
            cursor.execute(
                "DELETE FROM procrastinate_jobs WHERE queue_name LIKE 'planted-%%' OR task_name = %s",
                [remove_old_jobs.name],
            )

    def run_the_removal(self):
        app.perform_import_paths()
        queue = f"retention-{uuid4().hex[:12]}"
        job_id = remove_old_jobs.configure(queue=queue).defer(timestamp=int(time.time()))
        with (
            patch.dict(app.periodic_registry.periodic_tasks, {}, clear=True),
            app.replace_connector(app.connector.get_worker_connector()),
        ):
            app.run_worker(
                queues=[queue], wait=False, listen_notify=False, install_signal_handlers=False, delete_jobs="never"
            )
        with connection.cursor() as cursor:
            cursor.execute("SELECT status FROM procrastinate_jobs WHERE id = %s", [job_id])
            return cursor.fetchone()[0]

    def test_the_worker_removes_finished_jobs_past_their_window_and_keeps_everything_else(self):
        kept = {plant(self.planted, status, hours) for status, hours in KEPT}
        removed = {plant(self.planted, status, hours) for status, hours in REMOVED}
        scheduled = plant(self.planted, "succeeded", 8 * DAY)
        with connection.cursor() as cursor:
            cursor.execute(
                "INSERT INTO procrastinate_periodic_defers (task_name, periodic_id, defer_timestamp, job_id) "
                "VALUES (%s, '', 1, %s)",
                [PLANTED, scheduled],
            )

        self.assertEqual(self.run_the_removal(), "succeeded")

        self.assertEqual(surviving(kept | removed | {scheduled}), (kept, kept))
        with connection.cursor() as cursor:
            cursor.execute("SELECT job_id FROM procrastinate_periodic_defers WHERE task_name = %s", [PLANTED])
            self.assertEqual(cursor.fetchall(), [(None,)])
