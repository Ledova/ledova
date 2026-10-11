from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError
from rest_framework.test import APITransactionTestCase

from companies.models import CompanyDocument
from companies.services.team import revoke_company_appointment
from documents.models import Document
from shared.db import atomic, use_operator
from shared.tests.core_fixtures import CoreFixtures, pdf_bytes, populated_register
from shared.upload_errors import UploadRejected, UploadUnavailable
from tokens.models import RegisterGrant, RegisterGrantDecision, RegisterPosition


class RegistrySafeguardsTest(CoreFixtures, APITransactionTestCase):
    def test_revoked_company_authority_cannot_apply_an_approved_employee_grant(self):
        identifier = self.prepare_grant()
        self.decision("/api/v1/tokens/register-grants/", identifier, "approve")
        revoke_company_appointment(requester=self.owner, appointment_id=self.appointment.pk)
        response = self.client.post(
            f"/api/v1/tokens/register-grants/{identifier}/decision-preview/",
            {"appointment": str(self.appointment.pk), "kind": "apply"},
            format="json",
        )
        self.assertEqual(response.status_code, 404, response.content)
        proposal = RegisterGrant.objects.get(pk=identifier)
        self.assertIsNone(proposal.register_entry_id)
        self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)

    def test_a_foreign_member_cannot_receive_an_issue_in_another_company(self):
        _, foreign_member = populated_register(self.foreign, self.foreign_company, self.foreign_appointment, "FOREIGN")
        response = self.client.post(
            "/api/v1/tokens/register-grants/",
            self.grant_payload(member=str(foreign_member.pk), new_member=False, name="", residential_address=""),
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("identified member of this company", str(response.json()))
        self.assertEqual(RegisterGrant.objects.count(), 0)
        self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)

    def test_unapproved_sql_cannot_forge_a_grant_effect_or_ownership_totals(self):
        identifier = self.prepare_grant()
        proposal = RegisterGrant.objects.get(pk=identifier)
        with use_operator(), self.assertRaises(DatabaseError), atomic():
            RegisterGrant.objects.filter(pk=proposal.pk).update(status="applied", reviewed_by=self.owner)
        with use_operator(), self.assertRaises(DatabaseError), atomic():
            RegisterPosition.objects.filter(member=self.member).update(shares=900)
        proposal.refresh_from_db()
        self.assertIsNone(proposal.register_entry_id)
        self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)

    def test_an_issue_above_the_authorised_supply_is_refused_without_changing_holdings(self):
        response = self.client.post(
            "/api/v1/tokens/register-grants/",
            self.grant_payload(shares="1001"),
            format="json",
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json()["unmetRequirements"], ["authorised_headroom_required"])
        self.assertEqual(RegisterGrant.objects.count(), 0)
        self.assertEqual(RegisterGrantDecision.objects.count(), 0)
        self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)

    def test_fake_scanner_rejects_infected_and_unscannable_files_before_storage(self):
        before = {path for path in self.root.rglob("*") if path.is_file()}
        with patch("documents.services.document.extract_document.defer") as enqueue:
            self.scanner.side_effect = UploadRejected("Synthetic infected file")
            infected = self.client.post(
                "/api/v1/documents/",
                {
                    "documentType": "payslip",
                    "file": SimpleUploadedFile("infected.pdf", pdf_bytes(), content_type="application/pdf"),
                },
                format="multipart",
            )
            self.assertEqual(infected.status_code, 400, infected.content)
            self.scanner.side_effect = UploadUnavailable()
            unavailable = self.client.post(
                "/api/v1/documents/",
                {
                    "documentType": "payslip",
                    "file": SimpleUploadedFile("unscannable.pdf", pdf_bytes(), content_type="application/pdf"),
                },
                format="multipart",
            )
            self.assertEqual(unavailable.status_code, 503, unavailable.content)
            enqueue.assert_not_called()
        self.assertEqual(Document.objects.count(), 0)
        self.assertEqual(CompanyDocument.objects.count(), 0)
        self.assertEqual({path for path in self.root.rglob("*") if path.is_file()}, before)
