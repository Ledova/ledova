#!/usr/bin/env python3
import argparse
import contextlib
import json
import os
import subprocess
import sys
import unittest
from collections import Counter, defaultdict
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parent.parent
BACKEND = ROOT / "backend"
SHARDS = ROOT / ".github" / "ordinary-suite-shards.json"
WORKFLOW = ROOT / ".github" / "workflows" / "ci.yml"
JOB = "backend-suite-shard"
SETTINGS = "ledova_backend.settings.test"


def cases(suite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from cases(item)
        else:
            yield item


def binding(kind):
    if getattr(sys.modules.get(kind.__module__), kind.__name__, None) is kind:
        return kind.__module__, kind.__qualname__
    bindings = (
        (name, attribute)
        for name, module in list(sys.modules.items())
        for attribute, value in getattr(module, "__dict__", {}).items()
        if value is kind
    )
    return min(bindings, default=(kind.__module__, kind.__qualname__))


def record(case):
    module, name = binding(type(case))
    return {
        "id": f"{module}.{name}.{case._testMethodName}",
        "module": case._testMethodName if module == "unittest.loader" else module,
        "failed": isinstance(case, unittest.loader._FailedTest),
    }


def findings(everything, shards):
    runs = {"the unlabelled suite": everything} | {f"shard {name}": found for name, found in shards.items()}
    problems = {
        f"{run} failed to load {case['module']}" for run, found in runs.items() for case in found if case["failed"]
    }
    expected = Counter(case["id"] for case in everything if not case["failed"])
    placed = defaultdict(list)
    module = {}
    for name, found in shards.items():
        for case in found:
            if not case["failed"]:
                placed[case["id"]].append(name)
                module[case["id"]] = case["module"]
    for case in everything:
        if not case["failed"] and len(placed.get(case["id"], [])) < expected[case["id"]]:
            problems.add(f"{case['module']} has tests in no shard")
    for identity, names in placed.items():
        if identity not in expected:
            problems.add(
                f"{module[identity]} runs in shard {', '.join(sorted(set(names)))} and not in the unlabelled suite"
            )
        elif len(names) > expected[identity]:
            problems.add(f"{module[identity]} has tests duplicated in shards: {', '.join(sorted(names))}")
    return sorted(problems)


def matrix_findings(workflow, shards):
    try:
        matrix = workflow["jobs"][JOB]["strategy"]["matrix"]
    except (KeyError, TypeError):
        matrix = None
    listed = matrix.get("shard") if isinstance(matrix, dict) else None
    if matrix == {"shard": listed} and isinstance(listed, list) and sorted(listed) == sorted(shards):
        return []
    return [
        f"the {JOB} matrix in {WORKFLOW.relative_to(ROOT)} is {matrix},"
        f" and {SHARDS.relative_to(ROOT)} defines only the shards {sorted(shards)}"
    ]


def in_this_interpreter(labels):
    sys.path.insert(0, os.getcwd())
    with contextlib.redirect_stdout(sys.stderr):
        import django
        from django.conf import settings
        from django.test.utils import get_runner

        django.setup()
        runner = get_runner(settings)(verbosity=0, interactive=False)
        runner.setup_test_environment()
        return [record(case) for case in cases(runner.build_suite(labels))]


def in_a_fresh_interpreter(labels, backend):
    child = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), "--discover", *labels],
        cwd=backend,
        env=os.environ | {"DJANGO_SETTINGS_MODULE": SETTINGS},
        stdout=subprocess.PIPE,
        text=True,
        check=True,
    )
    return json.loads(child.stdout)


def discover(shards, backend=BACKEND):
    everything = in_a_fresh_interpreter([], backend)
    return everything, {name: in_a_fresh_interpreter(labels, backend) for name, labels in shards.items()}


def main():
    parser = argparse.ArgumentParser(description="Hold the ordinary suite's CI shards to the unlabelled suite.")
    parser.add_argument("--labels", metavar="SHARD", help="print one shard's Django test labels and exit")
    parser.add_argument("--discover", nargs="*", help=argparse.SUPPRESS)
    arguments = parser.parse_args()

    if arguments.discover is not None:
        print(json.dumps(in_this_interpreter(arguments.discover)))
        return 0

    shards = json.loads(SHARDS.read_text(encoding="utf-8"))

    if arguments.labels is not None:
        if arguments.labels not in shards:
            print(f"{SHARDS.relative_to(ROOT)} defines no shard named {arguments.labels}", file=sys.stderr)
            return 1
        print(" ".join(shards[arguments.labels]))
        return 0

    everything, found = discover(shards)
    problems = matrix_findings(yaml.safe_load(WORKFLOW.read_text(encoding="utf-8")), shards)
    problems += findings(everything, found)

    if problems:
        print(f"The ordinary suite's shards do not partition it ({len(problems)}):\n", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        print(
            f"\nPut each app label in exactly one shard in {SHARDS.relative_to(ROOT)}, and keep the {JOB}"
            f" matrix to exactly those shard names, with no include or exclude.\n\nThe rule is in"
            ' docs/development/gates.md, "The ordinary shard gate".',
            file=sys.stderr,
        )
        return 1

    modules = {case["module"] for case in everything}
    counts = ", ".join(f"{name} {len(tests)}" for name, tests in found.items())
    print(f"Each of {len(everything)} ordinary tests in {len(modules)} modules runs in exactly one shard: {counts}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
