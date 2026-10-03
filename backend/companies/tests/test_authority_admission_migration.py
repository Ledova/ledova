import tempfile
from unittest.mock import patch
from uuid import uuid4

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, override_settings

from companies.models import (
    CompanyAppointment,
    CompanyAppointmentRevocation,
    CompanyAuthorityRequest,
)
from companies.services.authority import (
    DECLARATION_VERSION,
    admit_authority_request,
    revoke_authority_request,
)
from companies.services.authority_requests import (
    submit_authority_request,
    withdraw_authority_request,
)
from companies.tests.registry_fixtures import matching_observation
from companies.tests.test_authority_requests import (
    PDF,
    STORAGES,
    authority_fixture,
    evidence,
)
from shared.db import use_operator
from shared.tests.upload_fixtures import StubUploadDependencies

OLD = ("companies", "0014_authority_request_capabilities_refuse_null")
NEW = ("companies", "0015_self_declared_company_appointments")


class CompanyAuthorityAdmissionMigrationTest(StubUploadDependencies, TransactionTestCase):
    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        with use_operator():
            self.user, self.profile, self.company = authority_fixture("admission-migration", "113355779")
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

    def test_upgrade_preserves_historical_pending_and_withdrawn_requests_without_seeding_authority(self):
        withdrawn, _ = submit_authority_request(
            requester=self.user,
            company_id=self.company.pk,
            idempotency_key=uuid4(),
            file=evidence(),
            requested_capabilities=["prepare"],
        )
        withdrawn = withdraw_authority_request(requester=self.user, request_id=withdrawn.pk)
        originals = {
            row.pk: {field.attname: getattr(row, field.attname) for field in row._meta.fields}
            for row in (self.proposal, withdrawn)
        }
        MigrationExecutor(connection).migrate([OLD])
        executor = MigrationExecutor(connection)
        historical = executor.loader.project_state(list(executor.loader.applied_migrations)).apps
        request_model = historical.get_model("companies", "CompanyAuthorityRequest")
        for identity, original in originals.items():
            before = request_model.objects.get(pk=identity)
            self.assertEqual({field.attname: getattr(before, field.attname) for field in before._meta.fields}, original)
            with before.file.open("rb") as source:
                self.assertEqual(source.read(), PDF)
        MigrationExecutor(connection).migrate([NEW])
        with use_operator():
            self.assertFalse(CompanyAppointment.objects.exists())
            self.assertFalse(CompanyAppointmentRevocation.objects.exists())
            rows = CompanyAuthorityRequest.objects.select_related("withdrawal", "appointment").in_bulk(originals)
            self.assertEqual(rows[self.proposal.pk].status, "pending")
            self.assertEqual(rows[withdrawn.pk].status, "withdrawn")
            for identity, original in originals.items():
                after = rows[identity]
                self.assertEqual(
                    {field.attname: getattr(after, field.attname) for field in after._meta.fields}, original
                )
            self.company.refresh_from_db()
            self.assertEqual((self.company.status, self.company.owner_id), ("draft", self.user.pk))

    def test_empty_authority_reversal_preserves_request_bytes_and_can_be_reapplied(self):
        MigrationExecutor(connection).migrate([OLD])
        tables = connection.introspection.table_names()
        self.assertNotIn("companies_companyappointment", tables)
        self.assertNotIn("companies_companyappointmentrevocation", tables)
        executor = MigrationExecutor(connection)
        historical = executor.loader.project_state(list(executor.loader.applied_migrations)).apps
        retained = historical.get_model("companies", "CompanyAuthorityRequest").objects.get(pk=self.proposal.pk)
        self.assertEqual(retained.request_digest, self.proposal.request_digest)
        with retained.file.open("rb") as source:
            self.assertEqual(source.read(), PDF)
        self.latest()
        self.assertIn("companies_companyappointment", connection.introspection.table_names())
        with use_operator():
            self.assertFalse(CompanyAppointment.objects.exists())

    def test_populated_reversal_refuses_and_preserves_declaration_revocation_and_private_evidence(self):
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(self.company)):
            admitted = admit_authority_request(
                requester=self.user,
                request_id=self.proposal.pk,
                declaration_version=DECLARATION_VERSION,
                accept_declaration=True,
            )
        revoked = revoke_authority_request(requester=self.user, request_id=self.proposal.pk)
        original_appointment = {
            field.attname: getattr(admitted.appointment, field.attname) for field in admitted.appointment._meta.fields
        }
        original_revocation = {
            field.attname: getattr(revoked.appointment.revocation, field.attname)
            for field in revoked.appointment.revocation._meta.fields
        }
        with self.assertRaisesMessage(RuntimeError, "Retain company appointments, declarations and revocations"):
            MigrationExecutor(connection).migrate([OLD])
        self.latest()
        with use_operator():
            appointment = CompanyAppointment.objects.get(pk=admitted.appointment.pk)
            revocation = CompanyAppointmentRevocation.objects.get(pk=revoked.appointment.revocation.pk)
            self.assertEqual(
                {field.attname: getattr(appointment, field.attname) for field in appointment._meta.fields},
                original_appointment,
            )
            self.assertEqual(
                {field.attname: getattr(revocation, field.attname) for field in revocation._meta.fields},
                original_revocation,
            )
            self.assertEqual(
                CompanyAuthorityRequest.objects.get(pk=self.proposal.pk).request_digest, self.proposal.request_digest
            )
        with self.proposal.file.open("rb") as source:
            self.assertEqual(source.read(), PDF)
