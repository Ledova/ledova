import logging
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic, sleep

from django.db import DatabaseError, connections

from shared.db import atomic, current_alias, use_migrate, use_operator

logger = logging.getLogger(__name__)


class RealRowContention:
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

    def wait_for_pid(self, inspection, waiter, blocker, *, row=None, query=None):
        self.assertNotEqual(waiter, blocker)
        deadline = monotonic() + 5
        last = None
        while monotonic() < deadline:
            with inspection.cursor() as cursor:
                cursor.execute(
                    "SELECT pg_blocking_pids(pid), wait_event_type, query FROM pg_stat_activity WHERE pid = %s",
                    [waiter],
                )
                last = cursor.fetchone()
            if last and blocker in last[0] and last[1] == "Lock":
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
        self.fail(f"PID {waiter} did not wait on PID {blocker}: {last}")

    def while_row_is_held(self, command, row, *, free=(), held=(), after_wait=None, no_key=False, wait_query=None):
        started, pid = Event(), []

        def run():
            connections.close_all()
            try:
                with use_operator():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET lock_timeout = '10s'")
                        cursor.execute("SET statement_timeout = '15s'")
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
                    future = pool.submit(run)
                    self.assertTrue(started.wait(5))
                    try:
                        self.wait_for_pid(inspection, pid[0], blocker, row=row, query=wait_query)
                    except AssertionError:
                        if future.done():
                            future.result()
                        raise
                    self.assertFalse(future.done())
                    for other in free:
                        self.assert_row_lock(inspection, other, held=False)
                    for other in held:
                        self.assert_row_lock(inspection, other, held=True)
                    if after_wait is not None:
                        after_wait()
                return future.result(timeout=10)
        finally:
            inspection.close()
