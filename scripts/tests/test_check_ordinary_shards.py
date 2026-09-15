import importlib.util
import json
import subprocess
import sys
import unittest
from pathlib import Path

import yaml

SCRIPT = Path(__file__).resolve().parent.parent / "check-ordinary-shards.py"
_spec = importlib.util.spec_from_file_location("check_ordinary_shards", SCRIPT)
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)


def a_module(name, *classes):
    found = []
    for class_name in classes or ("Behaviour",):
        body = {"__module__": name, "test_one": lambda self: None, "test_two": lambda self: None}
        case = type(class_name, (unittest.TestCase,), body)
        found += [case("test_one"), case("test_two")]
    return found


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
        broken = list(gate.cases(unittest.TestLoader().loadTestsFromName("no_such_test_module")))

        self.assertEqual(
            gate.findings(EVERYTHING + broken, {"tokens": TOKENS + broken, "others": WALLETS + SHARED}),
            [
                "shard tokens failed to load no_such_test_module",
                "the unlabelled suite failed to load no_such_test_module",
            ],
        )


class TheMatrixRunsExactlyTheDefinedShards(unittest.TestCase):
    SHARDS = {"tokens": ["tokens"], "others": ["wallets", "shared"]}

    def workflow(self, *shards):
        return {"jobs": {gate.JOB: {"strategy": {"matrix": {"shard": list(shards)}}}}}

    def test_the_same_shards_in_any_order_have_no_finding(self):
        self.assertEqual(gate.matrix_findings(self.workflow("others", "tokens"), self.SHARDS), [])

    def test_any_difference_is_a_finding(self):
        for workflow in (
            self.workflow("tokens"),
            self.workflow("tokens", "others", "wallets"),
            self.workflow("tokens", "others", "others"),
            {"jobs": {}},
        ):
            with self.subTest(workflow=workflow):
                self.assertEqual(len(gate.matrix_findings(workflow, self.SHARDS)), 1)


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
