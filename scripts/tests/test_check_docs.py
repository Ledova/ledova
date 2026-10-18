#!/usr/bin/env python3

from __future__ import annotations

import contextlib
import importlib.util
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
SCRIPT = REPO_ROOT / "scripts" / "check-docs.py"
_spec = importlib.util.spec_from_file_location("check_docs", SCRIPT)
gate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(gate)


@contextlib.contextmanager
def a_tree(documents: dict[str, str], scripts: tuple[str, ...] = ()):
    with TemporaryDirectory() as directory:
        root = Path(directory)
        (root / "docs").mkdir()
        (root / "scripts").mkdir()
        (root / "backend").mkdir()
        for name, text in documents.items():
            path = root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text, encoding="utf-8")
        for name in scripts:
            (root / "scripts" / name).write_text("", encoding="utf-8")
        original = gate.REPO_ROOT
        gate.REPO_ROOT = root
        try:
            yield root
        finally:
            gate.REPO_ROOT = original


def a_backend_task(root: Path, module: str, cron: str, name: str, definition: str = "def") -> None:
    path = root / "backend" / module
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        f'@app.periodic(cron="{cron}")\n@app.task\n{definition} {name}(timestamp: int = 0):\n    return None\n',
        encoding="utf-8",
    )


class TheDeadLinkRuleSeesBothDirections(unittest.TestCase):

    def test_an_anchor_in_another_nested_guide_must_exist(self):
        documents = {
            "docs/architecture/transfers.md": (
                "See [recovery](../operations/recovery.md#missing).\n"
                "Read `backend/record.py` and ``backend/missing.py``.\n"
                "```text\n`backend/fenced.py`\n```\n"
                "~~~text\n`backend/fenced-again.py`\n~~~\n"
                "See `backend/` and ` backend/record.py\n`.\n"
            ),
            "docs/operations/recovery.md": "# Recovery\n",
            "docs/operations/jobs-and-storage.md": "# Jobs\n\n## Schedule\n",
            "docs/engineering/gates.md": "# Gates\n\n## Every gate, and where its rule is written\n",
            "backend/record.py": "",
        }
        with a_tree(documents) as root:
            findings, _ = gate.scan()
            self.assertEqual(
                findings,
                [
                    "docs/architecture/transfers.md:1 dead anchor ../operations/recovery.md#missing",
                    "docs/architecture/transfers.md:2 missing cited path backend/missing.py",
                ],
            )
            guide = root / "docs/architecture/transfers.md"
            guide.write_text(
                guide.read_text(encoding="utf-8").replace("#missing", "#recovery")
                .replace("backend/missing.py", "backend/record.py"),
                encoding="utf-8",
            )
            self.assertEqual(gate.scan()[0], [])
            guide.write_text("Read `backend/../../outside.md`.\n", encoding="utf-8")
            self.assertEqual(
                gate.scan()[0],
                ["docs/architecture/transfers.md:1 cited path leaves the repository backend/../../outside.md"],
            )


class TheGateRefusesToPassByFindingNothing(unittest.TestCase):

    def test_a_missing_schedule_table_finds_every_task_rather_than_none(self):
        with a_tree({"docs/operations/jobs-and-storage.md": "# Operations\n\nNo table here.\n"}) as root:
            a_backend_task(root, "tokens/tasks/fold.py", "0 3 * * *", "a_real_task")
            findings = gate.periodic_findings()
        self.assertEqual(len(findings), 1)
        self.assertIn("`a_real_task`", findings[0])


if __name__ == "__main__":
    unittest.main()
