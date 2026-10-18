#!/usr/bin/env python3

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

DOCUMENTS = ("README.md", "CONTRIBUTING.md", "SECURITY.md", "CODE_OF_CONDUCT.md", "site/README.md")
DOC_DIR = "docs"

BACKEND = "backend"
OPERATIONS = "docs/operations/jobs-and-storage.md"
GATES = "docs/engineering/gates.md"
SCRIPT_GLOB = "check-*"

PERIODIC = re.compile(r"@app\.periodic\(\s*cron\s*=\s*[\"']([^\"']+)[\"']")
# A coroutine is a task too: Procrastinate runs an `async def` decorated with
# @app.periodic like any other, so a pattern that only knew `def` would let one
# go undocumented while this gate reported green.
DEFINITION = re.compile(r"^\s*(?:async\s+)?def\s+(\w+)")
LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)\)")
HEADING = re.compile(r"^#{1,6}\s+(.*?)\s*$")
BACKTICKED = re.compile(r"`([^`\n]+)`")
INLINE_CODE = re.compile(r"(?<!`)(`+)(?!`)(.*?)(?<!`)\1(?!`)", re.DOTALL)
REPOSITORY_FOLDERS = (
    "backend/", "contracts/", "dashboard/", "docs/",
    "mobile/", "packages/", "scripts/", "site/",
)

SCHEDULE_HEADING = "## Schedule"
GATE_TABLE_HEADING = "## Every gate, and where its rule is written"

# A script that is deliberately not a gate: it is tooling the gates and the
# Makefile call, not a rule anything is held to, so engineering/gates.md has no section
# for it and should not grow one.
NOT_A_GATE = {
    "check-port-free": "Makefile plumbing: refuses to start the chain test when its port is taken.",
}


def documented_files() -> list[Path]:
    files = [REPO_ROOT / name for name in DOCUMENTS]
    files += sorted((REPO_ROOT / DOC_DIR).rglob("*.md"))
    return [path for path in files if path.exists()]


def slug(heading: str) -> str:
    text = heading.strip().lower()
    text = re.sub(r"`([^`]*)`", r"\1", text)
    text = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"[^\w\s-]", "", text)
    # Each space becomes a hyphen, rather than each run of them. "Phase 2 -
    # Eligibility" loses its dash and keeps both spaces, so the anchor GitHub
    # serves carries two hyphens; collapsing whitespace here would report every
    # such heading as a dead anchor while the rendered page is fine.
    return text.strip().replace(" ", "-")


def anchors_of(path: Path) -> set[str]:
    found = set()
    for line in path.read_text(encoding="utf-8").splitlines():
        heading = HEADING.match(line)
        if heading:
            found.add(slug(heading.group(1)))
    return found


def dead_links(files: list[Path]) -> list[str]:
    # Both sides of the comparison are resolved paths. A link's target has to be
    # resolved to be found, so the documents it is looked up among are keyed the
    # same way. Keyed by the path each was found at, they never matched in a tree
    # reached through a symlink - macOS keeps temporary directories under /var,
    # which is a link to /private/var - and every anchor into another document
    # went unchecked there while the gate reported nothing.
    anchors = {path.resolve(): anchors_of(path) for path in files}
    findings = []
    for path in files:
        relative = path.relative_to(REPO_ROOT)
        for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for target in LINK.findall(line):
                if target.startswith(("http://", "https://", "mailto:")):
                    continue
                if target.startswith("#"):
                    if target[1:] not in anchors[path.resolve()]:
                        findings.append(f"{relative}:{line_number} dead anchor {target}")
                    continue
                location, _, fragment = target.partition("#")
                resolved = (path.parent / location).resolve()
                if not resolved.exists():
                    findings.append(f"{relative}:{line_number} missing file {location}")
                elif fragment and resolved in anchors and fragment not in anchors[resolved]:
                    findings.append(f"{relative}:{line_number} dead anchor {target}")
    return findings


def unfenced_text(text: str) -> str:
    lines = []
    fence = None
    for line in text.splitlines(keepends=True):
        if fence:
            if re.fullmatch(rf" {{0,3}}{re.escape(fence[0])}{{{fence[1]},}}\s*", line):
                fence = None
            lines.append("\n" if line.endswith("\n") else "")
            continue
        opening = re.match(r" {0,3}(`{3,}|~{3,})(.*)", line)
        if opening and not (opening.group(1)[0] == "`" and "`" in opening.group(2)):
            fence = (opening.group(1)[0], len(opening.group(1)))
            lines.append("\n" if line.endswith("\n") else "")
        else:
            lines.append(line)
    return "".join(lines)


def cited_paths(files: list[Path]) -> list[tuple[Path, int, str]]:
    paths = []
    for path in files:
        text = unfenced_text(path.read_text(encoding="utf-8"))
        for quoted in INLINE_CODE.finditer(text):
            value = quoted.group(2).replace("\n", " ")
            if value.startswith(" ") and value.endswith(" ") and value.strip(" "):
                value = value[1:-1]
            if value.startswith(REPOSITORY_FOLDERS):
                paths.append((path, text.count("\n", 0, quoted.start()) + 1, value))
    return paths


def cited_path_findings(files: list[Path]) -> list[str]:
    findings = []
    root = REPO_ROOT.resolve()
    for path, line_number, value in cited_paths(files):
        relative = path.relative_to(REPO_ROOT)
        resolved = (REPO_ROOT / value).resolve()
        if not resolved.is_relative_to(root):
            findings.append(f"{relative}:{line_number} cited path leaves the repository {value}")
        elif not resolved.exists():
            findings.append(f"{relative}:{line_number} missing cited path {value}")
    return findings


def periodic_tasks() -> dict[str, str]:
    tasks = {}
    for path in sorted((REPO_ROOT / BACKEND).rglob("*.py")):
        if "tests" in path.parts or "migrations" in path.parts:
            continue
        lines = path.read_text(encoding="utf-8").splitlines()
        for index, line in enumerate(lines):
            cron = PERIODIC.search(line)
            if not cron:
                continue
            for following in lines[index : index + 8]:
                name = DEFINITION.match(following)
                if name:
                    tasks[name.group(1)] = cron.group(1)
                    break
    return tasks


def scheduled_in_operations() -> set[str]:
    text = (REPO_ROOT / OPERATIONS).read_text(encoding="utf-8")
    start = text.find(SCHEDULE_HEADING)
    if start == -1:
        return set()
    named = set()
    for line in text[start:].splitlines():
        if not line.startswith("|"):
            if named:
                break
            continue
        for quoted in BACKTICKED.findall(line):
            named.add(quoted.strip().split(".")[-1].strip("`"))
    return named


def periodic_findings() -> list[str]:
    actual = periodic_tasks()
    documented = scheduled_in_operations()
    findings = []
    for name in sorted(set(actual) - documented):
        findings.append(f"{OPERATIONS}: periodic task `{name}` ({actual[name]}) is in no schedule row")
    for name in sorted(documented - set(actual)):
        findings.append(f"{OPERATIONS}: schedule names `{name}`, which is not an @app.periodic task")
    return findings


def gate_scripts() -> set[str]:
    found = set()
    for path in sorted((REPO_ROOT / "scripts").glob(SCRIPT_GLOB)):
        if path.is_file() and path.suffix in {".py", ".mjs"}:
            found.add(path.stem)
    return found


def gates_documented() -> set[str]:
    # The index table is the list, not the prose around it. Reading every
    # check-* name in the file instead was the first shape of this rule, and it
    # could not tell a script from `make check-mobile-test-awaits`, which is a
    # Makefile target, or from the route `batch-check-balances` wrapped so that
    # its second half opened a line. The table is what engineering/gates.md declares
    # this rule holds it to, so the table is what it reads.
    text = (REPO_ROOT / GATES).read_text(encoding="utf-8")
    start = text.find(GATE_TABLE_HEADING)
    if start == -1:
        return set()
    named = set()
    for line in text[start:].splitlines():
        if not line.startswith("|"):
            if named:
                break
            continue
        first = line.strip("|").split("|")[0].strip().strip("`")
        if first.startswith("check-"):
            named.add(Path(first).stem)
    return named


def gate_findings() -> list[str]:
    scripts = gate_scripts()
    documented = gates_documented()
    findings = []
    for name in sorted(scripts - documented - set(NOT_A_GATE)):
        findings.append(f"{GATES}: scripts/{name} is a gate with no section")
    for name in sorted(documented - scripts):
        if name in NOT_A_GATE:
            continue
        findings.append(f"{GATES}: names scripts/{name}, which does not exist")
    for name in sorted(set(NOT_A_GATE) & documented):
        findings.append(
            f"{GATES}: documents scripts/{name}, which NOT_A_GATE says is not a gate"
            f" - {NOT_A_GATE[name]} Remove it from one list or the other."
        )
    return findings


def scan() -> tuple[list[str], int]:
    files = documented_files()
    findings = dead_links(files) + cited_path_findings(files) + periodic_findings() + gate_findings()
    return findings, len(files)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Check documentation links, cited repository paths, periodic tasks and the gate inventory."
    )
    parser.add_argument("--explain", action="store_true")
    arguments = parser.parse_args()

    if arguments.explain:
        tasks = periodic_tasks()
        print(f"Documents scanned ({len(documented_files())}):")
        for path in documented_files():
            print(f"  {path.relative_to(REPO_ROOT)}")
        paths = cited_paths(documented_files())
        print(f"\nCited repository paths ({len(paths)}):")
        for path, line_number, value in paths:
            print(f"  {path.relative_to(REPO_ROOT)}:{line_number} {value}")
        print(f"\nPeriodic tasks in {BACKEND}/ ({len(tasks)}):")
        for name, cron in sorted(tasks.items(), key=lambda item: item[1]):
            print(f"  {cron:15} {name}")
        print(f"\nGate scripts ({len(gate_scripts())}): {', '.join(sorted(gate_scripts()))}")
        print(f"Not a gate ({len(NOT_A_GATE)}): {', '.join(sorted(NOT_A_GATE))}")
        return 0

    findings, scanned = scan()

    if findings:
        print(f"The documentation disagrees with the tree ({len(findings)}):\n", file=sys.stderr)
        for finding in findings:
            print(f"  {finding}", file=sys.stderr)
        print(
            "\nEach of these is a thing that exists and is undocumented, or is documented"
            "\nand does not exist. Fix the document, or the tree, or say which list it"
            "\nbelongs on - do not silence the finding."
            '\n\nThe rule and its scope are in docs/engineering/gates.md, "The documentation gate".',
            file=sys.stderr,
        )
        return 1

    print(
        f"Documentation agrees with the tree: {scanned} documents, "
        f"{len(cited_paths(documented_files()))} cited repository paths, "
        f"{len(periodic_tasks())} periodic tasks, {len(gate_scripts() - set(NOT_A_GATE))} gate scripts."
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
