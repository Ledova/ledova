import contextlib
import importlib.util
import io
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "preflight.py"
SPEC = importlib.util.spec_from_file_location("preflight", SCRIPT)
PREFLIGHT = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PREFLIGHT)
SCOPE = PREFLIGHT.module("preflight_test_scope", SCRIPT.with_name("ci-scope.py"))


class PreflightTest(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.repository = Path(temporary.name)
        self.git("init", "--quiet")
        self.git("config", "maintenance.auto", "false")
        self.write("backend/base.py", "base")
        self.write("docs/guide.md", "guide")
        self.write(".gitignore", "private.cfg\n")
        self.base = self.commit("test(#943): establish the fixture")

    def git(self, *arguments):
        return subprocess.run(
            [
                "git",
                "-c",
                "user.name=Preflight test",
                "-c",
                "user.email=preflight@example.invalid",
                *arguments,
            ],
            cwd=self.repository,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()

    def write(self, relative, text):
        path = self.repository / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        return path

    def commit(self, title, body="Refs #943"):
        self.git("add", "--all")
        self.git("commit", "--quiet", "--allow-empty", "-m", title, "-m", body)
        return self.git("rev-parse", "HEAD")

    def chosen(self, base=None):
        return PREFLIGHT.plan(self.repository, base or self.base, SCOPE)

    def run_main(self, *arguments):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return PREFLIGHT.main(
                [
                    "--repository-path",
                    str(self.repository),
                    "--base",
                    self.base,
                    *arguments,
                ]
            )

    def test_inventory_combines_committed_staged_unstaged_deleted_and_untracked_paths(
        self,
    ):
        self.write("backend/committed.py", "committed")
        head = self.commit("test(#943): add committed input")
        self.write("backend/staged.py", "staged")
        self.git("add", "backend/staged.py")
        self.write("backend/base.py", "unstaged")
        (self.repository / "docs/guide.md").unlink()
        self.write("backend/untracked.py", "untracked")
        self.write("private.cfg", "ignored fixture")
        base, current, paths = PREFLIGHT.working_changes(self.repository, self.base)
        self.assertEqual((base, current), (self.base, head))
        self.assertEqual(
            paths,
            [
                "backend/base.py",
                "backend/committed.py",
                "backend/staged.py",
                "backend/untracked.py",
                "docs/guide.md",
            ],
        )
        self.assertTrue(self.chosen()["scopes"]["django"]["required"])

    def test_backend_changes_select_fast_checks(
        self,
    ):
        (self.repository / "docs/guide.md").rename(self.repository / "backend/renamed.py")
        self.git("add", "--all")
        self.write("backend/untracked.py", "new")
        chosen = self.chosen()
        self.assertEqual(chosen["changed_files"], 3)
        self.assertIn(["make", "-C", "backend", "lint", "check"], chosen["commands"])
        self.write("backend/views/register.py", "changed API input")
        chosen = self.chosen()
        self.assertTrue(chosen["scopes"]["django"]["javascript_required"])
        self.assertIn(["npm", "run", "typecheck"], chosen["commands"])

    def test_docs_exemption_and_backend_named_document_use_the_ci_classifier(self):
        self.write("docs/guide.md", "changed")
        self.assertFalse(self.chosen()["scopes"]["django"]["required"])
        self.write("backend/base.py", 'open("docs/guide.md")')
        self.commit("test(#943): read the named document")
        self.write("docs/guide.md", "changed again")
        chosen = self.chosen(self.git("rev-parse", "HEAD"))
        self.assertTrue(chosen["scopes"]["django"]["required"])

    def test_clients_preview_native_ci_and_client_checks_without_a_backend_subset(self):
        self.write("packages/shared/input.ts", "changed")
        chosen = self.chosen()
        self.assertFalse(chosen["scopes"]["django"]["required"])
        self.assertTrue(chosen["scopes"]["native"]["required"])
        self.assertIn(["npm", "run", "typecheck"], chosen["commands"])
        self.assertNotIn(["make", "backend-test"], chosen["commands"])
        self.assertIn("Android Release and native probe", chosen["ci_jobs"])

    def test_missing_and_divergent_bases_fail_closed(self):
        missing = self.chosen("missing-base")
        self.assertIsNotNone(missing["gap"])
        self.assertTrue(all(value["required"] for value in missing["scopes"].values()))
        self.assertIn(["make", "-C", "backend", "lint", "check"], missing["commands"])
        self.git("checkout", "--quiet", "--orphan", "unrelated")
        self.commit("test(#943): unrelated history")
        self.assertIsNotNone(self.chosen()["gap"])
        self.assertEqual(self.run_main("--preview"), 1)

    def test_malformed_path_inventory_cannot_select_exempt_coverage(self):
        for raw in (
            b"backend/input.py",
            b"backend/../input.py\0",
            b"backend/invalid-\xff.py\0",
        ):
            with self.subTest(raw=raw), self.assertRaises(ValueError):
                PREFLIGHT.paths_from(raw)
        with patch.object(PREFLIGHT, "working_changes", side_effect=ValueError("Invalid path")):
            chosen = self.chosen()
        self.assertTrue(all(value["required"] for value in chosen["scopes"].values()))

    def test_shallow_and_subdirectory_comparisons_cannot_exempt_backend_coverage(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        clone = Path(temporary.name) / "clone"
        subprocess.run(
            [
                "git",
                "clone",
                "--quiet",
                "--depth",
                "1",
                self.repository.as_uri(),
                str(clone),
            ],
            check=True,
            capture_output=True,
        )
        for repository in (clone, self.repository / "backend"):
            with self.subTest(repository=repository):
                chosen = PREFLIGHT.plan(repository, self.base, SCOPE)
                self.assertIsNotNone(chosen["gap"])
                self.assertTrue(all(value["required"] for value in chosen["scopes"].values()))

    def test_preview_ignores_inherited_github_output_and_runs_no_check_commands(self):
        output = self.write("private.cfg", "unchanged")
        with patch.dict(
            os.environ,
            {
                "GITHUB_OUTPUT": str(output),
                "GITHUB_EVENT_NAME": "push",
                "GITHUB_REF": "refs/heads/main",
            },
        ):
            self.assertEqual(self.run_main("--preview"), 0)
        self.assertEqual(output.read_text(), "unchanged")

    def test_bad_draft_body_and_earlier_commit_wording_stop_before_checks(self):
        title = self.write("private-title.txt", "test(#943): prepare the change\n")
        body = self.write("private-body.md", "Refs #943\n\nThis does not close #943.\n")
        self.assertEqual(self.run_main("--title-file", str(title), "--body-file", str(body)), 1)
        body.write_text("Refs #943\n")
        self.commit("test(#943): earlier change", "Refs #943\n\nFixes #943")
        self.commit("test(#943): later change")
        self.assertEqual(self.run_main("--title-file", str(title), "--body-file", str(body)), 1)

    def test_first_failed_command_stops_and_github_output_is_removed_from_children(
        self,
    ):
        calls = []
        original = subprocess.run

        def execute(arguments, *args, **kwargs):
            if arguments[0] == "git":
                return original(arguments, *args, **kwargs)
            calls.append((arguments, kwargs))
            return subprocess.CompletedProcess(arguments, 7)

        with patch.dict(os.environ, {"GITHUB_OUTPUT": "/unused/output"}), patch.object(
            PREFLIGHT.subprocess, "run", side_effect=execute
        ):
            self.assertEqual(self.run_main(), 7)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0][0], "make")
        self.assertNotIn("GITHUB_OUTPUT", calls[0][1]["env"])


if __name__ == "__main__":
    unittest.main()
