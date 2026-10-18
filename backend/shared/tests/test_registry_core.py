import hashlib
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.models import (
    Company,
    CompanyAppointment,
    CompanyCapability,
    CompanyDocument,
    CompanySignupTermsAcceptance,
)
from companies.services.authority import (
    DECLARATION_VERSION,
    SIGNUP_DECLARATION_TEXT,
    SIGNUP_DECLARATION_VERSION,
)
from shared.db import atomic, use_migrate, use_operator
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
    RegisterTransfer,
    RegisterTransferDecision,
    ShareToken,
)
from tokens.services.register_events import record_entry


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
        self.scanner.reset_mock()
        request = {
            "company": str(company.pk),
            "idempotency_key": str(uuid4()),
            "requested_capabilities": ["admin"],
            "delegatable_capabilities": list(CompanyCapability.values),
        }
        with patch("shared.upload_limits.reserve_request") as reserve:
            response = self.client.post("/api/v1/company-authority/requests/", request, format="json")
            replay = self.client.post("/api/v1/company-authority/requests/", request, format="json")
            reserve.assert_not_called()
        self.scanner.assert_not_called()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertEqual(replay.json()["uuid"], response.json()["uuid"])
        self.assertIsNone(response.json()["fileUrl"])
        self.assertEqual(response.json()["fileSize"], 0)
        missing = self.client.get(f"/api/v1/company-authority/requests/{response.json()['uuid']}/file/")
        self.assertEqual(missing.status_code, 404, missing.content)
        declaration = {"declaration_version": SIGNUP_DECLARATION_VERSION, "accept_declaration": True}
        with patch("companies.services.registry.lookup_company", return_value=matching_observation(company)):
            admitted = self.client.post(
                f"/api/v1/company-authority/requests/{response.json()['uuid']}/admit/", declaration, format="json"
            )
            self.assertEqual(admitted.status_code, 200, admitted.content)
            appointment = admitted.json()["appointment"]["uuid"]
            self.assertEqual(admitted.json()["appointment"]["declarationText"], SIGNUP_DECLARATION_TEXT)
            self.assertEqual(admitted.json()["appointment"]["declarationVersion"], SIGNUP_DECLARATION_VERSION)
            accepted_terms = self.client.post(
                f"/api/v1/company-authority/appointments/{appointment}/signup-terms/", declaration, format="json"
            )
            self.assertEqual(accepted_terms.status_code, 200, accepted_terms.content)
            self.assertEqual(accepted_terms.json()["signupTerms"]["declarationText"], SIGNUP_DECLARATION_TEXT)
            self.assertEqual(CompanySignupTermsAcceptance.objects.count(), 0)
            activated = self.client.post(
                f"/api/v1/companies/{company.pk}/activate/",
                {
                    "declaration_version": DECLARATION_VERSION,
                    "accept_declaration": True,
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
        with patch("shared.upload_limits.reserve_request") as reserve:
            uploaded = self.client.post(
                f"/api/v1/companies/{company.pk}/documents/",
                {
                    "document_type": "other",
                    "name": "Company authority document",
                    "file": SimpleUploadedFile("authority.pdf", pdf_bytes(), content_type="application/pdf"),
                },
                format="multipart",
            )
            reserve.assert_called_once_with(user.pk)
        self.assertEqual(uploaded.status_code, 201, uploaded.content)
        self.scanner.assert_called_once()
        self.assertEqual(CompanyDocument.objects.get(pk=uploaded.json()["uuid"]).company_id, company.pk)
        invited = self.client.post(
            "/api/v1/company-authority/invitations/",
            {
                "company": str(company.pk),
                "inviter_appointment": appointment,
                "idempotency_key": str(uuid4()),
                "capabilities": [CompanyCapability.READ_REGISTER],
                "delegatable_capabilities": [],
            },
            format="json",
        )
        self.assertEqual(invited.status_code, 201, invited.content)

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
        award = self.client.post(
            "/api/v1/tokens/register-awards/",
            self.award_payload(appointment=str(appointment.pk)),
            format="json",
        )
        self.assertEqual(award.status_code, 404, award.content)
        self.assertEqual(RegisterGrant.objects.count(), 1)
        self.assertEqual(RegisterGrantDecision.objects.filter(register_grant_id=grant).count(), 0)
        self.assertIsNone(RegisterGrant.objects.get(pk=grant).register_entry_id)
        self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)
        refused_terms = self.client.post(
            f"/api/v1/company-authority/appointments/{appointment.pk}/signup-terms/",
            {"declaration_version": SIGNUP_DECLARATION_VERSION, "accept_declaration": True},
            format="json",
        )
        self.assertEqual(refused_terms.status_code, 404, refused_terms.content)
        self.client.force_authenticate(self.owner)
        resumed_user, resumed_profile = person("resumed-admin")
        with use_operator():
            resumed_profile.is_signup_completed = False
            resumed_profile.save(update_fields=["is_signup_completed"])
        invitation = self.client.post(
            "/api/v1/company-authority/invitations/",
            {
                "company": str(self.company.pk),
                "inviter_appointment": str(self.appointment.pk),
                "idempotency_key": str(uuid4()),
                "capabilities": ["admin"],
                "delegatable_capabilities": [],
                "appointment_expires_at": (timezone.now() + timedelta(days=1)).isoformat(),
            },
            format="json",
        )
        self.assertEqual(invitation.status_code, 201, invitation.content)
        self.client.force_authenticate(resumed_user)
        original = self.client.post(
            "/api/v1/company-authority/invitations/accept/",
            {"code": invitation.json()["code"], "declaration_version": DECLARATION_VERSION, "accept_declaration": True},
            format="json",
        )
        self.assertEqual(original.status_code, 200, original.content)
        original = original.json()
        self.assertIsNone(original["signupTerms"])
        self.assertEqual(CompanySignupTermsAcceptance.objects.count(), 0)
        endpoint = f"/api/v1/company-authority/appointments/{original['uuid']}/signup-terms/"
        not_accepted = self.client.post(
            endpoint, {"declaration_version": SIGNUP_DECLARATION_VERSION, "accept_declaration": False}, format="json"
        )
        self.assertEqual(not_accepted.status_code, 400, not_accepted.content)
        acknowledgement = {"declaration_version": SIGNUP_DECLARATION_VERSION, "accept_declaration": True}
        accepted_terms = self.client.post(endpoint, acknowledgement, format="json")
        retry = self.client.post(endpoint, acknowledgement, format="json")
        self.assertEqual(accepted_terms.status_code, 200, accepted_terms.content)
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(accepted_terms.json()["signupTerms"], retry.json()["signupTerms"])
        for field in (
            "uuid",
            "capabilities",
            "delegatableCapabilities",
            "expiresAt",
            "declarationVersion",
            "declarationText",
        ):
            self.assertEqual(accepted_terms.json()[field], original[field])
        receipt = accepted_terms.json()["signupTerms"]
        self.assertEqual(receipt["acceptedProfile"], str(resumed_profile.pk))
        self.assertEqual(receipt["acceptedBy"], resumed_user.pk)
        self.assertEqual(receipt["appointment"], original["uuid"])
        self.assertEqual(receipt["company"], str(self.company.pk))
        self.assertEqual(receipt["declarationText"], SIGNUP_DECLARATION_TEXT)
        self.assertEqual(receipt["declarationVersion"], SIGNUP_DECLARATION_VERSION)
        resumed_profile.refresh_from_db()
        self.assertFalse(resumed_profile.is_signup_completed)
        self.assertEqual(CompanySignupTermsAcceptance.objects.count(), 1)
        with use_operator(), self.assertRaises(DatabaseError), atomic():
            CompanySignupTermsAcceptance.objects.filter(appointment_id=original["uuid"]).update(
                declaration_text="Changed"
            )
        self.client.force_authenticate(self.owner)
        foreign_terms = self.client.post(endpoint, acknowledgement, format="json")
        self.assertEqual(foreign_terms.status_code, 404, foreign_terms.content)
        revoked = self.client.post(
            f"/api/v1/company-authority/appointments/{original['uuid']}/revoke/", {}, format="json"
        )
        self.assertEqual(revoked.status_code, 200, revoked.content)
        self.assertIsNone(revoked.json()["signupTerms"])
        self.client.force_authenticate(resumed_user)
        retained = self.client.get("/api/v1/company-authority/appointments/")
        self.assertEqual(retained.status_code, 200, retained.content)
        self.assertEqual(retained.json()["results"][0]["signupTerms"], receipt)
        revoked_terms = self.client.post(endpoint, acknowledgement, format="json")
        self.assertEqual(revoked_terms.status_code, 404, revoked_terms.content)
        self.assertEqual(CompanySignupTermsAcceptance.objects.count(), 1)

    def test_walletless_transfer_preserves_issued_shares_and_records_the_recipient(self):
        evidence = self.grant_payload()
        recipient = str(uuid4())
        endpoint = "/api/v1/tokens/register-transfers/"
        payload = {
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
        }
        with use_operator():
            ShareToken.objects.filter(pk=self.token.pk).update(is_transferable=False)
        restricted = self.client.post(endpoint, payload, format="json")
        self.assertEqual(restricted.status_code, 400, restricted.content)
        self.assertEqual(restricted.json()["unmetRequirements"], ["class_transfers_restricted"])
        self.assertEqual(RegisterTransfer.objects.count(), 0)
        with use_operator():
            ShareToken.objects.filter(pk=self.token.pk).update(is_transferable=True)
        response = self.client.post(endpoint, payload, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        identifier = response.json()["uuid"]
        self.decision(endpoint, identifier, "approve")
        fields = {"appointment": str(self.appointment.pk), "kind": "apply"}
        preview = self.client.post(f"{endpoint}{identifier}/decision-preview/", fields, format="json")
        self.assertEqual(preview.status_code, 200, preview.content)
        decision = {
            **fields,
            "idempotency_key": str(uuid4()),
            "preview_digest": preview.json()["previewDigest"],
            "confirmation": True,
        }
        with use_operator():
            ShareToken.objects.filter(pk=self.token.pk).update(is_transferable=False)
        restricted = self.client.post(f"{endpoint}{identifier}/decision-preview/", fields, format="json")
        self.assertEqual(restricted.status_code, 200, restricted.content)
        self.assertFalse(restricted.json()["canDecide"])
        self.assertEqual(restricted.json()["unmetRequirements"], ["class_transfers_restricted"])
        self.assertNotEqual(restricted.json()["previewDigest"], decision["preview_digest"])
        stale = self.client.post(f"{endpoint}{identifier}/decide/", decision, format="json")
        self.assertEqual(stale.status_code, 409, stale.content)
        self.assertEqual(RegisterTransferDecision.objects.filter(register_transfer_id=identifier).count(), 1)
        self.assertIsNone(RegisterTransfer.objects.get(pk=identifier).register_entry_id)
        with use_operator():
            ShareToken.objects.filter(pk=self.token.pk).update(is_transferable=True)

        def restrict_after_entry(**values):
            entry = record_entry(**values)
            ShareToken.objects.filter(pk=self.token.pk).update(is_transferable=False)
            return entry

        with patch("tokens.services.register_transfers.record_entry", side_effect=restrict_after_entry):
            refused = self.client.post(f"{endpoint}{identifier}/decide/", decision, format="json")
        self.assertEqual(refused.status_code, 409, refused.content)
        self.assertEqual(RegisterTransferDecision.objects.filter(register_transfer_id=identifier).count(), 1)
        self.assertIsNone(RegisterTransfer.objects.get(pk=identifier).register_entry_id)
        self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)
        self.assertFalse(RegisterPosition.objects.filter(member_id=recipient).exists())
        self.assertTrue(ShareToken.objects.get(pk=self.token.pk).is_transferable)
        self.token.stored_register.refresh_from_db()
        self.assertEqual(self.token.stored_register.sequence, 1)
        applied = self.client.post(f"{endpoint}{identifier}/decide/", decision, format="json")
        self.assertEqual(applied.status_code, 200, applied.content)
        with use_operator():
            ShareToken.objects.filter(pk=self.token.pk).update(is_transferable=False)
        retry = self.client.post(f"{endpoint}{identifier}/decide/", decision, format="json")
        prepared_retry = self.client.post(endpoint, payload, format="json")
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(prepared_retry.status_code, 200, prepared_retry.content)
        self.assertEqual(RegisterTransferDecision.objects.filter(register_transfer_id=identifier).count(), 2)
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
