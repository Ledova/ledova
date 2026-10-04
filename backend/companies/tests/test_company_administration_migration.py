import json
import tempfile
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, override_settings
from rest_framework.exceptions import NotFound

from companies.models import (
    Company,
    CompanyAppointment,
    CompanyDocument,
    CompanyLegacyOwnerSource,
)
from companies.services.authority_requests import _requester_principal
from companies.services.editing import update_company
from companies.services.team import revoke_company_appointment
from companies.tests.test_authority_requests import PDF, STORAGES, evidence
from shared.db import atomic, use_migrate, use_operator
from shared.tests.upload_fixtures import StubUploadDependencies
from users.models import UserProfile

BEFORE_LEGACY = ("companies", "0018_team_invitation_admission_guards")
OLD = ("companies", "0019_legacy_owner_appointments")
NEW = ("companies", "0020_company_administration")
TARGETS = {"companies_company", "companies_companydocument"}
TABLES = (
    "authentication_customuser",
    "users_userprofile",
    "companies_company",
    "companies_companydocument",
    "companies_companylegacyownersource",
    "companies_companyappointment",
    "companies_companyappointmentrevocation",
)
NEW_FUNCTIONS = {
    "app_company_administration_ids",
    "app_company_discovery_ids",
    "companies_locked_administration",
    "companies_valid_identifiers",
    "companies_guard_administration",
    "companies_guard_document_administration",
    "companies_guard_document_removal",
    "companies_lock_document_command",
}
OWNER_FUNCTIONS = {"app_visible_company_ids", "app_manageable_company_ids"}


class CompanyAdministrationMigrationTest(StubUploadDependencies, TransactionTestCase):
    def setUp(self):
        super().setUp()
        self.addCleanup(self.latest)
        self.migrate(BEFORE_LEGACY)
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        with use_migrate():
            self.owner = get_user_model().objects.create_user(
                email="company-upgrade@example.test",
                password="synthetic-password",
                is_active=True,
                is_email_verified=True,
            )
            self.profile = UserProfile.objects.create(user=self.owner, full_name="Retained Company Contact")
            self.company = Company.objects.create(
                owner=self.owner, name="Retained Company Pty Ltd", acn="123456780", status="active"
            )
            self.document = CompanyDocument.objects.create(
                company=self.company,
                name="Retained private constitution",
                document_type="constitution",
                file=evidence(),
                file_size=len(PDF),
                mime_type="application/pdf",
                notes="Retained historical company evidence",
            )
        self.migrate(OLD)

    def migrate(self, target):
        MigrationExecutor(connection).migrate([target])

    def latest(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def query(self, sql, params=()):
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchall()

    def schema(self):
        return {
            "functions": self.query(
                "SELECT proname, pg_get_functiondef(function.oid) FROM pg_proc function "
                "JOIN pg_namespace namespace ON namespace.oid = function.pronamespace "
                "WHERE namespace.nspname = 'public' AND function.prokind IN ('f', 'p') ORDER BY proname"
            ),
            "policies": self.query(
                "SELECT tablename, policyname, permissive, roles, cmd, qual, with_check "
                "FROM pg_policies WHERE schemaname = 'public' ORDER BY tablename, policyname"
            ),
            "tables": self.query(
                "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class relation "
                "JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace "
                "WHERE namespace.nspname = 'public' AND relation.relkind IN ('r', 'p') ORDER BY relname"
            ),
            "triggers": self.query(
                "SELECT relation.relname, tgname, tgenabled, pg_get_triggerdef(trigger.oid) FROM pg_trigger trigger "
                "JOIN pg_class relation ON relation.oid = trigger.tgrelid "
                "JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace "
                "WHERE namespace.nspname = 'public' AND NOT tgisinternal ORDER BY relation.relname, tgname"
            ),
            "grants": self.query(
                "SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants "
                "WHERE table_schema = 'public' ORDER BY table_name, grantee, privilege_type"
            ),
        }

    def records(self):
        return {
            table: [
                json.loads(row[0])
                for row in self.query(
                    f"SELECT to_jsonb(retained)::text FROM {table} retained ORDER BY to_jsonb(retained)::text"
                )
            ]
            for table in TABLES
        }

    def assert_file_retained(self):
        with self.document.file.open("rb") as source:
            self.assertEqual(source.read(), PDF)

    def test_populated_upgrade_retains_all_rows_and_original_guards_without_provider_calls(self):
        before_schema, before_records = self.schema(), self.records()
        owner_bodies = self.query(
            "SELECT proname, prosrc, provolatile, prorettype::regtype::text FROM pg_proc "
            "WHERE proname = ANY(%s) ORDER BY proname",
            [sorted(OWNER_FUNCTIONS)],
        )
        self.assertEqual(
            self.query(
                "SELECT prosecdef, proconfig FROM pg_proc WHERE proname = ANY(%s) ORDER BY proname",
                [sorted(OWNER_FUNCTIONS)],
            ),
            [(False, None)] * 2,
        )
        with patch("companies.services.registry.lookup_company", side_effect=AssertionError("Upgrade called ABR")):
            self.migrate(NEW)
        after_schema = self.schema()
        self.assertEqual(self.records(), before_records)
        self.assert_file_retained()
        self.assertEqual(
            [row for row in after_schema["functions"] if row[0] not in NEW_FUNCTIONS | OWNER_FUNCTIONS],
            [row for row in before_schema["functions"] if row[0] not in OWNER_FUNCTIONS],
        )
        self.assertEqual(
            self.query(
                "SELECT proname, prosrc, provolatile, prorettype::regtype::text FROM pg_proc "
                "WHERE proname = ANY(%s) ORDER BY proname",
                [sorted(OWNER_FUNCTIONS)],
            ),
            owner_bodies,
        )
        self.assertEqual(
            [row for row in after_schema["policies"] if row[0] not in TARGETS],
            [row for row in before_schema["policies"] if row[0] not in TARGETS],
        )
        self.assertEqual(after_schema["tables"], before_schema["tables"])
        self.assertEqual(after_schema["grants"], before_schema["grants"])
        for original in before_schema["triggers"]:
            self.assertIn(original, after_schema["triggers"])
        self.assertEqual(
            self.query(
                "SELECT prosecdef, proconfig FROM pg_proc WHERE proname IN "
                "('app_company_administration_ids', 'app_company_discovery_ids', "
                "'app_visible_company_ids', 'app_manageable_company_ids') ORDER BY proname"
            ),
            [(True, ["search_path=pg_catalog, public"])] * 4,
        )

    def test_actual_legacy_appointment_authorises_current_basic_edit_and_revocation_closes_bootstrap_forever(self):
        self.migrate(NEW)
        with use_operator():
            source = CompanyLegacyOwnerSource.objects.get(company=self.company)
            appointment = CompanyAppointment.objects.get(legacy_owner=source)
        self.assertEqual(
            (appointment.declaration_version, appointment.declaration_text, appointment.registry_check_id), (None,) * 3
        )
        with use_operator(), _requester_principal(self.owner.pk), atomic():
            with connection.cursor() as cursor:
                cursor.execute("SELECT quote_ident(%s)", [settings.RLS_ROLES["operator"]])
                cursor.execute(f"SET LOCAL ROLE {cursor.fetchone()[0]}")
            updated = update_company(self.company, {"phone": "555"}, actor=self.owner)
        self.assertEqual(updated.phone, "555")
        revoke_company_appointment(requester=self.owner, appointment_id=appointment.pk)
        with use_migrate():
            Company.objects.filter(pk=self.company.pk).update(status="draft")
        with self.assertRaises(NotFound):
            update_company(self.company, {"phone": "forbidden"}, actor=self.owner)
        with use_operator():
            self.assertEqual(CompanyLegacyOwnerSource.objects.get(company=self.company).pk, source.pk)

    def test_reverse_and_reupgrade_restore_exact_policies_functions_triggers_grants_and_records(self):
        before_schema, before_records = self.schema(), self.records()
        self.migrate(NEW)
        installed_schema = self.schema()
        self.migrate(OLD)
        self.assertEqual(self.schema(), before_schema)
        self.assertEqual(self.records(), before_records)
        self.assert_file_retained()
        self.migrate(NEW)
        self.assertEqual(self.schema(), installed_schema)
        self.assertEqual(self.records(), before_records)

    def test_failure_after_guard_installation_rolls_back_functions_policies_triggers_and_records(self):
        before_schema, before_records = self.schema(), self.records()
        intercepted = []

        def interrupt(execute, sql, params, many, context):
            result = execute(sql, params, many, context)
            if "CREATE TRIGGER companies_document_administration" in sql:
                intercepted.append(sql)
                raise RuntimeError("Synthetic interrupted administration upgrade")
            return result

        with connection.execute_wrapper(interrupt), self.assertRaisesMessage(
            RuntimeError, "Synthetic interrupted administration upgrade"
        ):
            self.migrate(NEW)
        self.assertEqual(len(intercepted), 1)
        self.assertEqual(self.schema(), before_schema)
        self.assertEqual(self.records(), before_records)
        self.assert_file_retained()

    def test_failure_after_target_policy_replacement_rolls_back_the_entire_upgrade(self):
        before_schema, before_records = self.schema(), self.records()
        intercepted = []

        def interrupt(execute, sql, params, many, context):
            result = execute(sql, params, many, context)
            if sql.startswith("CREATE POLICY companies_companydocument_delete"):
                intercepted.append(sql)
                raise RuntimeError("Synthetic interrupted administration policies")
            return result

        with connection.execute_wrapper(interrupt), self.assertRaisesMessage(
            RuntimeError, "Synthetic interrupted administration policies"
        ):
            self.migrate(NEW)
        self.assertEqual(len(intercepted), 1)
        self.assertEqual(self.schema(), before_schema)
        self.assertEqual(self.records(), before_records)
