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
    def __init__(self, test_name_patterns=None, **options):
        self.patterns = test_name_patterns or None

    def setup_test_environment(self):
        pass

    def build_suite(self):
        loader = unittest.TestLoader()
        loader.testNamePatterns = self.patterns
        return loader.discover(".", top_level_dir=".")


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
FOUND = {"tokens": TOKENS, "others": WALLETS + SHARED}
FACTORY = a_module("shared.tests.case_factory")


class EveryModuleRunsInExactlyOneShard(unittest.TestCase):
    def test_a_module_in_no_shard_is_named(self):
        self.assertEqual(
            gate.findings(EVERYTHING, {"tokens": TOKENS, "others": WALLETS}),
            ["shared.tests.test_uploads has tests in no shard"],
        )

    def test_a_module_in_two_shards_is_named_with_both(self):
        self.assertEqual(
            gate.findings(EVERYTHING, {"tokens": TOKENS + SHARED, "others": WALLETS + SHARED}),
            ["shared.tests.test_uploads has tests duplicated in shards: others, tokens"],
        )

    def test_a_test_id_a_shard_finds_more_often_than_the_unlabelled_suite_is_named(self):
        self.assertEqual(
            gate.findings(EVERYTHING + FACTORY, {"tokens": TOKENS + FACTORY * 2, "others": WALLETS + SHARED}),
            ["shared.tests.case_factory has tests duplicated in shards: tokens, tokens"],
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


class EveryShardListsItsTestNamePatterns(unittest.TestCase):
    def test_a_shard_without_a_list_of_patterns_each_free_of_whitespace_is_named(self):
        for patterns in ("tokens.*", [], [""], ["tokens .*"], ["tokens.*", 3], None):
            with self.subTest(patterns=patterns):
                self.assertEqual(
                    gate.pattern_findings({"tokens": ["tokens.*"], "others": patterns}),
                    ["shard others does not list its test name patterns, each a string with no whitespace"],
                )

    def test_a_file_that_names_no_shards_is_named(self):
        for shards in ({}, [], ["tokens.*"], None):
            with self.subTest(shards=shards):
                self.assertEqual(
                    gate.pattern_findings(shards), [f"{gate.SHARDS.relative_to(gate.ROOT)} names no shards"]
                )


class EveryPatternSelectsATest(unittest.TestCase):
    def test_a_misspelt_or_stale_pattern_is_named_with_its_shard(self):
        self.assertEqual(
            gate.unused_pattern_findings({"tokens": ["tokens.*"], "others": ["wallets.*", "walets.*"]}, FOUND),
            ["pattern walets.* in shard others selects no test"],
        )

    def test_a_pattern_without_a_star_is_widened_as_django_widens_it(self):
        self.assertEqual(gate.unused_pattern_findings({"others": ["test_sync"]}, {"others": WALLETS}), [])


class EachShardIsTheUnlabelledSuiteSelectedByItsPatterns(unittest.TestCase):
    def test_a_module_no_pattern_selects_is_in_no_shard(self):
        modules = {"tokens/tests/test_fold.py": PLAIN, "wallets/tests/test_sync.py": PLAIN}

        with a_backend(modules) as backend:
            everything, found = gate.discover({"tokens": ["tokens.*"]}, backend)

        self.assertEqual(gate.findings(everything, found), ["wallets.tests.test_sync has tests in no shard"])

    def test_a_module_two_shards_select_is_named_with_both(self):
        modules = {"tokens/tests/test_fold.py": PLAIN, "tokens/tests/test_swap.py": PLAIN}

        with a_backend(modules) as backend:
            everything, found = gate.discover({"folds": ["tokens.tests.test_f*"], "tokens": ["tokens.*"]}, backend)

        self.assertEqual(
            gate.findings(everything, found), ["tokens.tests.test_fold has tests duplicated in shards: folds, tokens"]
        )

    def test_a_class_a_module_imports_is_selected_by_the_module_that_defines_it(self):
        modules = {
            "shared/tests/cases.py": PLAIN,
            "wallets/tests/test_sync.py": "from shared.tests.cases import Behaviour\n",
        }

        with a_backend(modules) as backend:
            everything, found = gate.discover({"wallets": ["wallets.*"]}, backend)
            _, selected = gate.discover({"shared": ["shared.*"]}, backend)

        self.assertEqual(gate.findings(everything, found), ["shared.tests.cases has tests in no shard"])
        self.assertEqual(gate.findings(everything, selected), [])

    def test_a_module_skipped_as_it_is_imported_is_found_by_every_shard_under_its_own_name(self):
        modules = {
            "assets/tests/test_registry.py": PLAIN,
            "wallets/tests/test_redis.py": 'import unittest\n\nraise unittest.SkipTest("no Redis")\n',
        }

        with a_backend(modules) as backend:
            everything, found = gate.discover({"assets": ["assets.*"], "others": ["wallets.*"]}, backend)

        self.assertEqual(
            gate.findings(everything, found),
            ["wallets.tests.test_redis has tests duplicated in shards: assets, others"],
        )

    def test_each_discovery_starts_in_a_fresh_interpreter_as_each_job_does(self):
        once = PLAIN + (
            "\n\ncalls = []\n\n\ndef load_tests(loader, tests, pattern):\n    calls.append(pattern)\n"
            "    return tests if len(calls) == 1 else unittest.TestSuite()\n"
        )

        with a_backend({"tokens/tests/test_once.py": once}) as backend:
            everything, found = gate.discover({"tokens": ["tokens.*"]}, backend)

        self.assertEqual((gate.findings(everything, found), len(found["tokens"])), ([], 1))

    def test_a_factory_class_built_in_two_modules_is_named_by_its_test_id_though_a_shard_runs_both(self):
        factory = (
            "import unittest\n\n\ndef scenario():\n    class Scenario(unittest.TestCase):\n"
            "        def test_scenario(self):\n            pass\n\n    return Scenario\n"
        )
        built = "from shared.tests.case_factory import scenario\n\nScenario = scenario()\n"
        modules = {
            "shared/tests/case_factory.py": factory,
            "tokens/tests/test_built.py": built,
            "wallets/tests/test_built.py": built,
        }

        identity = "shared.tests.case_factory.scenario.<locals>.Scenario.test_scenario"

        with a_backend(modules) as backend:
            everything, found = gate.discover({"shared": ["shared.*"], "others": ["tokens.*", "wallets.*"]}, backend)

        self.assertEqual(gate.findings(everything, found), [f"{identity} is defined by more than one test class"])


class TheMatrixRunsExactlyTheDefinedShards(unittest.TestCase):
    SHARDS = {"tokens": ["tokens.*"], "others": ["wallets.*", "shared.*"]}

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
    SHARDS = {"tokens": ["tokens.*"], "others": ["wallets.*", "shared.*"]}

    def run_gate(self, found, matrix, everything=EVERYTHING, shards=SHARDS, discovered=True):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "shards.json").write_text(json.dumps(shards), encoding="utf-8")
            workflow = {"jobs": {gate.JOB: {"strategy": {"matrix": {"shard": matrix}}}}}
            (root / "ci.yml").write_text(yaml.safe_dump(workflow), encoding="utf-8")
            discover = mock.Mock(return_value=(everything, found))
            files = {"ROOT": root, "SHARDS": root / "shards.json", "WORKFLOW": root / "ci.yml"}
            streams = {"argv": [str(SCRIPT)], "stdout": io.StringIO(), "stderr": io.StringIO()}
            with mock.patch.multiple(gate, discover=discover, **files), mock.patch.multiple(sys, **streams):
                status = gate.main()
        if discovered:
            discover.assert_called_once_with(shards)
        else:
            discover.assert_not_called()
        return status, streams["stdout"].getvalue(), streams["stderr"].getvalue()

    def test_a_partition_the_matrix_runs_exits_0_printing_a_total_that_is_the_sum_of_uneven_shard_counts(self):
        allotment = a_module("offerings.tests.test_allotment", "Allots", "Refunds")
        shards = {"tokens": ["tokens.*"], "offerings": ["offerings.*"], "others": ["wallets.*", "shared.*"]}
        found = {"tokens": TOKENS, "offerings": allotment, "others": WALLETS + SHARED}

        status, output, errors = self.run_gate(found, ["others", "offerings", "tokens"], EVERYTHING + allotment, shards)

        self.assertEqual((status, errors), (0, ""))
        self.assertEqual(
            output,
            "Each of 10 ordinary test ids in 4 modules is in exactly one shard: tokens 2, offerings 4, others 4.\n",
        )

    def test_a_copy_of_a_test_id_in_no_shard_exits_1_without_a_total(self):
        found = {"tokens": TOKENS + FACTORY, "others": WALLETS + SHARED}

        status, output, errors = self.run_gate(found, ["tokens", "others"], EVERYTHING + FACTORY * 2)

        self.assertEqual((status, output), (1, ""))
        self.assertIn("  shared.tests.case_factory has tests in no shard\n", errors)

    def test_a_shard_without_patterns_exits_1_without_a_total_or_a_discovery(self):
        shards = {"tokens": ["tokens.*"], "others": "wallets.*"}

        status, output, errors = self.run_gate({}, ["tokens", "others"], shards=shards, discovered=False)

        self.assertEqual((status, output), (1, ""))
        self.assertIn("  shard others does not list its test name patterns, each a string with no whitespace\n", errors)

    def test_a_pattern_that_selects_no_test_exits_1_even_when_the_shards_partition_the_suite(self):
        shards = {"tokens": ["tokens.*"], "others": ["wallets.*", "shared.*", "walets.*"]}

        status, output, errors = self.run_gate(FOUND, ["tokens", "others"], shards=shards)

        self.assertEqual((status, output), (1, ""))
        self.assertIn("  pattern walets.* in shard others selects no test\n", errors)

    def test_a_matrix_missing_a_shard_exits_1_even_when_the_shards_partition_the_suite(self):
        status, _, errors = self.run_gate({"tokens": TOKENS, "others": WALLETS + SHARED}, ["tokens"])

        self.assertEqual(status, 1)
        self.assertIn(f"  the {gate.JOB} matrix in ci.yml is {{'shard': ['tokens']}},", errors)


class RunStartsTheShardsSuiteAsItsJobDoes(unittest.TestCase):
    def test_run_replaces_itself_with_the_ordinary_command_and_each_pattern_after_k(self):
        shards = {"tokens": ["tokens.tests.test_[a-n]*", "tokens.tests.test_s*"], "others": ["wallets.*"]}

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "shards.json").write_text(json.dumps(shards), encoding="utf-8")
            files = {"ROOT": root, "SHARDS": root / "shards.json", "BACKEND": root / "backend"}
            with (
                mock.patch.multiple(gate, **files),
                mock.patch.multiple(gate.os, chdir=mock.DEFAULT, execv=mock.DEFAULT) as calls,
                mock.patch.object(sys, "argv", [str(SCRIPT), "--run", "tokens"]),
            ):
                gate.main()

        calls["chdir"].assert_called_once_with(root / "backend")
        calls["execv"].assert_called_once_with(
            sys.executable,
            [
                sys.executable,
                "manage.py",
                "test",
                "--settings=ledova_backend.settings.test",
                "--parallel",
                "4",
                "--noinput",
                "-k",
                "tokens.tests.test_[a-n]*",
                "-k",
                "tokens.tests.test_s*",
            ],
        )

    def test_run_refuses_a_shard_the_file_does_not_define(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--run", "no-such-shard"], capture_output=True, text=True, check=False
        )

        self.assertEqual((result.returncode, result.stdout), (1, ""))
        self.assertIn("has no test name patterns for shard no-such-shard", result.stderr)


class TheCommittedFilesAgree(unittest.TestCase):
    def setUp(self):
        self.shards = json.loads(gate.SHARDS.read_text(encoding="utf-8"))

    def test_the_committed_matrix_runs_the_committed_shards(self):
        workflow = yaml.safe_load(gate.WORKFLOW.read_text(encoding="utf-8"))

        self.assertEqual(gate.matrix_findings(workflow, self.shards), [])

    def test_the_committed_shards_each_list_their_patterns(self):
        self.assertEqual(gate.pattern_findings(self.shards), [])


if __name__ == "__main__":
    unittest.main()
