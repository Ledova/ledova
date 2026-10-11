import contextlib
import importlib.util
import io
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("check_pr_metadata", ROOT / "scripts/check-pr-metadata.py")
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)


def commit(oid, headline, body=""):
    return {"oid": oid, "messageHeadline": headline, "messageBody": body}


class OwningIssue(unittest.TestCase):
    def test_feature_fix_docs_and_dependency_titles_have_matching_references(self):
        for title in (
            "feat(#123): export holdings",
            "fix(#123): refuse expired signatures",
            "docs(#123): explain the setup",
            "deps(#123): update dependencies",
        ):
            with self.subTest(title=title):
                self.assertEqual(gate.owning_issue(title, "\nRefs #123\n\nMeasured evidence."), 123)

    def test_a_refs_pr_whose_commit_messages_would_close_an_issue_is_refused_by_commit_and_reference(self):
        for headline, body, named in (
            ("fix(#123): refuse expired signatures", "Does not close #123 - it needs data.", ["#123"]),
            ("CLOSES: owner/ledova#99", "", ["owner/ledova#99"]),
            (
                "fix(#123): refuse expired signatures",
                "resolved\nhttps://github.com/owner/ledova/issues/7",
                ["https://github.com/owner/ledova/issues/7"],
            ),
            ("fix(#123): refuse expired signatures", "Fixed #5, fixes other/upstream#6", ["#5", "other/upstream#6"]),
            ("fix(#123): refuse expired signatures", "Fixes octo-org/octo-repo#100", ["octo-org/octo-repo#100"]),
            (
                "fix(#123): refuse expired signatures",
                "Closes https://github.com/octo-org/octo.repo/issues/7",
                ["https://github.com/octo-org/octo.repo/issues/7"],
            ),
        ):
            with self.subTest(headline=headline, body=body):
                commits = [
                    commit("1111111aaaa", "test(#123): pin expiry", "Refs #123"),
                    commit("2222222bbbb", headline, body),
                ]
                with self.assertRaises(ValueError) as refusal:
                    gate.owning_issue("fix(#123): refuse expired signatures", "Refs #123", (), commits)
                for reference in named:
                    self.assertIn(f"2222222 ({reference})", str(refusal.exception))
                self.assertNotIn("1111111", str(refusal.exception))


class LiveIssueVerification(unittest.TestCase):
    READ = (
        "PR #548",
        "pr",
        "view",
        "548",
        "--repo",
        "owner/ledova",
        "--json",
        "title,body,closingIssuesReferences,commits",
    )
    COUNT = ("the commit count of PR #548", "api", "repos/owner/ledova/pulls/548")
    COMMITS = [commit(f"{n:07d}", "test(#518): pin one step") for n in range(100)]

    def request(self, title="deps(#518): update dependencies", body="Refs #518", closing=(), commits=()):
        return {
            "title": title,
            "body": body,
            "closingIssuesReferences": [{"url": url} for url in closing],
            "commits": list(commits),
        }

    def test_any_pr_whose_commit_count_differs_from_the_commits_read_is_refused_with_both_counts(self):
        for body in ("Refs #518", "Closes #518"):
            for read, total in ((100, 99), (100, 101), (3, 2), (3, 4)):
                responses = [self.request(body=body, commits=self.COMMITS[:read]), {"number": 518}, {"commits": total}]
                with self.subTest(body=body, read=read, total=total):
                    with patch.object(gate, "github_json", side_effect=responses), self.assertRaisesRegex(
                        ValueError, f"PR #548 has {total} commits, but the gate read {read}; they must match"
                    ):
                        gate.check("owner/ledova", 548)

    def test_api_failure_cannot_be_reported_as_a_valid_reference(self):
        with patch.object(gate.subprocess, "run", side_effect=subprocess.CalledProcessError(1, ["gh"])):
            with self.assertRaisesRegex(ValueError, "Cannot verify PR #548 through GitHub"):
                gate.check("owner/ledova", 548)


class LocalDraftVerification(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="ledova-metadata-local-")
        self.addCleanup(temporary.cleanup)
        self.directory = Path(temporary.name)
        self.repository = self.directory / "repository"
        self.repository.mkdir()
        self.git("init", "--quiet")
        self.base = self.commit("test(#943): initial synthetic commit\n\nRefs #943")
        self.title = self.directory / "title.txt"
        self.body = self.directory / "body.md"
        self.title.write_text("ci(#943): prepare the backend checks\n")
        self.body.write_text("Refs #943\n\nRecorded focused verification.\n")

    def git(self, *arguments, input=None):
        environment = os.environ | {"GIT_CONFIG_NOSYSTEM": "1", "GIT_CONFIG_GLOBAL": os.devnull}
        return subprocess.run(
            ["git", *arguments],
            cwd=self.repository,
            env=environment,
            input=input,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()

    def commit(self, message):
        self.git(
            "-c",
            "user.name=Synthetic",
            "-c",
            "user.email=synthetic@example.invalid",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgSign=false",
            "commit",
            "--quiet",
            "--allow-empty",
            "--file=-",
            input=message,
        )
        return self.git("rev-parse", "HEAD")

    def check(self, base=None):
        return gate.check_local(self.title, self.body, self.base if base is None else base, self.repository)

    def cli(self, *extra):
        return [
            "check-pr-metadata.py",
            "--title-file",
            str(self.title),
            "--body-file",
            str(self.body),
            "--base",
            self.base,
            "--repository-path",
            str(self.repository),
            *extra,
        ]

    def test_each_body_closing_phrase_including_negation_is_refused_locally(self):
        phrases = [
            *(
                f"This does not {word} #8."
                for word in ("close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves", "resolved")
            ),
            "CLOSES: owner/repository#8",
            "Resolved\nhttps://github.com/owner/repository/issues/8",
        ]
        for phrase in phrases:
            self.body.write_text(f"Refs #943\n\n{phrase}\n")
            with self.subTest(phrase=phrase), self.assertRaisesRegex(ValueError, "would close"):
                self.check()

    def test_local_cli_pass_names_its_online_verification_limit(self):
        output = io.StringIO()
        with patch("sys.argv", self.cli()), patch.object(gate, "github_json") as api:
            with contextlib.redirect_stdout(output):
                self.assertEqual(gate.main(), 0)
        api.assert_not_called()
        self.assertIn("complete base-to-HEAD commit range", output.getvalue())
        self.assertIn("required online", output.getvalue())


class MetadataWorkflow(unittest.TestCase):
    def test_metadata_check_uses_trusted_code_and_read_only_access_even_for_bots(self):
        path = ROOT / ".github/workflows/pr-metadata.yml"
        workflow = yaml.load(path.read_text(), Loader=yaml.BaseLoader)
        self.assertIn("edited", workflow["on"]["pull_request_target"]["types"])
        self.assertIn("synchronize", workflow["on"]["pull_request_target"]["types"])
        self.assertEqual(set(workflow["permissions"].values()), {"read"})
        self.assertEqual(workflow["concurrency"]["cancel-in-progress"], "true")
        job = workflow["jobs"]["metadata"]
        self.assertNotIn("if", job)
        checkouts = [step for step in job["steps"] if step.get("uses", "").startswith("actions/checkout@")]
        self.assertTrue(checkouts)
        for checkout in checkouts:
            self.assertEqual(checkout["with"]["ref"], "${{ github.event.repository.default_branch }}")
            self.assertEqual(checkout["with"]["persist-credentials"], "false")
        self.assertNotIn("github.event.pull_request.title", path.read_text())
        self.assertNotIn("github.event.pull_request.body", path.read_text())


if __name__ == "__main__":
    unittest.main()
