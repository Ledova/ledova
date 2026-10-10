import importlib.util
import json
import os
import shlex
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import yaml

SCRIPT = Path(__file__).resolve().parents[1] / "ci-scope.py"
SPEC = importlib.util.spec_from_file_location("ci_scope", SCRIPT)
SCOPE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCOPE)


class ScopeCase(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.repository = Path(directory.name)
        self.git("init", "--quiet")
        self.git("config", "maintenance.auto", "false")
        self.git("config", "diff.renames", "true")
        self.base = self.commit({"backend/base.py": "base", "docs/guide.md": "guide", "mobile/app.ts": "app"})

    def git(self, *arguments):
        return subprocess.run(
            ["git", "-c", "user.name=Native CI test", "-c", "user.email=ci@example.invalid", *arguments],
            cwd=self.repository,
            check=True,
            capture_output=True,
            text=True,
        ).stdout.strip()

    def commit(self, files, removed=()):
        for relative in removed:
            (self.repository / relative).unlink()
        for relative, content in files.items():
            path = self.repository / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content)
        self.git("add", "--all")
        self.git("commit", "--quiet", "--allow-empty", "-m", "Fixture")
        return self.git("rev-parse", "HEAD")

    def decision(self, head, base=None, event="pull_request", scope="native"):
        base = self.base if base is None else base
        payload = (
            {"before": base, "after": head}
            if event == "push"
            else {"pull_request": {"base": {"sha": base}, "head": {"sha": head}}}
        )
        return SCOPE.SCOPES[scope](event, payload, self.repository)


class NativeBuildScopeTest(ScopeCase):
    def test_backend_and_docs_additions_modifications_deletions_skip(self):
        head = self.commit({"backend/new.py": "new", "docs/guide.md": "updated"}, removed=("backend/base.py",))
        self.assertEqual(self.decision(head)["required"], False)
        self.assertEqual(self.decision(head)["changed_files"], 3)

    def test_mobile_shared_and_build_inputs_run_both_platforms(self):
        paths = (
            "package.json",
            "package-lock.json",
            "npm-shrinkwrap.json",
            "dashboard/package.json",
            ".gitattributes",
            "dashboard/.gitattributes",
            "docs/.gitattributes",
            ".npmrc",
            "packages/shared/src/index.ts",
            "mobile/assets/icon.png",
            "mobile/app.json",
            "mobile/plugins/withMobileSecurity.cjs",
            "mobile/native-tests/index.tsx",
            "scripts/ci-scope.py",
            "scripts/tests/test_ci_scope.py",
            ".github/workflows/mobile-native.yml",
        )
        for path in paths:
            with self.subTest(path=path):
                head = self.commit({path: "changed"})
                self.assertTrue(self.decision(head)["required"])
                self.assertTrue(self.decision(head, event="push")["required"])
                self.git("reset", "--hard", self.base)

    def test_root_documentation_does_not_require_native_builds(self):
        head = self.commit({"README.md": "updated", "CONTRIBUTING.md": "updated", "docs/PRACTICES.md": "updated"})
        for event in ("pull_request", "push"):
            with self.subTest(event=event):
                self.assertFalse(self.decision(head, event=event)["required"])
                self.assertEqual(self.decision(head, event=event)["changed_files"], 3)

    def test_unrelated_paths_skip_without_partial_prefix_or_filename_matches(self):
        paths = (
            "backend/new.py",
            "dashboard/src/index.tsx",
            "dashboard/package-lock.json",
            "marketing/index.html",
            ".github/workflows/ci.yml",
            ".gitignore",
            "new-input/file.txt",
            "backend-other/file.py",
            "mobile-other/file.ts",
            "packages/shared-other/file.ts",
            "scripts/ci-scope.py.txt",
            "nested/package.json",
        )
        for path in paths:
            with self.subTest(path=path):
                head = self.commit({path: "changed"})
                self.assertFalse(self.decision(head)["required"])
                self.assertFalse(self.decision(head, event="push")["required"])
                self.git("reset", "--hard", self.base)

    def test_rename_from_mobile_to_docs_includes_removed_native_input(self):
        head = self.commit({"docs/retired.ts": "app"}, removed=("mobile/app.ts",))
        self.assertTrue(self.decision(head)["required"])
        self.assertTrue(self.decision(head, event="push")["required"])
        self.assertEqual(self.decision(head)["changed_files"], 2)

    def test_rename_from_docs_to_mobile_runs_native(self):
        head = self.commit({"mobile/guide.ts": "guide"}, removed=("docs/guide.md",))
        self.assertTrue(self.decision(head)["required"])

    def test_native_deletion_runs_native(self):
        head = self.commit({}, removed=("mobile/app.ts",))
        self.assertTrue(self.decision(head)["required"])
        self.assertTrue(self.decision(head, event="push")["required"])

    def test_unrelated_rename_and_deletion_skip(self):
        head = self.commit({"README.md": "guide"}, removed=("docs/guide.md", "backend/base.py"))
        for event in ("pull_request", "push"):
            with self.subTest(event=event):
                self.assertFalse(self.decision(head, event=event)["required"])
                self.assertEqual(self.decision(head, event=event)["changed_files"], 3)

    def test_nul_delimited_unrelated_names_do_not_become_extra_paths(self):
        head = self.commit({"docs/a b\tc\nd.md": "unrelated"})
        self.assertFalse(self.decision(head)["required"])
        self.assertEqual(self.decision(head)["changed_files"], 1)

    def test_complete_diff_includes_native_change_after_three_hundred_files(self):
        files = {f"backend/file-{index:04}.py": "new" for index in range(301)}
        files["mobile/app.ts"] = "updated"
        head = self.commit(files)
        self.assertTrue(self.decision(head)["required"])
        self.assertEqual(self.decision(head)["changed_files"], 302)

    def test_push_compares_all_commits_including_earlier_mobile_changes(self):
        mobile_head = self.commit({"mobile/app.ts": "updated"})
        head = self.commit({"backend/base.py": "updated"})
        self.assertTrue(self.decision(head, event="push")["required"])
        self.assertEqual(self.decision(head, event="push").get("changed_files"), 2)
        self.assertFalse(self.decision(head, base=mobile_head, event="push")["required"])

    def test_push_with_only_unrelated_commits_skips(self):
        self.commit({"backend/base.py": "updated"})
        head = self.commit({"dashboard/src/index.ts": "new"})
        self.assertFalse(self.decision(head, event="push")["required"])
        self.assertEqual(self.decision(head, event="push")["changed_files"], 2)

    def test_manual_dispatch_and_unknown_events_run_even_for_unrelated_diff(self):
        head = self.commit({"backend/base.py": "updated"})
        self.assertFalse(self.decision(head)["required"])
        for event in ("workflow_dispatch", "unknown", "pull_request_target", None):
            with self.subTest(event=event):
                self.assertTrue(self.decision(head, event=event)["required"])

    def test_verified_empty_diff_skips(self):
        empty_head = self.commit({})
        for event in ("pull_request", "push"):
            for head in (self.base, empty_head):
                with self.subTest(event=event, head=head):
                    self.assertFalse(self.decision(head, event=event)["required"])
                    self.assertEqual(self.decision(head, event=event)["changed_files"], 0)

    def test_invalid_zero_missing_or_noncommit_revisions_require_native(self):
        tree = self.git("rev-parse", "HEAD^{tree}")
        blob = self.git("rev-parse", "HEAD:mobile/app.ts")
        revisions = ("0" * 40, "f" * 40, "not-a-revision", "", 12, [], {}, tree, blob)
        for event in ("pull_request", "push"):
            for revision in revisions:
                with self.subTest(event=event, revision=revision):
                    self.assertTrue(self.decision(revision, event=event)["required"])
                    self.assertTrue(self.decision(self.base, base=revision, event=event)["required"])

    def test_malformed_payload_requires_native(self):
        payloads = (
            None,
            [],
            {},
            {"pull_request": {"base": None}},
            {"before": self.base},
            {"after": self.base},
            {"before": None, "after": self.base},
            {"before": self.base, "after": None},
        )
        for event in ("pull_request", "push"):
            for payload in payloads:
                with self.subTest(event=event, payload=payload):
                    self.assertTrue(SCOPE.native_scope(event, payload, self.repository)["required"])

    def test_malformed_diff_evidence_requires_native(self):
        for diff in (b"docs/file", b"\0", b"/file\0", b"docs//file\0", b"docs/../file\0", b"./file\0", b"\xff\0"):
            with self.subTest(diff=diff):
                results = (
                    subprocess.CompletedProcess([], 0),
                    subprocess.CompletedProcess([], 0, stdout=diff),
                )
                with patch.object(SCOPE.subprocess, "run", side_effect=results):
                    self.assertTrue(self.decision(self.base)["required"])

    def test_base_advancement_outside_head_requires_native(self):
        head = self.commit({"backend/base.py": "updated"})
        self.git("checkout", "--detach", self.base)
        advanced_base = self.commit({"mobile/app.ts": "new base"})
        self.assertTrue(self.decision(head, base=advanced_base)["required"])
        self.assertTrue(self.decision(head, base=advanced_base, event="push")["required"])

    def test_reversed_push_history_requires_native(self):
        head = self.commit({"backend/base.py": "updated"})
        self.assertTrue(self.decision(self.base, base=head, event="push")["required"])

    def test_shallow_history_requires_native_until_base_comparison_is_available(self):
        head = self.commit({"backend/base.py": "updated"})
        with tempfile.TemporaryDirectory() as directory:
            clone = Path(directory) / "clone"
            subprocess.run(
                ["git", "clone", "--quiet", "--depth", "1", self.repository.as_uri(), str(clone)],
                check=True,
                capture_output=True,
            )
            payloads = (
                ("pull_request", {"pull_request": {"base": {"sha": self.base}, "head": {"sha": head}}}),
                ("push", {"before": self.base, "after": head}),
            )
            for event, payload in payloads:
                with self.subTest(event=event):
                    self.assertTrue(SCOPE.native_scope(event, payload, clone)["required"])
            subprocess.run(["git", "fetch", "--quiet", "--deepen=1"], cwd=clone, check=True, capture_output=True)
            for event, payload in payloads:
                with self.subTest(event=event):
                    self.assertFalse(SCOPE.native_scope(event, payload, clone)["required"])

    def test_route_cli_writes_only_the_boolean_output(self):
        head = self.commit({"docs/new.md": "guide"})
        events = (
            ("pull_request", {"pull_request": {"base": {"sha": self.base}, "head": {"sha": head}}}),
            ("push", {"before": self.base, "after": head}),
        )
        for event_name, payload in events:
            with self.subTest(event=event_name):
                event = self.repository / f"{event_name}-event.json"
                event.write_text(json.dumps(payload))
                output = self.repository / f"{event_name}-github-output"
                result = subprocess.run(
                    [
                        sys.executable,
                        str(SCRIPT),
                        "route",
                        "native",
                        "--event",
                        event_name,
                        "--event-file",
                        str(event),
                        "--repository",
                        str(self.repository),
                    ],
                    env={**os.environ, "GITHUB_OUTPUT": str(output)},
                    check=True,
                    capture_output=True,
                    text=True,
                )
                self.assertFalse(json.loads(result.stdout)["required"])
                self.assertEqual(output.read_text(), "required=false\n")


class DjangoScopeTest(ScopeCase):
    CLIENT_AND_DOCUMENTATION = (
        "dashboard/src/index.tsx",
        "dashboard/package.json",
        "marketing/index.html",
        "mobile/app.ts",
        "packages/shared/src/index.ts",
        "docs/guide.md",
        "docs/architecture/new.md",
    )

    def test_a_pull_request_changing_only_client_code_and_documentation_skips_django(self):
        head = self.commit(dict.fromkeys(self.CLIENT_AND_DOCUMENTATION, "changed"), removed=("mobile/app.ts",))

        decision = self.decision(head, scope="django")

        self.assertEqual((decision["required"], decision["changed_files"]), (False, 7))

    def test_a_pull_request_changing_any_other_path_runs_django(self):
        paths = (
            "backend/new.py",
            "contracts/contracts/AUDY.sol",
            "scripts/check-docs.py",
            ".github/workflows/ci.yml",
            ".github/ordinary-suite-shards.json",
            "docker-compose.yml",
            "Makefile",
            "package.json",
            "README.md",
            "dashboard-other/file.ts",
            "docs-other/file.md",
            "packagesfile.ts",
        )
        for path in paths:
            with self.subTest(path=path):
                head = self.commit({"dashboard/src/index.tsx": "changed", path: "changed"})
                self.assertTrue(self.decision(head, scope="django")["required"])
                self.git("reset", "--hard", self.base)

    def test_root_policy_document_additions_edits_and_deletions_skip_django(self):
        added = self.commit({"AGENTS.md": "guidance", "CONTRIBUTING.md": "contributing"})
        edited = self.commit({"AGENTS.md": "updated guidance", "CONTRIBUTING.md": "updated contributing"})
        removed = self.commit({}, removed=("AGENTS.md", "CONTRIBUTING.md"))
        for base, head in ((self.base, added), (added, edited), (edited, removed)):
            with self.subTest(head=head):
                self.assertFalse(self.decision(head, base=base, scope="django")["required"])
                self.assertEqual(self.decision(head, base=base, scope="django")["changed_files"], 2)

    def test_policy_document_exemption_is_exact_and_does_not_hide_other_changes(self):
        for path in ("nested/AGENTS.md", "AGENTS.md.bak", "CONTRIBUTING.md.py", "README.md", "backend/base.py"):
            with self.subTest(path=path):
                head = self.commit({"AGENTS.md": "guidance", path: "changed"})
                self.assertTrue(self.decision(head, scope="django")["required"])
                self.git("reset", "--hard", self.base)

    def test_a_backend_reference_to_a_root_policy_document_requires_django(self):
        for name in ("AGENTS.md", "CONTRIBUTING.md"):
            with self.subTest(name=name):
                base = self.commit({name: "guidance", "backend/rule.py": f'RULE = "{name}"\n'})
                edited = self.commit({name: "updated guidance"})
                removed = self.commit({}, removed=(name,))
                for before, head in ((base, edited), (edited, removed)):
                    with self.subTest(head=head):
                        self.assertTrue(self.decision(head, base=before, scope="django")["required"])
                self.git("reset", "--hard", self.base)

    def test_a_document_a_backend_file_names_runs_django_when_it_changes(self):
        named = self.commit(
            {
                "backend/shared/management/commands/rule.py": 'RULE = "docs/architecture/tenancy.md"\n',
                "backend/.env.example": "# Upload limits: docs/operations/uploads.md\n",
            }
        )
        self.commit({"docs/architecture/tenancy.md": "# Tenancy model\n", "docs/operations/uploads.md": "# Uploads\n"})
        edited = self.commit({"docs/architecture/tenancy.md": "# Tenancy\n"})
        uploads = self.commit({"docs/operations/uploads.md": "# Upload limits\n"})
        removed = self.commit({}, removed=("docs/architecture/tenancy.md",))
        other = self.commit({"docs/guide.md": "updated"})

        for base, head, required in (
            (named, edited, True),
            (edited, uploads, True),
            (uploads, removed, True),
            (removed, other, False),
        ):
            with self.subTest(head=head):
                self.assertEqual(self.decision(head, base=base, scope="django")["required"], required)

    def test_a_gitattributes_anywhere_runs_django_since_it_changes_how_files_check_out(self):
        for path in ("docs/architecture/.gitattributes", "dashboard/.gitattributes", "docs/.gitattributes"):
            with self.subTest(path=path):
                head = self.commit({path: "tenancy.md working-tree-encoding=UTF-7\n"})
                self.assertTrue(self.decision(head, scope="django")["required"])
                self.git("reset", "--hard", self.base)

    def test_every_push_and_manual_run_tests_django_whatever_changed(self):
        head = self.commit({"AGENTS.md": "guidance", "CONTRIBUTING.md": "contributing", "docs/guide.md": "updated"})
        self.assertFalse(self.decision(head, scope="django")["required"])
        for event in ("push", "workflow_dispatch", None):
            with self.subTest(event=event):
                self.assertTrue(self.decision(head, event=event, scope="django")["required"])

    def test_an_unavailable_comparison_runs_django(self):
        head = self.commit({"docs/guide.md": "updated"})
        self.git("checkout", "--detach", self.base)
        advanced_base = self.commit({"dashboard/src/index.tsx": "new base"})
        for payload in (None, {}, {"pull_request": {"base": {"sha": advanced_base}, "head": {"sha": head}}}):
            with self.subTest(payload=payload):
                self.assertTrue(SCOPE.django_scope("pull_request", payload, self.repository)["required"])

    def test_route_cli_writes_the_django_decision(self):
        head = self.commit({"docs/new.md": "guide"})
        event = self.repository / "pull-request-event.json"
        event.write_text(json.dumps({"pull_request": {"base": {"sha": self.base}, "head": {"sha": head}}}))
        output = self.repository / "github-output"
        result = subprocess.run(
            [
                sys.executable,
                str(SCRIPT),
                "route",
                "django",
                "--event",
                "pull_request",
                "--event-file",
                str(event),
                "--repository",
                str(self.repository),
            ],
            env={**os.environ, "GITHUB_OUTPUT": str(output)},
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertFalse(json.loads(result.stdout)["required"])
        self.assertEqual(
            output.read_text(),
            "required=false\nrunners="
            + json.dumps(dict.fromkeys(SCOPE.MAC_JOBS, "ubuntu-latest"), separators=(",", ":"))
            + "\nrunner_timeout=360\n",
        )


class PreferredMainRunnerTest(unittest.TestCase):
    CONTEXT = {
        "GITHUB_EVENT_NAME": "push",
        "GITHUB_REPOSITORY": "Ledova/ledova",
        "GITHUB_REF": "refs/heads/main",
        "GITHUB_RUN_ID": "123456789",
        "GITHUB_RUN_ATTEMPT": "1",
    }

    def route(self, changes=None, scope="django", arguments=()):
        with tempfile.TemporaryDirectory() as directory:
            event = Path(directory) / "event.json"
            event.write_text("{}")
            output = Path(directory) / "github-output"
            environment = {key: value for key, value in os.environ.items() if key not in self.CONTEXT}
            environment.update(self.CONTEXT)
            environment.update(changes or {})
            environment = {key: value for key, value in environment.items() if value is not None}
            environment.update(GITHUB_EVENT_PATH=str(event), GITHUB_OUTPUT=str(output))
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "route", scope, *arguments],
                env=environment,
                check=True,
                capture_output=True,
                text=True,
            )
            outputs = dict(line.split("=", 1) for line in output.read_text().splitlines())
            return json.loads(result.stdout), outputs

    def assert_standard(self, outputs):
        self.assertEqual(
            outputs,
            {
                "required": "true",
                "runners": json.dumps(dict.fromkeys(SCOPE.MAC_JOBS, "ubuntu-latest"), separators=(",", ":")),
                "runner_timeout": "360",
            },
        )

    def test_real_main_push_and_dispatch_select_mac_profiles_with_exact_job_labels(self):
        for event in ("push", "workflow_dispatch"):
            with self.subTest(event=event):
                decision, outputs = self.route({"GITHUB_EVENT_NAME": event})
                self.assertTrue(decision["required"])
                self.assertEqual(outputs["runner_timeout"], "130")
                runners = json.loads(outputs["runners"])
                self.assertEqual(set(runners), set(SCOPE.MAC_JOBS))
                primary = "ledova-mac-linux-arm64-pilot"
                secondary = "ledova-mac-linux-arm64-ordinary-pilot"
                labels = set()
                for job, route in runners.items():
                    group = primary if job in SCOPE.MAC_PRIMARY_JOBS else secondary
                    self.assertEqual(route["group"], group)
                    self.assertEqual(route["labels"], [group, "ledova-main-123456789-1", f"ledova-job-{job}"])
                    self.assertNotIn(tuple(route["labels"]), labels)
                    labels.add(tuple(route["labels"]))
                self.assertEqual(len(labels), 12)

    def test_distinct_runs_and_attempts_require_distinct_guest_labels(self):
        labels = []
        for run_id, attempt in (("123456789", "1"), ("123456790", "1"), ("123456789", "2")):
            with self.subTest(run=run_id, attempt=attempt):
                context = {"GITHUB_RUN_ID": run_id, "GITHUB_RUN_ATTEMPT": attempt}
                decision, outputs = self.route(context)
                self.assertEqual(self.route(context), (decision, outputs))
                expected = f"ledova-main-{run_id}-{attempt}"
                selected = json.loads(outputs["runners"])["backend-scoped"]["labels"]
                self.assertEqual(len(selected), 3)
                self.assertEqual(selected[1], expected)
                labels.append(expected)
        self.assertEqual(len(set(labels)), 3)

    def test_missing_case_changed_foreign_and_other_contexts_stay_standard(self):
        changes = [{key: value} for key in self.CONTEXT for value in (None, "")]
        changes.extend(
            {"GITHUB_EVENT_NAME": event}
            for event in ("pull_request", "pull_request_target", "schedule", "PUSH", "WORKFLOW_DISPATCH", "unknown")
        )
        changes.extend(
            {"GITHUB_REPOSITORY": repository}
            for repository in ("ledova/ledova", "Ledova/Ledova", "fork/ledova", "Ledova/ledova-extra", " Ledova/ledova")
        )
        changes.extend(
            {"GITHUB_REF": ref}
            for ref in (
                "refs/heads/codex/943-trusted-selfhosted-pilot-runs",
                "refs/heads/codex/943-trusted-selfhosted-pilot",
                "refs/heads/Main",
                "refs/tags/main",
                "refs/heads/main-extra",
                "prefix/refs/heads/main",
                "refs/pull/123/merge",
                "main",
            )
        )
        changes.append(dict.fromkeys(self.CONTEXT))
        for change in changes:
            with self.subTest(context=change):
                decision, outputs = self.route(change)
                self.assertTrue(decision["required"])
                self.assert_standard(outputs)

    def test_invalid_run_ids_and_attempts_stay_standard(self):
        for key in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"):
            for value in ("0", "-1", "+1", "01", "1.0", "1e2", " 1", "1 ", "1\n", "１２3", "١", "a", "1-1"):
                with self.subTest(key=key, value=value):
                    decision, outputs = self.route({key: value})
                    self.assertTrue(decision["required"])
                    self.assert_standard(outputs)

    def test_cli_event_arguments_cannot_supply_or_override_runner_context(self):
        for changes in ({}, {"GITHUB_EVENT_NAME": "pull_request"}, {"GITHUB_EVENT_NAME": None}):
            for event in ("push", "workflow_dispatch", "pull_request", "unknown"):
                with self.subTest(context=changes, argument=event):
                    _, outputs = self.route(changes, arguments=("--event", event))
                    self.assertEqual(json.loads(outputs["runners"]), dict.fromkeys(SCOPE.MAC_JOBS, "ubuntu-latest"))
                    self.assertEqual(outputs["runner_timeout"], "360")

    def test_preferred_main_context_does_not_add_native_runner_outputs(self):
        for event in ("push", "workflow_dispatch"):
            with self.subTest(event=event):
                decision, outputs = self.route({"GITHUB_EVENT_NAME": event}, scope="native")
                self.assertTrue(decision["required"])
                self.assertEqual(outputs, {"required": "true"})


class NativeBuildVerdictTest(unittest.TestCase):
    def needs(self, required="true", routing="success", android="success", ios="success"):
        return {
            "scope": {"result": routing, "outputs": {"required": required}},
            "android": {"result": android},
            "ios": {"result": ios},
        }

    def passes(self, needs):
        return SCOPE.verdict(needs, SCOPE.JOBS["native"])

    def test_required_builds_and_intentional_skips_both_have_positive_controls(self):
        self.assertTrue(self.passes(self.needs()))
        self.assertTrue(self.passes(self.needs(required="false", android="skipped", ios="skipped")))

    def test_routing_failure_cancellation_missing_and_invalid_output_cannot_pass(self):
        for routing in ("failure", "cancelled", "skipped", ""):
            with self.subTest(routing=routing):
                self.assertFalse(self.passes(self.needs(routing=routing)))
                self.assertFalse(
                    self.passes(self.needs(required="false", routing=routing, android="skipped", ios="skipped"))
                )
        for required in (None, True, "", "FALSE", "maybe"):
            with self.subTest(required=required):
                self.assertFalse(self.passes(self.needs(required=required)))
                self.assertFalse(self.passes(self.needs(required=required, android="skipped", ios="skipped")))
        for needs in (None, [], {}, {"scope": {"result": "success", "outputs": None}}):
            with self.subTest(needs=needs):
                self.assertFalse(self.passes(needs))

    def test_either_native_job_failure_cancellation_or_unexpected_skip_cannot_pass(self):
        for platform in ("android", "ios"):
            for result in ("failure", "cancelled", "skipped", ""):
                with self.subTest(platform=platform, result=result):
                    self.assertFalse(self.passes(self.needs(**{platform: result})))

    def test_skip_decision_with_unexpected_job_results_cannot_pass(self):
        self.assertFalse(self.passes(self.needs(required="false")))

    def test_verdict_cli_exits_nonzero_on_invalid_or_failed_dependency_results(self):
        for needs in ("not-json", json.dumps(self.needs(ios="failure"))):
            with self.subTest(needs=needs):
                result = subprocess.run(
                    [sys.executable, str(SCRIPT), "verdict", "native"],
                    env={**os.environ, "JOB_RESULTS": needs},
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(result.returncode, 1)


class DjangoVerdictTest(unittest.TestCase):
    def needs(self, required="true", shards="success", backend=None):
        return {
            "scope": {"result": "success", "outputs": {"required": required}},
            "backend-suite-shard": {"result": shards},
            "backend": {"result": shards if backend is None else backend},
            "backend-scoped": {"result": shards},
            "backend-chain": {"result": shards},
        }

    def test_a_failed_chain_or_missing_scoped_job_cannot_pass(self):
        needs = self.needs()
        needs["backend-scoped"] = {"result": "success"}
        needs["backend-chain"] = {"result": "failure"}
        with self.subTest(chain="failure"):
            self.assertFalse(SCOPE.verdict(needs, SCOPE.JOBS["django"]))
        needs["backend-chain"]["result"] = "success"
        del needs["backend-scoped"]
        with self.subTest(scoped="missing"):
            self.assertFalse(SCOPE.verdict(needs, SCOPE.JOBS["django"]))

    def test_django_jobs_that_ran_or_were_rightly_skipped_pass_and_nothing_else_does(self):
        for required, shards, backend, passed in (
            ("true", "success", "success", True),
            ("false", "skipped", "skipped", True),
            ("true", "skipped", "skipped", False),
            ("true", "failure", "success", False),
            ("true", "success", "failure", False),
            ("true", "success", "skipped", False),
            ("false", "skipped", "success", False),
            ("false", "success", "skipped", False),
        ):
            with self.subTest(required=required, shards=shards, backend=backend):
                self.assertEqual(SCOPE.verdict(self.needs(required, shards, backend), SCOPE.JOBS["django"]), passed)

    def test_verdict_cli_judges_the_django_jobs(self):
        failed_chain = self.needs()
        failed_chain["backend-chain"]["result"] = "failure"
        missing_scoped = self.needs()
        del missing_scoped["backend-scoped"]
        for needs, status in (
            (json.dumps(self.needs("false", "skipped")), 0),
            (json.dumps(self.needs("true", "cancelled")), 1),
            (json.dumps(failed_chain), 1),
            (json.dumps(missing_scoped), 1),
            ("not-json", 1),
        ):
            with self.subTest(needs=needs):
                result = subprocess.run(
                    [sys.executable, str(SCRIPT), "verdict", "django"],
                    env={**os.environ, "JOB_RESULTS": needs},
                    capture_output=True,
                    text=True,
                )
                self.assertEqual(result.returncode, status)

    def test_each_required_group_must_have_the_expected_result(self):
        for required, good, bad in (
            ("true", "success", ("failure", "cancelled", "skipped", "", None)),
            ("false", "skipped", ("success", "failure", "cancelled", "", None)),
        ):
            for job in ("backend-suite-shard", "backend", "backend-scoped", "backend-chain"):
                for result in bad:
                    with self.subTest(required=required, job=job, result=result):
                        needs = self.needs(required, good)
                        needs[job]["result"] = result
                        self.assertFalse(SCOPE.verdict(needs, SCOPE.JOBS["django"]))
                for malformed in (None, [], {}, "success"):
                    with self.subTest(required=required, job=job, malformed=malformed):
                        needs = self.needs(required, good)
                        needs[job] = malformed
                        self.assertFalse(SCOPE.verdict(needs, SCOPE.JOBS["django"]))
                with self.subTest(required=required, job=job, missing=True):
                    needs = self.needs(required, good)
                    del needs[job]
                    self.assertFalse(SCOPE.verdict(needs, SCOPE.JOBS["django"]))

    def test_routing_failure_missing_and_invalid_output_cannot_pass(self):
        for required, result in (("true", "success"), ("false", "skipped")):
            for routing in ("failure", "cancelled", "skipped", "", None):
                with self.subTest(required=required, routing=routing):
                    needs = self.needs(required, result)
                    needs["scope"]["result"] = routing
                    self.assertFalse(SCOPE.verdict(needs, SCOPE.JOBS["django"]))
            for invalid in (None, True, "", "FALSE", "maybe"):
                with self.subTest(required=required, invalid=invalid):
                    needs = self.needs(required, result)
                    needs["scope"]["outputs"]["required"] = invalid
                    self.assertFalse(SCOPE.verdict(needs, SCOPE.JOBS["django"]))
        for needs in (None, [], {}, {"scope": {"result": "success", "outputs": None}}):
            with self.subTest(needs=needs):
                self.assertFalse(SCOPE.verdict(needs, SCOPE.JOBS["django"]))


class DjangoWorkflowTest(unittest.TestCase):
    def setUp(self):
        path = SCRIPT.parent.parent / ".github" / "workflows" / "ci.yml"
        self.workflow = yaml.safe_load(path.read_text())
        self.jobs = self.workflow["jobs"]

    def commands(self):
        return [
            (job, step, " ".join(step["run"].replace("\\\n", " ").split()))
            for job, definition in self.jobs.items()
            for step in definition["steps"]
            if "run" in step
        ]

    def test_all_backend_groups_are_required_scope_only_siblings(self):
        groups = ("backend-suite-shard", "backend", "backend-scoped", "backend-chain")
        self.assertEqual(SCOPE.JOBS["django"], groups)
        verdict = self.jobs["backend-suite"]
        self.assertEqual(verdict["if"], "always()")
        self.assertCountEqual(verdict["needs"], ("scope", *groups))
        for name in groups:
            with self.subTest(job=name):
                job = self.jobs[name]
                self.assertEqual(job["needs"], "scope")
                self.assertEqual(job["if"], "needs.scope.outputs.required == 'true'")
                self.assertFalse(job.get("continue-on-error", False))
                self.assertTrue(all(not step.get("continue-on-error", False) for step in job["steps"]))

    def test_mac_routes_reach_all_compatible_jobs_and_keep_the_scope_bootstrap_hosted(self):
        events = self.workflow.get("on", self.workflow.get(True))
        self.assertEqual(set(events), {"push", "pull_request", "workflow_dispatch"})
        self.assertIsNone(events["workflow_dispatch"])
        self.assertEqual(set(self.jobs["scope"]["outputs"]), {"required", "runners", "runner_timeout"})
        for output in ("runners", "runner_timeout"):
            self.assertEqual(self.jobs["scope"]["outputs"][output], "${{ steps.scope.outputs." + output + " }}")
        self.assertEqual(self.jobs["scope"]["runs-on"], "ubuntu-latest")
        for name in ("source-gates", "javascript", "backend", "backend-scoped", "backend-chain"):
            with self.subTest(job=name):
                job = self.jobs[name]
                self.assertEqual(job["needs"], "scope")
                self.assertEqual(job["runs-on"], "${{ fromJSON(needs.scope.outputs.runners)['" + name + "'] }}")
                self.assertEqual(job["timeout-minutes"], "${{ fromJSON(needs.scope.outputs.runner_timeout) }}")
        for name in ("source-gates", "javascript"):
            self.assertNotIn("if", self.jobs[name])
        shard = self.jobs["backend-suite-shard"]
        self.assertEqual(
            shard["runs-on"],
            "${{ fromJSON(needs.scope.outputs.runners)[format('backend-suite-shard-{0}', matrix.shard)] }}",
        )
        self.assertEqual(shard["timeout-minutes"], "${{ fromJSON(needs.scope.outputs.runner_timeout) }}")
        routed = {name for name in self.jobs if name not in ("scope", "backend-suite-shard")} | {
            "backend-suite-shard-" + shard for shard in shard["strategy"]["matrix"]["shard"]
        }
        self.assertEqual(routed, set(SCOPE.MAC_JOBS))
        verdict = self.jobs["backend-suite"]
        self.assertEqual(verdict["if"], "always()")
        self.assertEqual(
            verdict["runs-on"],
            "${{ needs.scope.result == 'success' && "
            "fromJSON(needs.scope.outputs.runners)['backend-suite'] || 'ubuntu-latest' }}",
        )
        self.assertEqual(verdict["timeout-minutes"], "${{ fromJSON(needs.scope.outputs.runner_timeout || '360') }}")

    def test_runner_routing_keeps_all_ordinary_shards_and_one_complete_inventory(self):
        shard = self.jobs["backend-suite-shard"]
        self.assertEqual(
            shard["strategy"],
            {
                "fail-fast": False,
                "matrix": {
                    "shard": ["tokens-1", "tokens-2", "tokens-3", "shared-wallets", "companies-users", "others"]
                },
            },
        )
        self.assertEqual(shard["services"]["postgres"], self.jobs["backend"]["services"]["postgres"])
        inventory = [row for row in self.commands() if row[2] == "python ../scripts/check-ordinary-shards.py"]
        self.assertEqual(len(inventory), 1)
        self.assertEqual(inventory[0][0], "backend-suite-shard")
        self.assertEqual(inventory[0][1]["if"], "strategy.job-index == 0")
        suites = [row for row in self.commands() if "check-ordinary-shards.py --run" in row[2]]
        self.assertEqual(len(suites), 1)
        self.assertEqual(suites[0][0], "backend-suite-shard")
        self.assertEqual(suites[0][2], "python ../scripts/check-ordinary-shards.py --run ${{ matrix.shard }}")
        self.assertNotIn("if", suites[0][1])

    def test_scoped_coverage_is_unlabelled_required_and_runs_exactly_once(self):
        matches = [row for row in self.commands() if "--settings=ledova_backend.settings.test_scoped" in row[2]]
        self.assertEqual(len(matches), 1)
        job, step, command = matches[0]
        self.assertEqual(job, "backend-scoped")
        self.assertNotIn("if", step)
        self.assertEqual(
            shlex.split(command),
            [
                "python",
                "manage.py",
                "test",
                "--settings=ledova_backend.settings.test_scoped",
                "--require-scoped-coverage",
                "--parallel",
                "4",
                "--noinput",
                "--durations",
                "0",
                "--verbosity",
                "2",
                "--timing",
            ],
        )

    def test_real_engine_commands_and_redis_preflight_run_once_in_the_chain_job(self):
        evm = [row for row in self.commands() if "make chain-test" in row[2]]
        bitcoin = [row for row in self.commands() if "scripts/test-bitcoin-chain.py" in row[2]]
        self.assertEqual((len(evm), len(bitcoin)), (1, 1))
        job, step, command = evm[0]
        self.assertEqual(job, "backend-chain")
        self.assertNotIn("if", step)
        self.assertEqual(step["working-directory"], ".")
        self.assertEqual(step["env"]["REDIS_URL"], "redis://127.0.0.1:6379/0")
        self.assertIn("timeout --kill-after=2s 10s python backend/manage.py shell --command", command)
        self.assertIn("Redis.from_url(settings.REDIS_URL, socket_connect_timeout=2, socket_timeout=2).ping()", command)
        self.assertTrue(command.endswith("make chain-test PYTHON=python"))
        self.assertEqual(bitcoin[0][0], "backend-chain")
        self.assertEqual(bitcoin[0][2], "python scripts/test-bitcoin-chain.py")
        self.assertNotIn("if", bitcoin[0][1])

    def test_new_jobs_keep_the_isolated_services_and_bootstrap_their_own_database(self):
        commands = self.commands()
        for name, bootstrap in (
            ("backend-scoped", "python manage.py migrate --settings=ledova_backend.settings.test_postgres --noinput"),
            ("backend-chain", "python manage.py migrate --noinput"),
        ):
            with self.subTest(job=name):
                job = self.jobs[name]
                self.assertEqual(job["runs-on"], "${{ fromJSON(needs.scope.outputs.runners)['" + name + "'] }}")
                self.assertEqual(job["env"], self.jobs["backend"]["env"])
                self.assertEqual(job["services"], self.jobs["backend"]["services"])
                self.assertEqual(job["services"]["postgres"]["image"], "postgres:16")
                self.assertEqual(job["services"]["redis"]["image"], "redis:7-alpine")
                setup = next(step for step in job["steps"] if step.get("uses", "").startswith("actions/setup-python@"))
                self.assertEqual(setup["with"]["python-version"], "3.13.15")
                self.assertIn((name, bootstrap), [(owner, command) for owner, _, command in commands])
                self.assertIn(
                    (name, "pip install -r requirements-dev.txt -c schema/requirements.txt"),
                    [(owner, command) for owner, _, command in commands],
                )

    def test_remaining_backend_boundaries_and_schema_artifact_stay_required(self):
        runs = [(step, command) for name, step, command in self.commands() if name == "backend"]
        for command in (
            "pip-audit -r requirements.txt --ignore-vuln PYSEC-2026-1845",
            "make lint",
            "python manage.py check",
            "python manage.py makemigrations --check --dry-run",
            "python manage.py check_rls_roles",
            "python manage.py check_rls_catalogue",
            "python manage.py export_api_schema --settings=ledova_backend.settings.test_postgres",
            "python ../scripts/check-api-schema.py --schema /tmp/ledova-schema.json",
            "python manage.py test authentication.tests.redis_throttle",
            "python manage.py test shared.tests.redis_uploads",
            "python manage.py test shared.tests.clamav_uploads",
        ):
            with self.subTest(command=command):
                matches = [
                    step
                    for step, run in runs
                    if command in run and (command != "python manage.py check" or run == command)
                ]
                self.assertEqual(len(matches), 1)
                self.assertNotIn("if", matches[0])
        cleanup = next(step for step, run in runs if "docker rm -f -v ledova-upload-clamav" in run)
        self.assertEqual(cleanup["if"], "always()")
        artifacts = [
            (name, step)
            for name, job in self.jobs.items()
            for step in job["steps"]
            if step.get("with", {}).get("name") == "api-schema-contract"
        ]
        self.assertEqual(len(artifacts), 1)
        self.assertEqual(artifacts[0][0], "backend")
        self.assertEqual(artifacts[0][1]["if"], "always()")


if __name__ == "__main__":
    unittest.main()
