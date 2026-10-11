#!/usr/bin/env python3

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent.parent / "check-type-check.py"
_spec = importlib.util.spec_from_file_location("check_type_check", SCRIPT)
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)

REFERENCES = [{"path": "./nowhere"}]


class _Workspace(unittest.TestCase):
    def setUp(self):
        self._directory = tempfile.TemporaryDirectory()
        self.root = Path(self._directory.name)
        self.addCleanup(self._directory.cleanup)
        gate.ROOT = self.root

    def write(self, name: str, config: dict | str) -> Path:
        path = self.root / name
        path.write_text(config if isinstance(config, str) else json.dumps(config))
        return path


class TruthTableFromTsc(_Workspace):

    def test_empty_files_with_references_examines_nothing(self):
        config = self.write("a.json", {"files": [], "references": REFERENCES})
        self.assertTrue(gate.examines_nothing(config))

    def test_an_include_beside_empty_files_examines_everything(self):
        config = self.write("e.json", {"files": [], "include": ["**/*"], "references": REFERENCES})
        self.assertFalse(gate.examines_nothing(config))


if __name__ == "__main__":
    unittest.main()
