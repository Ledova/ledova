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
        self.pending = b""
        self.errors = tempfile.TemporaryFile(mode="w+")
        self.process = subprocess.Popen(
            [sys.executable, "-m", f"tokens.tests.{worker}"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self.errors,
            bufsize=0,
            env={
                **os.environ,
                "ORDER_TEST_DATABASES": json.dumps(worker_databases(), default=str),
                "ORDER_TEST_PRIVATE_MEDIA_ROOT": str(settings.PRIVATE_MEDIA_ROOT),
            },
        )
        case.addCleanup(self.close)
        payload = {
            "phase": phase,
            "directory": str(directory),
            "user_id": case.tenant.user.pk,
            "share_contract": case.tenant.deployed_token.contract_address,
            **message,
        }
        self.process.stdin.write((json.dumps(payload) + "\n").encode())
        self.process.stdin.flush()

    def read(self):
        deadline = time.monotonic() + 20
        while b"\n" not in self.pending:
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([self.process.stdout], [], [], remaining)[0]:
                raise AssertionError(f"The {self.worker} did not reach its expected stage")
            chunk = os.read(self.process.stdout.fileno(), 65536)
            if not chunk:
                raise AssertionError(f"The {self.worker} ended before its result: {self.error_output()}")
            self.pending += chunk
        line, self.pending = self.pending.split(b"\n", 1)
        return json.loads(line)

    def error_output(self):
        self.errors.seek(0)
        return self.errors.read()[-5000:]

    def release(self):
        self.process.stdin.write(b"continue\n")
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


def wait_for_row_lock(case, waiter, table, blocker, row_pk=None):
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
        if (
            observed
            and observed[1]
            and observed[2] == "Lock"
            and f'"{table}"' in observed[0]
            and (row_pk is None or str(row_pk).replace("-", "") in observed[0].replace("-", ""))
        ):
            return
        time.sleep(0.01)
    case.fail(f"Backend {waiter} never waited for the {table} row held by {blocker}: {observed}")
