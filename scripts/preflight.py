import argparse
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GATES = (
    "check-comments",
    "check-layers",
    "check-type-check",
    "check-logging",
    "check-connection-binding",
    "check-schema-responses",
    "check-test-shadowing",
    "check-error-bodies",
    "check-docs",
)


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def git(repository, *arguments):
    return subprocess.run(
        ["git", *arguments],
        cwd=repository,
        capture_output=True,
        check=True,
        timeout=30,
    ).stdout


def paths_from(raw):
    if raw and not raw.endswith(b"\0"):
        raise ValueError("Git returned an incomplete path inventory")
    paths = raw[:-1].decode("utf-8").split("\0") if raw else []
    if any(not path or any(part in ("", ".", "..") for part in path.split("/")) for path in paths):
        raise ValueError("Git returned an invalid path inventory")
    return paths


def working_changes(repository, base):
    actual_root = Path(git(repository, "rev-parse", "--show-toplevel").decode("utf-8").strip()).resolve()
    if actual_root != repository.resolve():
        raise ValueError("Run preflight from the repository root")
    if git(repository, "rev-parse", "--is-shallow-repository").strip() != b"false":
        raise ValueError("Fetch complete history before preflight")
    resolved = (
        git(
            repository,
            "rev-parse",
            "--verify",
            "--end-of-options",
            f"{base}^{{commit}}",
        )
        .decode()
        .strip()
    )
    head = git(repository, "rev-parse", "--verify", "HEAD^{commit}").decode().strip()
    git(repository, "merge-base", "--is-ancestor", resolved, head)
    changed = paths_from(
        git(
            repository,
            "diff",
            "--no-ext-diff",
            "--no-renames",
            "--name-only",
            "-z",
            resolved,
            "--",
        )
    )
    untracked = paths_from(git(repository, "ls-files", "--others", "--exclude-standard", "-z"))
    return resolved, head, sorted(set(changed + untracked))


def plan(repository, base, scope):
    gap = None
    resolved = None
    head = None
    try:
        resolved, head, paths = working_changes(repository, base)
    except (ValueError, UnicodeError, OSError, subprocess.SubprocessError):
        paths = None
        gap = "Complete ancestor and working-tree comparison unavailable; fetch the base and complete history"
    named = scope.documents_named_in(repository / "backend")
    decisions = {name: scope.classify_paths(name, paths, named_documents=named) for name in ("django", "native")}
    commands = [["make", *GATES]]
    if decisions["django"]["tooling_required"]:
        commands.append(["make", "test-gates"])
    if decisions["django"]["javascript_required"]:
        commands.extend(
            [
                [
                    "make",
                    "check-self-imports",
                    "check-api-types",
                    "check-client-operations",
                    "check-mobile-test-awaits",
                ],
                ["npm", "run", "typecheck"],
                ["npm", "--prefix", "mobile", "run", "check:resolution"],
                ["make", "lint"],
            ]
        )
    if decisions["django"]["required"]:
        commands.append(["make", "-C", "backend", "lint", "check"])
    return {
        "base": resolved,
        "head": head,
        "changed_files": len(paths) if paths is not None else None,
        "gap": gap,
        "scopes": decisions,
        "ci_jobs": [
            "Determine CI scope",
            "Django verdict",
            "Determine native build scope",
            "Mobile native checks",
            "PR type and issue",
        ]
        + (["Source and client checks"] if decisions["django"]["checks_required"] else [])
        + (["Backend verification"] if decisions["django"]["required"] else [])
        + (
            [
                "Android Release and native probe",
                "iOS ad hoc simulator Release and native probe",
            ]
            if decisions["native"]["required"]
            else []
        ),
        "commands": commands,
    }


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default=os.environ.get("BASE", "origin/main"))
    parser.add_argument("--repository-path", type=Path, default=ROOT)
    parser.add_argument("--title-file", type=Path, default=os.environ.get("PR_TITLE_FILE") or None)
    parser.add_argument("--body-file", type=Path, default=os.environ.get("PR_BODY_FILE") or None)
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args(argv)
    if (args.title_file is None) != (args.body_file is None):
        parser.error("Supply both PR title and body files")
    repository = args.repository_path.resolve()
    scope = module("preflight_ci_scope", ROOT / "scripts" / "ci-scope.py")
    chosen = plan(repository, args.base, scope)
    print(json.dumps(chosen, indent=2), flush=True)
    if chosen["scopes"]["native"]["required"]:
        print(
            "Native release/probe checks remain required in CI; preflight does not run the native builds.",
            flush=True,
        )
    if chosen["gap"]:
        print(chosen["gap"], file=sys.stderr)
        return 1
    if args.preview:
        return 0
    if args.title_file is not None:
        metadata = module("preflight_pr_metadata", ROOT / "scripts" / "check-pr-metadata.py")
        try:
            issue = metadata.check_local(args.title_file, args.body_file, chosen["base"], repository)
        except (ValueError, UnicodeError, OSError, subprocess.SubprocessError) as error:
            print(f"Local PR wording: {error}", file=sys.stderr)
            return 1
        print(f"Local PR wording refers to issue #{issue}; online issue verification stays in CI.")
    if chosen["scopes"]["django"]["required"]:
        print(
            "Preflight checks backend source and configuration. Run focused regression tests for the change; CI verifies the relevant complete suite."
        )
    environment = {key: value for key, value in os.environ.items() if not key.startswith("GITHUB_")}
    for command in chosen["commands"]:
        arguments = command + ([f"PYTHON={sys.executable}"] if command[0] == "make" else [])
        print("Preflight: " + " ".join(command), flush=True)
        result = subprocess.run(arguments, cwd=repository, env=environment)
        if result.returncode:
            return result.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
