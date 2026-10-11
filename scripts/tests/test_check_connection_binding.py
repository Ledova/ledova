#!/usr/bin/env python3

from __future__ import annotations

import ast
import importlib.util
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPT = REPO_ROOT / "scripts" / "check-connection-binding.py"
_spec = importlib.util.spec_from_file_location("check_connection_binding", SCRIPT)
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)


def findings(source: str) -> list[str]:
    return [called for _, called in gate.findings_for(ast.parse(source))]


class TheGateSeesEachBinding(unittest.TestCase):

    def test_a_bare_cursor_is_a_finding_because_the_default_connection_bypasses(self):
        self.assertEqual(findings("with connection.cursor() as c:\n    pass\n"), ["connection.cursor"])

    def test_an_aliased_connection_is_not_a_finding(self):
        self.assertEqual(findings("with connections[current_alias()].cursor() as c:\n    pass\n"), [])


if __name__ == "__main__":
    unittest.main()
