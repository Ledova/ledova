#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPT = ROOT / "scripts" / "check-comments.py"

_spec = importlib.util.spec_from_file_location("check_comments", SCRIPT)
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)


class EverySourceFileIsReachedByATree(unittest.TestCase):

    def test_native_templates_and_tests_are_scanned_and_do_not_treat_urls_as_comments(self):
        scanned = {
            path.resolve()
            for tree, extensions, recurse in gate.TREES
            for path in gate.files_in(tree, extensions, recurse)
        }
        for relative in (
            "mobile/plugins/native/LedovaHTTPRequestHandler.m",
            "mobile/native-tests/ios/LedovaNetworkTests.m",
        ):
            self.assertIn(ROOT / relative, scanned)
        scanner = gate.FINDERS[".m"]
        self.assertEqual(
            scanner(
                '#import <React/RCTHTTPRequestHandler.h>\n#if DEBUG\nNSString *url = @"http://localhost/";\n#endif\n'
            ),
            [],
        )
        self.assertEqual(scanner('NSString *url = @"https://localhost/"; // forbidden\n'), [(1, "// forbidden", False)])


if __name__ == "__main__":
    unittest.main()
