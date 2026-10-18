#!/usr/bin/env python3
"""Fail when non-test, non-migration code binds a transaction or a cursor to the default connection.

`transaction.atomic()` binds to DEFAULT_DB_ALIAS at decoration time; the router sends the
queries to `current_alias()` at execution time. They agree only when the ambient alias *is*
`default`, which is what the ordinary test settings pin - so a mismatch is green in CI and
either raises or silently autocommits in production. Measured on 2026-09-07: under
RLS_AMBIENT_ALIAS=app a row written inside a failed `atomic()` block survives it.

`django.db.connection` is always the default connection, which under R1 is the role with
BYPASSRLS, so a raw read through it is a policy bypass as well as a transaction problem.
There is no such site today; this keeps it that way.

The remedy is `shared.db.atomic`, `shared.db.on_commit` and `connections[alias]`. Task
deferrals use `shared.tasks.queue.defer`, which inserts on the producer's connection.
R23 on #115, from #378; queue binding from #1131.
"""

import ast
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
SKIP_ANYWHERE = frozenset({"__pycache__", "migrations", "tests", ".git", "node_modules"})

# Matching call sites alone leaves three evasions, all of which shadow the helper's own
# name: `from django.db.transaction import atomic` then `atomic()`, `import django.db` then
# `django.db.transaction.atomic()`, and an alias. Refusing the import closes all three, and
# it is cheaper than matching every spelling. It is only cheap because the conversion is
# complete: one allowlisted file imports either name today.
IMPORTS_THE_DEFAULT = {
    "transaction": "shared.db.atomic and shared.db.on_commit",
    "connection": "connections[current_alias()]",
}

BOUND_TO_DEFAULT = {
    "transaction.atomic": "shared.db.atomic",
    "transaction.on_commit": "shared.db.on_commit",
    "connection.cursor": "connections[current_alias()].cursor",
}

# These reach for a connection deliberately and already name which one, so the rule they
# would otherwise break is the rule they implement.
ALLOWED = {
    "backend/shared/db/transactions.py": "the helper itself; it is what everything else calls",
    "backend/shared/db/principal.py": "takes connections[alias or current_alias()] explicitly",
    "backend/shared/management/commands/check_rls_roles.py": "asks each alias in turn, by name, on purpose",
}

QUEUE_HELPER = "backend/shared/tasks/queue.py"
DEFERRAL_METHODS = {"defer", "defer_async", "batch_defer", "batch_defer_async"}


def dotted(node: ast.AST) -> str:
    if isinstance(node, ast.Attribute):
        return f"{dotted(node.value)}.{node.attr}"
    if isinstance(node, ast.Name):
        return node.id
    return ""


def imported_names(node: ast.AST) -> list[str]:
    if isinstance(node, ast.ImportFrom):
        if node.module == "django.db":
            return [alias.name for alias in node.names if alias.name in IMPORTS_THE_DEFAULT]
        if node.module == "django.db.transaction":
            return ["transaction"]
    if isinstance(node, ast.Import):
        return ["transaction" for alias in node.names if alias.name.startswith("django.db.transaction")]
    return []


def findings_for(tree: ast.AST) -> list[tuple[int, str]]:
    found = []
    for node in ast.walk(tree):
        for name in imported_names(node):
            found.append((node.lineno, f"django.db.{name}"))
    for node in ast.walk(tree):
        called = None
        if isinstance(node, ast.Call):
            called = dotted(node.func)
        elif isinstance(node, ast.Attribute):
            called = dotted(node)
        if called in BOUND_TO_DEFAULT:
            found.append((node.lineno, called))
    return sorted(set(found))


def receiver_root(node: ast.AST) -> str:
    while isinstance(node, (ast.Attribute, ast.Call, ast.Subscript)):
        node = node.func if isinstance(node, ast.Call) else node.value
    return node.id if isinstance(node, ast.Name) else ""


def queue_findings_for(tree: ast.AST) -> list[tuple[int, str]]:
    tasks = set()
    modules = set()
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if "tasks" in module.split(".") or module in (
                "ledova_backend.procrastinate_app", "procrastinate.contrib.django"
            ):
                tasks.update(item.asname or item.name for item in node.names)
            if module.startswith("procrastinate"):
                for item in node.names:
                    if item.name in ("App", "DjangoConnector"):
                        found.append((node.lineno, f"{module}.{item.name} constructs a separate queue connector"))
        elif isinstance(node, ast.Import):
            for item in node.names:
                local = item.asname or item.name.split(".")[0]
                if "tasks" in item.name.split("."):
                    tasks.add(local)
                if item.name.startswith("procrastinate"):
                    modules.add(local)

    assignments = [node for node in ast.walk(tree) if isinstance(node, ast.Assign)]
    for _ in assignments:
        for node in assignments:
            if receiver_root(node.value) in tasks:
                tasks.update(target.id for target in node.targets if isinstance(target, ast.Name))

    for node in ast.walk(tree):
        if not isinstance(node, ast.Attribute):
            continue
        root = receiver_root(node.value)
        if node.attr in DEFERRAL_METHODS and root in tasks:
            found.append((node.lineno, f"{node.attr} bypasses the producer-bound enqueue helper"))
        if node.attr in ("App", "DjangoConnector") and root in modules:
            found.append((node.lineno, f"{node.attr} constructs a separate queue connector"))
    return sorted(set(found))


def files() -> list[Path]:
    return sorted(
        path
        for path in BACKEND.rglob("*.py")
        if not SKIP_ANYWHERE & set(path.relative_to(BACKEND).parts)
    )


def main() -> int:
    findings: list[str] = []
    checked = 0
    for path in files():
        relative = str(path.relative_to(ROOT))
        tree = ast.parse(path.read_text())
        checked += 1
        if relative not in ALLOWED:
            for line, called in findings_for(tree):
                instead = BOUND_TO_DEFAULT.get(called) or IMPORTS_THE_DEFAULT[called.rsplit(".", 1)[1]]
                findings.append(f"{relative}:{line}: {called} binds to the default connection, not {instead}")
        if relative != QUEUE_HELPER:
            for line, reason in queue_findings_for(tree):
                findings.append(f"{relative}:{line}: {reason}; use shared.tasks.queue.defer")

    stale = sorted(name for name in (*ALLOWED, QUEUE_HELPER) if not (ROOT / name).is_file())
    if stale:
        findings.extend(f"{name}: allowed, and the file is gone" for name in stale)

    if findings:
        print(
            f"These transaction, cursor or job bindings bypass the producer's connection ({len(findings)}):\n  "
            + "\n  ".join(findings),
            file=sys.stderr,
        )
        print(
            "\nUse shared.db.atomic, shared.db.on_commit, connections[alias], or shared.tasks.queue.defer.",
            file=sys.stderr,
        )
        return 1

    print(f"Transactions, cursors and task deferrals use their selected connection, in {checked} source files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
