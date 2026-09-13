import ast
import json
import subprocess
import sys
from inspect import signature
from pathlib import Path

from django.conf import settings
from django.test import SimpleTestCase

from ledova_backend.procrastinate_app import app
from shared.tasks.catalogue import (
    CLASSIFIED,
    CONVERTED_IN,
    OPERATOR_BOUNDARIES,
    PRINCIPAL_BEARING,
    READS_MUST_SURVIVE_THE_POLICIES,
    SYSTEM_WIDE,
)

WHAT_IS_DECLARED = """
import django, json, os
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "ledova_backend.settings.test")
django.setup()
from ledova_backend.procrastinate_app import app
"""


def declared_tasks(extra_declaration=""):
    finished = subprocess.run(
        [sys.executable, "-c", WHAT_IS_DECLARED + extra_declaration + "\nprint(json.dumps(sorted(app.tasks)))"],
        capture_output=True,
        text=True,
        cwd=settings.BASE_DIR,
        check=True,
    )
    return set(json.loads(finished.stdout.strip().splitlines()[-1]))


class EveryTaskSaysWhoItActsForTest(SimpleTestCase):

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.declared = declared_tasks()

    def test_every_declared_task_is_classified(self):
        self.assert_classified(self.declared)

    def assert_classified(self, declared):
        self.assertEqual(sorted(declared - set(CLASSIFIED)), [], "Each registered task needs a classification")

    def test_no_classification_names_a_task_nothing_declares(self):
        self.assertEqual(sorted(set(CLASSIFIED) - self.declared), [])

    def test_a_task_is_system_wide_or_principal_bearing_and_not_both(self):
        self.assertEqual(sorted(set(SYSTEM_WIDE) & set(PRINCIPAL_BEARING)), [])

    def test_every_entry_states_a_reason(self):
        for name, reason in CLASSIFIED.items():
            with self.subTest(task=name):
                self.assertTrue(reason.strip(), f"{name} needs a classification reason")

    def test_an_unclassified_task_would_be_reported_rather_than_ignored(self):
        name = "shared.tasks.unclassified_probe"
        declared = declared_tasks(f"\n@app.task(name={name!r})\ndef unclassified_probe():\n    pass\n")

        self.assertEqual(declared - self.declared, {name})
        with self.assertRaisesRegex(AssertionError, name):
            self.assert_classified(declared)

    def test_the_subprocess_answered_with_a_registry_rather_than_with_nothing(self):
        self.assertTrue(self.declared)
        self.assertLessEqual(self.declared, set(app.tasks))


def entered_acting_for():
    entered = {}
    for path in sorted(Path(settings.BASE_DIR).glob("*/tasks/*.py")):
        module = ".".join(path.relative_to(settings.BASE_DIR).with_suffix("").parts)
        for node in ast.walk(ast.parse(path.read_text())):
            if not isinstance(node, ast.FunctionDef):
                continue
            if not any("app.task" in ast.unparse(decorator) for decorator in node.decorator_list):
                continue
            entered[f"{module}.{node.name}"] = "acting_for" in ast.unparse(node)
    return entered


class EveryPrincipalBearingTaskAccountsForItsConversionTest(SimpleTestCase):

    def assert_accounted(self, conversions):
        self.assertEqual(set(conversions), set(PRINCIPAL_BEARING), "Every principal-bearing task needs accounting")
        for name, pull_request in conversions.items():
            self.assertIs(type(pull_request), int, f"{name} needs the PR that converted it")
            self.assertGreater(pull_request, 0, f"{name} needs the PR that converted it")

    @staticmethod
    def tasks_without_a_principal(tasks):
        entered = entered_acting_for()
        return sorted(name for name in tasks if not entered.get(name))

    def test_every_principal_bearing_task_enters_its_principal_context(self):
        self.assertEqual(self.tasks_without_a_principal(PRINCIPAL_BEARING), [])

    def test_an_operator_task_cannot_be_claimed_as_converted(self):
        name = "tokens.tasks.review_request.execute_review_request_task"
        self.assertEqual(self.tasks_without_a_principal([name]), [name])

    def test_a_conversion_that_names_no_registered_task_is_reported(self):
        name = "shared.tasks.a_task_that_was_deleted"
        self.assertEqual(self.tasks_without_a_principal([name]), [name])

    def test_every_principal_bearing_task_has_complete_conversion_accounting(self):
        self.assert_accounted(CONVERTED_IN)

    def test_missing_conversion_accounting_is_rejected(self):
        name = next(iter(PRINCIPAL_BEARING))
        conversions = {task: pull_request for task, pull_request in CONVERTED_IN.items() if task != name}
        with self.assertRaisesRegex(AssertionError, name):
            self.assert_accounted(conversions)

    def test_accounting_cannot_outlive_its_principal_bearing_task(self):
        name = "shared.tasks.removed_probe"
        with self.assertRaisesRegex(AssertionError, name):
            self.assert_accounted({**CONVERTED_IN, name: 1})

    def test_a_conversion_requires_a_pull_request_number(self):
        name = next(iter(PRINCIPAL_BEARING))
        for pull_request in (None, 0, -1, True, "pending"):
            with self.subTest(pull_request=pull_request), self.assertRaisesRegex(AssertionError, name):
                self.assert_accounted({**CONVERTED_IN, name: pull_request})


class AConversionMustProveItsReadsSurviveTheSelectPoliciesTest(SimpleTestCase):

    def test_every_noted_trap_names_a_task_that_is_principal_bearing(self):
        self.assertEqual(sorted(set(READS_MUST_SURVIVE_THE_POLICIES) - set(PRINCIPAL_BEARING)), [])

    def test_every_noted_policy_dependency_has_an_explanation(self):
        for name, reason in READS_MUST_SURVIVE_THE_POLICIES.items():
            with self.subTest(task=name):
                self.assertTrue(reason.strip(), f"{name} needs its policy dependency explained")


class EveryOperatorBoundaryIsNamedAndReachableTest(SimpleTestCase):

    def test_every_catalogued_operator_boundary_resolves_to_something_callable(self):
        import importlib

        for path in OPERATOR_BOUNDARIES:
            with self.subTest(boundary=path):
                module_path, _, attribute = path.rpartition(".")
                self.assertTrue(callable(getattr(importlib.import_module(module_path), attribute)))

    def test_every_operator_boundary_states_why_it_needs_the_operator(self):
        for path, reason in OPERATOR_BOUNDARIES.items():
            with self.subTest(boundary=path):
                self.assertTrue(reason.strip(), f"{path} needs its operator boundary explained")


class TransactionRecoveryScheduleTest(SimpleTestCase):
    legacy_names = (
        "blockchain.tasks.cleanup_failed_transactions",
        "wallets.tasks.confirmation.cleanup_stale_pending_transactions",
    )
    recovery_names = (
        "blockchain.tasks.check_pending_transactions",
        "wallets.tasks.confirmation.check_all_pending_transactions",
    )

    def test_queued_cleanup_names_still_resolve_and_accept_the_original_timestamp(self):
        for name in self.legacy_names:
            with self.subTest(task=name):
                self.assertIn(name, app.tasks)
                self.assertEqual(signature(app.tasks[name].func).bind(timestamp=0).arguments, {"timestamp": 0})

    def test_compatibility_reports_no_longer_have_a_periodic_schedule(self):
        scheduled = {entry.task.name for entry in app.periodic_registry.periodic_tasks.values()}
        self.assertFalse(set(self.legacy_names) & scheduled)

    def test_both_receipt_recovery_sweeps_remain_scheduled_every_five_minutes(self):
        for name in self.recovery_names:
            with self.subTest(task=name):
                schedules = [
                    entry.cron for entry in app.periodic_registry.periodic_tasks.values() if entry.task.name == name
                ]
                self.assertEqual(schedules, ["*/5 * * * *"])
