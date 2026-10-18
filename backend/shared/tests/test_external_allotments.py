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
    RegisterGrant,
    RegisterMemberCessation,
    RegisterMemberParticulars,
    RegisterPosition,
    ShareToken,
)
from tokens.services.register import _stored_register, months_after, outputs_due
from tokens.services.register_events import verify_register, with_company_event_dates


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
        missing_date = {key: value for key, value in payload.items() if key != "company_event_on"}
        self.assertEqual(self.client.post(endpoint, missing_date, format="json").status_code, 400)
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
        today = timezone.now().date()
        with use_operator():
            dated_class = ShareToken.objects.create(
                company=self.company, name="Dated class", symbol="DATES", total_supply="1000"
            )
        opening = import_payload(self.owner, self.appointment, dated_class)
        opening["as_at"] = (today - timedelta(days=10)).isoformat()
        imports = "/api/v1/tokens/register-imports/"
        copied = self.client.post(imports, opening, format="json")
        self.assertEqual(copied.status_code, 201, copied.content)
        self.decision(imports, copied.json()["uuid"], "approve")
        self.decision(imports, copied.json()["uuid"], "apply")
        with use_operator():
            original = dated_class.stored_register.entries.get(sequence=1)
            original_hash = original.entry_hash
        dated = self.allotment_payload(
            token_id=str(dated_class.pk),
            company_event_on=(today - timedelta(days=2)).isoformat(),
            agreement_on=(today - timedelta(days=5)).isoformat(),
            received_on=(today - timedelta(days=4)).isoformat(),
        )
        for invalid in ((today + timedelta(days=1)).isoformat(), (today - timedelta(days=11)).isoformat()):
            refused = self.client.post(endpoint, {**dated, "company_event_on": invalid}, format="json")
            self.assertEqual(refused.status_code, 400, refused.content)
        prepared = self.client.post(endpoint, dated, format="json")
        self.assertEqual(prepared.status_code, 201, prepared.content)
        self.decision(endpoint, prepared.json()["uuid"], "approve")
        applied, receipt = self.decision(endpoint, prepared.json()["uuid"], "apply")
        self.assertEqual(applied.json()["companyEventOn"], dated["company_event_on"])
        self.assertEqual(applied.json()["effectiveOn"], dated["company_event_on"])
        self.assertEqual(
            self.client.post(f"{endpoint}{prepared.json()['uuid']}/decide/", receipt, format="json").status_code, 200
        )
        with use_operator():
            issued = RegisterAllotment.objects.get(pk=prepared.json()["uuid"])
            self.assertEqual(issued.register_entry.created_at.date(), today)
            self.assertEqual(
                RegisterPosition.objects.get(register__token=dated_class, member_id=dated["member"]).entered_on, today
            )
            self.assertEqual(RegisterMemberParticulars.objects.get(member_id=dated["member"]).as_at, today)
            with self.assertRaises(IntegrityError), atomic():
                RegisterAllotment.objects.filter(pk=issued.pk).update(company_event_on=today)
        alias = self.client.post(
            "/api/v1/tokens/register-grants/",
            self.grant_payload(
                operation_id=prepared.json()["uuid"],
                token_id=str(dated_class.pk),
                member=dated["member"],
                new_member=False,
                name="",
                residential_address="",
                shares=dated["shares"],
                company_event_on=dated["company_event_on"],
            ),
            format="json",
        )
        self.assertEqual(alias.status_code, 201, alias.content)
        grants = "/api/v1/tokens/register-grants/"
        self.decision(grants, alias.json()["uuid"], "approve")
        preview = self.client.post(
            f"{grants}{alias.json()['uuid']}/decision-preview/",
            {"appointment": str(self.appointment.pk), "kind": "apply"},
            format="json",
        )
        self.assertEqual(preview.status_code, 200, preview.content)
        refused = self.client.post(
            f"{grants}{alias.json()['uuid']}/decide/",
            {
                "appointment": str(self.appointment.pk),
                "kind": "apply",
                "idempotency_key": str(uuid4()),
                "preview_digest": preview.json()["previewDigest"],
                "confirmation": True,
            },
            format="json",
        )
        self.assertEqual(refused.status_code, 409, refused.content)
        with use_operator():
            alias_grant = RegisterGrant.objects.get(pk=alias.json()["uuid"])
            self.assertEqual(alias_grant.status, "submitted")
            self.assertIsNone(alias_grant.register_entry_id)
            original_issue = with_company_event_dates(
                issued.register_entry.register.entries.filter(pk=issued.register_entry_id)
            ).get()
            self.assertEqual(original_issue.company_event_on.isoformat(), dated["company_event_on"])
            self.assertEqual(verify_register(dated_class.stored_register.pk)["issued_supply"], "125")
            due = {
                item["output"]: item["due_on"]
                for item in outputs_due(self.company)
                if item["token"].pk == dated_class.pk and item["sequence"] == 2
            }
            self.assertEqual(
                due,
                {
                    "certificate": months_after(today - timedelta(days=2), 2),
                    "notice_figures": today + timedelta(days=26),
                },
            )
        stale = self.client.post(
            endpoint, {**dated, "operation_id": str(uuid4()), "company_event_on": opening["as_at"]}, format="json"
        )
        self.assertEqual(stale.status_code, 400, stale.content)
        transfer_endpoint = "/api/v1/tokens/register-transfers/"
        source_member = opening["members"][0]["member"]
        for sender, recipient in ((source_member, dated["member"]), (dated["member"], source_member)):
            transfer = self.client.post(
                transfer_endpoint,
                {
                    "operation_id": str(uuid4()),
                    "appointment": str(self.appointment.pk),
                    "token_id": str(dated_class.pk),
                    "from_member": sender,
                    "to_member": recipient,
                    "new_member": False,
                    "shares": "100",
                    "company_event_on": (today - timedelta(days=1)).isoformat(),
                    "signed_on": (today - timedelta(days=3)).isoformat(),
                    "lodged_on": (today - timedelta(days=2)).isoformat(),
                    "terms": "Non-paid recorded transfer",
                    "approving_director": "Independent Director",
                    "authority_reference": "DATE-TRANSFER",
                    "reason": "Record company event separately from retention",
                    "authority_evidence": dated["authority_evidence"],
                    "instrument_evidence": dated["agreement_evidence"],
                },
                format="json",
            )
            self.assertEqual(transfer.status_code, 201, transfer.content)
            self.decision(transfer_endpoint, transfer.json()["uuid"], "approve")
            self.decision(transfer_endpoint, transfer.json()["uuid"], "apply")
        with use_operator():
            cessation = RegisterMemberCessation.objects.get(register__token=dated_class, member_id=source_member)
            self.assertEqual((cessation.ceased_on, cessation.returned_on), (today, today))
            self.assertEqual(
                RegisterPosition.objects.get(register__token=dated_class, member_id=source_member).entered_on, today
            )
            self.assertEqual(verify_register(dated_class.stored_register.pk)["issued_supply"], "125")
            due = {
                item["output"]: item["due_on"]
                for item in outputs_due(self.company)
                if item["token"].pk == dated_class.pk and item["sequence"] == 4
            }
            self.assertEqual(
                due,
                {
                    "certificate": months_after(today - timedelta(days=2), 1),
                    "notice_figures": today + timedelta(days=27),
                },
            )
            original.refresh_from_db()
            self.assertEqual(
                (original.entry_hash, original.effective_on.isoformat()), (original_hash, opening["as_at"])
            )

        award = self.award_payload(token_id=str(dated_class.pk), terms_on=(today - timedelta(days=5)).isoformat())
        promised = self.client.post("/api/v1/tokens/register-awards/", award, format="json")
        self.assertEqual(promised.status_code, 201, promised.content)
        vested = self.client.post(
            "/api/v1/tokens/register-award-vestings/", self.vesting_payload(award["operation_id"]), format="json"
        )
        self.assertEqual(vested.status_code, 201, vested.content)
        premature = self.client.post(
            "/api/v1/tokens/register-grants/",
            self.linked_grant_payload(
                award, token_id=str(dated_class.pk), company_event_on=(today - timedelta(days=1)).isoformat()
            ),
            format="json",
        )
        self.assertEqual(premature.status_code, 400, premature.content)
        self.assertIn("recorded_vested_quantity_required", str(premature.json()))
