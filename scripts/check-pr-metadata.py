import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

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
    titled = [found[1] for found in CLOSING.finditer(title)]
    if reference[1] == "Refs" and titled:
        raise ValueError(
            f"A Refs PR closes no issue, but its title would close {', '.join(titled)} on merge. Reword the title."
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
    total = github_json(f"the commit count of PR #{number}", "api", f"repos/{repository}/pulls/{number}").get("commits")
    if type(total) is not int or total != len(request["commits"]):
        raise ValueError(
            f"PR #{number} has {total!r} commits, but the gate read {len(request['commits'])}; they must match."
        )
    return issue_number


def local_commits(repository, base):
    def git(*arguments):
        try:
            return subprocess.run(
                ["git", *arguments], cwd=repository, capture_output=True, check=True, timeout=30
            ).stdout
        except (OSError, subprocess.SubprocessError) as error:
            raise ValueError(
                "Cannot verify the local commit range; supply an available complete ancestor base."
            ) from error

    if not isinstance(base, str) or not base or base != base.strip():
        raise ValueError("Supply an explicit ancestor base for the local commit range.")
    try:
        base_sha = git("rev-parse", "--verify", "--end-of-options", f"{base}^{{commit}}").decode("ascii").strip()
        head_sha = git("rev-parse", "--verify", "HEAD^{commit}").decode("ascii").strip()
        if any(not re.fullmatch(r"[0-9a-f]{40}", value) for value in (base_sha, head_sha)):
            raise ValueError("Local base and HEAD must resolve to complete commit identities.")
        if git("rev-parse", "--is-shallow-repository").strip() != b"false":
            raise ValueError("Local commit wording requires complete history; fetch the missing history first.")
        git("merge-base", "--is-ancestor", base_sha, head_sha)
        revision_range = f"{base_sha}..{head_sha}"
        count = int(git("rev-list", "--count", revision_range, "--").decode("ascii").strip())
        output = git("log", "--no-show-signature", "-z", "--format=%H%x00%B", revision_range, "--")
        fields = output.decode("utf-8").split("\0") if output else [""]
        if fields[-1] or len(fields) % 2 != 1:
            raise ValueError("The local commit inventory is incomplete or malformed.")
        commits = []
        for index in range(0, len(fields) - 1, 2):
            oid, message = fields[index : index + 2]
            if not re.fullmatch(r"[0-9a-f]{40}", oid):
                raise ValueError("The local commit inventory contains an invalid identity.")
            headline, _, body = message.partition("\n")
            commits.append({"oid": oid, "messageHeadline": headline, "messageBody": body})
        if count != len(commits) or len({commit["oid"] for commit in commits}) != len(commits):
            raise ValueError("The local commit count and complete unique inventory must match.")
        return commits
    except UnicodeError as error:
        raise ValueError("The local commit inventory could not be read completely as UTF-8.") from error


def check_local(title_file, body_file, base, repository_path=Path(".")):
    try:
        title = Path(title_file).read_text(encoding="utf-8").removesuffix("\n").removesuffix("\r")
        body = Path(body_file).read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        raise ValueError("Cannot read the local title and body files as UTF-8.") from error
    closing = [found[1] for found in CLOSING.finditer(body)]
    return owning_issue(title, body, closing, local_commits(repository_path, base))


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--repository")
    mode.add_argument("--title-file", type=Path)
    parser.add_argument("--pr", type=int)
    parser.add_argument("--body-file", type=Path)
    parser.add_argument("--base")
    parser.add_argument("--repository-path", type=Path)
    args = parser.parse_args()
    if args.repository is not None:
        if args.pr is None or any(value is not None for value in (args.body_file, args.base, args.repository_path)):
            parser.error("Online mode requires --repository and --pr, without local draft options.")
    elif args.pr is not None or args.body_file is None or args.base is None:
        parser.error("Local mode requires --title-file, --body-file and --base, without --pr.")
    try:
        if args.repository is not None:
            issue = check(args.repository, args.pr)
        else:
            issue = check_local(args.title_file, args.body_file, args.base, args.repository_path or Path.cwd())
    except (ValueError, KeyError, TypeError) as error:
        print(f"PR metadata: {error}", file=sys.stderr)
        return 1
    if args.repository is not None:
        print(f"PR #{args.pr} has a typed title and matching reference to issue #{issue} in {args.repository}.")
    else:
        print(f"Local draft wording and complete base-to-HEAD commit range pass for issue #{issue}.")
        print("GitHub issue, closing-reference and full PR commit-count verification remain required online.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
