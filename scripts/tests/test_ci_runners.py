import importlib.util
import unittest
from pathlib import Path

SPEC = importlib.util.spec_from_file_location("ci_runners", Path(__file__).parents[1] / "ci-runners.py")
CI = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CI)


class RunnerTest(unittest.TestCase):
    def setUp(self):
        self.main = {
            "GITHUB_EVENT_NAME": "push",
            "GITHUB_REPOSITORY": "Ledova/ledova",
            "GITHUB_REF": "refs/heads/main",
            "GITHUB_RUN_ID": "123",
            "GITHUB_RUN_ATTEMPT": "2",
        }

    def test_main_manual_and_pr_jobs_all_stay_hosted(self):
        for event in ("push", "workflow_dispatch", "pull_request"):
            with self.subTest(event=event):
                self.assertEqual(
                    CI.runners(self.main | {"GITHUB_EVENT_NAME": event}),
                    {"checks": "ubuntu-latest", "backend": "ubuntu-latest"},
                )

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
