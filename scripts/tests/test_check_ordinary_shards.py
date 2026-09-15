import contextlib
import importlib.util
import io
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import yaml

SCRIPT = Path(__file__).resolve().parent.parent / "check-ordinary-shards.py"
_spec = importlib.util.spec_from_file_location("check_ordinary_shards", SCRIPT)
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)

DJANGO = {
    "django/__init__.py": "def setup():\n    pass\n",
    "django/conf.py": "settings = None\n",
    "django/test/utils.py": """import unittest


class Runner:
    def __init__(self, **options):
        pass

    def setup_test_environment(self):
        pass

    def build_suite(self, labels):
        loader = unittest.TestLoader()
        return unittest.TestSuite(loader.discover(label, top_level_dir=".") for label in labels or ["."])


def get_runner(settings):
    return Runner
""",
}
PLAIN = "import unittest\n\n\nclass Behaviour(unittest.TestCase):\n    def test_one(self):\n        pass\n"


def a_module(name, *classes):
    return [
        {"id": f"{name}.{class_name}.{test}", "module": name, "failed": False}
        for class_name in classes or ("Behaviour",)
        for test in ("test_one", "test_two")
    ]


@contextlib.contextmanager
def a_backend(modules):
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        for name, text in (DJANGO | modules).items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
            for package in path.relative_to(root).parents[:-1]:
                (root / package / "__init__.py").touch()
        yield root


TOKENS = a_module("tokens.tests.test_fold")
WALLETS = a_module("wallets.tests.test_sync")
SHARED = a_module("shared.tests.test_uploads")
EVERYTHING = TOKENS + WALLETS + SHARED


class EveryModuleRunsInExactlyOneShard(unittest.TestCase):
    def test_a_partition_has_no_finding(self):
        self.assertEqual(gate.findings(EVERYTHING, {"tokens": TOKENS, "others": WALLETS + SHARED}), [])

    def test_a_module_in_no_shard_is_named(self):
        self.assertEqual(
            gate.findings(EVERYTHING, {"tokens": TOKENS, "others": WALLETS}),
            ["shared.tests.test_uploads has tests in no shard"],
        )

    def test_a_module_in_two_shards_is_named_with_both(self):
        self.assertEqual(
            gate.findings(EVERYTHING, {"tokens": TOKENS + SHARED, "others": WALLETS + SHARED}),
            ["shared.tests.test_uploads has tests in more than one shard: others, tokens"],
        )

    def test_a_class_label_that_leaves_half_a_module_out_is_named(self):
        split = a_module("offerings.tests.test_allotment", "Allots", "Refunds")

        self.assertEqual(
            gate.findings(EVERYTHING + split, {"tokens": TOKENS, "others": WALLETS + SHARED + split[:2]}),
            ["offerings.tests.test_allotment has tests in no shard"],
        )

    def test_a_module_the_unlabelled_suite_does_not_run_is_named(self):
        redis = a_module("shared.tests.redis_uploads")

        self.assertEqual(
            gate.findings(EVERYTHING, {"tokens": TOKENS, "others": WALLETS + SHARED + redis}),
            ["shared.tests.redis_uploads runs in shard others and not in the unlabelled suite"],
        )

    def test_a_module_that_fails_to_load_is_a_finding_even_where_both_sides_agree(self):
        loaded = unittest.TestLoader().loadTestsFromName("no_such_test_module")
        broken = [gate.record(case) for case in gate.cases(loaded)]

        self.assertEqual(
            gate.findings(EVERYTHING + broken, {"tokens": TOKENS + broken, "others": WALLETS + SHARED}),
            [
                "shard tokens failed to load no_such_test_module",
                "the unlabelled suite failed to load no_such_test_module",
            ],
        )


class EachDiscoveryRunsInItsOwnInterpreter(unittest.TestCase):
    def test_a_test_that_exists_only_once_another_shards_module_is_imported_is_in_no_shard(self):
        generated = (
            "import sys\nimport unittest\n\n\nclass Generated(unittest.TestCase):\n    pass\n\n\n"
            'if "assets.tests.test_registry" in sys.modules:\n    Generated.test_registered = lambda self: None\n'
        )
        modules = {
            "assets/tests/test_registry.py": PLAIN,
            "tokens/tests/test_generated.py": generated,
            "wallets/tests/test_sync.py": PLAIN,
        }

        with a_backend(modules) as backend:
            everything, found = gate.discover({"tokens": ["tokens"], "others": ["assets", "wallets"]}, backend)

        self.assertEqual(gate.findings(everything, found), ["tokens.tests.test_generated has tests in no shard"])

    def test_a_module_skipped_as_it_is_imported_is_named_by_its_own_name(self):
        modules = {
            "assets/tests/test_registry.py": PLAIN,
            "wallets/tests/test_redis.py": 'import unittest\n\nraise unittest.SkipTest("no Redis")\n',
        }

        with a_backend(modules) as backend:
            everything, found = gate.discover({"others": ["assets"]}, backend)

        self.assertEqual(gate.findings(everything, found), ["wallets.tests.test_redis has tests in no shard"])


class TheMatrixRunsExactlyTheDefinedShards(unittest.TestCase):
    SHARDS = {"tokens": ["tokens"], "others": ["wallets", "shared"]}

    def workflow(self, *shards, **more):
        return {"jobs": {gate.JOB: {"strategy": {"matrix": {"shard": list(shards)} | more}}}}

    def test_the_same_shards_in_any_order_have_no_finding(self):
        self.assertEqual(gate.matrix_findings(self.workflow("others", "tokens"), self.SHARDS), [])

    def test_any_difference_is_a_finding(self):
        for workflow in (
            self.workflow("tokens"),
            self.workflow("tokens", "others", "wallets"),
            self.workflow("tokens", "others", "others"),
            self.workflow("tokens", "others", exclude=[{"shard": "others"}]),
            self.workflow("tokens", "others", include=[{"shard": "wallets"}]),
            {"jobs": {}},
        ):
            with self.subTest(workflow=workflow):
                self.assertEqual(len(gate.matrix_findings(workflow, self.SHARDS)), 1)


class TheExitStatusFollowsEveryFinding(unittest.TestCase):
    SHARDS = {"tokens": ["tokens"], "others": ["wallets", "shared"]}

    def run_gate(self, found, matrix):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "shards.json").write_text(json.dumps(self.SHARDS), encoding="utf-8")
            workflow = {"jobs": {gate.JOB: {"strategy": {"matrix": {"shard": matrix}}}}}
            (root / "ci.yml").write_text(yaml.safe_dump(workflow), encoding="utf-8")
            discover = mock.Mock(return_value=(EVERYTHING, found))
            files = {"ROOT": root, "SHARDS": root / "shards.json", "WORKFLOW": root / "ci.yml"}
            streams = {"argv": [str(SCRIPT)], "stdout": io.StringIO(), "stderr": io.StringIO()}
            with mock.patch.multiple(gate, discover=discover, **files), mock.patch.multiple(sys, **streams):
                status = gate.main()
        discover.assert_called_once_with(self.SHARDS)
        return status, streams["stdout"].getvalue(), streams["stderr"].getvalue()

    def test_a_partition_the_matrix_runs_exits_0(self):
        status, output, errors = self.run_gate({"tokens": TOKENS, "others": WALLETS + SHARED}, ["others", "tokens"])

        self.assertEqual((status, errors), (0, ""))
        self.assertEqual(
            output, "Each of 6 ordinary tests in 3 modules runs in exactly one shard: tokens 2, others 4.\n"
        )

    def test_a_module_in_no_shard_exits_1_naming_it(self):
        status, _, errors = self.run_gate({"tokens": TOKENS, "others": WALLETS}, ["tokens", "others"])

        self.assertEqual(status, 1)
        self.assertIn("  shared.tests.test_uploads has tests in no shard\n", errors)

    def test_a_matrix_missing_a_shard_exits_1_even_when_the_shards_partition_the_suite(self):
        status, _, errors = self.run_gate({"tokens": TOKENS, "others": WALLETS + SHARED}, ["tokens"])

        self.assertEqual(status, 1)
        self.assertIn(f"  the {gate.JOB} matrix in ci.yml is {{'shard': ['tokens']}},", errors)


class TheCommittedFilesAgree(unittest.TestCase):
    def setUp(self):
        self.shards = json.loads(gate.SHARDS.read_text(encoding="utf-8"))

    def labels(self, shard):
        return subprocess.run(
            [sys.executable, str(SCRIPT), "--labels", shard], capture_output=True, text=True, check=False
        )

    def test_the_committed_matrix_runs_the_committed_shards(self):
        workflow = yaml.safe_load(gate.WORKFLOW.read_text(encoding="utf-8"))

        self.assertEqual(gate.matrix_findings(workflow, self.shards), [])

    def test_labels_prints_what_each_shard_passes_to_manage_py_test(self):
        for shard, labels in self.shards.items():
            with self.subTest(shard=shard):
                result = self.labels(shard)

                self.assertEqual((result.returncode, result.stdout), (0, " ".join(labels) + "\n"))

    def test_labels_refuses_a_shard_the_file_does_not_define(self):
        result = self.labels("no-such-shard")

        self.assertEqual((result.returncode, result.stdout), (1, ""))


if __name__ == "__main__":
    unittest.main()
