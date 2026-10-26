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
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(config if isinstance(config, str) else json.dumps(config))
        return path


class TruthTableFromTsc(_Workspace):

    def test_empty_files_with_references_examines_nothing(self):
        config = self.write("a.json", {"files": [], "references": REFERENCES})
        self.assertTrue(gate.examines_nothing(config))

    def test_nonempty_workspace_is_discovered_without_private_copies(self):
        config = self.write("new-client/tsconfig.json", {"files": [], "include": ["**/*"], "references": REFERENCES})
        self.assertFalse(gate.examines_nothing(config))
        self.write("new-client/package.json", {})
        for directory in (".claude/worktrees/private-client", ".codex/private-client", "node_modules/private-client"):
            self.write(f"{directory}/package.json", {})
            self.write(f"{directory}/tsconfig.json", {"files": []})
        self.assertEqual(gate.undeclared_workspaces(), ["new-client"])


if __name__ == "__main__":
    unittest.main()
