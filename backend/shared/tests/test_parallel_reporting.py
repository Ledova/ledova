import os
import subprocess
import sys
from pathlib import Path

from django.test import SimpleTestCase


class ParallelFailureReportingTest(SimpleTestCase):
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
