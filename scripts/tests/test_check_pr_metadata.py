import contextlib
import importlib.util
import io
import json
import subprocess
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

    def request(self, title="deps(#518): update dependencies", body="Refs #518", closing=(), commits=()):
        return {
            "title": title,
            "body": body,
            "closingIssuesReferences": [{"url": url} for url in closing],
            "commits": list(commits),
        }

    def test_reads_current_metadata_then_the_issue_in_the_same_repository(self):
        with patch.object(gate, "github_json", side_effect=[self.request(), {"number": 518}]) as api:
            self.assertEqual(gate.check("owner/ledova", 548), 518)
        self.assertEqual(
            [call.args for call in api.call_args_list],
            [self.READ, ("issue #518", "api", "repos/owner/ledova/issues/518")],
        )

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
