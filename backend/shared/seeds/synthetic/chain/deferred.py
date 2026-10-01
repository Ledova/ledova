from contextlib import contextmanager

from procrastinate.testing import InMemoryConnector

from ledova_backend.procrastinate_app import app

UNEXPECTED = "The chain layer queued {names}, which it does not know how to run in place of the worker."


class UnexpectedJob(RuntimeError):
    pass


class Deferrals:
    def __init__(self, connector):
        self.connector = connector

    def drain(self):
        jobs = sorted(self.connector.jobs.values(), key=lambda job: job["id"])
        self.connector.jobs.clear()
        return [(job["task_name"], dict(job["args"])) for job in jobs]

    def run(self, handlers):
        results = []
        while True:
            jobs = self.drain()
            if not jobs:
                return results
            unknown = sorted({name for name, _ in jobs if name not in handlers})
            if unknown:
                raise UnexpectedJob(UNEXPECTED.format(names=", ".join(unknown)))
            results += [handlers[name](**arguments) for name, arguments in jobs]


@contextmanager
def captured():
    connector = InMemoryConnector()
    with app.replace_connector(connector):
        yield Deferrals(connector)
