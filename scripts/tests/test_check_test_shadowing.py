#!/usr/bin/env python3

from __future__ import annotations

import ast
import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "check-test-shadowing.py"
_spec = importlib.util.spec_from_file_location("check_test_shadowing", SCRIPT)
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)


def names(source: str):
    return {f"{class_name}.{method}" for _, class_name, method in gate.shadowing(ast.parse(source))}


class AHelperThatReplacesAnAssertionIsAFinding(unittest.TestCase):

    def test_a_helper_named_fail_is_found(self):
        source = "class T(TestCase):\n    def fail(self, tx):\n        return tx\n"

        self.assertEqual(names(source), {"T.fail"})

    def test_the_override_hooks_are_not_findings(self):
        source = (
            "class T(TestCase):\n"
            "    def setUp(self):\n        pass\n"
            "    def tearDown(self):\n        pass\n"
            "    @classmethod\n    def setUpClass(cls):\n        pass\n"
            "    @classmethod\n    def setUpTestData(cls):\n        pass\n"
        )

        self.assertEqual(names(source), set())


if __name__ == "__main__":
    unittest.main()
