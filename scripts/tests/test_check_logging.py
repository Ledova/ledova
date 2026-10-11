#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "check-logging.py"
_spec = importlib.util.spec_from_file_location("check_logging", SCRIPT)
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)


class ProviderErrorTextRule(unittest.TestCase):
    def rules(self, body, provider_facing=True):
        source = "try:\n    read()\nexcept Exception as error:\n" + "".join(f"    {line}\n" for line in body)
        return [rule for _, rule, _ in gate.python_findings(source, provider_facing)]

    def test_the_text_of_a_caught_error_is_refused_however_it_is_formatted(self):
        for line in (
            'logger.error(f"Balance query failed: {error}")',
            'logger.warning("Balance query failed: %s", error)',
            'logger.error("Balance query failed: " + str(error))',
            'logger.error(f"Balance query failed: {error.args}")',
            "logger.error(repr(error))",
        ):
            with self.subTest(line=line):
                self.assertEqual(self.rules([line]), [gate.LOG_EXCEPTION_TEXT])

    def test_the_class_or_the_summary_is_allowed(self):
        for line in (
            'logger.error(f"Balance query failed ({failure_summary(error)})")',
            'logger.warning("Balance query failed (%s)", type(error).__name__)',
            'logger.warning("Balance query failed (%s)", error.__class__.__name__)',
        ):
            with self.subTest(line=line):
                self.assertEqual(self.rules([line]), [])


if __name__ == "__main__":
    unittest.main()
