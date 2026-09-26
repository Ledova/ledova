#!/usr/bin/env python3
import argparse
import contextlib
import fnmatch
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
WORKERS = "4"


def cases(suite):
    for item in suite:
        if isinstance(item, unittest.TestSuite):
            yield from cases(item)
        else:
            yield item


def record(case):
    made_by_the_loader = type(case).__module__ == "unittest.loader"
    return {
        "id": case.id(),
        "module": case._testMethodName if made_by_the_loader else type(case).__module__,
        "failed": isinstance(case, unittest.loader._FailedTest),
    }


def pattern_findings(shards):
    if not isinstance(shards, dict) or not shards:
        return [f"{SHARDS.relative_to(ROOT)} names no shards"]
    return [
        f"shard {name} does not list its test name patterns, each a string with no whitespace"
        for name, patterns in shards.items()
        if not isinstance(patterns, list)
        or not patterns
        or not all(isinstance(pattern, str) and pattern.split() == [pattern] for pattern in patterns)
    ]


def unused_pattern_findings(shards, found):
    return [
        f"pattern {pattern} in shard {name} selects no test"
        for name, patterns in shards.items()
        for pattern in patterns
        if not any(
            fnmatch.fnmatchcase(case["id"], pattern if "*" in pattern else f"*{pattern}*") for case in found[name]
        )
    ]


def findings(everything, shards):
    runs = {"the unlabelled suite": everything} | {f"shard {name}": found for name, found in shards.items()}
    problems = {
        f"{run} failed to load {case['module']}" for run, found in runs.items() for case in found if case["failed"]
    }
    expected = Counter(case["id"] for case in everything if not case["failed"])
    problems |= {
        f"{identity} is defined by more than one test class" for identity, times in expected.items() if times > 1
    }
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


def in_this_interpreter(patterns):
    sys.path.insert(0, os.getcwd())
    with contextlib.redirect_stdout(sys.stderr):
        import django
        from django.conf import settings
        from django.test.utils import get_runner

        django.setup()
        runner = get_runner(settings)(verbosity=0, interactive=False, test_name_patterns=patterns)
        runner.setup_test_environment()
        return [record(case) for case in cases(runner.build_suite())]


def in_a_fresh_interpreter(patterns, backend):
    child = subprocess.run(
        [sys.executable, str(Path(__file__).resolve()), "--discover", json.dumps(patterns)],
        cwd=backend,
        env=os.environ | {"DJANGO_SETTINGS_MODULE": SETTINGS},
        stdout=subprocess.PIPE,
        text=True,
        check=True,
    )
    return json.loads(child.stdout)


def discover(shards, backend=BACKEND):
    everything = in_a_fresh_interpreter([], backend)
    return everything, {name: in_a_fresh_interpreter(patterns, backend) for name, patterns in shards.items()}


def run(patterns):
    os.chdir(BACKEND)
    selection = [argument for pattern in patterns for argument in ("-k", pattern)]
    command = ["manage.py", "test", f"--settings={SETTINGS}", "--parallel", WORKERS, "--noinput", *selection]
    return os.execv(sys.executable, [sys.executable, *command])


def main():
    parser = argparse.ArgumentParser(description="Hold the ordinary suite's CI shards to the unlabelled suite.")
    parser.add_argument("--run", metavar="SHARD", help="run one shard's suite as its CI job does")
    parser.add_argument("--discover", type=json.loads, help=argparse.SUPPRESS)
    arguments = parser.parse_args()

    if arguments.discover is not None:
        print(json.dumps(in_this_interpreter(arguments.discover)))
        return 0

    shards = json.loads(SHARDS.read_text(encoding="utf-8"))

    if arguments.run is not None:
        patterns = shards.get(arguments.run) if isinstance(shards, dict) else None
        if pattern_findings({arguments.run: patterns}):
            print(f"{SHARDS.relative_to(ROOT)} has no test name patterns for shard {arguments.run}", file=sys.stderr)
            return 1
        return run(patterns)

    problems = pattern_findings(shards)
    if not problems:
        everything, found = discover(shards)
        problems = matrix_findings(yaml.safe_load(WORKFLOW.read_text(encoding="utf-8")), shards)
        problems += findings(everything, found) + unused_pattern_findings(shards, found)

    if problems:
        print(f"The ordinary suite's shards fail their gate ({len(problems)}):\n", file=sys.stderr)
        for problem in problems:
            print(f"  {problem}", file=sys.stderr)
        print(
            f"\nGive each shard in {SHARDS.relative_to(ROOT)} test name patterns that together select each test id"
            f" exactly once, give each test its own id, and keep the {JOB} matrix to exactly those shard names, with"
            " no include or exclude.\n\n"
            'The rule is in docs/development/gates.md, "The ordinary shard gate".',
            file=sys.stderr,
        )
        return 1

    modules = {case["module"] for case in everything}
    counts = ", ".join(f"{name} {len(tests)}" for name, tests in found.items())
    print(f"Each of {len(everything)} ordinary test ids in {len(modules)} modules is in exactly one shard: {counts}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
