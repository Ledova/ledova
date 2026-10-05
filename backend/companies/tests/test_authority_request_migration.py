import tempfile

from django.core.files.base import ContentFile
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, override_settings

from companies.models import CompanyAuthorityRequest
from companies.services.authority_requests import submit_authority_request
from companies.tests.test_authority_requests import (
    PDF,
    STORAGES,
    authority_fixture,
    evidence,
)
from shared.db import use_operator
from shared.tests.upload_fixtures import StubUploadDependencies

OLD = ("companies", "0011_remove_company_api_key")
NEW = ("companies", "0012_company_authority_request")


class CompanyAuthorityRequestMigrationTest(StubUploadDependencies, TransactionTestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))

    def latest(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_upgrade_keeps_unrelated_historical_company_profile_and_evidence(self):
        self.addCleanup(self.latest)
        executor = MigrationExecutor(connection)
        executor.migrate([OLD])
        executor = MigrationExecutor(connection)
        applied_nodes = [node for node in executor.loader.applied_migrations if node in executor.loader.graph.nodes]
        historical = executor.loader.project_state(applied_nodes).apps
        User = historical.get_model("authentication", "CustomUser")
        Profile = historical.get_model("users", "UserProfile")
        Company = historical.get_model("companies", "Company")
        Document = historical.get_model("companies", "CompanyDocument")
        user = User.objects.create(email="migration-authority@example.test", password="synthetic", is_active=True)
        profile = Profile.objects.create(user=user, full_name="Historical representative")
        company = Company.objects.create(owner=user, name="Historical Pty Ltd", acn="123456789", status="draft")
        document = Document.objects.create(
            company=company,
            document_type="other",
            name="Historical evidence",
            file_size=len(PDF),
            mime_type="application/pdf",
            file=ContentFile(PDF, name="historical-evidence.pdf"),
        )
        executor = MigrationExecutor(connection)
        executor.migrate([NEW])
        executor = MigrationExecutor(connection)
        applied_nodes = [node for node in executor.loader.applied_migrations if node in executor.loader.graph.nodes]
        upgraded = executor.loader.project_state(applied_nodes).apps
        self.assertEqual(upgraded.get_model("companies", "Company").objects.get(pk=company.pk).name, company.name)
        self.assertEqual(
            upgraded.get_model("users", "UserProfile").objects.get(pk=profile.pk).full_name, profile.full_name
        )
        retained = upgraded.get_model("companies", "CompanyDocument").objects.get(pk=document.pk)
        self.assertEqual(
            (retained.name, retained.external_url, retained.file_size),
            (document.name, document.external_url, document.file_size),
        )
        with retained.file.open("rb") as source:
            self.assertEqual(source.read(), PDF)
        self.assertEqual(upgraded.get_model("companies", "CompanyAuthorityRequest").objects.count(), 0)
        self.latest()

    def test_populated_reversal_refuses_without_discarding_requests_or_private_bytes(self):
        from uuid import uuid4

        with use_operator():
            user, profile, company = authority_fixture("migration-request")
        proposal, created = submit_authority_request(
            requester=user,
            company_id=company.pk,
            idempotency_key=uuid4(),
            file=evidence(),
            requested_capabilities=["admin"],
        )
        self.assertTrue(created)
        with proposal.file.open("rb") as source:
            before = source.read()
        self.addCleanup(self.latest)
        with self.assertRaisesMessage(RuntimeError, "Retain company authority requests"):
            MigrationExecutor(connection).migrate([OLD])
        self.latest()
        with use_operator():
            self.assertEqual(
                CompanyAuthorityRequest.objects.get(pk=proposal.pk).request_digest, proposal.request_digest
            )
        with proposal.file.open("rb") as source:
            self.assertEqual(source.read(), before)

    def test_empty_reversal_and_reapplication_are_supported(self):
        self.addCleanup(self.latest)
        executor = MigrationExecutor(connection)
        executor.migrate([OLD])
        self.assertNotIn("companies_companyauthorityrequest", connection.introspection.table_names())
        self.latest()
        self.assertIn("companies_companyauthorityrequest", connection.introspection.table_names())
