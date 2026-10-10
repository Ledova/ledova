import contextlib
import importlib.util
import io
import json
import os
import signal
import subprocess
import sys
import tempfile
import time
import types
import unittest
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

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
        self.env = BACKEND.environment({"PATH": "/usr/bin", "DOCKER_HOST": "unix:///synthetic-local-docker.sock"})

    def test_external_database_and_redis_connections_are_refused(self):
        for supplied in (
            {"POSTGRES_HOST": "database.example.com"},
            {"REDIS_URL": "redis://example.com/0"},
            {"REDIS_URL": "https://127.0.0.1/0"},
        ):
            with self.subTest(supplied=supplied), self.assertRaises(BACKEND.BackendFailure):
                BACKEND.environment(supplied)

    def test_unix_sockets_are_accepted_without_the_old_tcp_probe(self):
        self.assertEqual(
            BACKEND.environment({"POSTGRES_HOST": "/tmp/synthetic-socket"})["POSTGRES_HOST"],
            "/tmp/synthetic-socket",
        )

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

    def test_missing_dependencies_fail_before_creating_resources(self):
        with (
            patch.object(BACKEND.sys, "version_info", (3, 13, 15)),
            patch.object(BACKEND.importlib.util, "find_spec", return_value=None),
        ):
            with self.assertRaisesRegex(BACKEND.BackendFailure, "Missing backend dependency: django"):
                BACKEND.dependencies(self.env)
        self.assertFalse(self.artifacts.exists())

    def test_wrong_python_patch_is_refused_before_dependency_or_service_access(self):
        with (
            patch.object(BACKEND.sys, "version_info", (3, 13, 14)),
            patch.object(BACKEND.importlib.util, "find_spec") as dependency,
        ):
            with self.assertRaisesRegex(BACKEND.BackendFailure, "Python 3.13.15"):
                BACKEND.dependencies(self.env)
        dependency.assert_not_called()
        self.assertFalse(self.artifacts.exists())

    def test_redis_readiness_is_bounded_and_requires_major_seven(self):
        redis = MagicMock()
        client = redis.from_url.return_value.__enter__.return_value
        client.ping.return_value = True
        client.info.return_value = {"redis_version": "6.2.0"}
        with patch.dict(sys.modules, {"redis": types.SimpleNamespace(Redis=redis)}):
            with self.assertRaisesRegex(BACKEND.BackendFailure, "Redis 7"):
                BACKEND.check_redis(self.env)
        redis.from_url.assert_called_once_with(self.env["REDIS_URL"], socket_connect_timeout=2, socket_timeout=2)

    def test_remote_docker_host_is_refused_without_a_container_operation(self):
        with patch.object(BACKEND, "docker") as docker:
            with self.assertRaisesRegex(BACKEND.BackendFailure, "Docker must use a local"):
                BACKEND.check_docker_local({"DOCKER_HOST": "tcp://docker.example.com:2376"})
        docker.assert_not_called()

    def test_active_docker_context_is_checked_and_remote_endpoint_is_refused(self):
        with patch.object(BACKEND, "docker", side_effect=["synthetic-context", "ssh://docker.example.com"]) as docker:
            with self.assertRaisesRegex(BACKEND.BackendFailure, "Docker must use a local"):
                BACKEND.check_docker_local({})
        self.assertEqual(
            [entry.args[0][:2] for entry in docker.call_args_list],
            [["context", "show"], ["context", "inspect"]],
        )

    def test_local_docker_endpoints_and_explicit_context_precedence_are_preserved(self):
        for endpoint in ("unix:///tmp/synthetic-docker.sock", "tcp://127.0.0.1:2375", "tcp://[::1]:2375"):
            with self.subTest(endpoint=endpoint):
                BACKEND.check_docker_local({"DOCKER_HOST": endpoint})
        with patch.object(BACKEND, "docker", return_value="unix:///tmp/synthetic-docker.sock") as docker:
            BACKEND.check_docker_local(
                {"DOCKER_CONTEXT": "local-context", "DOCKER_HOST": "tcp://remote.example.com:2376"}
            )
        self.assertEqual(docker.call_args.args[0][2], "local-context")

    def test_redis_errors_do_not_expose_provider_authentication(self):
        redis = Mock()
        redis.from_url.side_effect = RuntimeError("private-provider-auth")
        with patch.dict(sys.modules, {"redis": types.SimpleNamespace(Redis=redis)}):
            with self.assertRaisesRegex(BACKEND.BackendFailure, "Redis readiness failed") as failed:
                BACKEND.check_redis(self.env)
        self.assertNotIn("private-provider-auth", str(failed.exception))

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

    def process_group(self, *, leader_exits, resists_term):
        ready = self.root / "child-ready"
        child_source = (
            "import signal, sys, time\n"
            "from pathlib import Path\n"
            "if sys.argv[2] == 'True': signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
            "Path(sys.argv[1]).write_text('ready')\n"
            "while True: time.sleep(0.05)\n"
        )
        leader_source = (
            "import subprocess, sys, time\n"
            "from pathlib import Path\n"
            "subprocess.Popen([sys.executable, '-c', sys.argv[1], sys.argv[2], sys.argv[3]])\n"
            "while not Path(sys.argv[2]).exists(): time.sleep(0.01)\n"
            "if sys.argv[4] == 'True': raise SystemExit(0)\n"
            "while True: time.sleep(0.05)\n"
        )
        process = subprocess.Popen(
            [
                sys.executable,
                "-c",
                leader_source,
                child_source,
                str(ready),
                str(resists_term),
                str(leader_exits),
            ],
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        self.addCleanup(BACKEND.stop_process, process)
        deadline = time.monotonic() + 5
        while not ready.exists():
            self.assertIsNone(process.poll())
            self.assertLess(time.monotonic(), deadline)
            time.sleep(0.01)
        return process

    def test_exited_leader_does_not_leave_its_owned_descendant_running(self):
        process = self.process_group(leader_exits=True, resists_term=False)
        self.assertEqual(process.wait(timeout=5), 0)
        os.killpg(process.pid, 0)
        with patch.object(BACKEND, "PROCESS_STOP_SECONDS", 0.5):
            BACKEND.stop_process(process)
        with self.assertRaises(ProcessLookupError):
            os.killpg(process.pid, 0)

    def test_term_resistant_descendant_is_killed_after_its_leader_exits(self):
        process = self.process_group(leader_exits=False, resists_term=True)
        send = os.killpg
        with (
            patch.object(BACKEND, "PROCESS_STOP_SECONDS", 0.3),
            patch.object(BACKEND.os, "killpg", wraps=send) as killed,
        ):
            BACKEND.stop_process(process)
        delivered = [entry.args for entry in killed.call_args_list if entry.args[1]]
        self.assertEqual(
            delivered,
            [(process.pid, signal.SIGTERM), (process.pid, signal.SIGKILL)],
        )
        self.assertIsNotNone(process.returncode)
        with self.assertRaises(ProcessLookupError):
            os.killpg(process.pid, 0)

    def test_interruption_is_a_failure_that_unwinds_cleanup(self):
        with self.assertRaisesRegex(BACKEND.BackendFailure, "signal"):
            BACKEND.interrupted(signal.SIGTERM, None)

    def context(self, events, child=None):
        @contextlib.contextmanager
        def scratch(env, receipt, path):
            events.append("database-created")
            try:
                yield child or env
            finally:
                events.append("database-cleaned")

        @contextlib.contextmanager
        def scanner(env, receipt, path, directory):
            events.append("scanner-created")
            try:
                yield env
            finally:
                events.append("scanner-cleaned")

        return scratch, scanner

    def test_requested_integrations_use_owned_services_and_preserve_execution_checks(
        self,
    ):
        events = []
        scratch, scanner = self.context(events)
        commands = []
        with (
            patch.object(BACKEND, "dependencies"),
            patch.object(BACKEND, "check_redis"),
            patch.object(BACKEND, "scratch_database", scratch),
            patch.object(BACKEND, "scanner", scanner),
            patch.object(
                BACKEND,
                "phase",
                side_effect=lambda name, arguments, *args, **kwargs: commands.append((name, arguments)),
            ),
            patch.object(BACKEND, "free_port", return_value=18500),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            BACKEND.run({"PATH": "/usr/bin"}, uploads=True, chains=True, audit=True)
        by_name = dict(commands)
        self.assertEqual(len(commands), len(by_name))
        self.assertEqual(
            set(by_name),
            {
                "advisories",
                "lint",
                "system",
                "migration-consistency",
                "migrate",
                "check_rls_roles",
                "check_rls_catalogue",
                "schema",
                "schema-comparison",
                "ordinary",
                "scoped",
                "redis-throttle",
                "redis-uploads",
                "clamav-uploads",
                "evm",
                "bitcoin",
            },
        )
        for name in ("ordinary", "scoped"):
            self.assertIn("--parallel", by_name[name])
            self.assertEqual(by_name[name][by_name[name].index("--parallel") + 1], "4")
            self.assertNotIn("-k", by_name[name])
            self.assertIn("--timing", by_name[name])
        self.assertIn("--require-scoped-coverage", by_name["scoped"])
        self.assertIn("authentication.tests.redis_throttle", by_name["redis-throttle"])
        self.assertIn("shared.tests.redis_uploads", by_name["redis-uploads"])
        self.assertIn("shared.tests.clamav_uploads", by_name["clamav-uploads"])
        self.assertIn("chain-test", by_name["evm"])
        self.assertTrue(
            any(
                argument.startswith("CHAIN_TEST_ENV_FILE=") and "/checks/run-" in argument
                for argument in by_name["evm"]
            )
        )
        self.assertIn(str(BACKEND.ROOT / "scripts/test-bitcoin-chain.py"), by_name["bitcoin"])
        self.assertEqual(
            events,
            [
                "database-created",
                "scanner-created",
                "scanner-cleaned",
                "database-cleaned",
            ],
        )

    def test_core_runs_without_starting_integration_resources(self):
        events = []
        scratch, _ = self.context(events)
        commands = []
        with (
            patch.object(BACKEND, "dependencies"),
            patch.object(BACKEND, "check_redis") as redis,
            patch.object(BACKEND, "scratch_database", scratch),
            patch.object(BACKEND, "scanner") as scanner,
            patch.object(BACKEND, "phase", side_effect=lambda name, *args, **kwargs: commands.append(name)),
            contextlib.redirect_stdout(io.StringIO()),
        ):
            BACKEND.run({"PATH": "/usr/bin"})
        redis.assert_not_called()
        scanner.assert_not_called()
        self.assertNotIn("evm", commands)
        self.assertNotIn("bitcoin", commands)
        self.assertNotIn("advisories", commands)
        self.assertEqual(events, ["database-created", "database-cleaned"])

    def test_failed_phase_stops_the_group_and_cleans_the_database(self):
        events = []
        scratch, scanner = self.context(events)
        phases = []

        def execute(name, *arguments, **options):
            phases.append(name)
            if name == "ordinary":
                raise BACKEND.BackendFailure("ordinary failed")

        with (
            patch.object(BACKEND, "dependencies"),
            patch.object(BACKEND, "check_redis"),
            patch.object(BACKEND, "scratch_database", scratch),
            patch.object(BACKEND, "scanner", scanner),
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

    def test_database_cleanup_drops_only_exact_owned_names_and_roles(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [
            ("test_owned_4", "owned_migrate"),
            ("owned", "owned_migrate"),
        ]
        roles = {
            "migrate": "owned_migrate",
            "app": "owned_app",
            "operator": "owned_operator",
        }
        with patch.dict(sys.modules, {"psycopg": PSYCOPG}):
            BACKEND.cleanup_database(connection, "owned", roles)
        queries = [entry.args[0] for entry in cursor.execute.call_args_list[1:]]
        self.assertEqual(
            queries,
            [
                "SET statement_timeout = '60s'",
                'DROP DATABASE "test_owned_4" WITH (FORCE)',
                'DROP DATABASE "owned" WITH (FORCE)',
                'DROP ROLE "owned_operator"',
                'DROP ROLE "owned_app"',
                'DROP ROLE "owned_migrate"',
            ],
        )

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

    def scanner_answers(self, *, owner=None, state="running healthy"):
        identity = "b" * 64
        return identity, [
            identity,
            state,
            "127.0.0.1:43210",
            owner or self.receipt["run_id"],
            "",
        ]

    def test_scanner_failure_cleans_only_its_owned_container(self):
        identity, answers = self.scanner_answers()

        def respond(arguments, *args, **options):
            if arguments[0] == "run":
                Path(arguments[arguments.index("--cidfile") + 1]).write_text(identity)
            return answers.pop(0)

        with patch.object(BACKEND, "docker", side_effect=respond) as docker, patch.object(BACKEND.subprocess, "run"):
            with self.assertRaisesRegex(BACKEND.BackendFailure, "scan failed"):
                with BACKEND.scanner(self.env, self.receipt, self.receipt_path, self.root) as child:
                    self.assertEqual(child["UPLOAD_TEST_CLAMAV_HOST"], "127.0.0.1")
                    self.assertEqual(child["UPLOAD_TEST_CLAMAV_PORT"], "43210")
                    raise BACKEND.BackendFailure("scan failed")
        create = docker.call_args_list[0].args[0]
        self.assertIn(BACKEND.CLAMAV_IMAGE, create)
        self.assertIn("127.0.0.1::3310", create)
        self.assertEqual(docker.call_args_list[-1].args[0], ["rm", "-f", "-v", identity])
        self.assertEqual(self.receipt["scanner_cleanup"], "complete")

    def test_a_foreign_scanner_label_refuses_cleanup(self):
        identity, answers = self.scanner_answers(owner="foreign")

        def respond(arguments, *args, **options):
            if arguments[0] == "run":
                Path(arguments[arguments.index("--cidfile") + 1]).write_text(identity)
            return answers.pop(0)

        with patch.object(BACKEND, "docker", side_effect=respond) as docker:
            with self.assertRaisesRegex(BACKEND.BackendFailure, "ownership changed"):
                with BACKEND.scanner(self.env, self.receipt, self.receipt_path, self.root):
                    pass
        self.assertFalse(any(entry.args[0][0] == "rm" for entry in docker.call_args_list))

    def test_failed_cleanup_cannot_turn_into_a_passing_run(self):
        identity, answers = self.scanner_answers()
        answers[-1] = subprocess.CalledProcessError(1, ["docker", "rm", identity])

        def respond(arguments, *args, **options):
            if arguments[0] == "run":
                Path(arguments[arguments.index("--cidfile") + 1]).write_text(identity)
            answer = answers.pop(0)
            if isinstance(answer, Exception):
                raise answer
            return answer

        with patch.object(BACKEND, "docker", side_effect=respond), patch.object(BACKEND.subprocess, "run"):
            with self.assertRaises(subprocess.CalledProcessError):
                with BACKEND.scanner(self.env, self.receipt, self.receipt_path, self.root):
                    pass
        self.assertNotIn("scanner_cleanup", self.receipt)

    def test_created_scanner_is_cleaned_when_start_fails_before_run_returns(self):
        identity = "b" * 64

        def respond(arguments, *args, **options):
            if arguments[0] == "run":
                Path(arguments[arguments.index("--cidfile") + 1]).write_text(identity)
                raise subprocess.CalledProcessError(1, ["docker", "run"])
            if arguments[0] == "inspect":
                return self.receipt["run_id"]
            if arguments[0] == "rm":
                return identity
            self.fail("Unexpected Docker operation")

        with patch.object(BACKEND, "docker", side_effect=respond) as docker, patch.object(BACKEND.subprocess, "run"):
            with self.assertRaises(subprocess.CalledProcessError):
                with BACKEND.scanner(self.env, self.receipt, self.receipt_path, self.root):
                    self.fail("A failed scanner start was admitted")
        self.assertEqual(docker.call_args_list[-1].args[0], ["rm", "-f", "-v", identity])
        self.assertEqual(self.receipt["scanner"]["container_id"], identity)
        self.assertEqual(self.receipt["scanner_cleanup"], "complete")


if __name__ == "__main__":
    unittest.main()
