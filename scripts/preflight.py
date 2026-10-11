import argparse
import importlib.util
import os
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def validate_wording(args):
    spec = importlib.util.spec_from_file_location("preflight_metadata", ROOT / "scripts/check-pr-metadata.py")
    metadata = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(metadata)
    if args.title_file is not None:
        issue = metadata.check_local(args.title_file, args.body_file, args.base, ROOT)
        print(f"Local PR wording refers to issue #{issue}; online issue verification stays in CI.", flush=True)
        return
    with tempfile.TemporaryDirectory(prefix="ledova-preflight-wording-") as directory:
        title = Path(directory) / "title.txt"
        body = Path(directory) / "body.md"
        for path, field in ((title, "%s"), (body, "%b")):
            path.write_bytes(subprocess.check_output(["git", "log", "-1", f"--format={field}"], cwd=ROOT, timeout=30))
        heading = metadata.TITLE.fullmatch(title.read_text().strip())
        content = body.read_text()
        first_line = next((line for line in content.splitlines() if line.strip()), "")
        if heading and not metadata.REFERENCE.fullmatch(first_line):
            body.write_text(f"Refs #{heading[2]}\n\n{content}")
        issue = metadata.check_local(title, body, args.base, ROOT)
    print(
        f"HEAD-derived draft refers to issue #{issue}; actual PR wording and online issue verification stay in CI.",
        flush=True,
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="Run the full CI checks except manual native builds")
    parser.add_argument("--base", default=os.environ.get("BASE", "origin/main"))
    parser.add_argument("--title-file", type=Path, default=os.environ.get("PR_TITLE_FILE") or None)
    parser.add_argument("--body-file", type=Path, default=os.environ.get("PR_BODY_FILE") or None)
    args = parser.parse_args(argv)
    if (args.title_file is None) != (args.body_file is None):
        parser.error("Supply both PR title and body files")
    try:
        validate_wording(args)
    except (ValueError, UnicodeError, OSError, subprocess.SubprocessError) as error:
        print(f"Local PR wording: {error}", file=sys.stderr)
        return 1
    environment = {key: value for key, value in os.environ.items() if not key.startswith("GITHUB_")}
    return subprocess.run(
        ["make", "ci-checks", "backend-test", f"PYTHON={sys.executable}"], cwd=ROOT, env=environment
    ).returncode


if __name__ == "__main__":
    raise SystemExit(main())
