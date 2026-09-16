import json
import os
import select
import subprocess
import sys
import tempfile
import time
from copy import deepcopy

from django.conf import settings
from django.db import connections


def worker_databases():
    base = deepcopy(connections["default"].settings_dict)
    base["CONN_MAX_AGE"] = 0
    result = {"default": base}
    for alias in ("app", "operator"):
        result[alias] = deepcopy(base)
        result[alias]["USER"] = settings.DATABASES[alias]["USER"]
        result[alias]["PASSWORD"] = settings.DATABASES[alias]["PASSWORD"]
    return result


class OrderChild:
    def __init__(self, case, worker, phase, directory, **message):
        self.worker = worker
        self.errors = tempfile.TemporaryFile(mode="w+")
        self.process = subprocess.Popen(
            [sys.executable, "-m", f"tokens.tests.{worker}"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self.errors,
            text=True,
            env={**os.environ, "ORDER_TEST_DATABASES": json.dumps(worker_databases(), default=str)},
        )
        case.addCleanup(self.close)
        self.process.stdin.write(
            json.dumps({"phase": phase, "directory": str(directory), "user_id": case.tenant.user.pk, **message}) + "\n"
        )
        self.process.stdin.flush()

    def read(self):
        if not select.select([self.process.stdout], [], [], 20)[0]:
            raise AssertionError(f"The {self.worker} did not reach its expected stage")
        line = self.process.stdout.readline()
        if not line:
            raise AssertionError(f"The {self.worker} ended before its result: {self.error_output()}")
        return json.loads(line)

    def error_output(self):
        self.errors.seek(0)
        return self.errors.read()[-5000:]

    def release(self):
        self.process.stdin.write("continue\n")
        self.process.stdin.flush()

    def wait(self):
        return self.process.wait(timeout=20)

    def close(self):
        if self.process.poll() is None:
            self.process.kill()
            self.process.wait(timeout=10)
        self.process.stdin.close()
        self.process.stdout.close()
        self.errors.close()


def wait_for_row_lock(case, waiter, table, blocker):
    deadline = time.monotonic() + 10
    observed = None
    while time.monotonic() < deadline:
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT pg_stat_clear_snapshot()")
            cursor.execute(
                "SELECT query, %s = ANY(pg_blocking_pids(pid)), wait_event_type FROM pg_stat_activity WHERE pid = %s",
                [blocker, waiter],
            )
            observed = cursor.fetchone()
        if observed and observed[1] and observed[2] == "Lock" and f'"{table}"' in observed[0]:
            return
        time.sleep(0.01)
    case.fail(f"Backend {waiter} never waited for the {table} row held by {blocker}: {observed}")
