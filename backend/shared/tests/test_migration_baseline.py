from contextlib import contextmanager
from unittest.mock import MagicMock, patch

from django.core.management.base import CommandError
from django.db import connections
from django.db.migrations.loader import MigrationLoader
from django.db.migrations.recorder import MigrationRecorder
from django.test import SimpleTestCase, TransactionTestCase

from shared.db import MIGRATE_ALIAS, atomic, migration_baseline, use_migrate
from shared.management.commands.migrate import Command

AUTHENTICATION = ("authentication", "0001_initial")
COMPANY_FIRST = ("companies", "0001_initial")
COMPANY_LAST = ("companies", "0002_current")
GRANTS = ("shared", "0008_scoped_role_table_grants")
POLICIES = ("shared", "0009_policies_require_a_principal")
ALIAS = ("shared", "0015_scoped_grants_queue_prerequisite")
VENDOR_FIRST = ("auth", "0001_initial")
VENDOR_LAST = ("auth", "0002_current")
AUTHENTICATION_PHASE = ("authentication", "0001_baseline")
COMPANY_PHASE = ("companies", "0001_baseline")
SHARED_PHASE = ("shared", "0001_baseline")
PROJECT = frozenset({AUTHENTICATION, COMPANY_FIRST, COMPANY_LAST, GRANTS, POLICIES})
VENDORS = frozenset({VENDOR_FIRST, VENDOR_LAST})
PHASES = {
    AUTHENTICATION_PHASE: {"replaces": frozenset({AUTHENTICATION}), "requires": frozenset({VENDOR_FIRST})},
    COMPANY_PHASE: {
        "replaces": frozenset({COMPANY_FIRST, COMPANY_LAST}),
        "requires": frozenset({AUTHENTICATION_PHASE, VENDOR_LAST}),
    },
    SHARED_PHASE: {"replaces": frozenset({GRANTS, POLICIES}), "requires": frozenset({COMPANY_PHASE})},
}


class MigrationBaselineAdmissionTest(SimpleTestCase):
    def setUp(self):
        super().setUp()
        metadata = patch.multiple(
            migration_baseline,
            PROJECT_MIGRATIONS=PROJECT,
            VENDOR_MIGRATIONS=VENDORS,
            BASELINE_PHASES=PHASES,
            ALIASES={ALIAS: GRANTS},
        )
        metadata.start()
        self.addCleanup(metadata.stop)
        recorder_patch = patch("shared.db.migration_baseline.MigrationRecorder")
        self.recorder = recorder_patch.start().return_value
        self.addCleanup(recorder_patch.stop)
        self.connection = MagicMock()

    def _records(self, records):
        self.recorder.applied_migrations.return_value = {key: object() for key in records}

    def _admit(self, records):
        self._records(records)
        migration_baseline.require_baseline_history(self.connection)
        self.recorder.ensure_schema.assert_not_called()
        self.recorder.record_applied.assert_not_called()

        self.recorder.record_unapplied.assert_not_called()

    def _refuse(self, records, message):
        self._records(records)
        with self.assertRaisesMessage(CommandError, message):
            migration_baseline.require_baseline_history(self.connection)
        self.recorder.ensure_schema.assert_not_called()
        self.recorder.record_applied.assert_not_called()

    def test_a_fresh_database_needs_no_recorder_creation(self):
        self.connection.introspection.table_names.return_value = []
        with patch("shared.db.migration_baseline.MigrationRecorder", MigrationRecorder):
            migration_baseline.require_baseline_history(self.connection)
        self.connection.schema_editor.assert_not_called()
        self.connection.cursor.return_value.__enter__.return_value.execute.assert_not_called()

    def test_fresh_history_and_partial_vendor_steps_are_admitted(self):
        for records in [set(), {VENDOR_FIRST}, VENDORS]:
            with self.subTest(records=records):
                self._admit(records)

    def test_fully_upgraded_old_history_and_optional_alias_are_admitted(self):
        for extra in [set(), {ALIAS}, {AUTHENTICATION_PHASE}, set(PHASES), {("companies", "0002_after_baseline")}]:
            with self.subTest(extra=extra):
                self._admit(PROJECT | VENDORS | extra)

    def test_the_old_cut_requires_every_vendor_record_not_only_a_leaf(self):
        self._refuse(PROJECT | {VENDOR_LAST}, "required vendor migration records")

    def test_partial_old_history_is_refused_even_when_one_app_is_complete(self):
        for records in [{AUTHENTICATION}, {COMPANY_FIRST, COMPANY_LAST}, PROJECT - {POLICIES}]:
            with self.subTest(records=records):
                self._refuse(records | VENDORS, "old project migrations are recorded")

    def test_the_optional_alias_cannot_admit_history_without_its_original(self):
        self._refuse({ALIAS}, "has no original prerequisite")

    def test_dependency_closed_complete_fresh_phases_can_resume(self):
        first = {AUTHENTICATION_PHASE, AUTHENTICATION, VENDOR_FIRST}
        second = first | {COMPANY_PHASE, COMPANY_FIRST, COMPANY_LAST, VENDOR_LAST}
        self._admit(first)
        self._admit(second)
        self._admit(second | {SHARED_PHASE, GRANTS, POLICIES, ALIAS})

    def test_a_baseline_record_alone_does_not_exempt_a_partial_database(self):
        self._refuse({AUTHENTICATION_PHASE, VENDOR_FIRST}, "original target records")

    def test_a_phase_must_record_its_whole_exact_target_slice(self):
        self._refuse(
            {AUTHENTICATION_PHASE, AUTHENTICATION, COMPANY_PHASE, COMPANY_FIRST} | VENDORS,
            "original target records",
        )

    def test_phase_records_require_their_baseline_dependency_not_only_old_rows(self):
        self._refuse({COMPANY_PHASE, COMPANY_FIRST, COMPANY_LAST, AUTHENTICATION} | VENDORS, "phase prerequisites")

    def test_a_complete_phase_cannot_omit_its_vendor_prerequisite(self):
        self._refuse({AUTHENTICATION_PHASE, AUTHENTICATION}, "phase prerequisites")

    def test_an_extra_old_row_outside_completed_phases_is_refused(self):
        self._refuse(
            {AUTHENTICATION_PHASE, AUTHENTICATION, VENDOR_FIRST, COMPANY_FIRST},
            "do not match the complete recorded baseline phases",
        )

    def test_the_selected_database_is_checked_inside_the_migration_role_before_django(self):
        events = []

        @contextmanager
        def migration_role():
            events.append("enter-role")
            yield
            events.append("leave-role")

        def admission(connection):
            self.assertIs(connection, self.connection)
            self.assertEqual(events, ["enter-role"])
            events.append("admission")

        def django_handle(*args, **options):
            self.assertEqual(events, ["enter-role", "admission"])
            self.assertEqual(options["database"], "selected")
            events.append("django")
            return "complete"

        with (
            patch("shared.management.commands.migrate.use_migrate", migration_role),
            patch("shared.management.commands.migrate.connections", {"selected": self.connection}),
            patch("shared.management.commands.migrate.require_baseline_history", admission),
            patch("django.core.management.commands.migrate.Command.handle", django_handle),
        ):
            self.assertEqual(Command().handle(database="selected"), "complete")
        self.assertEqual(events, ["enter-role", "admission", "django", "leave-role"])

    def test_plan_check_and_fake_never_reach_django_on_partial_history(self):
        self._records({AUTHENTICATION})
        for option in [{"plan": True}, {"check_unapplied": True}, {"fake": True}, {"fake_initial": True}, {}]:
            with self.subTest(option=option):
                with (
                    patch("shared.management.commands.migrate.use_migrate"),
                    patch("shared.management.commands.migrate.connections", {"selected": self.connection}),
                    patch("django.core.management.commands.migrate.Command.handle") as django_handle,
                    self.assertRaisesMessage(CommandError, "old project migrations are recorded"),
                ):
                    Command().handle(database="selected", **option)
                django_handle.assert_not_called()
        self.recorder.ensure_schema.assert_not_called()
        self.recorder.record_applied.assert_not_called()


class MigrationBaselineGraphTest(SimpleTestCase):
    def test_the_recorded_slices_and_prerequisites_match_the_actual_replacement_graph(self):
        loader = MigrationLoader(None)
        phases = migration_baseline.BASELINE_PHASES
        actual = {key: migration for key, migration in loader.disk_migrations.items() if migration.replaces}
        self.assertEqual(set(actual), set(phases))
        targets = []
        for key, migration in actual.items():
            with self.subTest(phase=key):
                self.assertTrue(migration.replaces)
                self.assertEqual(set(migration.replaces), phases[key]["replaces"])
                self.assertEqual(set(loader.graph.forwards_plan(key)) - {key}, phases[key]["requires"])
            targets.extend(migration.replaces)
        self.assertEqual(set(targets), migration_baseline.PROJECT_MIGRATIONS)
        self.assertEqual(len(targets), len(set(targets)))


class MigrationBaselineRecorderRefusalTest(TransactionTestCase):
    def test_real_partial_recorder_history_cannot_reach_django_for_any_flag(self):
        connection = connections[MIGRATE_ALIAS]
        recorder = MigrationRecorder(connection)
        missing = sorted(migration_baseline.PROJECT_MIGRATIONS)[-1]
        for option in [{}, {"plan": True}, {"check_unapplied": True}, {"fake": True}, {"fake_initial": True}]:
            with self.subTest(option=option), use_migrate(), atomic():
                self.assertIn(missing, recorder.applied_migrations())
                recorder.record_unapplied(*missing)
                before = set(recorder.applied_migrations())
                with (
                    patch("django.core.management.commands.migrate.Command.handle") as django_handle,
                    self.assertRaisesMessage(CommandError, "Migration baseline admission refused"),
                ):
                    Command().handle(database=MIGRATE_ALIAS, **option)
                django_handle.assert_not_called()
                self.assertEqual(set(recorder.applied_migrations()), before)
                recorder.record_applied(*missing)
