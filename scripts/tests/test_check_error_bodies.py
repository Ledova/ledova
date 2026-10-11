#!/usr/bin/env python3

from __future__ import annotations

import ast
import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "check-error-bodies.py"
_spec = importlib.util.spec_from_file_location("check_error_bodies", SCRIPT)
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)

SUBCLASSES = {"OrderCancellationException", "BlockchainAPIError"}

NOTE_METHODS = {"mark_failed", "mark_refused"}


def findings(source: str, notes=frozenset(), helpers=None):
    tree = ast.parse(source)
    return gate.findings_in(tree, SUBCLASSES, set(notes), helpers or {}, Path("service.py"))


class AnExceptionsTextReachingTheBody(unittest.TestCase):

    def test_a_sanitised_fragment_does_not_hide_raw_exception_text_beside_it(self):
        source = (
            "try:\n    x()\nexcept Exception as e:\n"
            "    raise OrderCancellationException(f\"{decode_exception_to_message(e, 'Failed')}: {e}\")\n"
        )

        self.assertEqual(len(findings(source)), 1)


class WhatIsNotAFinding(unittest.TestCase):

    def test_a_fixed_message(self):
        self.assertEqual(
            findings(
                'try:\n    x()\nexcept Exception as e:\n    raise OrderCancellationException("It failed.") from e\n'
            ),
            [],
        )


if __name__ == "__main__":
    unittest.main()
