import importlib.util
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

SCRIPT = Path(__file__).resolve().parents[1] / "check-backend-modules.py"
spec = importlib.util.spec_from_file_location("check_dead_code", SCRIPT)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)


class BackendDeadCode(unittest.TestCase):
    def test_import_graph_and_framework_discovery_leave_only_unreachable_modules(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            files = {
                "manage.py": "from demo.entry import run\n",
                "demo/__init__.py": "",
                "demo/entry.py": "from .helper import value\nWORKER = 'worker.py'\n",
                "demo/helper.py": "value = 1\n",
                "demo/worker.py": "value = 1\n",
                "demo/apps.py": "name = 'demo'\n",
                "plugin/__init__.py": "value = 1\n",
                "plugin/apps.py": "name = 'plugin'\n",
                "demo/models/__init__.py": "from .record import Record\n",
                "demo/models/record.py": "class Record: pass\n",
                "demo/admin.py": "from .models import Record\n",
                "demo/migrations/0001_initial.py": "from demo.guards import install\n",
                "demo/guards.py": "def install(): pass\n",
                "demo/management/commands/seed.py": "from demo.seed import run\n",
                "demo/seed.py": "def run(): pass\n",
                "demo/templatetags/render.py": "value = 1\n",
                "demo/tasks/__init__.py": "from .process import run\n",
                "demo/tasks/process.py": "def run(): pass\n",
                "demo/settings/base.py": "HANDLER = 'demo.handler.handle'\n",
                "demo/handler.py": "def handle(): pass\n",
                "demo/tests/test_journey.py": "from demo.fixture import value\n",
                "demo/fixture.py": "value = 1\n",
                "demo/orphan_a.py": "from .orphan_b import value\n",
                "demo/orphan_b.py": "from .orphan_a import value\n",
            }
            for file, text in files.items():
                path = root / "backend" / file
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding="utf-8")
            workers = {"demo.worker": ("demo/entry.py", "worker.py")}
            findings, scanned = gate.backend_findings(
                root, workers=workers, documented={}
            )
            self.assertEqual(scanned, len(files))
            self.assertEqual(
                findings,
                [
                    "backend/demo/orphan_a.py: unused backend module",
                    "backend/demo/orphan_b.py: unused backend module",
                ],
            )
            (root / "backend/demo/entry.py").write_text(
                "from .helper import value\n", encoding="utf-8"
            )
            self.assertIn(
                "demo.worker: stale worker reference in demo/entry.py; remove or update the exception",
                gate.backend_findings(root, workers=workers, documented={})[0],
            )

    def test_documented_entry_point_exception_must_still_have_a_consumer(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "backend").mkdir()
            (root / "backend/manage.py").write_text("pass\n", encoding="utf-8")
            (root / "backend/runner.py").write_text("pass\n", encoding="utf-8")
            consumer = root / "guide.md"
            consumer.write_text("Run `runner.py`.\n", encoding="utf-8")
            documented = {"runner": ("guide.md", "`runner.py`")}
            self.assertEqual(
                gate.backend_findings(root, workers={}, documented=documented)[0], []
            )
            consumer.unlink()
            self.assertIn(
                "runner: stale documented entry point; remove or update its exception",
                gate.backend_findings(root, workers={}, documented=documented)[0],
            )

    def test_an_empty_backend_is_refused(self):
        with TemporaryDirectory() as directory:
            self.assertEqual(
                gate.backend_findings(Path(directory), workers={}, documented={}),
                (["No backend Python files found; refusing an empty scan"], 0),
            )


if __name__ == "__main__":
    unittest.main()
