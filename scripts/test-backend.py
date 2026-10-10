#!/usr/bin/env python3
import argparse
import contextlib
import importlib.util
import ipaddress
import json
import os
import platform
import re
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
ARTIFACTS = Path("/tmp/ledova-backend-checks")
SCHEMA = Path("/tmp/ledova-schema.json")
SCHEMA_ENVIRONMENT = Path("/tmp/ledova-schema-environment.json")
SCHEMA_COMPARISON = Path("/tmp/ledova-schema-comparison.json")
SCHEMA_LOG = Path("/tmp/ledova-schema-diagnostics.log")
CLAMAV_IMAGE = "clamav/clamav:1.5.4-debian"
TEST_SETTINGS = "ledova_backend.settings.test"
POSTGRES_SETTINGS = "ledova_backend.settings.test_postgres"
SCOPED_SETTINGS = "ledova_backend.settings.test_scoped"
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
            "DOCKER_HOST",
            "DOCKER_CONTEXT",
            "BITCOIN_TEST_BINARY",
        )
        if name in supplied
    }
    host = supplied.get("POSTGRES_HOST", "127.0.0.1")
    require(
        loopback(host) or host.startswith("/"),
        "PostgreSQL must use loopback or a Unix socket",
    )
    redis_url = supplied.get("REDIS_URL", "redis://127.0.0.1:6379/0")
    parsed = urlsplit(redis_url)
    require(
        parsed.scheme == "redis" and loopback(parsed.hostname or ""),
        "Redis must use loopback",
    )
    return inherited | {
        "SECRET_KEY": "backend-checks-synthetic-only",
        "STORAGE_BACKEND": "local",
        "POSTGRES_HOST": host,
        "POSTGRES_PORT": supplied.get("POSTGRES_PORT", "5432"),
        "POSTGRES_USER": supplied.get("POSTGRES_USER", "postgres"),
        "POSTGRES_PASSWORD": supplied.get("POSTGRES_PASSWORD", ""),
        "POSTGRES_SSLMODE": "disable",
        "REDIS_URL": redis_url,
        "THROTTLE_TEST_REDIS_URL": redis_url,
        "UPLOAD_TEST_REDIS_URL": redis_url,
    }


def dependencies(env, *, uploads=False, chains=False, audit=False):
    require(sys.version_info[:3] == (3, 13, 15), "Use Python 3.13.15 for backend checks")
    modules = ["django", "psycopg", "black", "isort", "flake8"]
    if uploads:
        modules.append("redis")
    if audit:
        modules.append("pip_audit")
    for name in modules:
        require(
            importlib.util.find_spec(name) is not None,
            f"Missing backend dependency: {name}",
        )
    require(
        shutil.which("make", path=env.get("PATH")) is not None,
        "Missing backend dependency: make",
    )
    if uploads:
        require(
            shutil.which("docker", path=env.get("PATH")) is not None,
            "Docker is required for upload integration checks",
        )
        check_docker_local(env)
        require(
            bool(docker(["info", "--format", "{{.ServerVersion}}"], env)),
            "Docker is unavailable for the scanner",
        )
    if chains:
        for name in ("node", "npm"):
            require(
                shutil.which(name, path=env.get("PATH")) is not None,
                f"Missing chain dependency: {name}",
            )
        node = subprocess.run(
            ["node", "--version"],
            env=env,
            capture_output=True,
            text=True,
            timeout=10,
            check=True,
        )
        require(node.stdout.strip() == "v22.15.1", "Chain checks require Node 22.15.1")
        require(
            (ROOT / "contracts/node_modules/.bin/hardhat").is_file(),
            "Run npm ci in contracts before chain checks",
        )
        if platform.system() != "Linux":
            binary = env.get("BITCOIN_TEST_BINARY", "")
            require(
                bool(binary) and Path(binary).is_file() and os.access(binary, os.X_OK),
                "Set BITCOIN_TEST_BINARY to Bitcoin Core 31.1",
            )


def check_redis(env):
    from redis import Redis

    try:
        with Redis.from_url(env["REDIS_URL"], socket_connect_timeout=2, socket_timeout=2) as client:
            require(client.ping(), "Redis did not answer PING")
            require(
                client.info("server")["redis_version"].split(".")[0] == "7",
                "Backend checks require Redis 7",
            )
    except BackendFailure:
        raise
    except Exception:
        raise BackendFailure("Redis readiness failed on the supplied local service") from None


def free_port():
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


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
        *(f"test_{database}_{n}" for n in range(1, 5)),
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


def docker(arguments, env, *, timeout=30):
    result = subprocess.run(
        ["docker", *arguments],
        env=env,
        text=True,
        capture_output=True,
        timeout=timeout,
        check=True,
    )
    return result.stdout.strip()


def check_docker_local(env):
    if env.get("DOCKER_CONTEXT") or not env.get("DOCKER_HOST"):
        context = env.get("DOCKER_CONTEXT") or docker(["context", "show"], env)
        endpoint = docker(
            ["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"],
            env,
        )
    else:
        endpoint = env["DOCKER_HOST"]
    parsed = urlsplit(endpoint)
    require(
        (parsed.scheme == "unix" and not parsed.netloc and parsed.path.startswith("/"))
        or (parsed.scheme in {"tcp", "http", "https"} and loopback(parsed.hostname or "")),
        "Docker must use a local Unix socket or loopback endpoint for the owned scanner",
    )


@contextlib.contextmanager
def scanner(env, receipt, receipt_path, directory):
    check_docker_local(env)
    name = "ledova-backend-clamav-" + receipt["run_id"]
    cid_file = directory / "clamav.cid"
    identity = None
    require(not cid_file.exists(), "Scanner CID artifact already exists")
    receipt["scanner"] = {
        "name": name,
        "image": CLAMAV_IMAGE,
        "cid_file": str(cid_file),
    }
    write_receipt(receipt_path, receipt)
    try:
        identity = docker(
            [
                "run",
                "-d",
                "--name",
                name,
                "--cidfile",
                str(cid_file),
                "--label",
                "ledova.backend-check=" + receipt["run_id"],
                "--memory",
                "4g",
                "--cpus",
                "2",
                "--pids-limit",
                "128",
                "--publish",
                "127.0.0.1::3310",
                "--health-cmd",
                "clamdscan --ping=1 --config-file=/etc/clamav/clamd.conf",
                "--health-interval",
                "5s",
                "--health-timeout",
                "3s",
                "--health-retries",
                "60",
                "--mount",
                f"type=bind,src={BACKEND / '.deployment/clamd.conf'},dst=/etc/clamav/clamd.conf,readonly",
                CLAMAV_IMAGE,
                "sh",
                "-c",
                "freshclam --foreground --stdout && exec clamd --foreground",
            ],
            env,
            timeout=600,
        )
        require(
            re.fullmatch("[0-9a-f]{64}", identity) is not None,
            "Scanner returned an invalid owned container ID",
        )
        require(
            cid_file.is_file() and cid_file.read_text().strip() == identity,
            "Scanner CID artifact does not match its owned container ID",
        )
        receipt["scanner"]["container_id"] = identity
        write_receipt(receipt_path, receipt)
        deadline = time.monotonic() + 300
        while True:
            state = docker(
                [
                    "inspect",
                    "--format",
                    "{{.State.Status}} {{.State.Health.Status}}",
                    identity,
                ],
                env,
            )
            if state == "running healthy":
                break
            require(
                state.startswith("running "),
                "The owned ClamAV scanner exited before readiness",
            )
            require(
                time.monotonic() < deadline,
                "The owned ClamAV scanner did not become healthy within 300s",
            )
            time.sleep(2)
        binding = docker(["port", identity, "3310/tcp"], env)
        require(
            re.fullmatch(r"127\.0\.0\.1:[0-9]+", binding) is not None,
            "Scanner port is not loopback-only",
        )
        yield env | {
            "UPLOAD_TEST_CLAMAV_HOST": "127.0.0.1",
            "UPLOAD_TEST_CLAMAV_PORT": binding.rsplit(":", 1)[1],
        }
    finally:
        if cid_file.exists():
            recorded = cid_file.read_text().strip()
            require(
                re.fullmatch("[0-9a-f]{64}", recorded) is not None,
                "Scanner CID artifact is invalid; cleanup refused",
            )
            require(
                identity is None or recorded == identity,
                "Scanner container identity changed; cleanup refused",
            )
            identity = recorded
            receipt["scanner"]["container_id"] = identity
            write_receipt(receipt_path, receipt)
        if identity is not None and re.fullmatch("[0-9a-f]{64}", identity):
            owned = docker(
                [
                    "inspect",
                    "--format",
                    '{{index .Config.Labels "ledova.backend-check"}}',
                    identity,
                ],
                env,
            )
            require(owned == receipt["run_id"], "Scanner ownership changed; cleanup refused")
            try:
                with (directory / "clamav.log").open("w") as output:
                    subprocess.run(
                        ["docker", "logs", identity],
                        env=env,
                        stdout=output,
                        stderr=subprocess.STDOUT,
                        timeout=30,
                        check=True,
                    )
            finally:
                docker(["rm", "-f", "-v", identity], env)
                receipt["scanner_cleanup"] = "complete"
                write_receipt(receipt_path, receipt)


def interrupted(signum, frame):
    raise BackendFailure(f"Backend command interrupted by signal {signum}")


def run(supplied=None, *, uploads=False, chains=False, audit=False):
    env = environment(os.environ if supplied is None else supplied)
    dependencies(env, uploads=uploads, chains=chains, audit=audit)
    if uploads:
        check_redis(env)
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

            if audit:
                execute(
                    "advisories",
                    [sys.executable, "-m", "pip_audit", "-r", "requirements.txt", "--ignore-vuln", "PYSEC-2026-1845"],
                    timeout=600,
                )
            execute("lint", ["make", "-C", "backend", "lint", f"PYTHON={sys.executable}"], cwd=ROOT, timeout=300)
            management = [sys.executable, "manage.py"]
            for name, arguments in (
                ("system", ["check"]),
                ("migration-consistency", ["makemigrations", "--check", "--dry-run"]),
                ("migrate", ["migrate", f"--settings={POSTGRES_SETTINGS}", "--noinput"]),
                ("check_rls_roles", ["check_rls_roles", f"--settings={POSTGRES_SETTINGS}"]),
                ("check_rls_catalogue", ["check_rls_catalogue", f"--settings={POSTGRES_SETTINGS}"]),
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
            common = ["--noinput", "--keepdb"]
            for name, settings in (("ordinary", TEST_SETTINGS), ("scoped", SCOPED_SETTINGS)):
                extra = ["--require-scoped-coverage"] if name == "scoped" else []
                arguments = management + ["test", f"--settings={settings}", *extra, *common]
                arguments += ["--parallel", "4", "--durations", "0", "--verbosity", "2", "--timing"]
                execute(name, arguments)
            if uploads:
                for name, label in (
                    ("redis-throttle", "authentication.tests.redis_throttle"),
                    ("redis-uploads", "shared.tests.redis_uploads"),
                ):
                    execute(name, management + ["test", label, f"--settings={TEST_SETTINGS}", *common])
                with scanner(child, receipt, receipt_path, directory) as scanner_environment:
                    arguments = management + [
                        "test",
                        "shared.tests.clamav_uploads",
                        f"--settings={TEST_SETTINGS}",
                        *common,
                    ]
                    phase("clamav-uploads", arguments, scanner_environment, directory, results, timeout=300)
            if chains:
                arguments = ["make", "chain-test", f"PYTHON={sys.executable}", f"CHAIN_TEST_PORT={free_port()}"]
                arguments += [
                    f"CHAIN_TEST_ENV_FILE={directory / 'chain-contracts.env'}",
                    f"CHAIN_TEST_LOG_FILE={directory / 'hardhat.log'}",
                ]
                execute("evm", arguments, cwd=ROOT)
                execute(
                    "bitcoin",
                    [sys.executable, str(ROOT / "scripts/test-bitcoin-chain.py"), "--port", str(free_port())],
                    cwd=ROOT,
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
    parser.add_argument("--uploads", action="store_true")
    parser.add_argument("--chains", action="store_true")
    parser.add_argument("--audit", action="store_true")
    args = parser.parse_args()
    try:
        run(uploads=args.uploads, chains=args.chains, audit=args.audit)
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
