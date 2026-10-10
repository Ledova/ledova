import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from django.core.management.base import CommandError
from django.test import SimpleTestCase
from django.test.runner import DiscoverRunner

from shared.test_runner import LedovaTestRunner, NamedRemoteTestResult
from shared.tests.parallel_reporting_worker import UnserializableValue


class ParallelFailureReportingTest(SimpleTestCase):
    def test_a_whole_event_failure_preserves_its_original_subtest_error(self):
        result = NamedRemoteTestResult()
        result.test_ids[0] = self.id()
        try:
            self.fail("Synthetic assertion before whole-event serialization")
        except AssertionError:
            result.events = [("addSubTest", 0, UnserializableValue(), sys.exc_info()), ("addSuccess", 0)]
        result.prepare_events()
        self.assertEqual(len(result.events), 1)
        event = result.events[0]
        self.assertEqual(event[:2], ("addError", 0))
        self.assertIn(self.id(), str(event[2][1]))
        self.assertIn("Synthetic assertion before whole-event serialization", str(event[2][1]))

    def test_empty_discovery_cannot_report_a_passing_backend_suite(self):
        with patch.object(DiscoverRunner, "build_suite", return_value=unittest.TestSuite()):
            with self.assertRaisesRegex(CommandError, "No backend tests were discovered"):
                LedovaTestRunner(verbosity=0).build_suite()

    def test_an_unserializable_event_names_its_test_and_keeps_a_failed_verdict(self):
        for settings in (
            "ledova_backend.settings.test",
            "ledova_backend.settings.test_scoped",
        ):
            with self.subTest(settings=settings):
                result = subprocess.run(
                    [sys.executable, "-m", "shared.tests.parallel_reporting_worker"],
                    cwd=Path(__file__).resolve().parents[2],
                    env=os.environ | {"DJANGO_SETTINGS_MODULE": settings},
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                output = result.stdout + result.stderr
                self.assertNotEqual(result.returncode, 0, output)
                for method in (
                    "test_unserializable_event",
                    "test_unserializable_assertion",
                    "test_unserializable_subtest",
                ):
                    self.assertIn(f"shared.tests.parallel_reporting_worker.ParallelReportingFailure.{method}", output)
                for stage, name in (
                    ("setUpClass", "ParallelReportingSetupFailure"),
                    ("tearDownClass", "ParallelReportingTeardownFailure"),
                ):
                    self.assertIn(f"{stage} (shared.tests.parallel_reporting_worker.{name})", output)
                for message in (
                    "Synthetic event cannot be serialized",
                    "Synthetic original assertion failure",
                    "Synthetic original subtest failure",
                    "Synthetic original setup failure",
                    "Synthetic original teardown failure",
                    "expected failures=1",
                ):
                    self.assertIn(message, output)
                self.assertIn("FAILED", output)
                self.assertNotIn("MaybeEncodingError", output)
