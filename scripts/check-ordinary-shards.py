#!/usr/bin/env python3
import argparse
import json
import os
import sys
import unittest
from collections import defaultdict
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


def failed(case):
    return isinstance(case, unittest.loader._FailedTest)


def findings(everything, shards):
    runs = {"the unlabelled suite": everything} | {f"shard {name}": found for name, found in shards.items()}
    problems = {
        f"{run} failed to load {case._testMethodName}" for run, found in runs.items() for case in found if failed(case)
    }
    expected = {case.id() for case in everything if not failed(case)}
    placed = defaultdict(list)
    module = {}
    for name, found in shards.items():
        for case in found:
            if not failed(case):
                placed[case.id()].append(name)
                module[case.id()] = type(case).__module__
    for case in everything:
        if not failed(case) and case.id() not in placed:
            problems.add(f"{type(case).__module__} has tests in no shard")
    for identity, names in placed.items():
        if identity not in expected:
            problems.add(
                f"{module[identity]} runs in shard {', '.join(sorted(set(names)))} and not in the unlabelled suite"
            )
        elif len(names) > 1:
            problems.add(f"{module[identity]} has tests in more than one shard: {', '.join(sorted(names))}")
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


def discover(shards):
    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))
    os.environ["DJANGO_SETTINGS_MODULE"] = SETTINGS
    import django
    from django.conf import settings
    from django.test.utils import get_runner

    django.setup()
    runner = get_runner(settings)(verbosity=0, interactive=False)
    everything = list(cases(runner.build_suite()))
    return everything, {name: list(cases(runner.build_suite(labels))) for name, labels in shards.items()}


def main():
    parser = argparse.ArgumentParser(description="Hold the ordinary suite's CI shards to the unlabelled suite.")
    parser.add_argument("--labels", metavar="SHARD", help="print one shard's Django test labels and exit")
    arguments = parser.parse_args()
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

    modules = {type(case).__module__ for case in everything}
    counts = ", ".join(f"{name} {len(tests)}" for name, tests in found.items())
    print(f"Each of {len(everything)} ordinary tests in {len(modules)} modules runs in exactly one shard: {counts}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
