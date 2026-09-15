import argparse
import json
import re
import subprocess
import sys

CHANGE_TYPES = ("feat", "fix", "refactor", "perf", "docs", "test", "build", "ci", "deps", "chore", "revert")
TITLE = re.compile(rf"({'|'.join(CHANGE_TYPES)})\(#([1-9][0-9]*)\): (\S(?:[^\r\n]*\S)?)")
REFERENCE = re.compile(r"(Refs|Closes) #([1-9][0-9]*)")
CLOSING = re.compile(
    r"\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+"
    r"(#\d+|[\w.-]+/[\w.-]+#\d+|https://github\.com/[\w.-]+/[\w.-]+/issues/\d+)",
    re.IGNORECASE,
)


def owning_issue(title, body, closing=(), commits=()):
    match = TITLE.fullmatch(title)
    if not match:
        raise ValueError("Use a title like fix(#123): describe the change. Types: " + ", ".join(CHANGE_TYPES))
    first_line = next((line for line in (body or "").splitlines() if line.strip()), "")
    reference = REFERENCE.fullmatch(first_line)
    if not reference or reference[2] != match[2]:
        raise ValueError(f"Start the body with Refs #{match[2]} or Closes #{match[2]} on its own line.")
    if reference[1] == "Refs" and closing:
        raise ValueError(
            f"A Refs PR closes no issue, but GitHub would close {', '.join(closing)} on merge. "
            "Remove the closing phrase or the linked issue."
        )
    committed = [
        f"{commit['oid'][:7]} ({found[1]})"
        for commit in commits
        for found in CLOSING.finditer(f"{commit['messageHeadline']}\n{commit['messageBody']}".replace("…\n…", ""))
    ]
    if reference[1] == "Refs" and committed:
        raise ValueError(
            f"A Refs PR closes no issue, but these commit messages would close one on merge: {', '.join(committed)}. "
            "Reword the commits."
        )
    return int(match[2])


def github_json(subject, *arguments):
    try:
        result = subprocess.run(["gh", *arguments], capture_output=True, text=True, check=True, timeout=30)
        return json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, json.JSONDecodeError) as error:
        raise ValueError(f"Cannot verify {subject} through GitHub; check access and availability.") from error


def check(repository, number):
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository) or number < 1:
        raise ValueError("Supply owner/repository and a positive pull request number.")
    request = github_json(
        f"PR #{number}",
        "pr",
        "view",
        str(number),
        "--repo",
        repository,
        "--json",
        "title,body,closingIssuesReferences,commits",
    )
    closing = [issue["url"] for issue in request["closingIssuesReferences"]]
    issue_number = owning_issue(request["title"], request["body"], closing, request["commits"])
    issue = github_json(f"issue #{issue_number}", "api", f"repos/{repository}/issues/{issue_number}")
    if issue.get("number") != issue_number or "pull_request" in issue:
        raise ValueError(f"#{issue_number} must be an issue in {repository}, not a pull request.")
    return issue_number


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", required=True)
    parser.add_argument("--pr", required=True, type=int)
    args = parser.parse_args()
    try:
        issue = check(args.repository, args.pr)
    except (ValueError, KeyError, TypeError) as error:
        print(f"PR metadata: {error}", file=sys.stderr)
        return 1
    print(f"PR #{args.pr} has a typed title and matching reference to issue #{issue} in {args.repository}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
