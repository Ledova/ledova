import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

SCRIPT = Path(__file__).resolve().parents[1] / "test-backend.py"
SPEC = importlib.util.spec_from_file_location("backend_command", SCRIPT)
BACKEND = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BACKEND)


class SQL:
    def __init__(self, text):
        self.text = text

    def format(self, *values):
        return self.text.format(*values)


PSYCOPG = types.SimpleNamespace(
    sql=types.SimpleNamespace(SQL=SQL, Identifier=lambda value: '"' + value + '"', Literal=repr)
)


class BackendCommandTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.artifacts = self.root / "checks"
        self.addCleanup(patch.stopall)
        patch.object(BACKEND, "ARTIFACTS", self.artifacts).start()
        for name in ("SCHEMA", "SCHEMA_LOG", "SCHEMA_ENVIRONMENT", "SCHEMA_COMPARISON"):
            patch.object(BACKEND, name, self.root / getattr(BACKEND, name).name).start()
        self.receipt = {"run_id": "a" * 32}
        self.receipt_path = self.root / "resources.json"
        self.env = BACKEND.environment({"PATH": "/usr/bin"})

    def test_external_database_connection_is_refused(self):
        with self.assertRaises(BACKEND.BackendFailure):
            BACKEND.environment({"POSTGRES_HOST": "database.example.com"})

    def test_provider_authentication_and_developer_database_name_are_not_inherited(
        self,
    ):
        env = BACKEND.environment(
            {
                "POSTGRES_DB": "developer",
                "BLOCKCHAIN_OPERATOR_KEY": "private",
                "INFO_TRACK_PASSWORD": "private",
            }
        )
        self.assertNotIn("POSTGRES_DB", env)
        self.assertNotIn("BLOCKCHAIN_OPERATOR_KEY", env)
        self.assertNotIn("INFO_TRACK_PASSWORD", env)

    def test_real_nonzero_subprocess_is_a_named_failure(self):
        results = []
        output = io.StringIO()
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(output):
            with self.assertRaisesRegex(BACKEND.BackendFailure, "synthetic-failure failed .*9"):
                BACKEND.phase(
                    "synthetic-failure",
                    [sys.executable, "-c", "print('AssertionError: named synthetic case'); raise SystemExit(9)"],
                    self.env,
                    self.root,
                    results,
                    cwd=self.root,
                    timeout=10,
                )
        self.assertEqual(results[0]["exit"], 9)
        self.assertEqual(results[0]["status"], "failed")
        self.assertIn("AssertionError: named synthetic case", output.getvalue())
        self.assertEqual(
            json.loads((self.root / "phases.json").read_text())[0]["phase"],
            "synthetic-failure",
        )

    def context(self, events, child=None):
        @contextlib.contextmanager
        def scratch(env, receipt, path):
            events.append("database-created")
            try:
                yield child or env
            finally:
                events.append("database-cleaned")

        return scratch

    def test_failed_phase_stops_the_group_and_cleans_the_database(self):
        events = []
        scratch = self.context(events)
        phases = []

        def execute(name, *arguments, **options):
            phases.append(name)
            if name == "ordinary":
                raise BACKEND.BackendFailure("ordinary failed")

        with (
            patch.object(BACKEND, "dependencies"),
            patch.object(BACKEND, "scratch_database", scratch),
            patch.object(BACKEND, "phase", side_effect=execute),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            with self.assertRaisesRegex(BACKEND.BackendFailure, "ordinary failed"):
                BACKEND.run({"PATH": "/usr/bin"})
        self.assertEqual(phases[-1], "ordinary")
        self.assertEqual(events, ["database-created", "database-cleaned"])
        receipt = json.loads(next(self.artifacts.glob("run-*/resources.json")).read_text())
        self.assertEqual(receipt["status"], "failed")

    def test_database_cleanup_rejects_foreign_owners_before_any_drop(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [("test_owned", "developer")]
        with patch.dict(sys.modules, {"psycopg": PSYCOPG}):
            with self.assertRaisesRegex(BACKEND.BackendFailure, "ownership changed"):
                BACKEND.cleanup_database(connection, "owned", {"migrate": "owned_migrate"})
        self.assertEqual(cursor.execute.call_count, 1)

    def test_owned_scratch_roles_are_used_and_credentials_are_absent_from_receipt(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (160015, True)
        cursor.fetchall.side_effect = [[], [], []]
        with (
            patch.dict(sys.modules, {"psycopg": PSYCOPG}),
            patch.object(BACKEND, "postgres_connection", return_value=connection),
            patch.object(
                BACKEND.secrets,
                "token_urlsafe",
                return_value="synthetic-private-password",
            ),
        ):
            with BACKEND.scratch_database(self.env, self.receipt, self.receipt_path) as child:
                self.assertTrue(child["POSTGRES_DB"].startswith("ledova_check_"))
                self.assertEqual(
                    len(
                        {
                            child["POSTGRES_USER"],
                            child["RLS_APP_DB_USER"],
                            child["RLS_OPERATOR_DB_USER"],
                        }
                    ),
                    3,
                )
                self.assertNotIn("ledova_app", child.values())
        self.assertNotIn("synthetic-private-password", self.receipt_path.read_text())
        self.assertEqual(self.receipt["database_cleanup"], "complete")

    def test_database_cleanup_failure_is_recorded_without_replacing_a_phase_failure(
        self,
    ):
        def attempt(primary):
            try:
                with BACKEND.scratch_database(self.env, self.receipt, self.receipt_path):
                    if primary is not None:
                        raise primary
            except Exception as error:
                return error
            self.fail("Cleanup failure was accepted")

        for primary, ambient in ((None, False), (BACKEND.BackendFailure("Core phase failed"), False), (None, True)):
            with self.subTest(primary=primary, ambient=ambient):
                connection = MagicMock()
                cursor = connection.cursor.return_value.__enter__.return_value
                cursor.fetchone.return_value = (160015, True)
                cursor.fetchall.side_effect = [[], []]
                self.receipt = {"run_id": "a" * 32}
                with (
                    patch.dict(sys.modules, {"psycopg": PSYCOPG}),
                    patch.object(BACKEND, "postgres_connection", return_value=connection),
                    patch.object(
                        BACKEND,
                        "cleanup_database",
                        side_effect=RuntimeError("synthetic-private-password"),
                    ),
                ):
                    if ambient:
                        try:
                            raise ValueError("Unrelated handled error")
                        except ValueError:
                            outcome = attempt(primary)
                    else:
                        outcome = attempt(primary)
                self.assertIsInstance(outcome, BACKEND.BackendFailure)
                if primary is not None:
                    self.assertIs(outcome, primary)
                self.assertEqual(self.receipt["database_cleanup"], "failed")
                self.assertEqual(self.receipt["database_cleanup_error_type"], "RuntimeError")
                self.assertNotIn("synthetic-private-password", self.receipt_path.read_text())
                connection.close.assert_called_once_with()

    def test_a_preexisting_scratch_role_is_not_adopted_or_removed(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (160015, True)
        cursor.fetchall.return_value = [("existing_role",)]
        with (
            patch.dict(sys.modules, {"psycopg": PSYCOPG}),
            patch.object(BACKEND, "postgres_connection", return_value=connection),
        ):
            with self.assertRaisesRegex(BACKEND.BackendFailure, "already exists"):
                with BACKEND.scratch_database(self.env, self.receipt, self.receipt_path):
                    self.fail("Preexisting roles were admitted")
        self.assertEqual(cursor.execute.call_count, 2)


if __name__ == "__main__":
    unittest.main()
