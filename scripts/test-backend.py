#!/usr/bin/env python3
import argparse
import contextlib
import importlib.util
import ipaddress
import json
import os
import secrets
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
ARTIFACTS = Path("/tmp/ledova-backend-checks")
SCHEMA = Path("/tmp/ledova-schema.json")
SCHEMA_ENVIRONMENT = Path("/tmp/ledova-schema-environment.json")
SCHEMA_COMPARISON = Path("/tmp/ledova-schema-comparison.json")
SCHEMA_LOG = Path("/tmp/ledova-schema-diagnostics.log")
TEST_SETTINGS = "ledova_backend.settings.test"
POSTGRES_SETTINGS = "ledova_backend.settings.test_postgres"
PROCESS_STOP_SECONDS = 5


class BackendFailure(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise BackendFailure(message)


def write_receipt(path, value):
    path.write_text(json.dumps(value, indent=2) + "\n")


def loopback(host):
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def environment(supplied):
    inherited = {
        name: supplied[name]
        for name in (
            "PATH",
            "HOME",
            "LANG",
            "LC_ALL",
            "TMPDIR",
            "TEMP",
            "TMP",
        )
        if name in supplied
    }
    host = supplied.get("POSTGRES_HOST", "127.0.0.1")
    require(
        loopback(host) or host.startswith("/"),
        "PostgreSQL must use loopback or a Unix socket",
    )
    return inherited | {
        "SECRET_KEY": "backend-checks-synthetic-only",
        "STORAGE_BACKEND": "local",
        "POSTGRES_HOST": host,
        "POSTGRES_PORT": supplied.get("POSTGRES_PORT", "5432"),
        "POSTGRES_USER": supplied.get("POSTGRES_USER", "postgres"),
        "POSTGRES_PASSWORD": supplied.get("POSTGRES_PASSWORD", ""),
        "POSTGRES_SSLMODE": "disable",
    }


def dependencies(env):
    require(sys.version_info[:3] == (3, 13, 15), "Use Python 3.13.15 for backend checks")
    for name in ("django", "psycopg", "black", "isort", "flake8"):
        require(importlib.util.find_spec(name) is not None, f"Missing backend dependency: {name}")
    require(shutil.which("make", path=env.get("PATH")) is not None, "Missing backend dependency: make")


def stop_process(process):
    for signum in (signal.SIGTERM, signal.SIGKILL):
        process.poll()
        try:
            os.killpg(process.pid, signum)
        except ProcessLookupError:
            return
        deadline = time.monotonic() + PROCESS_STOP_SECONDS
        while True:
            process.poll()
            try:
                os.killpg(process.pid, 0)
            except ProcessLookupError:
                return
            except PermissionError:
                pass
            if time.monotonic() >= deadline:
                break
            time.sleep(0.05)
    raise BackendFailure("The owned backend child process group did not stop")


def phase(name, arguments, env, directory, results, *, cwd=BACKEND, timeout=1800, log=None):
    log = log or directory / f"{name}.log"
    print(f"Backend phase {name}; log {log}", flush=True)
    start = time.monotonic()
    result = {"phase": name, "log": str(log), "exit": None, "status": "failed"}
    results.append(result)
    try:
        with log.open("w") as output:
            process = subprocess.Popen(
                arguments,
                cwd=cwd,
                env=env,
                stdout=output,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
            try:
                result["exit"] = process.wait(timeout=timeout)
            finally:
                stop_process(process)
        require(
            result["exit"] == 0,
            f"Backend phase {name} failed (exit {result['exit']}); see {log}",
        )
        result["status"] = "passed"
    except BaseException as error:
        if log.is_file():
            with log.open() as output:
                shutil.copyfileobj(output, sys.stderr)
        if isinstance(error, subprocess.TimeoutExpired):
            raise BackendFailure(f"Backend phase {name} exceeded its deadline; see {log}") from None
        raise
    finally:
        result["elapsed_seconds"] = round(time.monotonic() - start, 3)
        write_receipt(directory / "phases.json", results)
    print(f"Backend phase {name} passed in {result['elapsed_seconds']}s", flush=True)


def postgres_connection(env):
    import psycopg

    return psycopg.connect(
        host=env["POSTGRES_HOST"],
        port=env["POSTGRES_PORT"],
        user=env["POSTGRES_USER"],
        password=env["POSTGRES_PASSWORD"],
        dbname="postgres",
        connect_timeout=5,
        autocommit=True,
        options="-c statement_timeout=10000 -c lock_timeout=10000",
    )


def cleanup_database(connection, database, roles):
    from psycopg import sql

    names = [
        database,
        f"test_{database}",
    ]
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT datname, pg_get_userbyid(datdba) FROM pg_database WHERE datname = ANY(%s)",
            [names],
        )
        found = cursor.fetchall()
        require(
            all(name in names and owner == roles["migrate"] for name, owner in found),
            "Scratch database ownership changed; cleanup refused",
        )
        cursor.execute("SET statement_timeout = '60s'")
        for name, _ in found:
            cursor.execute(sql.SQL("DROP DATABASE {} WITH (FORCE)").format(sql.Identifier(name)))
        for name in reversed(list(roles.values())):
            cursor.execute(sql.SQL("DROP ROLE {}").format(sql.Identifier(name)))


@contextlib.contextmanager
def scratch_database(env, receipt, receipt_path):
    from psycopg import sql

    identifier = receipt["run_id"][:20]
    database = "ledova_check_" + identifier
    roles = {name: database + "_" + name for name in ("migrate", "app", "operator")}
    password = secrets.token_urlsafe(32)
    created = {}
    connection = None
    primary_failed = False
    receipt["database"] = database
    receipt["roles"] = roles
    write_receipt(receipt_path, receipt)
    try:
        connection = postgres_connection(env)
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT current_setting('server_version_num')::int, rolsuper FROM pg_roles WHERE rolname = current_user"
            )
            version, administrator = cursor.fetchone()
            require(
                160000 <= version < 170000 and administrator,
                "Backend scratch setup requires a local PostgreSQL 16 administrator",
            )
            cursor.execute(
                "SELECT rolname FROM pg_roles WHERE rolname = ANY(%s)",
                [list(roles.values())],
            )
            require(not cursor.fetchall(), "Scratch role name already exists")
            cursor.execute("SELECT datname FROM pg_database WHERE datname = %s", [database])
            require(not cursor.fetchall(), "Scratch database name already exists")
            for kind, name in roles.items():
                privilege = {
                    "migrate": "SUPERUSER",
                    "app": "NOBYPASSRLS",
                    "operator": "BYPASSRLS",
                }[kind]
                cursor.execute(
                    sql.SQL("CREATE ROLE {} LOGIN " + privilege + " PASSWORD {}").format(
                        sql.Identifier(name), sql.Literal(password)
                    )
                )
                created[kind] = name
            cursor.execute(
                sql.SQL("CREATE DATABASE {} OWNER {} TEMPLATE template0").format(
                    sql.Identifier(database), sql.Identifier(roles["migrate"])
                )
            )
        child = env | {
            "POSTGRES_DB": database,
            "POSTGRES_USER": roles["migrate"],
            "POSTGRES_PASSWORD": password,
            "RLS_APP_DB_USER": roles["app"],
            "RLS_APP_DB_PASSWORD": password,
            "RLS_OPERATOR_DB_USER": roles["operator"],
            "RLS_OPERATOR_DB_PASSWORD": password,
        }
        yield child
    except BaseException:
        primary_failed = True
        raise
    finally:
        if connection is not None:
            try:
                if created:
                    try:
                        cleanup_database(connection, database, created)
                        receipt["database_cleanup"] = "complete"
                    except Exception as error:
                        receipt["database_cleanup"] = "failed"
                        receipt["database_cleanup_error_type"] = type(error).__name__
                        if not primary_failed:
                            raise BackendFailure(
                                "Scratch database cleanup failed; inspect retained resources"
                            ) from error
            finally:
                connection.close()
                write_receipt(receipt_path, receipt)


def interrupted(signum, frame):
    raise BackendFailure(f"Backend command interrupted by signal {signum}")


def run(supplied=None):
    env = environment(os.environ if supplied is None else supplied)
    dependencies(env)
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    directory = Path(tempfile.mkdtemp(prefix="run-", dir=ARTIFACTS))
    receipt_path = directory / "resources.json"
    receipt = {"run_id": uuid.uuid4().hex, "owner_pid": os.getpid(), "status": "running"}
    results = []
    start = time.monotonic()
    handlers = {number: signal.signal(number, interrupted) for number in (signal.SIGINT, signal.SIGTERM)}
    try:
        with scratch_database(env, receipt, receipt_path) as child:

            def execute(name, arguments, **options):
                phase(name, arguments, child, directory, results, **options)

            execute("lint", ["make", "-C", "backend", "lint", f"PYTHON={sys.executable}"], cwd=ROOT, timeout=300)
            management = [sys.executable, "manage.py"]
            for name, arguments in (
                ("system", ["check"]),
                ("migration-consistency", ["makemigrations", "--check", "--dry-run"]),
                ("migrate", ["migrate", f"--settings={TEST_SETTINGS}", "--noinput"]),
                ("check_rls_roles", ["check_rls_roles", f"--settings={TEST_SETTINGS}"]),
                ("check_rls_catalogue", ["check_rls_catalogue", f"--settings={TEST_SETTINGS}"]),
            ):
                execute(name, management + arguments)
            execute(
                "schema",
                management
                + [
                    "export_api_schema",
                    f"--settings={POSTGRES_SETTINGS}",
                    "--file",
                    str(directory / SCHEMA.name),
                    "--report",
                    str(directory / SCHEMA_ENVIRONMENT.name),
                ],
                log=directory / SCHEMA_LOG.name,
            )
            execute(
                "schema-comparison",
                [
                    sys.executable,
                    str(ROOT / "scripts/check-api-schema.py"),
                    "--schema",
                    str(directory / SCHEMA.name),
                    "--report",
                    str(directory / SCHEMA_COMPARISON.name),
                ],
            )
            execute(
                "ordinary",
                management + ["test", f"--settings={TEST_SETTINGS}", "--noinput", "--keepdb", "--verbosity", "2"],
            )
        receipt["status"] = "passed"
    finally:
        receipt["elapsed_seconds"] = round(time.monotonic() - start, 3)
        if receipt["status"] == "running":
            receipt["status"] = "failed"
        write_receipt(receipt_path, receipt)
        for output in (SCHEMA, SCHEMA_ENVIRONMENT, SCHEMA_COMPARISON, SCHEMA_LOG):
            source = directory / output.name
            if source.is_file():
                shutil.copyfile(source, output)
        for number, handler in handlers.items():
            signal.signal(number, handler)
        print(f"Backend checks {receipt['status']}; evidence {directory}", flush=True)


def main():
    parser = argparse.ArgumentParser(description="Run backend checks on owned synthetic resources")
    parser.add_argument("--uploads", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--chains", action="store_true", help=argparse.SUPPRESS)
    parser.add_argument("--audit", action="store_true", help=argparse.SUPPRESS)
    parser.parse_args()
    try:
        run()
        return 0
    except BackendFailure as error:
        print(str(error), file=sys.stderr)
        return 1
    except Exception as error:
        print(
            f"Backend checks failed ({type(error).__name__}); inspect phase and resource diagnostics",
            file=sys.stderr,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
