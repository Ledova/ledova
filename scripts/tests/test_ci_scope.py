import importlib.util
import json
import os
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


class UniqueKeysLoader(yaml.SafeLoader):
    def construct_mapping(self, node, deep=False):
        self.flatten_mapping(node)
        mapping = {}
        for key_node, value_node in node.value:
            key = self.construct_object(key_node, deep=deep)
            if key in mapping:
                raise yaml.constructor.ConstructorError(None, None, f"Duplicate key: {key}", key_node.start_mark)
            mapping[key] = self.construct_object(value_node, deep=deep)
        return mapping


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

    def test_javascript_test_only_additions_edits_and_deletions_skip_native(self):
        paths = (
            "mobile/src/screens/trading/swap-settlements.test.tsx",
            "mobile/src/services/swapSettlements.test.ts",
            "packages/shared/tests/utils/swap-settlement.test.ts",
            "packages/shared/tests/fixtures/swap-settlements.ts",
            "packages/shared/tests/fixtures/swap-settlement-api.json",
        )
        base = self.base
        for operation in ("add", "edit", "delete"):
            head = self.commit({path: operation for path in paths}) if operation != "delete" else self.commit({}, paths)
            for event in ("pull_request", "push"):
                with self.subTest(operation=operation, event=event):
                    decision = self.decision(head, base=base, event=event)
                    self.assertFalse(decision["required"])
                    self.assertEqual(decision["changed_files"], len(paths))
            base = head

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
            "mobile/native-tests/ScannerBridgeProbe.test.tsx",
            "mobile/scripts/native-smoke.mjs",
            "mobile/scripts/tests/native-probe-tls.test.mjs",
            "mobile/modules/ledova-scanner/src/bridge.test.ts",
            "mobile/src/screens/trading/swap-settlements.tsx",
            "mobile/src/services/swapSettlements.ts",
            "mobile/src/services/swapSettlements.spec.ts",
            "mobile/src/services/swapSettlements.test.ts.map",
            "mobile/src/native/NativeProbe.ios.test.ts",
            "mobile/src/native/NativeProbe.android.test.ts",
            "mobile/src/native/ProbeNativeComponent.ios.test.tsx",
            "mobile/src/native/ProbeNativeComponent.android.test.tsx",
            "mobile/src/native/NativeProbe.fb.ios.test.ts",
            "mobile/src/native/NativeProbe.fb.android.test.ts",
            "mobile/src/native/ProbeNativeComponent.fb.ios.test.tsx",
            "mobile/src/native/ProbeNativeComponent.fb.android.test.tsx",
            "mobile/src/native/NativeProbe.test.ts",
            "mobile/src/native/ProbeNativeComponent.test.tsx",
            "mobile/src/tests/helper.ts",
            "mobile/src-other/screen.test.tsx",
            "mobile/src/.gitattributes",
            "packages/shared/src/utils/swap-settlement.test.ts",
            "packages/shared/tests/.gitattributes",
            "packages/shared/tests/fixtures/.gitattributes",
            "packages/shared/tests-other/swap-settlement.test.ts",
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
            "scripts/ci-scope.py",
            "scripts/tests/test_ci_scope.py",
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

    def test_renames_between_tests_and_production_require_native(self):
        test_path = "mobile/src/screens/trading/swap-settlements.test.tsx"
        test_head = self.commit({test_path: "app"}, removed=("mobile/app.ts",))
        production_head = self.commit({"mobile/src/screens/trading/swap-settlements.tsx": "app"}, (test_path,))
        for event in ("pull_request", "push"):
            with self.subTest(event=event):
                self.assertTrue(self.decision(test_head, event=event)["required"])
                self.assertTrue(self.decision(production_head, base=test_head, event=event)["required"])
                self.assertEqual(self.decision(test_head, event=event)["changed_files"], 2)
                self.assertEqual(self.decision(production_head, base=test_head, event=event)["changed_files"], 2)

    def test_test_only_exception_does_not_hide_an_earlier_production_change(self):
        production_head = self.commit({"mobile/src/screens/trading/swap-settlements.tsx": "changed"})
        head = self.commit(
            {
                "mobile/src/screens/trading/swap-settlements.test.tsx": "test",
                "packages/shared/tests/utils/swap-settlement.test.ts": "test",
            }
        )
        for event in ("pull_request", "push"):
            with self.subTest(event=event):
                self.assertTrue(self.decision(head, event=event)["required"])
                self.assertEqual(self.decision(head, event=event)["changed_files"], 3)
                self.assertFalse(self.decision(head, base=production_head, event=event)["required"])

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
            "scripts/ci-scope.py.bak",
            "scripts/tests/test_ci_scope.py.bak",
            "nested/scripts/ci-scope.py",
            "backend/ledova_backend/settings/test.py",
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
                head = self.commit(
                    {
                        "scripts/ci-scope.py": "routing policy",
                        "scripts/tests/test_ci_scope.py": "routing controls",
                        "dashboard/src/index.tsx": "changed",
                        path: "changed",
                    }
                )
                self.assertTrue(self.decision(head, scope="django")["required"])
            self.git("reset", "--hard", self.base)

    def test_routing_policy_only_changes_skip_django_on_prs_and_run_on_main(self):
        paths = ("scripts/ci-scope.py", "scripts/tests/test_ci_scope.py")
        base = self.base
        for operation in ("add", "edit", "delete"):
            head = self.commit({path: operation for path in paths}) if operation != "delete" else self.commit({}, paths)
            for event, required in (("pull_request", False), ("push", True), ("workflow_dispatch", True)):
                with self.subTest(operation=operation, event=event):
                    decision = self.decision(head, base=base, event=event, scope="django")
                    self.assertEqual(decision["required"], required)
                    if event == "pull_request":
                        self.assertEqual(decision["changed_files"], len(paths))
            base = head

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

    def test_main_push_keeps_core_but_selects_extras_from_the_complete_range(self):
        head = self.commit({"docs/guide.md": "updated"})
        decision = self.decision(head, event="push", scope="django")
        self.assertTrue(decision["required"])
        self.assertTrue(decision["checks_required"])
        self.assertEqual(
            {name: decision[name] for name in SCOPE.CI_FLAGS[1:]}, dict.fromkeys(SCOPE.CI_FLAGS[1:], False)
        )
        for event in ("workflow_dispatch", "unknown"):
            decision = self.decision(head, event=event, scope="django")
            self.assertTrue(decision["required"])
            self.assertEqual({name: decision[name] for name in SCOPE.CI_FLAGS}, dict.fromkeys(SCOPE.CI_FLAGS, True))
        integration = self.commit({"backend/shared/uploads.py": "changed"})
        head = self.commit({"docs/guide.md": "later docs"})
        decision = self.decision(head, base=integration, event="push", scope="django")
        self.assertFalse(decision["uploads"])
        self.assertTrue(self.decision(head, event="push", scope="django")["uploads"])

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
            "required=false\nchecks_required=true\njavascript_required=false\ntooling_required=false\n"
            "uploads=false\nchains=false\naudit=false\nrunners="
            + json.dumps(dict.fromkeys(SCOPE.MAC_JOBS, "ubuntu-latest"), separators=(",", ":"))
            + "\nrunner_timeout=360\n",
        )


class SharedPathClassificationTest(unittest.TestCase):
    def test_only_relevant_client_and_real_integration_inputs_are_selected(self):
        for path, backend, javascript, tooling, uploads, chains, audit in (
            ("docs/guide.md", False, False, False, False, False, False),
            ("scripts/preflight.py", False, False, True, False, False, False),
            ("scripts/check-pr-metadata.py", False, False, True, False, False, False),
            ("backend/tokens/tests/test_register_grants.py", True, False, False, False, False, False),
            ("backend/tokens/migrations/0001_baseline.py", True, False, False, False, False, False),
            ("backend/tokens/services/register_grants.py", True, False, False, False, False, False),
            ("backend/tokens/baseline.sql", True, False, False, True, True, False),
            ("backend/shared/db/policy_sql.py", True, False, False, True, True, False),
            ("backend/shared/uploads.py", True, False, False, True, False, False),
            ("backend/shared/tests/clamav_uploads.py", True, False, False, True, False, False),
            ("backend/authentication/throttles.py", True, False, False, True, False, False),
            ("backend/authentication/email.py", True, False, False, True, False, False),
            ("backend/authentication/views/user.py", True, True, False, True, False, False),
            ("backend/authentication/serializers/user.py", True, True, False, True, False, False),
            ("backend/authentication/serializers/fields.py", True, True, False, True, False, False),
            ("backend/shared/api/exceptions.py", True, True, False, True, False, False),
            ("backend/authentication/services/sessions.py", True, False, False, False, False, False),
            ("backend/authentication/tests/redis_throttle.py", True, False, False, True, False, False),
            ("backend/blockchain/tests/test_outgoing.py", True, False, False, False, False, False),
            ("backend/tokens/tests/test_chain_integration.py", True, False, False, False, True, False),
            ("backend/tokens/services/issuance_execution.py", True, False, False, False, True, False),
            ("backend/tokens/models/share_token.py", True, True, False, False, True, False),
            ("backend/tokens/views/register_grant.py", True, True, False, False, False, False),
            ("contracts/contracts/ShareToken.sol", True, True, False, False, True, False),
            ("packages/shared/tests/utils/swap-settlement.test.ts", False, True, False, False, False, False),
            ("mobile/package-lock.json", False, True, False, False, False, True),
            ("backend/requirements.txt", True, False, False, True, True, True),
            ("new-input/file.txt", True, True, True, True, True, True),
            ("scripts/new-runtime.py", True, True, True, True, True, True),
        ):
            with self.subTest(path=path):
                result = SCOPE.classify_paths("django", [path])
                self.assertEqual(
                    {name: result.get(name) for name in ("required", "checks_required", *SCOPE.CI_FLAGS[1:])},
                    dict(
                        required=backend,
                        checks_required=True,
                        javascript_required=javascript,
                        tooling_required=tooling,
                        uploads=uploads,
                        chains=chains,
                        audit=audit,
                    ),
                )

    def test_empty_and_unknown_comparisons_have_complete_typed_phase_outputs(self):
        for paths, expected in (([], False), (None, True), (["docs/../file"], True), (["docs/.gitattributes"], True)):
            with self.subTest(paths=paths):
                decision = SCOPE.classify_paths("django", paths)
                self.assertEqual(
                    {name: decision[name] for name in SCOPE.CI_FLAGS}, dict.fromkeys(SCOPE.CI_FLAGS, expected)
                )
                self.assertTrue(all(type(decision[name]) is bool for name in SCOPE.CI_FLAGS))

    def test_verified_paths_use_the_same_native_and_django_boundaries_without_io(self):
        for paths, native, django in (
            ([], False, False),
            (["docs/guide.md", "AGENTS.md", "CONTRIBUTING.md"], False, False),
            (["dashboard/src/index.tsx"], False, False),
            (["mobile/app.ts"], True, False),
            (["packages/shared/src/index.ts"], True, False),
            (["docs/.gitattributes"], True, True),
            (["backend/new.py"], False, True),
            (["new-input/file.txt"], False, True),
            (["docs/a b\tc\nd.md"], False, False),
        ):
            with self.subTest(paths=paths):
                with patch.object(SCOPE, "documents_named_in", side_effect=AssertionError("unexpected I/O")):
                    for scope, required in (("native", native), ("django", django)):
                        decision = SCOPE.classify_paths(scope, paths)
                        self.assertEqual(decision["required"], required)
                        self.assertEqual(decision["changed_files"], len(paths))

    def test_named_backend_documents_override_only_the_django_document_exemption(self):
        for name in ("docs/architecture/tenancy.md", "AGENTS.md", "CONTRIBUTING.md"):
            with self.subTest(name=name):
                self.assertFalse(SCOPE.classify_paths("django", [name])["required"])
                self.assertTrue(SCOPE.classify_paths("django", [name], named_documents=(name,))["required"])
                self.assertFalse(SCOPE.classify_paths("native", [name], named_documents=(name,))["required"])

    def test_unavailable_or_malformed_path_evidence_requires_coverage(self):
        evidence = (
            None,
            "docs/guide.md",
            b"docs/guide.md",
            {},
            [""],
            [12],
            ["docs/a\0b.md"],
            ["/docs/guide.md"],
            ["docs//guide.md"],
            ["docs/../guide.md"],
            ["./docs/guide.md"],
            ["docs/\udcff.md"],
        )
        for paths in evidence:
            for scope in ("django", "native"):
                with self.subTest(paths=paths, scope=scope):
                    decision = SCOPE.classify_paths(scope, paths)
                    self.assertTrue(decision["required"])
                    self.assertNotIn("changed_files", decision)
                    self.assertEqual(decision["reason"], "Complete ancestor comparison unavailable")

    def test_unknown_scope_is_refused(self):
        with self.assertRaises(ValueError):
            SCOPE.classify_paths("unknown", ["docs/guide.md"])


class LocalPreviewTest(ScopeCase):
    def test_explicit_complete_diff_keeps_exemption_and_cannot_write_github_output(self):
        head = self.commit({"docs/guide.md": "updated"})
        event = self.repository / "explicit-event.json"
        event.write_text(json.dumps({"pull_request": {"base": {"sha": self.base}, "head": {"sha": head}}}))
        inherited = self.repository / "inherited-event.json"
        inherited.write_text("not-json")
        output = self.repository / "github-output"
        output.write_text("preserved\n")
        for scope in ("native", "django"):
            with self.subTest(scope=scope):
                result = subprocess.run(
                    [
                        sys.executable,
                        str(SCRIPT),
                        "route",
                        scope,
                        "--local-preview",
                        "--event",
                        "pull_request",
                        "--event-file",
                        str(event),
                        "--repository",
                        str(self.repository),
                    ],
                    env={
                        **os.environ,
                        **PreferredMainRunnerTest.CONTEXT,
                        "GITHUB_EVENT_PATH": str(inherited),
                        "GITHUB_OUTPUT": str(output),
                    },
                    check=True,
                    capture_output=True,
                    text=True,
                )
                decision = json.loads(result.stdout)
                self.assertFalse(decision["required"])
                self.assertEqual(decision["changed_files"], 1)
                if scope == "django":
                    self.assertEqual(decision["runners"], dict.fromkeys(SCOPE.MAC_JOBS, "ubuntu-latest"))
                else:
                    self.assertNotIn("runners", decision)
                self.assertEqual(output.read_text(), "preserved\n")


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
                **dict.fromkeys(SCOPE.CI_FLAGS, "true"),
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
                self.assertEqual(len(labels), 2)

    def test_distinct_runs_and_attempts_require_distinct_guest_labels(self):
        labels = []
        for run_id, attempt in (("123456789", "1"), ("123456790", "1"), ("123456789", "2")):
            with self.subTest(run=run_id, attempt=attempt):
                context = {"GITHUB_RUN_ID": run_id, "GITHUB_RUN_ATTEMPT": attempt}
                decision, outputs = self.route(context)
                self.assertEqual(self.route(context), (decision, outputs))
                expected = f"ledova-main-{run_id}-{attempt}"
                selected = json.loads(outputs["runners"])["backend"]["labels"]
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

    def test_local_preview_ignores_inherited_event_runner_and_output_identity(self):
        with tempfile.TemporaryDirectory() as directory:
            repository = Path(directory)
            event = repository / "event.json"
            event.write_text("{}")
            output = repository / "github-output"
            output.write_text("preserved\n")
            environment = {
                **os.environ,
                **self.CONTEXT,
                "GITHUB_EVENT_PATH": str(event),
                "GITHUB_OUTPUT": str(output),
            }
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "route", "django", "--local-preview"],
                env=environment,
                check=True,
                capture_output=True,
                text=True,
            )
            decision = json.loads(result.stdout)
            self.assertTrue(decision["required"])
            self.assertEqual(decision["reason"], "Complete ancestor comparison unavailable")
            self.assertEqual(decision["runners"], dict.fromkeys(SCOPE.MAC_JOBS, "ubuntu-latest"))
            self.assertEqual(decision["runner_timeout"], 360)
            self.assertEqual(output.read_text(), "preserved\n")


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
    def needs(self, required="true", backend="success", routing="success", checks="success", checks_required="true"):
        return {
            "scope": {
                "result": routing,
                "outputs": {
                    "required": required,
                    **dict.fromkeys(SCOPE.CI_FLAGS, "false"),
                    "checks_required": checks_required,
                },
            },
            "backend": {"result": backend},
            "checks": {"result": checks},
        }

    def test_checks_and_backend_verdicts_bind_their_own_selection(self):
        for required, backend, checks_required, checks in (
            ("true", "success", "true", "success"),
            ("true", "success", "false", "skipped"),
            ("false", "skipped", "true", "success"),
            ("false", "skipped", "false", "skipped"),
        ):
            needs = self.needs(required, backend, checks=checks, checks_required=checks_required)
            self.assertTrue(SCOPE.verdict(needs, SCOPE.JOBS["django"]))
            for job in ("checks", "backend"):
                for bad in (
                    "failure",
                    "cancelled",
                    None,
                    "",
                    "skipped" if needs[job]["result"] == "success" else "success",
                ):
                    with self.subTest(job=job, bad=bad):
                        broken = self.needs(required, backend, checks=checks, checks_required=checks_required)
                        broken[job]["result"] = bad
                        self.assertFalse(SCOPE.verdict(broken, SCOPE.JOBS["django"]))

    def test_missing_or_malformed_phase_flags_and_checks_results_cannot_pass(self):
        for flag in SCOPE.CI_FLAGS:
            for invalid in (None, True, False, "", "TRUE", "unknown"):
                with self.subTest(flag=flag, invalid=invalid):
                    needs = self.needs()
                    needs["scope"]["outputs"][flag] = invalid
                    self.assertFalse(SCOPE.verdict(needs, SCOPE.JOBS["django"]))
            needs = self.needs()
            del needs["scope"]["outputs"][flag]
            self.assertFalse(SCOPE.verdict(needs, SCOPE.JOBS["django"]))
        for malformed in (None, [], {}, "success"):
            needs = self.needs()
            needs["checks"] = malformed
            self.assertFalse(SCOPE.verdict(needs, SCOPE.JOBS["django"]))
        needs = self.needs()
        del needs["checks"]
        self.assertFalse(SCOPE.verdict(needs, SCOPE.JOBS["django"]))

    def test_the_complete_backend_group_must_succeed_or_be_rightly_skipped(self):
        for required, result, passed in (
            ("true", "success", True),
            ("false", "skipped", True),
            ("true", "skipped", False),
            ("true", "failure", False),
            ("true", "cancelled", False),
            ("false", "success", False),
            ("false", "failure", False),
            ("false", "cancelled", False),
        ):
            with self.subTest(required=required, result=result):
                self.assertEqual(SCOPE.verdict(self.needs(required, result), SCOPE.JOBS["django"]), passed)

    def test_missing_and_malformed_backend_results_cannot_pass(self):
        for required, good in (("true", "success"), ("false", "skipped")):
            for malformed in (None, [], {}, "success", {"result": None}, {"result": ""}):
                with self.subTest(required=required, result=malformed):
                    needs = self.needs(required, good)
                    needs["backend"] = malformed
                    self.assertFalse(SCOPE.verdict(needs, SCOPE.JOBS["django"]))
            with self.subTest(required=required, missing=True):
                needs = self.needs(required, good)
                del needs["backend"]
                self.assertFalse(SCOPE.verdict(needs, SCOPE.JOBS["django"]))

    def test_routing_failure_missing_and_invalid_output_cannot_pass(self):
        for required, result in (("true", "success"), ("false", "skipped")):
            for routing in ("failure", "cancelled", "skipped", "", None):
                with self.subTest(required=required, routing=routing):
                    self.assertFalse(SCOPE.verdict(self.needs(required, result, routing), SCOPE.JOBS["django"]))
            for invalid in (None, True, "", "FALSE", "maybe"):
                with self.subTest(required=required, invalid=invalid):
                    self.assertFalse(SCOPE.verdict(self.needs(invalid, result), SCOPE.JOBS["django"]))
        for needs in (None, [], {}, {"scope": {"result": "success", "outputs": None}}):
            with self.subTest(needs=needs):
                self.assertFalse(SCOPE.verdict(needs, SCOPE.JOBS["django"]))

    def test_verdict_cli_judges_the_complete_backend_group(self):
        for needs, status in (
            (json.dumps(self.needs("false", "skipped")), 0),
            (json.dumps(self.needs()), 0),
            (json.dumps(self.needs(backend="cancelled")), 1),
            (json.dumps({"scope": self.needs()["scope"]}), 1),
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


class DjangoWorkflowTest(unittest.TestCase):
    def setUp(self):
        path = SCRIPT.parent.parent / ".github" / "workflows" / "ci.yml"
        self.workflow = yaml.load(path.read_text(), Loader=UniqueKeysLoader)
        self.jobs = self.workflow["jobs"]

    def test_duplicate_workflow_keys_are_refused_and_checkout_never_retains_credentials(self):
        for source in (
            "jobs:\n  checks:\n    runs-on: ubuntu-latest\n    runs-on: attacker\n",
            "steps:\n  - uses: actions/checkout@v7\n    with:\n      persist-credentials: false\n"
            "    with:\n      fetch-depth: 0\n",
        ):
            with self.subTest(source=source), self.assertRaises(yaml.constructor.ConstructorError):
                yaml.load(source, Loader=UniqueKeysLoader)
        for name, job in self.jobs.items():
            checkout = [step for step in job["steps"] if step.get("uses", "").startswith("actions/checkout@")]
            with self.subTest(job=name):
                self.assertEqual(len(checkout), 1)
                self.assertIs(checkout[0]["with"]["persist-credentials"], False)
        self.assertEqual(self.jobs["scope"]["steps"][0]["with"]["fetch-depth"], 0)

    def commands(self):
        return [
            (job, step, " ".join(step["run"].replace("\\\n", " ").split()))
            for job, definition in self.jobs.items()
            for step in definition["steps"]
            if "run" in step
        ]

    def test_the_single_backend_group_and_always_verdict_remain_required(self):
        self.assertEqual(SCOPE.JOBS["django"], ("checks", "backend"))
        self.assertEqual(set(self.jobs), {"scope", "checks", "backend", "backend-suite"})
        backend = self.jobs["backend"]
        self.assertEqual(backend["needs"], "scope")
        self.assertEqual(backend["if"], "needs.scope.outputs.required == 'true'")
        self.assertFalse(backend.get("continue-on-error", False))
        self.assertTrue(all(not step.get("continue-on-error", False) for step in backend["steps"]))
        self.assertNotIn("strategy", backend)
        verdict = self.jobs["backend-suite"]
        self.assertEqual(verdict["if"], "always()")
        self.assertCountEqual(verdict["needs"], ("scope", "checks", "backend"))
        self.assertEqual(self.jobs["checks"]["needs"], "scope")
        self.assertEqual(self.jobs["checks"]["if"], "needs.scope.outputs.checks_required == 'true'")

    def test_mac_routes_reach_all_compatible_jobs_and_keep_the_scope_bootstrap_hosted(self):
        events = self.workflow.get("on", self.workflow.get(True))
        self.assertEqual(set(events), {"push", "pull_request", "workflow_dispatch"})
        self.assertIsNone(events["workflow_dispatch"])
        self.assertEqual(set(self.jobs["scope"]["outputs"]), {"required", *SCOPE.CI_FLAGS, "runners", "runner_timeout"})
        for output in (*SCOPE.CI_FLAGS, "runners", "runner_timeout"):
            self.assertEqual(self.jobs["scope"]["outputs"][output], "${{ steps.scope.outputs." + output + " }}")
        self.assertEqual(self.jobs["scope"]["runs-on"], "ubuntu-latest")
        for name in ("checks", "backend"):
            with self.subTest(job=name):
                job = self.jobs[name]
                self.assertEqual(job["needs"], "scope")
                self.assertEqual(job["runs-on"], "${{ fromJSON(needs.scope.outputs.runners)['" + name + "'] }}")
                self.assertEqual(job["timeout-minutes"], "${{ fromJSON(needs.scope.outputs.runner_timeout) }}")
        self.assertEqual(set(self.jobs) - {"scope", "backend-suite"}, set(SCOPE.MAC_JOBS))
        self.assertEqual(SCOPE.MAC_PRIMARY_JOBS, {"backend"})
        verdict = self.jobs["backend-suite"]
        self.assertEqual(verdict["runs-on"], "ubuntu-latest")
        self.assertEqual(verdict["timeout-minutes"], 5)
        self.assertEqual(self.workflow["permissions"], {"contents": "read"})

    def test_client_tooling_and_advisories_run_only_for_relevant_inputs(self):
        steps = self.jobs["checks"]["steps"]
        tooling = next(step for step in steps if step.get("run") == "make test-gates PYTHON=python")
        self.assertEqual(tooling["if"], "needs.scope.outputs.tooling_required == 'true'")
        node_index = next(
            index for index, step in enumerate(steps) if step.get("uses", "").startswith("actions/setup-node@")
        )
        for step in steps[node_index:]:
            self.assertIn("needs.scope.outputs.javascript_required == 'true'", step["if"])
        audit = next(step for step in steps if "npm audit" in step.get("run", ""))
        self.assertIn("needs.scope.outputs.audit == 'true'", audit["if"])

    def test_one_shared_backend_command_replaces_every_runtime_wrapper(self):
        commands = self.commands()
        retained = [
            (owner, step, run) for owner, step, run in commands if run.startswith("make backend-test PYTHON=python")
        ]
        self.assertEqual(len(retained), 1)
        self.assertEqual(retained[0][0], "backend")
        self.assertNotIn("if", retained[0][1])
        for flag in ("uploads", "chains", "audit"):
            self.assertIn("needs.scope.outputs." + flag + " == 'true' && '--" + flag + "' || ''", retained[0][2])
        self.assertIn("BACKEND_CHECKS=", retained[0][2])
        self.assertNotIn("defaults", self.jobs["backend"])
        for _, _, run in commands:
            for removed in (
                "check-ordinary-shards.py",
                "manage.py test",
                "manage.py migrate",
                "make chain-test",
                "test-bitcoin-chain.py",
                "ledova-upload-clamav",
            ):
                self.assertNotIn(removed, run)

    def test_the_backend_group_installs_pinned_dependencies_and_real_services(self):
        job = self.jobs["backend"]
        self.assertEqual(job["services"]["postgres"]["image"], "postgres:16")
        self.assertEqual(job["services"]["redis"]["image"], "redis:7-alpine")
        self.assertIn("pg_isready", job["services"]["postgres"]["options"])
        self.assertIn("redis-cli ping", job["services"]["redis"]["options"])
        self.assertEqual(job["env"]["POSTGRES_HOST"], "127.0.0.1")
        self.assertEqual(str(job["env"]["POSTGRES_PORT"]), "5432")
        self.assertEqual(job["env"]["POSTGRES_DB"], "ledova")
        self.assertEqual(job["env"]["POSTGRES_USER"], "ledova")
        for variable in ("REDIS_URL", "THROTTLE_TEST_REDIS_URL", "UPLOAD_TEST_REDIS_URL"):
            self.assertEqual(job["env"][variable], "redis://127.0.0.1:6379/0")
        python = next(step for step in job["steps"] if step.get("uses", "").startswith("actions/setup-python@"))
        node = next(step for step in job["steps"] if step.get("uses", "").startswith("actions/setup-node@"))
        self.assertEqual(python["with"]["python-version"], "3.13.15")
        self.assertEqual(str(node["with"]["node-version"]), "22.15.1")
        self.assertEqual(node["if"], "needs.scope.outputs.chains == 'true'")
        commands = [(owner, run) for owner, _, run in self.commands()]
        self.assertEqual(
            commands.count(
                ("backend", "pip install -r backend/requirements-dev.txt -c backend/schema/requirements.txt")
            ),
            1,
        )
        contracts = [step for owner, step, run in self.commands() if owner == "backend" and run == "npm ci"]
        self.assertEqual(len(contracts), 1)
        self.assertEqual(contracts[0]["working-directory"], "contracts")
        self.assertEqual(contracts[0]["if"], "needs.scope.outputs.chains == 'true'")

    def test_schema_and_backend_diagnostics_are_uploaded_on_every_outcome(self):
        artifacts = [
            (name, step)
            for name, job in self.jobs.items()
            for step in job["steps"]
            if step.get("uses", "").startswith("actions/upload-artifact@")
            and step.get("with", {}).get("name") in ("api-schema-contract", "backend-checks")
        ]
        self.assertEqual(len(artifacts), 2)
        self.assertEqual({step["with"]["name"] for _, step in artifacts}, {"api-schema-contract", "backend-checks"})
        for name, step in artifacts:
            self.assertEqual(name, "backend")
            self.assertEqual(step["if"], "always()")
            self.assertEqual(step["with"]["if-no-files-found"], "ignore")
        schema = next(step for _, step in artifacts if step["with"]["name"] == "api-schema-contract")
        self.assertEqual(
            schema["with"]["path"].splitlines(),
            [
                "/tmp/ledova-schema.json",
                "/tmp/ledova-schema-diagnostics.log",
                "/tmp/ledova-schema-environment.json",
                "/tmp/ledova-schema-comparison.json",
            ],
        )
        backend = next(step for _, step in artifacts if step["with"]["name"] == "backend-checks")
        self.assertEqual(backend["with"]["path"], "/tmp/ledova-backend-checks")


if __name__ == "__main__":
    unittest.main()
