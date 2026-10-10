import sys
from unittest import expectedFailure

import django
from django.conf import settings
from django.test import SimpleTestCase
from django.test.utils import get_runner


class UnserializableValue:
    def __reduce__(self):
        raise TypeError("Synthetic event cannot be serialized")

    def __str__(self):
        return "Synthetic event value"


class UnserializableFailure(AssertionError):
    def __init__(self, message):
        super().__init__(message)
        self.payload = UnserializableValue()


class ParallelReportingFailure(SimpleTestCase):
    def test_unserializable_event(self):
        self._outcome.result.addSkip(self, UnserializableValue())

    def test_unserializable_assertion(self):
        raise UnserializableFailure("Synthetic original assertion failure")

    def test_unserializable_subtest(self):
        with self.subTest(value=UnserializableValue()):
            self.fail("Synthetic original subtest failure")

    @expectedFailure
    def test_expected_unserializable_assertion(self):
        raise UnserializableFailure("Synthetic expected assertion failure")


class ParallelReportingSetupFailure(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        raise UnserializableFailure("Synthetic original setup failure")

    def test_setup_prevents_the_body(self):
        self.fail("Setup failure must prevent this body")


class ParallelReportingTeardownFailure(SimpleTestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        raise UnserializableFailure("Synthetic original teardown failure")

    def test_body_succeeds(self):
        self.assertTrue(True)


class ParallelReportingPeer(SimpleTestCase):
    def test_an_independent_worker_succeeds(self):
        self.assertTrue(True)


def main():
    django.setup()
    runner = get_runner(settings)(parallel=2, verbosity=2, interactive=False)
    return runner.run_tests(
        [
            "shared.tests.parallel_reporting_worker.ParallelReportingFailure",
            "shared.tests.parallel_reporting_worker.ParallelReportingSetupFailure",
            "shared.tests.parallel_reporting_worker.ParallelReportingTeardownFailure",
            "shared.tests.parallel_reporting_worker.ParallelReportingPeer",
        ]
    )


if __name__ == "__main__":
    sys.exit(bool(main()))
