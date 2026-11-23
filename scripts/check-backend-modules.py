#!/usr/bin/env python3

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# These standalone subprocess entry points are selected by a filename, not imported.
# Keep each exception tied to the literal reference that starts it.
WORKERS = {
    "shared.upload_worker": ("shared/upload_processing.py", "upload_worker.py"),
    "shared.upload_scanner_worker": (
        "shared/upload_scanner.py",
        "upload_scanner_worker.py",
    ),
}
DOCUMENTED_ENTRY_POINTS = {
    "ledova_backend.worker_entrypoint": (
        "docs/operations/jobs-and-storage.md",
        "`ledova_backend/worker_entrypoint.py`",
    ),
}


def backend_findings(root=ROOT, *, workers=WORKERS, documented=DOCUMENTED_ENTRY_POINTS):
    backend = root / "backend"
    files = {
        ".".join(path.relative_to(backend).with_suffix("").parts).removesuffix(
            ".__init__"
        ): path
        for path in sorted(backend.rglob("*.py"))
        if not {"node_modules", ".venv", "venv", "__pycache__"}.intersection(path.parts)
    }
    trees = {
        name: ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for name, path in files.items()
    }
    graph = {name: set() for name in files}
    roots = set()
    findings = []
    if not files:
        return ["No backend Python files found; refusing an empty scan"], 0

    def targets(name):
        # Importing a submodule executes each package's __init__ on its way in.
        return {
            ".".join(name.split(".")[:length])
            for length in range(1, len(name.split(".")) + 1)
        } & files.keys()

    for name, tree in trees.items():
        path = files[name]
        relative = path.relative_to(backend)
        if (
            path.name in {"manage.py", "apps.py", "asgi.py", "wsgi.py"}
            or "settings" in relative.parts
            or "migrations" in relative.parts
            or "tests" in relative.parts
            or "templatetags" in relative.parts
            or relative.parts[-3:-1] == ("management", "commands")
            or path.name in {"models.py", "admin.py", "tasks.py"}
            or (
                path.name == "__init__.py"
                and path.parent.name in {"models", "admin", "tasks"}
            )
        ):
            roots.add(name)
        package = name if path.name == "__init__.py" else name.rpartition(".")[0]
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    graph[name].update(targets(alias.name))
            elif isinstance(node, ast.ImportFrom):
                parent = (
                    package.split(".")[: len(package.split(".")) - node.level + 1]
                    if node.level
                    else []
                )
                module = ".".join([*parent, *([node.module] if node.module else [])])
                graph[name].update(targets(module))
                for alias in node.names:
                    graph[name].update(targets(f"{module}.{alias.name}"))
            elif (
                isinstance(node, ast.Constant)
                and isinstance(node.value, str)
                and "." in node.value
            ):
                # Django settings and import_module/import_string retain literal dotted entry points.
                graph[name].update(targets(node.value))

    for module, (source, literal) in workers.items():
        source_name = source.removesuffix(".py").replace("/", ".")
        if module not in files or source_name not in trees:
            findings.append(f"{module}: stale worker exception; remove it")
        elif not any(
            isinstance(node, ast.Constant) and node.value == literal
            for node in ast.walk(trees[source_name])
        ):
            findings.append(
                f"{module}: stale worker reference in {source}; remove or update the exception"
            )
        else:
            graph[source_name].update(targets(module))

    for module, (consumer, reference) in documented.items():
        document = root / consumer
        if (
            module not in files
            or not document.is_file()
            or reference not in document.read_text(encoding="utf-8")
        ):
            findings.append(
                f"{module}: stale documented entry point; remove or update its exception"
            )
        else:
            roots.add(module)

    reached = set()

    def reach(name):
        if name in reached:
            return
        reached.add(name)
        for dependency in graph[name]:
            reach(dependency)

    for name in roots:
        for entry in targets(name):
            reach(entry)
    for name, path in files.items():
        if name not in reached and trees[name].body:
            findings.append(f"{path.relative_to(root)}: unused backend module")
    return sorted(findings), len(files)


if __name__ == "__main__":
    findings, scanned = backend_findings()
    if findings:
        print(f"Backend dead-code findings ({len(findings)}):\n" + "\n".join(findings))
        raise SystemExit(1)
    print(f"No unused backend modules in {scanned} Python files.")
