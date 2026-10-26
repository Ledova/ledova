import argparse
import json
import os
from pathlib import Path


def runners():
    return {"checks": "ubuntu-latest", "backend": "ubuntu-latest"}


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
    chosen = runners()
    encoded = json.dumps(chosen, separators=(",", ":"))
    print(encoded)
    if output := os.environ.get("GITHUB_OUTPUT"):
        with Path(output).open("a") as stream:
            stream.write(f"runners={encoded}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
