import tempfile
from uuid import uuid4

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, override_settings

from companies.models import CompanyAuthorityRequest, CompanyAuthorityRequestWithdrawal
from companies.services.authority_requests import (
    submit_authority_request,
    withdraw_authority_request,
)
from companies.tests.test_authority_requests import (
    PDF,
    STORAGES,
    authority_fixture,
    evidence,
)
from shared.db import use_operator
from shared.tests.upload_fixtures import StubUploadDependencies

OLD = ("companies", "0012_company_authority_request")
NEW = ("companies", "0013_company_authority_request_withdrawal")


class CompanyAuthorityRequestWithdrawalMigrationTest(StubUploadDependencies, TransactionTestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        with use_operator():
            self.user, self.profile, self.company = authority_fixture("withdrawal-migration", "113355779")
        self.proposal, created = submit_authority_request(
            requester=self.user,
            company_id=self.company.pk,
            idempotency_key=uuid4(),
            file=evidence(),
            requested_capabilities=["admin"],
        )
        self.assertTrue(created)
        self.addCleanup(self.latest)

    def latest(self):
        executor = MigrationExecutor(connection)
        executor.migrate(executor.loader.graph.leaf_nodes())

    def test_upgrade_preserves_pending_request_identity_terms_file_and_unrelated_company(self):
        original = {field.attname: getattr(self.proposal, field.attname) for field in self.proposal._meta.fields}
        MigrationExecutor(connection).migrate([OLD])
        executor = MigrationExecutor(connection)
        historical = executor.loader.project_state(list(executor.loader.applied_migrations)).apps
        before = historical.get_model("companies", "CompanyAuthorityRequest").objects.get(pk=self.proposal.pk)
        self.assertEqual({field.attname: getattr(before, field.attname) for field in before._meta.fields}, original)
        with before.file.open("rb") as source:
            self.assertEqual(source.read(), PDF)
        MigrationExecutor(connection).migrate([NEW])
        with use_operator():
            after = CompanyAuthorityRequest.objects.select_related("withdrawal").get(pk=self.proposal.pk)
            self.assertEqual({field.attname: getattr(after, field.attname) for field in after._meta.fields}, original)
            self.assertEqual(after.status, "pending")
            self.assertFalse(CompanyAuthorityRequestWithdrawal.objects.exists())
            self.company.refresh_from_db()
            self.assertEqual(self.company.name, "withdrawal-migration Pty Ltd")
            self.profile.refresh_from_db()
            self.assertEqual(self.profile.full_name, "withdrawal-migration representative")
        with after.file.open("rb") as source:
            self.assertEqual(source.read(), PDF)

    def test_populated_reversal_refuses_and_keeps_withdrawal_request_and_private_bytes(self):
        withdrawn = withdraw_authority_request(requester=self.user, request_id=self.proposal.pk)
        recorded = withdrawn.withdrawal
        with self.assertRaisesMessage(RuntimeError, "Retain authority request withdrawals"):
            MigrationExecutor(connection).migrate([OLD])
        self.latest()
        with use_operator():
            retained = CompanyAuthorityRequestWithdrawal.objects.get(pk=recorded.pk)
            self.assertEqual(
                (retained.request_id, retained.withdrawn_by_id, retained.created_at),
                (self.proposal.pk, self.user.pk, recorded.created_at),
            )
            self.assertEqual(
                CompanyAuthorityRequest.objects.get(pk=self.proposal.pk).request_digest, self.proposal.request_digest
            )
        with self.proposal.file.open("rb") as source:
            self.assertEqual(source.read(), PDF)

    def test_empty_withdrawal_reversal_preserves_requests_and_can_be_reapplied(self):
        MigrationExecutor(connection).migrate([OLD])
        tables = connection.introspection.table_names()
        self.assertNotIn("companies_companyauthorityrequestwithdrawal", tables)
        self.assertIn("companies_companyauthorityrequest", tables)
        self.latest()
        self.assertIn("companies_companyauthorityrequestwithdrawal", connection.introspection.table_names())
        with use_operator():
            self.assertEqual(
                CompanyAuthorityRequest.objects.get(pk=self.proposal.pk).request_digest, self.proposal.request_digest
            )
