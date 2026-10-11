import importlib.util
import os
import subprocess
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location("preflight", Path(__file__).parents[1] / "preflight.py")
PREFLIGHT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREFLIGHT)


class PreflightTest(unittest.TestCase):
    def test_full_command_preserves_failure_and_strips_github_child_routing(self):
        with (
            patch.dict(os.environ, {"GITHUB_RUN_ID": "123"}),
            patch.object(PREFLIGHT, "validate_wording"),
            patch.object(PREFLIGHT.subprocess, "run", return_value=subprocess.CompletedProcess([], 7)) as run,
        ):
            self.assertEqual(PREFLIGHT.main([]), 7)
        self.assertEqual(run.call_args.args[0][:3], ["make", "ci-checks", "backend-test"])
        self.assertFalse(any(name.startswith("GITHUB_") for name in run.call_args.kwargs["env"]))

    def test_partial_draft_is_refused_before_any_command_runs(self):
        with patch.object(PREFLIGHT.subprocess, "run") as run:
            with self.assertRaises(SystemExit) as refusal:
                PREFLIGHT.main(["--title-file", "title.txt"])
            self.assertEqual(refusal.exception.code, 2)
        run.assert_not_called()
