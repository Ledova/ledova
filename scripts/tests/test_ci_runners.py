import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("ci_runners", Path(__file__).parents[1] / "ci-runners.py")
CI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CI)


class RunnerTest(unittest.TestCase):
    def test_jobs_stay_hosted(self):
        self.assertEqual(CI.runners(), {"checks": "ubuntu-latest", "backend": "ubuntu-latest"})

    def test_missing_skipped_or_failed_jobs_cannot_pass_the_verdict(self):
        complete = {job: {"result": "success"} for job in ("scope", "checks", "backend")}
        self.assertTrue(CI.verdict(complete))
        for incomplete in (
            None,
            complete | {"backend": {"result": "skipped"}},
            complete | {"checks": {"result": "failure"}},
            {"scope": complete["scope"]},
        ):
            with self.subTest(incomplete=incomplete):
                self.assertFalse(CI.verdict(incomplete))
