import argparse
import json
import os
import re
import subprocess
from pathlib import Path

NATIVE_INPUT_PREFIXES = ("mobile/", "packages/shared/")
NATIVE_INPUT_FILES = frozenset(
    (
        "package.json",
        "package-lock.json",
        "npm-shrinkwrap.json",
        ".npmrc",
        "dashboard/package.json",
        ".gitattributes",
        ".github/workflows/mobile-native.yml",
    )
)
UNREAD_BY_DJANGO = ("dashboard/", "docs/", "marketing/", "mobile/", "packages/")
UNREAD_FILES_BY_DJANGO = frozenset(
    (
        "AGENTS.md",
        "CONTRIBUTING.md",
        "scripts/ci-scope.py",
        "scripts/tests/test_ci_scope.py",
        "scripts/preflight.py",
        "scripts/tests/test_preflight.py",
        "scripts/check-pr-metadata.py",
        "scripts/tests/test_check_pr_metadata.py",
    )
)
DOCUMENT = re.compile(rb"docs/[\w./-]+\.md|(?:AGENTS|CONTRIBUTING)\.md")
JOBS = {"native": ("android", "ios"), "django": ("checks", "backend")}
MAC_JOBS = ("checks", "backend")
MAC_PRIMARY_JOBS = frozenset(("backend",))
CI_FLAGS = ("checks_required", "javascript_required", "tooling_required", "uploads", "chains", "audit")


def changes_checkouts(path):
    return path.rsplit("/", 1)[-1] == ".gitattributes"


def javascript_test_input(path):
    name = path.rsplit("/", 1)[-1]
    return path.startswith("packages/shared/tests/") or (
        path.startswith("mobile/src/")
        and path.endswith((".test.ts", ".test.tsx"))
        and not (name.startswith("Native") or "NativeComponent" in name)
    )


def classify_paths(scope, paths, *, named_documents=()):
    if scope not in ("native", "django"):
        raise ValueError("Unknown CI scope")
    try:
        if not isinstance(paths, (list, tuple)) or any(
            not isinstance(path, str)
            or not path
            or "\0" in path
            or any(part in ("", ".", "..") for part in path.split("/"))
            for path in paths
        ):
            raise ValueError
        for path in paths:
            path.encode("utf-8")
    except (TypeError, ValueError):
        return {
            "required": True,
            "reason": "Complete ancestor comparison unavailable",
            **(dict.fromkeys(CI_FLAGS, True) if scope == "django" else {}),
        }
    if scope == "native":
        required = any(
            changes_checkouts(path)
            or path in NATIVE_INPUT_FILES
            or (path.startswith(NATIVE_INPUT_PREFIXES) and not javascript_test_input(path))
            for path in paths
        )
        reason = "Mobile or native build input changed" if required else "No mobile or native build inputs changed"
    else:
        required = any(
            (not path.startswith(UNREAD_BY_DJANGO) and path not in UNREAD_FILES_BY_DJANGO)
            or path in named_documents
            or changes_checkouts(path)
            for path in paths
        )
        reason = "A path the Django jobs read changed" if required else "No backend runtime inputs changed"
    decision = {"required": required, "reason": reason, "changed_files": len(paths)}
    if scope == "django":
        unknown = any(
            changes_checkouts(path)
            or (
                not path.startswith((*UNREAD_BY_DJANGO, "backend/", "contracts/"))
                and path not in UNREAD_FILES_BY_DJANGO
                and path not in NATIVE_INPUT_FILES
                and path not in ("README.md", "LICENSE", "CODE_OF_CONDUCT.md", "SECURITY.md")
            )
            for path in paths
        )
        dependencies = any(
            path.rsplit("/", 1)[-1]
            in (
                "package.json",
                "package-lock.json",
                "npm-shrinkwrap.json",
                ".npmrc",
                "requirements.txt",
                "requirements-dev.txt",
            )
            and "/tests/" not in path
            for path in paths
        )
        common = unknown or any(
            changes_checkouts(path)
            or (
                "/tests/" not in path
                and "/migrations/" not in path
                and (
                    path.startswith(
                        ("backend/shared/db/", "backend/ledova_backend/", "backend/schema/", "backend/requirements")
                    )
                    or (path.startswith("backend/") and path.endswith(".sql"))
                )
            )
            or (
                path.startswith("backend/")
                and "/migrations/" in path
                and path.rsplit("/", 1)[-1] not in ("0001_baseline.py", "__init__.py")
            )
            for path in paths
        )
        decision.update(
            checks_required=bool(paths),
            javascript_required=unknown
            or any(
                path.startswith(("dashboard/", "marketing/", "mobile/", "packages/", "contracts/"))
                or (path in NATIVE_INPUT_FILES and not path.startswith(("scripts/", ".github/")))
                or (
                    path.startswith("backend/")
                    and "/tests/" not in path
                    and "/migrations/" not in path
                    and (
                        any(part in path for part in ("/views/", "/serializers/", "/models/"))
                        or path.rsplit("/", 1)[-1] in ("urls.py", "constants.py", "schema.py")
                        or path.startswith(("backend/shared/api/", "backend/schema/"))
                    )
                )
                for path in paths
            ),
            tooling_required=unknown
            or any(path.startswith(("scripts/", ".github/")) or path == "Makefile" for path in paths),
            uploads=common
            or any(
                (
                    "/tests/" not in path
                    and "/migrations/" not in path
                    and path.startswith(
                        (
                            "backend/shared/upload",
                            "backend/shared/storage.py",
                            "backend/shared/cache.py",
                            "backend/shared/services/orphaned_files.py",
                            "backend/shared/tasks/orphaned_files.py",
                            "backend/shared/views/uploads.py",
                            "backend/shared/views/files.py",
                            "backend/shared/api/exceptions.py",
                            "backend/authentication/throttles.py",
                            "backend/authentication/email.py",
                            "backend/authentication/views/user.py",
                            "backend/authentication/serializers/user.py",
                            "backend/authentication/serializers/fields.py",
                        )
                    )
                )
                or path.startswith(
                    (
                        "backend/shared/tests/redis_",
                        "backend/shared/tests/clamav_",
                        "backend/authentication/tests/redis_",
                    )
                )
                for path in paths
            ),
            chains=common
            or any(
                path.startswith("contracts/")
                or (
                    path.startswith("backend/")
                    and (
                        "chain" in path.rsplit("/", 1)[-1]
                        or (
                            "/tests/" not in path
                            and "/migrations/" not in path
                            and (
                                path.startswith(
                                    ("backend/blockchain/", "backend/wallets/", "backend/integrations/blockchain/")
                                )
                                or (
                                    path.startswith("backend/tokens/")
                                    and re.search(
                                        r"sign|execut|mirror|issue|issuance|capital|deploy|pause|swap|mint|settlement|"
                                        r"token_transfer|"
                                        r"share_token|yield_token|creation|inclusion|reconciliation|constants",
                                        path.rsplit("/", 1)[-1],
                                    )
                                )
                            )
                        )
                    )
                )
                for path in paths
            ),
            audit=unknown or dependencies,
        )
    return decision


def changed_paths(event_name, payload, repository):
    try:
        if event_name == "pull_request":
            request = payload["pull_request"]
            base = request["base"]["sha"]
            head = request["head"]["sha"]
        else:
            base = payload["before"]
            head = payload["after"]
        if not all(isinstance(value, str) and re.fullmatch(r"[0-9a-f]{40}", value) for value in (base, head)):
            raise ValueError
        subprocess.run(
            ["git", "merge-base", "--is-ancestor", base, head],
            cwd=repository,
            check=True,
            capture_output=True,
            timeout=30,
        )
        diff = subprocess.run(
            ["git", "diff", "--no-ext-diff", "--no-renames", "--name-only", "-z", base, head, "--"],
            cwd=repository,
            check=True,
            capture_output=True,
            timeout=30,
        ).stdout
        if diff and not diff.endswith(b"\0"):
            raise ValueError
        paths = diff[:-1].decode("utf-8").split("\0") if diff else []
        if any(not path or any(part in ("", ".", "..") for part in path.split("/")) for path in paths):
            raise ValueError
    except (KeyError, TypeError, ValueError, OSError, subprocess.SubprocessError):
        return None
    return paths


def native_scope(event_name, payload, repository):
    if event_name not in ("pull_request", "push"):
        return {"required": True, "reason": "Unconditional native run"}
    return classify_paths("native", changed_paths(event_name, payload, repository))


def documents_named_in(backend):
    return {
        name.decode() for path in backend.rglob("*") if path.is_file() for name in DOCUMENT.findall(path.read_bytes())
    }


def django_scope(event_name, payload, repository):
    paths = changed_paths(event_name, payload, repository) if event_name in ("pull_request", "push") else None
    named = documents_named_in(repository / "backend") if paths is not None else ()
    decision = classify_paths("django", paths, named_documents=named)
    if event_name != "pull_request":
        decision.update(required=True, reason="Every push and manual run tests Django")
    return decision


SCOPES = {"native": native_scope, "django": django_scope}


def django_runners(environment):
    run_id = environment.get("GITHUB_RUN_ID", "")
    attempt = environment.get("GITHUB_RUN_ATTEMPT", "")
    trusted = (
        environment.get("GITHUB_EVENT_NAME") in ("push", "workflow_dispatch")
        and environment.get("GITHUB_REPOSITORY") == "Ledova/ledova"
        and environment.get("GITHUB_REF") == "refs/heads/main"
        and re.fullmatch(r"[1-9][0-9]*", run_id)
        and re.fullmatch(r"[1-9][0-9]*", attempt)
    )
    run_label = f"ledova-main-{run_id}-{attempt}"
    runners = {}
    for job in MAC_JOBS:
        group = "ledova-mac-linux-arm64-pilot" if job in MAC_PRIMARY_JOBS else "ledova-mac-linux-arm64-ordinary-pilot"
        runners[job] = (
            {"group": group, "labels": [group, run_label, f"ledova-job-{job}"]} if trusted else "ubuntu-latest"
        )
    return {"runners": runners}


def verdict(needs, jobs):
    try:
        routing = needs["scope"]
        if routing["result"] != "success":
            return False
        flags = ("required", *CI_FLAGS) if "checks" in jobs else ("required",)
        if any(routing["outputs"][flag] not in ("true", "false") for flag in flags):
            return False
        return all(
            needs[job]["result"]
            == (
                "success"
                if routing["outputs"]["checks_required" if job == "checks" else "required"] == "true"
                else "skipped"
            )
            for job in jobs
        )
    except (KeyError, TypeError):
        return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("route", "verdict"))
    parser.add_argument("scope", choices=sorted(SCOPES))
    parser.add_argument("--event")
    parser.add_argument("--event-file")
    parser.add_argument("--local-preview", action="store_true")
    parser.add_argument("--repository", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()
    if args.command == "verdict":
        try:
            needs = json.loads(os.environ.get("JOB_RESULTS", "null"))
        except ValueError:
            needs = None
        passed = verdict(needs, JOBS[args.scope])
        print(f"{args.scope} CI {'requirements satisfied' if passed else 'routing or jobs did not succeed'}")
        return 0 if passed else 1
    environment = {} if args.local_preview else os.environ
    try:
        payload = json.loads(Path(args.event_file or environment.get("GITHUB_EVENT_PATH")).read_text())
    except (TypeError, ValueError, OSError):
        payload = None
    event = (
        args.event
        if args.event is not None
        else ("pull_request" if args.local_preview else environment.get("GITHUB_EVENT_NAME"))
    )
    decision = SCOPES[args.scope](event, payload, args.repository)
    runners = django_runners(environment if args.event is None else {}) if args.scope == "django" else {}
    decision.update(runners)
    print(json.dumps(decision))
    output = environment.get("GITHUB_OUTPUT")
    if output:
        with Path(output).open("a") as stream:
            for name, value in decision.items():
                if isinstance(value, bool):
                    stream.write(f"{name}={str(value).lower()}\n")
            for name, value in runners.items():
                stream.write(f"{name}={json.dumps(value, separators=(',', ':'))}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
