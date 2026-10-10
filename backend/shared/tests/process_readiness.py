import time

WORKER_START_TIMEOUT = 60
WORKER_RELEASE_TIMEOUT = 90


def wait_for_worker_files(test, waiting, *, timeout=WORKER_START_TIMEOUT):
    waiting = tuple(waiting)
    test.assertTrue(waiting, f"{test.id()}: no workers were supplied")
    deadline = time.monotonic() + timeout
    while True:
        for path, process in waiting:
            code = process.poll()
            if code is not None:
                out, err = process.communicate(timeout=10)
                test.fail(f"{test.id()}: worker {process.pid} exited {code} before {path}: {out}{err}")
        missing = [str(path) for path, _ in waiting if not path.is_file()]
        if not missing:
            return
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            test.fail(f"{test.id()}: workers did not reach readiness within {timeout}s: {missing}")
        time.sleep(min(0.01, remaining))
