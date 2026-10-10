import traceback
import unittest

from django.test.runner import (
    DiscoverRunner,
    ParallelTestSuite,
    RemoteTestResult,
    RemoteTestRunner,
)


class NamedRemoteTestResult(RemoteTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.test_ids = {}

    def startTest(self, test):
        super().startTest(test)
        self.test_ids[self.test_index] = test.id()

    def serializable_error(self, test, error, *, context=""):
        try:
            self._confirm_picklable(error)
        except Exception as serialization_error:
            return self.named_error(test.id(), error, serialization_error, context=context)
        return error

    @staticmethod
    def named_error(identity, error, serialization_error, *, context=""):
        original = "".join(traceback.format_exception(*error)) if error is not None else ""
        message = (
            f"Parallel result for {identity} cannot be serialized{context}: "
            f"{type(serialization_error).__name__}: {serialization_error}\n{original}"
        )
        return RuntimeError, RuntimeError(message), None

    def addError(self, test, error):
        error = self.serializable_error(test, error)
        if isinstance(test, unittest.suite._ErrorHolder):
            self.events.append(("addError", -1, test.id(), error))
            unittest.TestResult.addError(self, test, error)
        else:
            super().addError(test, error)

    def addFailure(self, test, error):
        super().addFailure(test, self.serializable_error(test, error))

    def addExpectedFailure(self, test, error):
        super().addExpectedFailure(test, self.serializable_error(test, error))

    def addSubTest(self, test, subtest, error):
        if error is not None:
            error = self.serializable_error(test, error, context=f" in {subtest}")
            try:
                self._confirm_picklable(subtest)
            except Exception as serialization_error:
                self.addError(
                    test,
                    self.named_error(test.id(), error, serialization_error, context=f" in {subtest}"),
                )
                return
        super().addSubTest(test, subtest, error)

    def prepare_events(self):
        events = []
        failed = set()
        for event in self.events:
            try:
                self._confirm_picklable(event)
            except Exception as serialization_error:
                index = event[1]
                identity = event[2] if index == -1 and event[0] == "addError" else self.test_ids[index]
                original = (
                    event[-1] if event[0] in {"addError", "addFailure", "addExpectedFailure", "addSubTest"} else None
                )
                error = self.named_error(identity, original, serialization_error, context=f" in {event[0]}")
                event = ("addError", -1, identity, error) if index == -1 else ("addError", index, error)
                failed.add(index)
            events.append(event)
        self.events = [event for event in events if not (event[0] == "addSuccess" and event[1] in failed)]


class NamedRemoteTestRunner(RemoteTestRunner):
    resultclass = NamedRemoteTestResult

    def run(self, test):
        result = super().run(test)
        result.prepare_events()
        return result


class NamedParallelTestSuite(ParallelTestSuite):
    runner_class = NamedRemoteTestRunner


class LedovaTestRunner(DiscoverRunner):
    parallel_test_suite = NamedParallelTestSuite
