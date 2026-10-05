import tempfile
from datetime import timedelta
from unittest import skipUnless

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.files.base import ContentFile
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.tests.test_authority_requests import STORAGES
from shared.db import use_migrate, use_operator
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.upload_fixtures import StubUploadDependencies, pdf_bytes
from users.models.company_eligibility import (
    CompanyEligibilityDecision,
    CompanyEligibilityRequest,
    CompanyEligibilityRequestWithdrawal,
    CompanyEligibilityRevocation,
)
from users.services.investor_classification import require_evidence_retention_policy
from users.tests.test_company_eligibility_requests import (
    SOURCES,
    CompanyEligibilityCases,
)

OLD = ("users", "0031_protected_identity_results")
RECORDS = ("users", "0032_company_eligibility_records")
GUARDS = ("users", "0033_company_eligibility_guards")
RETAINED_TABLES = (
    "authentication_customuser",
    "users_userprofile",
    "customer_accounts_account",
    "operators_operator",
    "users_investorclassification",
    "documents",
    "document_extractions",
    "documents_documentread",
    "companies_company",
    "companies_companyappointment",
)
ELIGIBILITY_MODELS = (
    CompanyEligibilityRequest,
    CompanyEligibilityDecision,
    CompanyEligibilityRequestWithdrawal,
    CompanyEligibilityRevocation,
)
MODULES = getattr(settings, "MIGRATION_MODULES", {})
ORDINARY_MIGRATIONS = (
    connection.vendor == "postgresql"
    and settings.RLS_AMBIENT_ALIAS == "default"
    and all(MODULES.get(app, f"{app}.migrations") is not None for app in ("users", "companies", "documents"))
)


class EligibilityMigrationChecks:
    def query(self, sql, params=()):
        with connection.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchall()

    def catalogue(self):
        return {
            "functions": self.query(
                "SELECT proname, pg_get_functiondef(oid) FROM pg_proc "
                "WHERE pronamespace = 'public'::regnamespace AND prokind IN ('f', 'p') "
                "ORDER BY proname, oid::regprocedure::text"
            ),
            "triggers": self.query(
                "SELECT tgrelid::regclass::text, tgname, tgenabled, pg_get_triggerdef(oid) "
                "FROM pg_trigger WHERE NOT tgisinternal ORDER BY tgrelid::regclass::text, tgname"
            ),
            "policies": self.query(
                "SELECT tablename, policyname, roles, cmd, qual, with_check FROM pg_policies "
                "WHERE schemaname = 'public' ORDER BY tablename, policyname"
            ),
            "tables": self.query(
                "SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class "
                "WHERE relnamespace = 'public'::regnamespace AND relkind IN ('r', 'p') ORDER BY relname"
            ),
            "columns": self.query(
                "SELECT table_name, column_name, data_type, is_nullable, column_default "
                "FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name"
            ),
            "constraints": self.query(
                "SELECT conrelid::regclass::text, conname, pg_get_constraintdef(oid) FROM pg_constraint "
                "WHERE connamespace = 'public'::regnamespace ORDER BY conrelid::regclass::text, conname"
            ),
            "indexes": self.query(
                "SELECT tablename, indexname, indexdef FROM pg_indexes "
                "WHERE schemaname = 'public' ORDER BY tablename, indexname"
            ),
            "grants": self.query(
                "SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants "
                "WHERE table_schema = 'public' ORDER BY table_name, grantee, privilege_type"
            ),
            "migrations": self.query("SELECT app, name FROM django_migrations ORDER BY app, name"),
        }

    def retained_records(self, *, legacy_source=False, include_eligibility=False):
        tables = RETAINED_TABLES
        if include_eligibility:
            tables += tuple(model._meta.db_table for model in ELIGIBILITY_MODELS)
        records = {}
        for table in tables:
            payload = "to_jsonb(retained)"
            if legacy_source and table == "users_investorclassification":
                payload += " - 'withdrawn_by_id'"
            records[table] = self.query(f"SELECT ({payload})::text FROM {table} retained ORDER BY ({payload})::text")
        return records

    def private_bytes(self, *files):
        contents = {}
        for file in files:
            with file.storage.open(file.name, "rb") as stored:
                contents[file.name] = stored.read()
        return contents

    def reverse_records_preflight(self):
        executor = MigrationExecutor(connection)
        migration = executor.loader.get_migration(*RECORDS)
        state = executor.loader.project_state([RECORDS])
        with connection.schema_editor() as schema_editor:
            migration.operations[-1].database_backwards("users", schema_editor, state, state)

    def assert_refuses_before_ddl(self, reverse, message):
        before = self.catalogue(), self.retained_records(include_eligibility=True)
        ddl = []

        def observe(execute, sql, params, many, context):
            if sql.lstrip().upper().startswith(("ALTER ", "CREATE ", "DROP ")):
                ddl.append(sql)
            return execute(sql, params, many, context)

        with connection.execute_wrapper(observe), self.assertRaisesMessage(RuntimeError, message):
            reverse()
        self.assertEqual(ddl, [])
        self.assertEqual((self.catalogue(), self.retained_records(include_eligibility=True)), before)


@skipUnless(ORDINARY_MIGRATIONS, "Real ordinary PostgreSQL migration execution is required")
class CompanyEligibilityEmptyMigrationTest(EligibilityMigrationChecks, TransactionTestCase):
    def setUp(self):
        super().setUp()
        self.addCleanup(restore_every_migration)
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))

    def historical_evidence(self, apps):
        data = pdf_bytes()
        past = timezone.now() - timedelta(days=120)
        with use_migrate():
            Actor = apps.get_model("authentication", "CustomUser")
            actor = Actor.objects.create(
                email="old-evidence-holder@example.test", is_active=True, is_email_verified=True
            )
            reviewer = Actor.objects.create(email="old-evidence-reviewer@example.test", is_staff=True)
            profile = apps.get_model("users", "UserProfile").objects.create(
                user_id=actor.pk, full_name="Retained historical holder", is_id_verified=True, verified_at=past
            )
            account = apps.get_model("users", "UserAccount").objects.create(
                user_profile_id=profile.pk, account_number="MIG-ELIGIBILITY", role="investor", account_status="active"
            )
            apps.get_model("operators", "Operator").objects.create(
                id=1, name="Historical configuration", issuer_kyc_required=True, investor_kyc_required=False
            )
            source = apps.get_model("users", "InvestorClassification").objects.create(
                user_account_id=account.pk,
                category="professional_investor",
                status="verified",
                declaration_accepted=True,
                declaration_text="Synthetic retained historical declaration",
                declared_basis="Retained private historical basis",
                evidence_file=ContentFile(data, name="old-primary.pdf"),
                evidence_file_size=len(data),
                evidence_mime_type="application/pdf",
                submitted_at=past,
                reviewed_by_id=reviewer.pk,
                reviewed_at=past + timedelta(days=1),
                review_notes="Retained staff review",
                expires_at=timezone.now() + timedelta(days=120),
            )
            Document = apps.get_model("documents", "Document")
            supporting = Document.objects.create(
                uploaded_by_id=actor.pk,
                classification_id=source.pk,
                attached_at=past,
                original_filename="old-supporting.pdf",
                mime_type="application/pdf",
                file=ContentFile(data, name="old-supporting.pdf"),
                note="Retained private supporting note",
            )
            unattached = Document.objects.create(
                uploaded_by_id=actor.pk,
                original_filename="old-unattached.pdf",
                file=ContentFile(data, name="old-unattached.pdf"),
                mime_type="application/pdf",
            )
            Document.objects.create(
                uploaded_by_id=actor.pk, classification_id=source.pk, attached_at=past, purged_at=past
            )
            apps.get_model("documents", "DocumentExtraction").objects.create(
                document_id=supporting.pk,
                status="succeeded",
                raw_output="Retained private extraction",
                parsed_json={"old": True},
            )
            apps.get_model("documents", "DocumentRead").objects.create(
                actor_id=reviewer.pk, document_uuid=supporting.pk, classification_uuid=source.pk, kind="file"
            )
        return source.evidence_file, supporting.file, unattached.file

    def test_upgrade_empty_reverse_and_reapply_preserve_old_rows_bytes_and_exact_catalogue(self):
        try:
            migrate_to([OLD])
            executor = MigrationExecutor(connection)
            apps = executor.loader.project_state(list(executor.loader.applied_migrations)).apps
            files = self.historical_evidence(apps)
            before_catalogue = self.catalogue()
            before_records = self.retained_records(legacy_source=True)
            before_bytes = self.private_bytes(*files)
            migrate_to([RECORDS])
            self.assertEqual(self.retained_records(legacy_source=True), before_records)
            migrate_to([GUARDS])
            installed_catalogue = self.catalogue()
            self.assertEqual(self.retained_records(legacy_source=True), before_records)
            self.assertEqual(self.private_bytes(*files), before_bytes)
            self.assertEqual(
                self.query("SELECT count(*) FROM users_investorclassification WHERE withdrawn_by_id IS NOT NULL"),
                [(0,)],
            )
            for model in ELIGIBILITY_MODELS:
                self.assertEqual(self.query(f"SELECT count(*) FROM {model._meta.db_table}"), [(0,)])
            self.assertEqual(
                self.query(
                    "SELECT users_classification_evidence_retention_days(), users_unattached_document_retention_days()"
                ),
                [(settings.CLASSIFICATION_EVIDENCE_RETENTION_DAYS, settings.UNATTACHED_DOCUMENT_RETENTION_DAYS)],
            )
            with override_settings(
                CLASSIFICATION_EVIDENCE_RETENTION_DAYS=settings.CLASSIFICATION_EVIDENCE_RETENTION_DAYS + 1
            ):
                with self.assertRaisesMessage(ImproperlyConfigured, "Evidence retention configuration changed"):
                    require_evidence_retention_policy()
            self.assertEqual(self.catalogue(), installed_catalogue)
            migrate_to([RECORDS])
            self.assertEqual(self.retained_records(legacy_source=True), before_records)
            migrate_to([OLD])
            self.assertEqual(self.catalogue(), before_catalogue)
            self.assertEqual(self.retained_records(legacy_source=True), before_records)
            self.assertEqual(self.private_bytes(*files), before_bytes)
            migrate_to([GUARDS])
            self.assertEqual(self.catalogue(), installed_catalogue)
            self.assertEqual(self.retained_records(legacy_source=True), before_records)
            self.assertEqual(self.private_bytes(*files), before_bytes)
        finally:
            restore_every_migration()


@skipUnless(ORDINARY_MIGRATIONS, "Real ordinary PostgreSQL migration execution is required")
class CompanyEligibilityPopulatedMigrationTest(
    EligibilityMigrationChecks, CompanyEligibilityCases, StubUploadDependencies, APITransactionTestCase
):
    def setUp(self):
        self.addCleanup(restore_every_migration)
        super().setUp()

    def test_retained_real_request_refuses_guard_and_schema_reversal_before_ddl(self):
        try:
            self.created_request()
            before_bytes = self.private_bytes(self.source.evidence_file)
            self.assert_refuses_before_ddl(
                lambda: migrate_to([RECORDS]), "Retain the guards protecting recorded company eligibility"
            )
            self.assert_refuses_before_ddl(
                lambda: migrate_to([OLD]), "Retain the guards protecting recorded company eligibility"
            )
            self.assert_refuses_before_ddl(self.reverse_records_preflight, "Retain company eligibility history")
            self.assertEqual(self.private_bytes(self.source.evidence_file), before_bytes)
        finally:
            restore_every_migration()

    def test_actual_holder_withdrawal_without_a_request_refuses_reversal_before_ddl(self):
        try:
            before_bytes = self.private_bytes(self.source.evidence_file)
            response = self.client.delete(f"{SOURCES}{self.source.pk}/")
            self.assertEqual(response.status_code, 204, response.content)
            with use_operator():
                self.source.refresh_from_db()
                self.assertEqual(self.source.withdrawn_by_id, self.participant.pk)
                self.assertIsNone(self.source.reviewed_by_id)
                self.assertFalse(CompanyEligibilityRequest.objects.exists())
            self.assert_refuses_before_ddl(
                lambda: migrate_to([RECORDS]),
                "Retain the guards protecting actual participant withdrawal attribution",
            )
            self.assert_refuses_before_ddl(
                lambda: migrate_to([OLD]),
                "Retain the guards protecting actual participant withdrawal attribution",
            )
            self.assert_refuses_before_ddl(
                self.reverse_records_preflight, "Retain the actual participant's classification withdrawal attribution"
            )
            self.assertEqual(self.private_bytes(self.source.evidence_file), before_bytes)
        finally:
            restore_every_migration()
