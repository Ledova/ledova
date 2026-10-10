import contextlib
import importlib.util
import io
import json
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

    def test_closing_reference_is_allowed_for_the_owning_issue_whatever_github_would_close(self):
        commits = [commit("99aa99aa99aa", "fix(#123): finish the checks", "Fixes #99")]
        for closing in ((), ["owner/ledova#123"], ["owner/ledova#123", "owner/ledova#99"]):
            with self.subTest(closing=closing):
                issue = gate.owning_issue("ci(#123): check PR metadata", "Closes #123\n\nEvidence.", closing, commits)
                self.assertEqual(issue, 123)

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

    def test_each_closing_keyword_github_documents_is_refused_in_a_commit_message(self):
        for keyword in ("close", "closes", "closed", "fix", "fixes", "fixed", "resolve", "resolves", "resolved"):
            with self.subTest(keyword=keyword), self.assertRaisesRegex(ValueError, r"5555555 \(#8\)"):
                gate.owning_issue(
                    "fix(#123): refuse expired signatures", "Refs #123", (), [commit("5555555", f"{keyword} #8")]
                )

    def test_a_closing_phrase_split_where_github_truncates_a_long_headline_is_still_refused(self):
        commits = [
            commit("3333333cccc", "fix(#123): refuse signatures the server cannot check any more, so clo…", "…ses #8")
        ]
        with self.assertRaisesRegex(ValueError, r"3333333 \(#8\)"):
            gate.owning_issue("fix(#123): refuse expired signatures", "Refs #123", (), commits)

    def test_commit_messages_the_closing_grammar_does_not_match_are_allowed(self):
        for headline, body in (
            ("fix(#123): refuse expired signatures", "Refs #123"),
            ("fix(#123): leave #123 open", "Closing #123 needs production data."),
            ("fix(#123): resolve the merge conflict", "Fixing the test named in owner/ledova#123 comes later."),
            ("fix(#123): prefix #1 to the list", ""),
            ("fix(#123): refuse expired signatures", "The unfixed #2 stays open."),
            ("fix(#123): refuse expired signatures", "Closes#1 has no space."),
            ("fix(#123): refuse expired signatures", "fixes GH-1"),
        ):
            with self.subTest(headline=headline, body=body):
                issue = gate.owning_issue(
                    "fix(#123): refuse expired signatures", "Refs #123", (), [commit("4444444", headline, body)]
                )
                self.assertEqual(issue, 123)

    def test_a_refs_pr_that_github_would_close_an_issue_is_refused_by_name(self):
        for body, closing in (
            ("Refs #123\n\nThis PR does not close #123.", ["owner/ledova#123"]),
            ("Refs #123", ["owner/ledova#99", "other/upstream#7"]),
        ):
            with self.subTest(body=body):
                with self.assertRaises(ValueError) as refusal:
                    gate.owning_issue("fix(#123): refuse expired signatures", body, closing)
                for issue in closing:
                    self.assertIn(issue, str(refusal.exception))

    def test_a_refs_pr_whose_title_would_close_an_issue_is_refused_by_reference(self):
        commits = [commit("1111111aaaa", "test(#123): pin expiry", "Refs #123")]
        for title, named in (
            ("fix(#123): refuse expired signatures, fixes #8", ["#8"]),
            ("fix(#123): CLOSES: owner/ledova#99 before release", ["owner/ledova#99"]),
            (
                "docs(#123): resolved https://github.com/owner/ledova/issues/7",
                ["https://github.com/owner/ledova/issues/7"],
            ),
            ("fix(#123): fix #5 and close other/upstream#6", ["#5", "other/upstream#6"]),
        ):
            with self.subTest(title=title):
                with self.assertRaises(ValueError) as refusal:
                    gate.owning_issue(title, "Refs #123", (), commits)
                self.assertIn(
                    f"title would close {', '.join(named)} on merge. Reword the title.", str(refusal.exception)
                )

    def test_a_closing_title_is_allowed_on_a_closes_pr_and_a_mentioning_title_on_a_refs_pr(self):
        commits = [commit("1111111aaaa", "test(#123): pin expiry", "Refs #123")]
        for title, body in (
            ("fix(#123): refuse expired signatures, fixes #8", "Closes #123"),
            ("fix(#123): leave #8 open", "Refs #123"),
            ("fix(#123): resolve the conflict with owner/ledova#8", "Refs #123"),
        ):
            with self.subTest(title=title, body=body):
                self.assertEqual(gate.owning_issue(title, body, (), commits), 123)

    def test_the_fix_type_prefix_alone_is_not_a_closing_phrase(self):
        self.assertIsNone(gate.CLOSING.search("fix(#123): refuse expired signatures"))
        self.assertEqual(gate.owning_issue("fix(#123): refuse expired signatures", "Refs #123"), 123)

    def test_title_needs_a_type_issue_and_description(self):
        for title in (
            "update dependencies",
            "feature(#123): export holdings",
            "deps: update dependencies",
            "deps(#0): update dependencies",
            "deps(#0123): update dependencies",
            "deps(#123): ",
            "deps(#123): update\ndependencies",
        ):
            with self.subTest(title=title), self.assertRaises(ValueError):
                gate.owning_issue(title, "Refs #123")

    def test_reference_cannot_be_missing_mismatched_negated_or_upstream(self):
        for body in (
            None,
            "",
            "Refs #124",
            "Does not close #123",
            "Refs owner/upstream#123",
            "`Refs #123`",
            "    Refs #123",
            "Untracked change\n\nRefs #123",
        ):
            with self.subTest(body=body), self.assertRaises(ValueError):
                gate.owning_issue("fix(#123): refuse expired signatures", body)


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

    def test_reads_current_metadata_the_issue_in_the_same_repository_then_the_commit_count(self):
        with patch.object(gate, "github_json", side_effect=[self.request(), {"number": 518}, {"commits": 0}]) as api:
            self.assertEqual(gate.check("owner/ledova", 548), 518)
        self.assertEqual(
            [call.args for call in api.call_args_list],
            [self.READ, ("issue #518", "api", "repos/owner/ledova/issues/518"), self.COUNT],
        )

    def test_a_pr_passes_when_every_commit_github_counts_was_read(self):
        responses = [self.request(commits=self.COMMITS), {"number": 518}, {"commits": 100}]
        with patch.object(gate, "github_json", side_effect=responses):
            self.assertEqual(gate.check("owner/ledova", 548), 518)

    def test_any_pr_whose_commit_count_differs_from_the_commits_read_is_refused_with_both_counts(self):
        for body in ("Refs #518", "Closes #518"):
            for read, total in ((100, 99), (100, 101), (3, 2), (3, 4)):
                responses = [self.request(body=body, commits=self.COMMITS[:read]), {"number": 518}, {"commits": total}]
                with self.subTest(body=body, read=read, total=total):
                    with patch.object(gate, "github_json", side_effect=responses), self.assertRaisesRegex(
                        ValueError, f"PR #548 has {total} commits, but the gate read {read}; they must match"
                    ):
                        gate.check("owner/ledova", 548)

    def test_a_missing_or_non_integer_commit_count_is_refused(self):
        for count, shown in (
            ({}, "None"),
            ({"commits": "1"}, "'1'"),
            ({"commits": 1.0}, "1.0"),
            ({"commits": True}, "True"),
        ):
            responses = [self.request(commits=self.COMMITS[:1]), {"number": 518}, count]
            with self.subTest(count=count), patch.object(gate, "github_json", side_effect=responses):
                with self.assertRaisesRegex(ValueError, f"PR #548 has {shown} commits, but the gate read 1;"):
                    gate.check("owner/ledova", 548)

    def test_api_failure_on_the_commit_count_cannot_be_reported_as_a_valid_reference(self):
        answers = [
            subprocess.CompletedProcess([], 0, stdout=json.dumps(self.request())),
            subprocess.CompletedProcess([], 0, stdout=json.dumps({"number": 518})),
            subprocess.CalledProcessError(1, ["gh"]),
        ]
        with patch.object(gate.subprocess, "run", side_effect=answers):
            with self.assertRaisesRegex(ValueError, "Cannot verify the commit count of PR #548 through GitHub"):
                gate.check("owner/ledova", 548)

    def test_a_refs_pr_is_refused_when_github_reports_it_closes_an_issue(self):
        closing = ("https://github.com/owner/ledova/issues/518",)
        request = self.request(body="Refs #518\n\nThis PR does not close #518.", closing=closing)
        with patch.object(gate, "github_json", side_effect=[request, {"number": 518}]):
            with self.assertRaisesRegex(ValueError, "would close https://github.com/owner/ledova/issues/518 on merge"):
                gate.check("owner/ledova", 548)

    def test_a_refs_pr_is_refused_when_one_of_its_commits_would_close_an_issue(self):
        commits = [commit("df0dbe083c89", "fix(#518): serve stored files safely", "Does not close #170.\n\nRefs #518")]
        with patch.object(gate, "github_json", side_effect=[self.request(commits=commits), {"number": 518}]):
            with self.assertRaisesRegex(ValueError, r"would close one on merge: df0dbe0 \(#170\)\. Reword"):
                gate.check("owner/ledova", 548)

    def test_a_pull_request_number_cannot_stand_in_for_an_issue(self):
        with patch.object(gate, "github_json", side_effect=[self.request(), {"number": 518, "pull_request": {}}]):
            with self.assertRaisesRegex(ValueError, "must be an issue"):
                gate.check("owner/ledova", 548)

    def test_a_missing_issue_or_wrong_api_identity_is_refused(self):
        for response in ({}, {"number": 517}):
            with self.subTest(response=response):
                with patch.object(gate, "github_json", side_effect=[self.request(), response]):
                    with self.assertRaisesRegex(ValueError, "must be an issue"):
                        gate.check("owner/ledova", 548)

    def test_bots_have_no_untracked_title_exemption(self):
        with patch.object(gate, "github_json", return_value=self.request(title="Bump packages")) as api:
            with self.assertRaisesRegex(ValueError, "Use a title"):
                gate.check("owner/ledova", 548)
        api.assert_called_once_with(*self.READ)

    def test_invalid_repository_or_pr_number_never_reaches_the_api(self):
        for repository, number in (("owner/ledova/../other", 548), ("owner/ledova?x=1", 548), ("owner/ledova", 0)):
            with self.subTest(repository=repository, number=number), patch.object(gate, "github_json") as api:
                with self.assertRaises(ValueError):
                    gate.check(repository, number)
                api.assert_not_called()

    def test_api_failure_cannot_be_reported_as_a_valid_reference(self):
        with patch.object(gate.subprocess, "run", side_effect=subprocess.CalledProcessError(1, ["gh"])):
            with self.assertRaisesRegex(ValueError, "Cannot verify PR #548 through GitHub"):
                gate.check("owner/ledova", 548)

    def test_metadata_remains_data_in_the_api_process(self):
        metadata = self.request(title="deps(#518): keep `touch /tmp/unwanted` as text")
        result = subprocess.CompletedProcess([], 0, stdout=json.dumps(metadata))
        with patch.object(gate.subprocess, "run", return_value=result) as process:
            self.assertEqual(gate.github_json(*self.READ), metadata)
        self.assertEqual(process.call_args.args[0], ["gh", *self.READ[1:]])
        self.assertNotIn("shell", process.call_args.kwargs)

    def test_cli_returns_failure_for_an_unverified_issue(self):
        with patch("sys.argv", ["check-pr-metadata.py", "--repository", "owner/ledova", "--pr", "548"]):
            with patch.object(gate, "github_json", side_effect=[self.request(), {"number": 518, "pull_request": {}}]):
                with contextlib.redirect_stderr(io.StringIO()) as errors:
                    self.assertEqual(gate.main(), 1)
        self.assertIn("must be an issue", errors.getvalue())


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

    def test_an_ancestor_range_retains_every_full_commit_message_without_network_access(self):
        first_message = "test(#943): retain original bytes\n\nRefs #943\n\n" + "Synthetic evidence.\n" * 300
        first = self.commit(first_message)
        second = self.commit("ci(#943): verify complete range\n\nRefs #943\n")
        with patch.object(gate, "github_json") as api:
            self.assertEqual(self.check(), 943)
            commits = gate.local_commits(self.repository, self.base)
        api.assert_not_called()
        self.assertEqual({item["oid"] for item in commits}, {first, second})
        self.assertEqual(
            next(item for item in commits if item["oid"] == first)["messageBody"],
            first_message.partition("\n")[2],
        )

    def test_an_empty_current_head_range_is_valid_without_invented_commit_messages(self):
        self.assertEqual(gate.local_commits(self.repository, self.base), [])
        self.assertEqual(self.check(), 943)

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

    def test_closes_draft_preserves_the_existing_closing_wording_rule(self):
        self.title.write_text("fix(#943): finish checks, fixes #8\r\n")
        self.body.write_text("Closes #943\n\nCloses #8\n")
        self.commit("test(#943): finish the issue\n\nFixes #8")
        self.assertEqual(self.check(), 943)

    def test_malformed_title_and_missing_or_mismatched_body_reference_are_refused(self):
        for title, body in (
            ("untracked title", "Refs #943"),
            ("ci(#943): first\nsecond", "Refs #943"),
            ("ci(#943): prepare checks", ""),
            ("ci(#943): prepare checks", "Refs #944"),
            ("ci(#943): prepare checks", "    Refs #943"),
        ):
            self.title.write_text(title)
            self.body.write_text(body)
            with self.subTest(title=title, body=body), self.assertRaises(ValueError):
                self.check()

    def test_missing_unreadable_or_non_utf8_draft_files_are_refused(self):
        for invalid in (self.directory / "missing", self.directory):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(ValueError, "Cannot read"):
                gate.check_local(invalid, self.body, self.base, self.repository)
        self.body.write_bytes(b"\xff")
        with self.assertRaisesRegex(ValueError, "Cannot read"):
            self.check()

    def test_closing_commit_headlines_and_late_body_text_name_the_commit(self):
        for message in (
            "Fixed #8",
            "test(#943): preserve the entire message\n\n" + "Synthetic evidence.\n" * 300 + "Does not close #8",
        ):
            with self.subTest(message=message[:50]):
                self.git("checkout", "--quiet", "--detach", self.base)
                oid = self.commit(message)
                with self.assertRaisesRegex(ValueError, rf"{oid[:7]} \(#8\)"):
                    self.check()

    def test_unavailable_invalid_and_divergent_bases_are_refused(self):
        for base in ("", " HEAD", "missing-reference", "HEAD~100", "--all"):
            with self.subTest(base=base), self.assertRaises(ValueError):
                self.check(base)
        other = self.commit("test(#943): other branch\n\nRefs #943")
        self.git("checkout", "--quiet", "--detach", self.base)
        self.commit("test(#943): current branch\n\nRefs #943")
        with self.assertRaisesRegex(ValueError, "complete ancestor base"):
            self.check(other)

    def test_shallow_history_is_refused_even_when_the_base_is_present(self):
        self.commit("test(#943): shallow tip\n\nRefs #943")
        shallow = self.directory / "shallow"
        self.git("clone", "--quiet", "--depth=1", self.repository.as_uri(), str(shallow))
        with self.assertRaisesRegex(ValueError, "complete history"):
            gate.check_local(self.title, self.body, "HEAD", shallow)

    def test_truncated_malformed_or_duplicate_git_inventory_is_refused(self):
        oid = "a" * 40
        record = f"{oid}\0test(#943): step\n\nRefs #943\n\0".encode()
        for count, output in (
            (b"2\n", record),
            (b"1\n", record[:-1]),
            (b"2\n", record * 2),
            (b"1\n", b"invalid\0message\0"),
            (b"1\n", b"\xff"),
            (b"invalid\n", record),
        ):
            answers = [b"a" * 40 + b"\n", b"b" * 40 + b"\n", b"false\n", b"", count, output]
            results = [subprocess.CompletedProcess([], 0, stdout=value) for value in answers]
            with self.subTest(count=count, output=output[:30]), patch.object(
                gate.subprocess, "run", side_effect=results
            ):
                with self.assertRaises(ValueError):
                    gate.local_commits(self.repository, "base")

    def test_git_timeout_and_malformed_revision_identity_fail_closed(self):
        for response in (
            subprocess.TimeoutExpired(["git"], 30),
            subprocess.CompletedProcess([], 0, stdout=b"not-a-commit\n"),
        ):
            with self.subTest(response=response), patch.object(
                gate.subprocess, "run", side_effect=[response, response]
            ):
                with self.assertRaises(ValueError):
                    gate.local_commits(self.repository, "base")

    def test_draft_commit_and_base_shell_text_remain_literal_data(self):
        sentinel = self.directory / "executed"
        literal = f"$(touch {sentinel}) `touch {sentinel}`"
        self.title.write_text(f"ci(#943): retain {literal}\n")
        self.body.write_text(f"Refs #943\n\n{literal}\n")
        self.commit(f"test(#943): retain {literal}\n\nRefs #943\n{literal}")
        self.assertEqual(self.check(), 943)
        original_run = subprocess.run
        with patch.object(gate.subprocess, "run", side_effect=original_run) as run:
            with self.assertRaises(ValueError):
                self.check(f"HEAD; touch {sentinel}")
        self.assertFalse(sentinel.exists())
        arguments = run.call_args.args[0]
        self.assertEqual(arguments[-1], f"HEAD; touch {sentinel}^{{commit}}")
        self.assertIn("--end-of-options", arguments)
        self.assertNotIn("shell", run.call_args.kwargs)

    def test_local_cli_pass_names_its_online_verification_limit(self):
        output = io.StringIO()
        with patch("sys.argv", self.cli()), patch.object(gate, "github_json") as api:
            with contextlib.redirect_stdout(output):
                self.assertEqual(gate.main(), 0)
        api.assert_not_called()
        self.assertIn("complete base-to-HEAD commit range", output.getvalue())
        self.assertIn("required online", output.getvalue())

    def test_partial_or_mixed_cli_modes_are_refused_before_git_or_github(self):
        invalid = (
            [],
            ["--repository", "owner/repository"],
            ["--pr", "1"],
            ["--title-file", str(self.title)],
            ["--title-file", str(self.title), "--body-file", str(self.body)],
            self.cli()[1:] + ["--repository", "owner/repository", "--pr", "1"],
            self.cli()[1:] + ["--pr", "1"],
            ["--repository", "owner/repository", "--pr", "1", "--base", self.base],
            ["--repository", "owner/repository", "--pr", "1", "--body-file", str(self.body)],
            ["--repository", "owner/repository", "--pr", "1", "--repository-path", str(self.repository)],
        )
        for arguments in invalid:
            with self.subTest(arguments=arguments), patch("sys.argv", ["check-pr-metadata.py", *arguments]):
                with patch.object(gate, "github_json") as api, patch.object(gate.subprocess, "run") as run:
                    with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as refusal:
                        gate.main()
                self.assertEqual(refusal.exception.code, 2)
                api.assert_not_called()
                run.assert_not_called()


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
