import logging
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic, sleep

from django.db import DatabaseError, connections

from shared.db import atomic, current_alias, use_migrate, use_operator

logger = logging.getLogger(__name__)


class RealRowContention:
    def assert_worker_running(self, future, *, stage):
        if not future.done():
            return
        try:
            future.result()
        except BaseException as error:
            error.add_note(f"{self.id()}: worker failed during {stage}")
            raise
        self.fail(f"{self.id()}: worker finished before {stage}")

    def assert_row_lock(self, inspection, row, *, held):
        table = inspection.ops.quote_name(row._meta.db_table)
        column = inspection.ops.quote_name(row._meta.pk.column)
        blocked = False
        with inspection.cursor() as cursor:
            cursor.execute("BEGIN")
            try:
                cursor.execute(f"SELECT {column} FROM {table} WHERE {column} = %s FOR UPDATE NOWAIT", [row.pk])
                self.assertIsNotNone(cursor.fetchone())
            except DatabaseError as error:
                self.assertEqual(error.__cause__.sqlstate, "55P03")
                blocked = True
            finally:
                cursor.execute("ROLLBACK")
        self.assertEqual(blocked, held, f"Unexpected lock on {row._meta.label} {row.pk}")

    def wait_for_pid(self, inspection, waiter, blocker, *, row=None, query=None, deadline=None, future=None):
        self.assertNotEqual(waiter, blocker)
        if deadline is None:
            deadline = monotonic() + 5
        last = None
        expected = query
        select_table = None
        if expected is None and row is not None:
            expected = row._meta.db_table
            select_table = f'"{row._meta.db_table}"'
        while monotonic() < deadline:
            if future is not None:
                self.assert_worker_running(future, stage="lock observation")
            with inspection.cursor() as cursor:
                cursor.execute("SELECT pg_stat_clear_snapshot()")
                cursor.execute(
                    "SELECT pg_blocking_pids(pid), wait_event_type, query FROM pg_stat_activity WHERE pid = %s",
                    [waiter],
                )
                last = cursor.fetchone()
            observed_query = (last[2] or "") if last else ""
            select_columns, from_clause, from_table = observed_query.partition(" FROM ")
            if (
                last
                and blocker in last[0]
                and last[1] == "Lock"
                and (expected is None or expected in observed_query)
                and (
                    select_table is None
                    or (
                        observed_query.startswith("SELECT ")
                        and (
                            from_table.startswith(select_table)
                            if from_clause
                            else select_columns.startswith(f"SELECT {select_table}.")
                        )
                    )
                )
            ):
                logger.info(
                    "Observed PostgreSQL waiter=%s blocker=%s blocking_pids=%s row=%s/%s query=%s",
                    waiter,
                    blocker,
                    last[0],
                    row._meta.label if row is not None else query,
                    row.pk if row is not None else "trigger-or-commit",
                    last[2],
                )
                if row is not None and query is None:
                    self.assertIn(row._meta.db_table, last[2])
                if query is not None:
                    self.assertIn(query, last[2])
                return
            sleep(0.01)
        if future is not None:
            self.assert_worker_running(future, stage="lock observation")
        self.fail(f"PID {waiter} did not wait on PID {blocker}: {last}")

    def while_row_is_held(self, command, row, *, free=(), held=(), after_wait=None, no_key=False, wait_query=None):
        started, pid = Event(), []

        def run():
            connections.close_all()
            try:
                with use_operator():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET lock_timeout = '20s'")
                        cursor.execute("SET statement_timeout = '30s'")
                        cursor.execute("SELECT pg_backend_pid()")
                        pid.append(cursor.fetchone()[0])
                    started.set()
                    return command()
            finally:
                connections.close_all()

        inspection = connections["default"].copy()
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                with use_migrate(), atomic():
                    type(row).objects.select_for_update(no_key=no_key).get(pk=row.pk)
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET LOCAL lock_timeout = '5s'")
                        cursor.execute("SELECT pg_backend_pid()")
                        blocker = cursor.fetchone()[0]
                    deadline = monotonic() + 10
                    future = pool.submit(run)
                    while not started.is_set():
                        self.assert_worker_running(future, stage="startup")
                        remaining = deadline - monotonic()
                        self.assertGreater(
                            remaining, 0, f"{self.id()}: worker missed the startup coordination deadline"
                        )
                        started.wait(min(0.01, remaining))
                    self.assertLess(monotonic(), deadline, f"{self.id()}: worker missed the coordination deadline")
                    self.wait_for_pid(
                        inspection, pid[0], blocker, row=row, query=wait_query, deadline=deadline, future=future
                    )
                    self.assert_worker_running(future, stage="lock-prefix probes")
                    for other in free:
                        self.assert_row_lock(inspection, other, held=False)
                    for other in held:
                        self.assert_row_lock(inspection, other, held=True)
                    if after_wait is not None:
                        after_wait()
                    self.assertLess(monotonic(), deadline, f"{self.id()}: worker missed the coordination deadline")
                return future.result(timeout=10)
        finally:
            inspection.close()
