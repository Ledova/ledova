from uuid import uuid4

from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from shared.tests.core_fixtures import CoreFixtures
from tokens.models import RegisterAwardVesting, RegisterGrant, RegisterPosition


class EmployeeAwardTest(CoreFixtures, APITransactionTestCase):
    def test_vesting_cannot_exceed_the_promise_and_transfers_do_not_recycle_issued_entitlement(self):
        award = self.award_payload(shares="10")
        response = self.client.post("/api/v1/tokens/register-awards/", award, format="json")
        self.assertEqual(response.status_code, 201, response.content)
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
        response = self.client.post(
            "/api/v1/tokens/register-grants/", self.linked_grant_payload(award, shares="4"), format="json"
        )
        self.assertEqual(response.status_code, 201, response.content)
        identifier = response.json()["uuid"]
        endpoint = "/api/v1/tokens/register-grants/"
        self.decision(endpoint, identifier, "approve")
        self.decision(endpoint, identifier, "apply")
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
