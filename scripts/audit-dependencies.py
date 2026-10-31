import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEVERITIES = {"info", "low", "moderate", "high", "critical"}
MOBILE_ACCEPTED = {
    ("brace-expansion", "GHSA-6j4f-fj2g-mc7p"),
    ("brace-expansion", "GHSA-q2hr-2g5m-vwhr"),
    ("brace-expansion", "GHSA-qhr7-859c-m2p7"),
    ("deepmerge", "GHSA-gcqx-w48m-w2h4"),
    ("image-size", "GHSA-5p2g-fcmc-qvqq"),
    ("image-size", "GHSA-w3rx-r6r6-pgpr"),
    ("minimatch", "GHSA-g3hv-75wg-m249"),
    ("postcss", "GHSA-6g55-p6wh-862q"),
    ("postcss", "GHSA-fxqj-rqcc-2cmp"),
    ("postcss", "GHSA-qx2v-qp2m-jg93"),
    ("postcss", "GHSA-r28c-9q8g-f849"),
    ("uuid", "GHSA-w5hq-g745-h8pq"),
}
BACKEND_ACCEPTED = {("pytest", "PYSEC-2026-1845")}


class AuditFailure(RuntimeError):
    pass


def require(condition, message="Malformed or incomplete dependency audit report"):
    if not condition:
        raise AuditFailure(message)


def npm_findings(report, accepted):
    require(report["auditReportVersion"] == 2 and "error" not in report)
    vulnerabilities = report["vulnerabilities"]
    counts = report["metadata"]["vulnerabilities"]
    total = report["metadata"]["dependencies"]["total"]
    require(type(total) is int and total > 0)
    require(isinstance(vulnerabilities, dict) and isinstance(counts, dict))
    require(
        all(
            type(counts[level]) is int and counts[level] >= 0
            for level in SEVERITIES | {"total"}
        )
    )
    require(counts["critical"] == 0, "Critical npm advisory refused")
    findings = set()
    references = {}
    direct = set()
    for name, item in vulnerabilities.items():
        require(item["name"] == name and item["severity"] in SEVERITIES)
        require(
            item["severity"] != "critical", f"Critical npm advisory refused: {name}"
        )
        require(isinstance(item["via"], list) and item["via"])
        references[name] = set()
        for advisory in item["via"]:
            if isinstance(advisory, str):
                require(advisory in vulnerabilities)
                references[name].add(advisory)
                continue
            require(isinstance(advisory, dict) and advisory["name"] == name)
            require(advisory["severity"] in SEVERITIES)
            require(
                advisory["severity"] != "critical",
                f"Critical npm advisory refused: {name}",
            )
            match = re.fullmatch(
                r"https://github.com/advisories/(GHSA-[23456789cfghjmpqrvwx]{4}(?:-[23456789cfghjmpqrvwx]{4}){2})",
                advisory["url"],
            )
            require(match is not None)
            finding = (name, match[1])
            require(finding in accepted, f"Unaccepted npm advisory: {name} {match[1]}")
            findings.add(finding)
            direct.add(name)
    actual = Counter(item["severity"] for item in vulnerabilities.values())
    require(all(counts[level] == actual[level] for level in SEVERITIES))
    require(counts["total"] == len(vulnerabilities))
    resolved = set(direct)
    while True:
        added = {
            name for name, targets in references.items() if targets & resolved
        } - resolved
        if not added:
            break
        resolved.update(added)
    require(resolved == set(vulnerabilities))
    return findings


def pip_findings(report):
    require("error" not in report)
    dependencies = report["dependencies"]
    require(isinstance(dependencies, list) and dependencies)
    findings = set()
    for dependency in dependencies:
        require(isinstance(dependency["name"], str) and dependency["name"])
        require(isinstance(dependency["version"], str) and dependency["version"])
        require(
            "skip_reason" not in dependency and isinstance(dependency["vulns"], list)
        )
        for advisory in dependency["vulns"]:
            finding = (dependency["name"], advisory["id"])
            require(
                finding in BACKEND_ACCEPTED,
                f"Unaccepted Python advisory: {finding[0]} {finding[1]}",
            )
            findings.add(finding)
    return findings


def audit(arguments, cwd, validator, name):
    result = subprocess.run(
        arguments, cwd=cwd, capture_output=True, text=True, timeout=300
    )
    require(
        result.returncode in (0, 1),
        f"Dependency audit tool failed: {name} (exit {result.returncode})",
    )
    findings = validator(json.loads(result.stdout))
    require(
        result.returncode == bool(findings),
        f"Dependency audit status disagrees with its report: {name}",
    )
    print(f"Dependency audit {name}: {len(findings)} accepted advisories", flush=True)
    for package, identifier in sorted(findings):
        print(f"  {package} {identifier}", flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Refuse dependency advisories outside fixed accepted exceptions"
    )
    parser.add_argument("kind", choices=("node", "backend"))
    parser.add_argument("--npm", default="npm")
    args = parser.parse_args(argv)
    try:
        if args.kind == "node":
            for name in ("root", "site", "contracts", "mobile"):
                accepted = MOBILE_ACCEPTED if name == "mobile" else set()
                audit(
                    [args.npm, "audit", "--omit=dev", "--audit-level=low", "--json"],
                    ROOT if name == "root" else ROOT / name,
                    lambda report: npm_findings(report, accepted),
                    name,
                )
        else:
            audit(
                [
                    sys.executable,
                    "-m",
                    "pip_audit",
                    "--strict",
                    "-r",
                    str(ROOT / "backend/requirements.txt"),
                    "--format=json",
                    "--progress-spinner=off",
                ],
                ROOT,
                pip_findings,
                "backend",
            )
        return 0
    except AuditFailure as error:
        print(str(error), file=sys.stderr)
    except (OSError, subprocess.SubprocessError):
        print("Dependency audit tool could not complete", file=sys.stderr)
    except (KeyError, TypeError, ValueError):
        print("Malformed or missing dependency audit output", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
