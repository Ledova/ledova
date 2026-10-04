import json
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

from companies.models import CompanyAppointment, CompanyRegistryCheck
from companies.services.activation import activate_company
from companies.services.authority import DECLARATION_VERSION
from companies.tests.registry_fixtures import matching_observation
from integrations.abr.client import RegistryObservation
from shared.db import use_migrate, use_operator
from users.models import UserProfile

BEFORE_LEGACY = ("companies", "0018_team_invitation_admission_guards")
OLD = ("companies", "0020_company_administration")
NEW = ("companies", "0021_company_activation")
PROVENANCE = {
    "initiating_appointment_id",
    "idempotency_key",
    "person_identity",
    "issuer_identity_required",
    "declaration_version",
    "declaration_text",
    "applied_at",
}
TABLES = (
    "authentication_customuser",
    "users_userprofile",
    "companies_company",
    "companies_companyregistrycheck",
    "companies_companylegacyownersource",
    "companies_companyappointment",
    "companies_companydocument",
)


class CompanyActivationMigrationTest(TransactionTestCase):
    def setUp(self):
        self.addCleanup(self.latest)
        self.migrate(BEFORE_LEGACY)
        apps = MigrationExecutor(connection).loader.project_state([BEFORE_LEGACY]).apps
        User = get_user_model()
        Profile = UserProfile
        Company = apps.get_model("companies", "Company")
        with use_migrate():
            self.actor_id = User.objects.create(
                email="activation-history@example.test", is_active=True, is_email_verified=True
            ).pk
            Profile.objects.create(user_id=self.actor_id, full_name="Historical Company Administrator")
            self.company_id = Company.objects.create(
                owner_id=self.actor_id,
                name="Retained Historical Pty Ltd",
                acn="123456780",
                status="draft",
            ).pk
        self.migrate(OLD)
        apps = MigrationExecutor(connection).loader.project_state([OLD]).apps
        Check = apps.get_model("companies", "CompanyRegistryCheck")
        with use_migrate():
            Check.objects.create(
                company_id=self.company_id,
                initiated_by_id=self.actor_id,
                purpose="retry",
                requested_name="Retained Historical Pty Ltd",
                requested_acn="123456780",
                requested_abn="",
                identity={"name": "retained historical pty ltd", "acn": "123456780", "abn": "", "company_type": "pty"},
                lifecycle_revision=0,
                status="pending",
                reason="unconfigured",
            )

    def migrate(self, target):
        MigrationExecutor(connection).migrate([target])

    def latest(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def query(self, sql, params=()):
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchall()

    def catalogue(self):
        return {
            "functions": self.query(
                "SELECT proname, pg_get_functiondef(oid) FROM pg_proc "
                "WHERE pronamespace = 'public'::regnamespace ORDER BY proname"
            ),
            "triggers": self.query(
                "SELECT tgrelid::regclass::text, tgname, tgenabled, pg_get_triggerdef(oid) "
                "FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgrelid::regclass::text, tgname"
            ),
            "policies": self.query(
                "SELECT tablename, policyname, roles, cmd, qual, with_check FROM pg_policies "
                "WHERE schemaname = 'public' ORDER BY tablename, policyname"
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

    def test_populated_upgrade_and_reverse_preserve_history_and_restore_exact_catalogue(self):
        before, records = self.catalogue(), self.records()
        with patch(
            "companies.services.registry.lookup_company", side_effect=AssertionError("Migration called provider")
        ):
            self.migrate(NEW)
        after = self.records()
        for row in after["companies_companyregistrycheck"]:
            for name in PROVENANCE:
                self.assertIsNone(row.pop(name))
        self.assertEqual(after, records)
        upgraded = self.catalogue()
        self.assertEqual(upgraded["policies"], before["policies"])
        self.assertEqual(upgraded["grants"], before["grants"])
        self.migrate(OLD)
        self.assertEqual(self.records(), records)
        self.assertEqual(self.catalogue(), before)
        self.migrate(NEW)
        self.assertEqual(self.catalogue(), upgraded)

    def test_real_legacy_administrator_activates_without_manufactured_appointment_declaration(self):
        self.migrate(NEW)
        from companies.models import Company

        with use_operator():
            actor = get_user_model().objects.get(pk=self.actor_id)
            company = Company.objects.get(pk=self.company_id)
            source = CompanyAppointment.objects.get(company=company, legacy_owner__isnull=False)
        self.assertIsNone(source.declaration_version)
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(company)):
            company, receipt = activate_company(
                actor=actor,
                company_id=company.pk,
                appointment=source.pk,
                lifecycle_revision=company.lifecycle_revision,
                idempotency_key=uuid4(),
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            )
        self.assertEqual(company.status, "active")
        self.assertIsNotNone(receipt.applied_at)
        self.assertEqual(receipt.initiating_appointment_id, source.pk)
        self.assertIsNone(source.declaration_version)
        with self.assertRaisesMessage(RuntimeError, "Retain activation requests"):
            self.migrate(OLD)
        with use_operator():
            self.assertEqual(CompanyRegistryCheck.objects.get(pk=receipt.pk).applied_at, receipt.applied_at)

    def test_pending_attempt_also_blocks_history_destroying_downgrade(self):
        self.migrate(NEW)
        from companies.models import Company

        with use_operator():
            actor = get_user_model().objects.get(pk=self.actor_id)
            company = Company.objects.get(pk=self.company_id)
            source = CompanyAppointment.objects.get(company=company, legacy_owner__isnull=False)
        with patch(
            "companies.services.registry.lookup_company", return_value=RegistryObservation(reason="unconfigured")
        ):
            _, receipt = activate_company(
                actor=actor,
                company_id=company.pk,
                appointment=source.pk,
                lifecycle_revision=0,
                idempotency_key=uuid4(),
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            )
        before = self.catalogue(), self.records()
        with self.assertRaisesMessage(RuntimeError, "Retain activation requests"):
            self.migrate(OLD)
        self.assertEqual((self.catalogue(), self.records()), before)
        self.assertIsNone(receipt.applied_at)

    def test_interruption_after_registry_trigger_restores_the_original_catalogue_and_rows(self):
        before = self.catalogue(), self.records()

        def interrupt(execute, sql, params, many, context):
            result = execute(sql, params, many, context)
            if "CREATE TRIGGER companies_registry_receipt" in sql:
                raise RuntimeError("Synthetic interrupted activation migration")
            return result

        with connection.execute_wrapper(interrupt), self.assertRaisesMessage(RuntimeError, "Synthetic interrupted"):
            self.migrate(NEW)
        self.assertEqual((self.catalogue(), self.records()), before)
