import json
from uuid import uuid4

from django.db import connections
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.models import CompanyAppointment, CompanyCapability
from companies.services.authority import DECLARATION_VERSION
from companies.services.team import revoke_company_appointment
from shared.db import current_alias, use_operator
from shared.tests.core_fixtures import CoreFixtures, person, retained_evidence
from tokens.models import (
    RegisterAward,
    RegisterAwardVesting,
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterGrant,
    RegisterMember,
    RegisterPosition,
)
from tokens.services.register_evidence import retain_register_evidence


class EmployeeAwardTest(CoreFixtures, APITransactionTestCase):
    def test_vesting_cannot_exceed_the_promise_and_transfers_do_not_recycle_issued_entitlement(self):
        award = self.award_payload(shares="10")
        response = self.client.post("/api/v1/tokens/register-awards/", award, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        award_receipt = response.json()
        vesting = self.vesting_payload(award["operation_id"], shares="6")
        response = self.client.post("/api/v1/tokens/register-award-vestings/", vesting, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        excess = self.client.post(
            "/api/v1/tokens/register-award-vestings/",
            {**vesting, "operation_id": str(uuid4()), "shares": "5"},
            format="json",
        )
        self.assertEqual(excess.status_code, 400, excess.content)
        self.assertEqual(RegisterAwardVesting.objects.filter(award_id=award["operation_id"]).count(), 1)
        with use_operator():
            promised = RegisterAward.objects.get(pk=award["operation_id"])
            with promised.file.open("rb") as source:
                agreement_bytes = source.read()
        copied_terms, _ = retain_register_evidence(
            actor=self.owner,
            company_id=self.company.pk,
            appointment=self.appointment.pk,
            kind=RegisterEvidenceKind.SUPPORTING,
            idempotency_key=uuid4(),
            name="earlier-explicit-terms.pdf",
            raw=agreement_bytes,
            mime_type="application/pdf",
        )
        original_request = {**self.linked_grant_payload(award, shares="4"), "terms_evidence": str(copied_terms.pk)}
        response = self.client.post("/api/v1/tokens/register-grants/", original_request, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        identifier = response.json()["uuid"]
        endpoint = "/api/v1/tokens/register-grants/"
        self.decision(endpoint, identifier, "approve")
        original_applied, earlier_decision = self.decision(endpoint, identifier, "apply")
        evidence = self.grant_payload()
        endpoint = "/api/v1/tokens/register-transfers/"
        response = self.client.post(
            endpoint,
            {
                "operation_id": str(uuid4()),
                "appointment": str(self.appointment.pk),
                "token_id": str(self.token.pk),
                "from_member": award["member"],
                "to_member": str(self.member.pk),
                "new_member": False,
                "shares": "4",
                "company_event_on": timezone.now().date().isoformat(),
                "signed_on": timezone.now().date().isoformat(),
                "lodged_on": timezone.now().date().isoformat(),
                "terms": "Transfer issued shares without restoring the award entitlement",
                "approving_director": "Synthetic Independent Director",
                "authority_reference": "SYNTHETIC-AWARD-TRANSFER",
                "reason": "Record the company-approved transfer",
                "authority_evidence": evidence["authority_evidence"],
                "instrument_evidence": evidence["terms_evidence"],
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        transfer = response.json()["uuid"]
        self.decision(endpoint, transfer, "approve")
        self.decision(endpoint, transfer, "apply")
        self.assertEqual(RegisterPosition.objects.get(member_id=award["member"]).shares, 0)
        entitlement = self.client.get(f"/api/v1/tokens/register-awards/{award['operation_id']}/").json()
        self.assertEqual(
            (entitlement["vestedShares"], entitlement["issuedShares"], entitlement["availableShares"]),
            ("6", "4", "2"),
        )
        excess = self.client.post(
            "/api/v1/tokens/register-grants/",
            self.linked_grant_payload(award, shares="3", new_member=False),
            format="json",
        )
        self.assertEqual(excess.status_code, 400, excess.content)
        self.assertIn("recorded_vested_quantity_required", str(excess.json()))
        self.assertEqual(RegisterGrant.objects.filter(award_id=award["operation_id"]).count(), 1)
        self.token.stored_register.refresh_from_db()
        self.assertEqual(int(self.token.stored_register.issued_supply), 104)

        invited = self.client.post(
            "/api/v1/company-authority/invitations/",
            {
                "company": str(self.company.pk),
                "inviter_appointment": str(self.appointment.pk),
                "idempotency_key": str(uuid4()),
                "capabilities": [CompanyCapability.PREPARE],
                "delegatable_capabilities": [],
            },
            format="json",
        )
        self.assertEqual(invited.status_code, 201, invited.content)
        preparer, _ = person("award-preparer")
        self.client.force_authenticate(preparer)
        accepted = self.client.post(
            "/api/v1/company-authority/invitations/accept/",
            {"code": invited.json()["code"], "declaration_version": DECLARATION_VERSION, "accept_declaration": True},
            format="json",
        )
        self.assertEqual(accepted.status_code, 200, accepted.content)
        with use_operator():
            appointment = CompanyAppointment.objects.get(company=self.company, appointee=preparer)
            uploaded = RegisterEvidence.objects.get(pk=award["agreement_evidence"])
            uploaded.file.storage.delete(uploaded.file.name)
        authority = retained_evidence(preparer, appointment, RegisterEvidenceKind.AUTHORITY)
        acceptance = retained_evidence(preparer, appointment, RegisterEvidenceKind.SUPPORTING)
        reused = self.linked_grant_payload(
            award,
            shares="2",
            new_member=False,
            appointment=str(appointment.pk),
            authority_evidence=str(authority.pk),
            acceptance_required=True,
            acceptance_evidence=str(acceptance.pk),
        )
        for changes, status in (
            ({"award": str(uuid4())}, 404),
            ({"terms_evidence": str(copied_terms.pk)}, 400),
            ({"authority_evidence": original_request["authority_evidence"]}, 400),
            ({"acceptance_evidence": str(copied_terms.pk)}, 400),
        ):
            refused = self.client.post("/api/v1/tokens/register-grants/", {**reused, **changes}, format="json")
            self.assertEqual(refused.status_code, status, refused.content)
        with use_operator(), promised.file.storage.open(promised.file.name, "wb") as target:
            target.write(bytes([agreement_bytes[0] ^ 1]) + agreement_bytes[1:])
        corrupt = self.client.post("/api/v1/tokens/register-grants/", reused, format="json")
        self.assertEqual(corrupt.status_code, 400, corrupt.content)
        with use_operator():
            promised.file.storage.delete(promised.file.name)
        missing = self.client.post("/api/v1/tokens/register-grants/", reused, format="json")
        self.assertEqual(missing.status_code, 400, missing.content)
        with use_operator(), promised.file.storage.open(promised.file.name, "wb") as target:
            target.write(agreement_bytes)
        response = self.client.post("/api/v1/tokens/register-grants/", reused, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        retained_id = response.json()["uuid"]
        self.assertEqual(response.json()["termsEvidence"], award["agreement_evidence"])
        self.assertEqual(response.json()["termsFingerprint"], promised.agreement_fingerprint)
        self.assertEqual(response.json()["termsSnapshot"], award_receipt["agreementSnapshot"])
        self.assertEqual(self.client.post("/api/v1/tokens/register-grants/", reused, format="json").status_code, 200)
        changed = self.client.post(
            "/api/v1/tokens/register-grants/", {**reused, "terms_evidence": str(copied_terms.pk)}, format="json"
        )
        self.assertEqual(changed.status_code, 409, changed.content)
        with use_operator(), connections[current_alias()].cursor() as cursor:
            for changes, expected in (
                ({}, True),
                ({"award_id": str(uuid4())}, False),
                ({"company_id": str(self.foreign_company.pk)}, False),
                ({"token_id": str(uuid4())}, False),
                ({"member": str(self.member.pk)}, False),
                ({"terms_evidence_id": str(copied_terms.pk)}, False),
                ({"terms_fingerprint": "0" * 64}, False),
                ({"terms_snapshot": {}}, False),
                ({"terms_file": promised.file.name}, False),
            ):
                cursor.execute(
                    "SELECT tokens_register_grant_terms_evidence_matches("
                    "jsonb_populate_record(NULL::tokens_registergrant, to_jsonb(proposal) || %s::jsonb), %s) "
                    "FROM tokens_registergrant proposal WHERE proposal.uuid = %s",
                    [json.dumps(changes), preparer.pk, retained_id],
                )
                self.assertEqual(cursor.fetchone()[0], expected, changes)
        private = self.client.get(f"/api/v1/tokens/register-grants/{retained_id}/terms-file/")
        self.assertEqual(private.status_code, 200, getattr(private, "content", b""))
        self.assertEqual(b"".join(private.streaming_content), agreement_bytes)
        private.close()
        self.client.force_authenticate(self.owner)
        endpoint = "/api/v1/tokens/register-grants/"
        self.decision(endpoint, retained_id, "approve")
        applied, original_decision = self.decision(endpoint, retained_id, "apply")
        self.assertEqual(
            self.client.post(f"{endpoint}{retained_id}/decide/", original_decision, format="json").json()[
                "registerEntry"
            ],
            applied.json()["registerEntry"],
        )
        recovered = self.client.post(endpoint, original_request, format="json")
        self.assertEqual(recovered.status_code, 200, recovered.content)
        self.assertEqual(recovered.json()["uuid"], identifier)
        self.assertEqual(recovered.json()["termsEvidence"], str(copied_terms.pk))
        self.assertEqual(
            self.client.post(f"{endpoint}{identifier}/decide/", earlier_decision, format="json").json()[
                "registerEntry"
            ],
            original_applied.json()["registerEntry"],
        )
        with use_operator():
            self.assertEqual(RegisterMember.objects.filter(pk=award["member"], company=self.company).count(), 1)
            self.assertEqual(RegisterPosition.objects.get(member_id=award["member"]).shares, 2)
            self.assertEqual(RegisterGrant.objects.filter(award_id=award["operation_id"], status="applied").count(), 2)
            self.token.stored_register.refresh_from_db()
            self.assertEqual(int(self.token.stored_register.issued_supply), 106)
        revoke_company_appointment(requester=self.owner, appointment_id=appointment.pk)
        self.client.force_authenticate(preparer)
        refused = self.client.post(endpoint, {**reused, "operation_id": str(uuid4())}, format="json")
        self.assertEqual(refused.status_code, 404, refused.content)
        self.assertEqual(self.client.get(f"{endpoint}{retained_id}/terms-file/").status_code, 404)
