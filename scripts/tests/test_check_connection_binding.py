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
        for source in (
            "from wallets.tasks import sync_wallet\nsync_wallet.defer(wallet_uuid='x')",
            "from wallets.tasks import sync_wallet as sync\nsync.configure(schedule_in={'seconds': 30}).defer()",
            "from wallets.tasks import sync_wallet\nlater=sync_wallet.configure()\nlater.defer()",
            "from wallets.tasks import sync_wallet\nlater: object=sync_wallet.configure()\nlater.defer()",
            "from ledova_backend.procrastinate_app import app\n@app.task\ndef local(): pass\nlocal.defer()",
            "from procrastinate.contrib.django import app as jobs\n@jobs.task(retry=False)\n"
            "async def local(): pass\nlater: object=local.configure()\nlater.defer()",
            "from procrastinate.contrib.django import app\napp.configure_task('x').defer()",
            "from procrastinate import App as Queue\nQueue()",
            "import procrastinate as jobs\njobs.App()",
        ):
            with self.subTest(source=source):
                self.assertTrue(gate.queue_findings_for(ast.parse(source)))

    def test_an_aliased_connection_is_not_a_finding(self):
        self.assertEqual(findings("with connections[current_alias()].cursor() as c:\n    pass\n"), [])
        for source in (
            "from shared.tasks.queue import defer\nfrom wallets.tasks import sync_wallet\ndefer(sync_wallet)",
            "rows=Model.objects.filter(active=True)\nrows.defer('large_field')",
            "rows: QuerySet=Model.objects.filter(active=True)\nrows.defer('large_field')",
            "Model.objects.defer('large_field')",
            "def ordinary(): pass\nordinary.defer('large_field')",
            "class Decorator:\n    def task(self, f): return f\nother=Decorator()\n"
            "@other.task\ndef ordinary(): pass\nordinary.defer('large_field')",
        ):
            with self.subTest(source=source):
                self.assertEqual(gate.queue_findings_for(ast.parse(source)), [])


if __name__ == "__main__":
    unittest.main()
