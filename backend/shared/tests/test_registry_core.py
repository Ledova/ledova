import hashlib
from unittest.mock import patch
from uuid import uuid4

from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.models import Company, CompanyAppointment, CompanyCapability
from companies.services.authority import DECLARATION_VERSION
from shared.db import use_migrate
from shared.tests.core_fixtures import (
    CoreFixtures,
    matching_observation,
    pdf_bytes,
    person,
)
from tokens.models import (
    RegisterExport,
    RegisterGrant,
    RegisterGrantDecision,
    RegisterPosition,
)


class RegistryCoreTest(CoreFixtures, APITransactionTestCase):
    def test_company_registration_records_the_owner_and_contact(self):
        user, profile = person("registration")
        self.client.force_authenticate(user)
        response = self.client.post(
            "/api/v1/companies/",
            {
                "name": "Synthetic New Pty Ltd",
                "acn": "987654320",
                "companyType": "pty",
                "primaryContact": {"firstName": "Ada", "lastName": "Example", "phone": "+61 0400000000"},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        company = Company.objects.get(pk=response.json()["company"]["uuid"])
        profile.refresh_from_db()
        self.assertEqual((company.owner_id, company.status, profile.full_name), (user.pk, "draft", "Ada Example"))

    def test_representative_declaration_and_activation_use_current_company_authority(self):
        user, _ = person("representative")
        with use_migrate():
            company = Company.objects.create(owner=user, name="Synthetic Declared Pty Ltd", acn="123456780")
        self.client.force_authenticate(user)
        response = self.client.post(
            "/api/v1/company-authority/requests/",
            {
                "company": str(company.pk),
                "idempotency_key": str(uuid4()),
                "file": SimpleUploadedFile("authority.pdf", pdf_bytes(), content_type="application/pdf"),
                "requested_capabilities": ["admin"],
                "delegatable_capabilities": ["admin"],
            },
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.content)
        declaration = {"declaration_version": DECLARATION_VERSION, "accept_declaration": True}
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(company)):
            admitted = self.client.post(
                f"/api/v1/company-authority/requests/{response.json()['uuid']}/admit/", declaration, format="json"
            )
            self.assertEqual(admitted.status_code, 200, admitted.content)
            appointment = admitted.json()["appointment"]["uuid"]
            activated = self.client.post(
                f"/api/v1/companies/{company.pk}/activate/",
                {
                    **declaration,
                    "appointment": appointment,
                    "idempotency_key": str(uuid4()),
                    "lifecycle_revision": company.lifecycle_revision,
                },
                format="json",
            )
        self.assertEqual(activated.status_code, 200, activated.content)
        company.refresh_from_db()
        self.assertEqual(company.status, "active")
        self.assertEqual(CompanyAppointment.objects.get(pk=appointment).appointee_id, user.pk)

    def test_company_team_invitation_records_the_invitees_exact_capability(self):
        response = self.client.post(
            "/api/v1/company-authority/invitations/",
            {
                "company": str(self.company.pk),
                "inviter_appointment": str(self.appointment.pk),
                "idempotency_key": str(uuid4()),
                "capabilities": [CompanyCapability.READ_REGISTER],
                "delegatable_capabilities": [],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        grant = self.prepare_grant()
        self.client.force_authenticate(self.foreign)
        accepted = self.client.post(
            "/api/v1/company-authority/invitations/accept/",
            {"code": response.json()["code"], "declaration_version": DECLARATION_VERSION, "accept_declaration": True},
            format="json",
        )
        self.assertEqual(accepted.status_code, 200, accepted.content)
        appointment = CompanyAppointment.objects.get(company=self.company, appointee=self.foreign)
        self.assertEqual(appointment.capabilities, [CompanyCapability.READ_REGISTER])
        self.assertIsNotNone(appointment.invitation_id)
        holders = self.client.get(f"/api/v1/tokens/{self.token.pk}/holders/")
        self.assertEqual(holders.status_code, 200, holders.content)
        self.assertIn("Synthetic Member", str(holders.json()))
        endpoint = f"/api/v1/tokens/register-grants/{grant}/"
        fields = {"appointment": str(appointment.pk), "kind": "approve"}
        preview = self.client.post(f"{endpoint}decision-preview/", fields, format="json")
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertFalse(preview.json()["canDecide"])
        self.assertIn("appointment_capability_required", preview.json()["unmetRequirements"])
        approval = self.client.post(
            f"{endpoint}decide/",
            {
                **fields,
                "idempotency_key": str(uuid4()),
                "preview_digest": preview.json()["previewDigest"],
                "confirmation": True,
            },
            format="json",
        )
        self.assertEqual(approval.status_code, 400, approval.content)
        issue = self.client.post(
            "/api/v1/tokens/register-grants/",
            self.grant_payload(appointment=str(appointment.pk)),
            format="json",
        )
        self.assertEqual(issue.status_code, 404, issue.content)
        self.assertEqual(RegisterGrant.objects.count(), 1)
        self.assertEqual(RegisterGrantDecision.objects.filter(register_grant_id=grant).count(), 0)
        self.assertIsNone(RegisterGrant.objects.get(pk=grant).register_entry_id)
        self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)

    def test_walletless_transfer_preserves_issued_shares_and_records_the_recipient(self):
        evidence = self.grant_payload()
        recipient = str(uuid4())
        endpoint = "/api/v1/tokens/register-transfers/"
        response = self.client.post(
            endpoint,
            {
                "operation_id": str(uuid4()),
                "appointment": str(self.appointment.pk),
                "token_id": str(self.token.pk),
                "from_member": str(self.member.pk),
                "to_member": recipient,
                "new_member": True,
                "name": "Synthetic Recipient",
                "residential_address": "3 Example Street, Sydney NSW 2000",
                "shares": "25",
                "signed_on": timezone.now().date().isoformat(),
                "lodged_on": timezone.now().date().isoformat(),
                "terms": "Non-paid transfer with a signed synthetic instrument",
                "approving_director": "Synthetic Independent Director",
                "authority_reference": "SYNTHETIC-CORE-TRANSFER",
                "reason": "Record the company-approved transfer",
                "authority_evidence": evidence["authority_evidence"],
                "instrument_evidence": evidence["terms_evidence"],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        identifier = response.json()["uuid"]
        self.decision(endpoint, identifier, "approve")
        self.decision(endpoint, identifier, "apply")
        positions = RegisterPosition.objects.filter(register=self.token.stored_register)
        self.assertEqual(positions.get(member=self.member).shares, 75)
        self.assertEqual(positions.get(member_id=recipient).shares, 25)
        self.token.stored_register.refresh_from_db()
        self.assertEqual(int(self.token.stored_register.issued_supply), 100)

    def test_company_inspection_copy_serves_and_retains_the_real_register_bytes(self):
        endpoint = f"/api/v1/tokens/{self.token.pk}/register/inspection-copy/"
        preview = self.client.get(endpoint)
        self.assertEqual(preview.status_code, 200, preview.content)
        response = self.client.post(
            endpoint,
            {
                "appointment": preview.json()["appointment"],
                "sourceDigest": preview.json()["sourceDigest"],
                "instruction": "SYNTHETIC-CORE-INSPECTION",
                "requestedOn": timezone.now().date().isoformat(),
                "recipient": "Synthetic Requester",
            },
            format="json",
        )
        self.assertEqual((response.status_code, response["Content-Type"]), (200, "text/csv"))
        self.assertIn("Synthetic Member", response.content.decode())
        record = RegisterExport.objects.get(token=self.token, kind="inspection_copy", requested_by_id=self.owner.pk)
        self.assertEqual(record.digest, hashlib.sha256(response.content).hexdigest())
        self.assertEqual(record.member_rows, 1)
