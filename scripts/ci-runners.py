import argparse
import json
import os
import re
from pathlib import Path


def runners(environment):
    run_id = environment.get("GITHUB_RUN_ID", "")
    attempt = environment.get("GITHUB_RUN_ATTEMPT", "")
    trusted = (
        environment.get("GITHUB_EVENT_NAME") in ("push", "workflow_dispatch")
        and environment.get("GITHUB_REPOSITORY") == "Ledova/ledova"
        and environment.get("GITHUB_REF") == "refs/heads/main"
        and re.fullmatch(r"[1-9][0-9]*", run_id)
        and re.fullmatch(r"[1-9][0-9]*", attempt)
    )
    chosen = {}
    for job, group in (
        ("checks", "ledova-mac-linux-arm64-ordinary-pilot"),
        ("backend", "ledova-mac-linux-arm64-pilot"),
    ):
        chosen[job] = (
            {"group": group, "labels": [group, f"ledova-main-{run_id}-{attempt}", f"ledova-job-{job}"]}
            if trusted
            else "ubuntu-latest"
        )
    return chosen


def verdict(needs):
    return (
        isinstance(needs, dict)
        and set(needs) == {"scope", "checks", "backend"}
        and all(isinstance(job, dict) and job.get("result") == "success" for job in needs.values())
    )


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=("select", "verdict"))
    args = parser.parse_args()
    if args.command == "verdict":
        try:
            needs = json.loads(os.environ.get("JOB_RESULTS", "null"))
        except ValueError:
            needs = None
        passed = verdict(needs)
        print("CI jobs succeeded" if passed else "CI jobs did not all succeed")
        return 0 if passed else 1
    chosen = runners(os.environ)
    encoded = json.dumps(chosen, separators=(",", ":"))
    print(encoded)
    if output := os.environ.get("GITHUB_OUTPUT"):
        with Path(output).open("a") as stream:
            stream.write(f"runners={encoded}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
