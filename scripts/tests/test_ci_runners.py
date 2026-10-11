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

    def test_main_keeps_the_two_reserved_mac_job_identities(self):
        chosen = CI.runners(self.main)
        self.assertEqual(chosen["backend"]["group"], "ledova-mac-linux-arm64-pilot")
        self.assertEqual(chosen["checks"]["group"], "ledova-mac-linux-arm64-ordinary-pilot")
        for job, selection in chosen.items():
            self.assertEqual(selection["labels"], [selection["group"], "ledova-main-123-2", f"ledova-job-{job}"])

    def test_a_pr_or_incomplete_main_identity_stays_hosted(self):
        for field, value in (("GITHUB_EVENT_NAME", "pull_request"), ("GITHUB_RUN_ID", "")):
            with self.subTest(field=field):
                self.assertEqual(
                    CI.runners(self.main | {field: value}), {"checks": "ubuntu-latest", "backend": "ubuntu-latest"}
                )

    def test_missing_skipped_or_failed_jobs_cannot_pass_the_verdict(self):
        complete = {job: {"result": "success"} for job in ("scope", "checks", "backend")}
        self.assertTrue(CI.verdict(complete))
        for incomplete in (None, complete | {"backend": {"result": "skipped"}}, {"scope": complete["scope"]}):
            with self.subTest(incomplete=incomplete):
                self.assertFalse(CI.verdict(incomplete))
