from datetime import timedelta
from uuid import uuid4

from django.db import DatabaseError, IntegrityError
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from shared.db import atomic, use_operator
from shared.tests.core_fixtures import CoreFixtures, import_payload
from tokens.models import (
    RegisterAgreement,
    RegisterAllotment,
    RegisterContribution,
    RegisterMemberParticulars,
    RegisterPosition,
    ShareToken,
)
from tokens.services.register import _stored_register


class ExternalAllotmentTest(CoreFixtures, APITransactionTestCase):
    def test_fully_paid_sources_exact_approval_and_single_issue_preserve_known_and_unknown_backing(self):
        endpoint = "/api/v1/tokens/register-allotments/"
        payload = self.allotment_payload()
        for changes in (
            {"received_amount": "249.00"},
            {"shares": "901"},
            {"approving_director": payload["name"]},
            {"authority_evidence": str(uuid4())},
        ):
            refusal = self.client.post(endpoint, {**payload, **changes}, format="json")
            self.assertEqual(refusal.status_code, 400, refusal.content)
        self.assertFalse(RegisterAllotment.objects.exists())
        self.assertFalse(RegisterAgreement.objects.exists())
        self.assertFalse(RegisterContribution.objects.exists())
        prepared = self.client.post(endpoint, payload, format="json")
        self.assertEqual(prepared.status_code, 201, prepared.content)
        identifier = prepared.json()["uuid"]
        self.assertEqual(prepared.json()["contribution"]["companyRecorded"], True)
        self.assertIsNone(prepared.json()["registerEntry"])
        self.assertEqual(self.client.post(endpoint, payload, format="json").status_code, 200)
        self.assertEqual(
            self.client.post(endpoint, {**payload, "terms": "Changed external terms"}, format="json").status_code, 409
        )
        preview = self.client.post(
            f"{endpoint}{identifier}/decision-preview/",
            {"appointment": str(self.appointment.pk), "kind": "apply"},
            format="json",
        )
        self.assertIn("approval_required", preview.json()["unmetRequirements"])
        with use_operator(), self.assertRaises(DatabaseError), atomic():
            RegisterAllotment.objects.filter(pk=identifier).update(status="applied", reviewed_by=self.owner)
        self.decision(endpoint, identifier, "approve")
        self.assertEqual(int(self.token.stored_register.issued_supply), 100)
        applied, receipt = self.decision(endpoint, identifier, "apply")
        self.assertEqual(
            self.client.post(f"{endpoint}{identifier}/decide/", receipt, format="json").json()["registerEntry"],
            applied.json()["registerEntry"],
        )
        with use_operator():
            proposal = RegisterAllotment.objects.get(pk=identifier)
            register = proposal.register_entry.register
            self.assertEqual(
                (int(register.issued_supply), int(RegisterPosition.objects.get(member_id=payload["member"]).shares)),
                (125, 25),
            )
            self.assertEqual(register.entries.filter(kind="issue").count(), 1)
            self.assertEqual(
                str(
                    next(row for row in _stored_register(self.token)["rows"] if row["member"] == payload["member"])[
                        "amount_paid"
                    ]
                ),
                "250.00",
            )
            with self.assertRaises(IntegrityError), atomic():
                RegisterContribution.objects.filter(pk=proposal.contribution_id).update(amount="249.00")
        change = self.client.post(
            "/api/v1/tokens/register-particulars-changes/",
            {
                "operation_id": str(uuid4()),
                "appointment": str(self.appointment.pk),
                "member": payload["member"],
                "supporting_evidence": payload["agreement_evidence"],
                "name": "Synthetic Investor Updated",
                "residential_address": "5 Example Street, Sydney NSW 2000",
                "as_at": payload["agreement_on"],
                "reason": "Apply the company's supported particulars update after allotment",
            },
            format="json",
        )
        self.assertEqual(change.status_code, 201, change.content)
        current = self.client.post(
            f"/api/v1/tokens/register-particulars-changes/{change.json()['uuid']}/decision-preview/",
            {"appointment": str(self.appointment.pk), "kind": "approve"},
            format="json",
        )
        self.assertEqual(current.status_code, 200, current.content)
        self.assertEqual(current.json()["current"]["sourceAllotment"], identifier)
        self.decision("/api/v1/tokens/register-particulars-changes/", change.json()["uuid"], "approve")
        self.decision("/api/v1/tokens/register-particulars-changes/", change.json()["uuid"], "apply")
        with use_operator():
            held = RegisterMemberParticulars.objects.get(member_id=payload["member"])
            self.assertEqual(str(held.source_change_id), change.json()["uuid"])
            self.assertIsNone(held.source_allotment_id)
            self.assertEqual(held.name, "Synthetic Investor Updated")
        shared_member = self.allotment_payload()
        shared = self.client.post(endpoint, shared_member, format="json")
        self.assertEqual(shared.status_code, 201, shared.content)
        self.decision(endpoint, shared.json()["uuid"], "approve")
        self.decision(endpoint, shared.json()["uuid"], "apply")
        for symbol, days_before in (("OLDER", 1), ("CURRENT", 0)):
            with use_operator():
                imported_class = ShareToken.objects.create(
                    company=self.company, name="Synthetic second class", symbol=symbol, total_supply="1000"
                )
            copied = import_payload(self.owner, self.appointment, imported_class, member_id=shared_member["member"])
            copied["as_at"] = (timezone.now().date() - timedelta(days=days_before)).isoformat()
            imported = self.client.post("/api/v1/tokens/register-imports/", copied, format="json")
            self.assertEqual(imported.status_code, 201, imported.content)
            self.decision("/api/v1/tokens/register-imports/", imported.json()["uuid"], "approve")
            self.decision("/api/v1/tokens/register-imports/", imported.json()["uuid"], "apply")
            with use_operator():
                held = RegisterMemberParticulars.objects.get(member_id=shared_member["member"])
                if days_before:
                    self.assertEqual(str(held.source_allotment_id), shared.json()["uuid"])
                    self.assertEqual(held.name, shared_member["name"])
                else:
                    self.assertIsNone(held.source_allotment_id)
                    self.assertEqual(str(held.source_import_id), imported.json()["uuid"])
        existing = self.allotment_payload(member=str(self.member.pk), new_member=False, name="", residential_address="")
        created = self.client.post(endpoint, existing, format="json")
        self.assertEqual(created.status_code, 201, created.content)
        existing_id = created.json()["uuid"]
        self.decision(endpoint, existing_id, "approve")
        self.decision(endpoint, existing_id, "apply")
        with use_operator():
            projected = _stored_register(self.token)
            self.assertEqual(
                str(next(row for row in projected["rows"] if row["member"] == str(self.member.pk))["amount_paid"]),
                "350.00",
            )
        grant = self.client.post(
            "/api/v1/tokens/register-grants/",
            self.grant_payload(member=str(self.member.pk), new_member=False, name="", residential_address=""),
            format="json",
        )
        self.assertEqual(grant.status_code, 201, grant.content)
        self.decision("/api/v1/tokens/register-grants/", grant.json()["uuid"], "approve")
        self.decision("/api/v1/tokens/register-grants/", grant.json()["uuid"], "apply")
        with use_operator():
            self.assertIsNone(
                next(row for row in _stored_register(self.token)["rows"] if row["member"] == str(self.member.pk))[
                    "amount_paid"
                ]
            )
