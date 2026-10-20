import json
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.db import IntegrityError, connections
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.models import CompanyAppointment, CompanyCapability
from companies.services.authority import DECLARATION_VERSION
from companies.services.team import revoke_company_appointment
from shared.db import atomic, current_alias, use_operator
from shared.tests.core_fixtures import CoreFixtures, person, retained_evidence
from tokens.models import (
    RegisterAward,
    RegisterAwardEnd,
    RegisterAwardVesting,
    RegisterAwardVestingReversal,
    RegisterEvidence,
    RegisterEvidenceKind,
    RegisterGrant,
    RegisterMember,
    RegisterMemberParticulars,
    RegisterPosition,
)
from tokens.services.register_authority import register_command
from tokens.services.register_evidence import retain_register_evidence


class EmployeeAwardTest(CoreFixtures, APITransactionTestCase):
    def test_an_award_records_one_person_whose_particulars_every_later_flow_keeps(self):
        unrecorded = self.award_payload()
        with patch("tokens.services.register_awards.RegisterMemberParticulars.objects.create"):
            refused = self.client.post("/api/v1/tokens/register-awards/", unrecorded, format="json")
        self.assertEqual(refused.status_code, 503, refused.content)
        with use_operator():
            self.assertFalse(RegisterAward.objects.filter(pk=unrecorded["operation_id"]).exists())
            self.assertFalse(RegisterMember.objects.filter(pk=unrecorded["member"]).exists())
        award = self.award_payload()
        response = self.client.post("/api/v1/tokens/register-awards/", award, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        with use_operator():
            held = RegisterMemberParticulars.objects.select_related("member").get(member_id=award["member"])
            self.assertEqual(
                (held.member.company_id, str(held.source_award_id), held.name, held.residential_address),
                (self.company.pk, award["operation_id"], award["name"], award["residential_address"]),
            )
            self.assertFalse(RegisterPosition.objects.filter(member_id=award["member"]).exists())
        people = self.client.get(f"/api/v1/tokens/{self.token.pk}/register/members/").json()
        self.assertEqual(people["awardRecipients"], [])
        recipient = next(row for row in people["members"] if row["member"] == award["member"])
        self.assertEqual(
            (recipient["name"], recipient["currentShares"], recipient["onRegister"]), (award["name"], "0", False)
        )
        evidence = self.grant_payload()
        renamed = {"name": "Synthetic Other Employee", "residential_address": "9 Other Street, Sydney NSW 2000"}
        transfer = {
            "operation_id": str(uuid4()),
            "appointment": str(self.appointment.pk),
            "token_id": str(self.token.pk),
            "from_member": str(self.member.pk),
            "to_member": award["member"],
            "new_member": True,
            **renamed,
            "shares": "1",
            "company_event_on": timezone.now().date().isoformat(),
            "signed_on": timezone.now().date().isoformat(),
            "lodged_on": timezone.now().date().isoformat(),
            "terms": "Transfer to a new holder",
            "approving_director": "Synthetic Independent Director",
            "authority_reference": "SYNTHETIC-AWARD-IDENTITY",
            "reason": "Record the company-approved transfer",
            "authority_evidence": evidence["authority_evidence"],
            "instrument_evidence": evidence["terms_evidence"],
        }
        for endpoint, payload, refusal in (
            ("register-awards", self.award_payload(member=award["member"]), "already identifies a member"),
            (
                "register-awards",
                self.award_payload(member=award["member"], new_member=False, **renamed),
                "must match the retained particulars",
            ),
            ("register-allotments", self.allotment_payload(member=award["member"]), "member_reference_conflict"),
            (
                "register-allotments",
                self.allotment_payload(member=award["member"], new_member=False, **renamed),
                "must match the retained particulars",
            ),
            ("register-grants", self.linked_grant_payload(award, new_member=True), "member_reference_conflict"),
            ("register-grants", self.linked_grant_payload(award, **renamed), "must match the retained particulars"),
            ("register-transfers", transfer, "must match the retained particulars"),
        ):
            refused = self.client.post(f"/api/v1/tokens/{endpoint}/", payload, format="json")
            self.assertEqual(refused.status_code, 400, (endpoint, refused.content))
            self.assertIn(refusal, refused.content.decode(), endpoint)
        second = self.award_payload(member=award["member"], new_member=False, name="", residential_address="")
        response = self.client.post("/api/v1/tokens/register-awards/", second, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        supporting = retained_evidence(self.owner, self.appointment, RegisterEvidenceKind.SUPPORTING)
        change = self.client.post(
            "/api/v1/tokens/register-particulars-changes/",
            {
                "operation_id": str(uuid4()),
                "appointment": str(self.appointment.pk),
                "member": award["member"],
                "supporting_evidence": str(supporting.pk),
                **renamed,
                "as_at": timezone.now().date().isoformat(),
                "reason": "Correct the award recipient's particulars",
            },
            format="json",
        )
        self.assertEqual(change.status_code, 201, change.content)
        self.decision("/api/v1/tokens/register-particulars-changes/", change.json()["uuid"], "approve")
        self.decision("/api/v1/tokens/register-particulars-changes/", change.json()["uuid"], "apply")
        for promised in (award, second):
            shown = self.client.get(f"/api/v1/tokens/register-awards/{promised['operation_id']}/").json()
            self.assertEqual(
                (shown["recipientName"], shown["recipientResidentialAddress"]),
                (renamed["name"], renamed["residential_address"]),
            )
        with use_operator():
            self.assertEqual(RegisterMember.objects.filter(pk=award["member"]).count(), 1)
            self.assertFalse(RegisterPosition.objects.filter(member_id=award["member"]).exists())

    def test_vesting_cannot_exceed_the_promise_and_transfers_do_not_recycle_issued_entitlement(self):
        yesterday = (timezone.now().date() - timedelta(days=1)).isoformat()
        award = self.award_payload(shares="10", terms_on=yesterday)
        response = self.client.post("/api/v1/tokens/register-awards/", award, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        award_receipt = response.json()
        vesting = self.vesting_payload(award["operation_id"], shares="6", vested_on=yesterday)
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
            self.linked_grant_payload(award, shares="3"),
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
        extra_vesting = self.vesting_payload(award["operation_id"], shares="2")
        vested = self.client.post("/api/v1/tokens/register-award-vestings/", extra_vesting, format="json")
        self.assertEqual(vested.status_code, 201, vested.content)
        pending = self.client.post(endpoint, self.linked_grant_payload(award, shares="2"), format="json")
        self.assertEqual(pending.status_code, 201, pending.content)
        self.decision(endpoint, pending.json()["uuid"], "approve")
        still_available = self.client.post(endpoint, self.linked_grant_payload(award, shares="1"), format="json")
        self.assertEqual(still_available.status_code, 201, still_available.content)
        self.decision(endpoint, still_available.json()["uuid"], "approve")
        end_evidence = retained_evidence(self.owner, self.appointment, RegisterEvidenceKind.SUPPORTING)
        end_payload = {
            "operation_id": str(uuid4()),
            "appointment": str(self.appointment.pk),
            "award": award["operation_id"],
            "unvested_shares": "1",
            "vested_shares": "1",
            "company_event_on": timezone.now().date().isoformat(),
            "reason": "Company ends selected unissued rights",
            "evidence": str(end_evidence.pk),
        }
        ends = "/api/v1/tokens/register-award-ends/"
        for changes in (
            {"company_event_on": yesterday},
            {"unvested_shares": "0", "vested_shares": "0"},
            {"unvested_shares": "3"},
            {"vested_shares": "3"},
            {"evidence": original_request["authority_evidence"]},
        ):
            refused = self.client.post(ends, {**end_payload, **changes}, format="json")
            self.assertEqual(refused.status_code, 400, refused.content)
        ended = self.client.post(ends, end_payload, format="json")
        self.assertEqual(ended.status_code, 201, ended.content)
        self.assertEqual(self.client.post(ends, end_payload, format="json").status_code, 200)
        self.assertEqual(self.client.get(f"{ends}{end_payload['operation_id']}/").json(), ended.json())
        changed = self.client.post(ends, {**end_payload, "reason": "Changed fact"}, format="json")
        self.assertEqual(changed.status_code, 409, changed.content)
        for table, family, field, operation in (
            ("tokens_registerawardend", "register-award-ends", "unvested_shares", "register_award_end_record"),
            ("tokens_registerawardend", "register-award-ends", "vested_shares", "register_award_end_record"),
            (
                "tokens_registerawardvestingreversal",
                "register-award-vesting-reversals",
                "reversed_shares",
                "register_award_vesting_reversal_record",
            ),
        ):
            operation_id = str(uuid4())
            changes = {
                "uuid": operation_id,
                "unvested_shares": "0",
                "vested_shares": "0",
                field: "0.6",
                "vesting_id": vesting["operation_id"],
                "file": f"companies/{self.company.pk}/{family}/{operation_id}/{uuid4()}.bin",
            }
            with self.assertRaises(IntegrityError) as refusal:
                with register_command(self.owner, self.company.pk, operation), connections[
                    current_alias()
                ].cursor() as cursor:
                    cursor.execute(
                        f"INSERT INTO {table} SELECT (jsonb_populate_record(NULL::{table}, "
                        "to_jsonb(fact) || %s::jsonb)).* FROM tokens_registerawardend fact WHERE fact.uuid = %s",
                        [json.dumps(changes), end_payload["operation_id"]],
                    )
            self.assertEqual(refusal.exception.__cause__.sqlstate, "23514")
        preview = self.client.post(
            f"{endpoint}{pending.json()['uuid']}/decision-preview/",
            {"appointment": str(self.appointment.pk), "kind": "apply"},
            format="json",
        )
        self.assertIn("approval_lapsed", str(preview.json()))
        self.assertIn("recorded_vested_quantity_required", str(preview.json()))
        sufficient = self.client.post(
            f"{endpoint}{still_available.json()['uuid']}/decision-preview/",
            {"appointment": str(self.appointment.pk), "kind": "apply"},
            format="json",
        )
        self.assertEqual(sufficient.json()["unmetRequirements"], ["approval_lapsed"])
        self.assertFalse(sufficient.json()["canDecide"])
        stale = self.client.post(
            f"{endpoint}{pending.json()['uuid']}/decide/",
            {
                "appointment": str(self.appointment.pk),
                "kind": "apply",
                "idempotency_key": str(uuid4()),
                "preview_digest": preview.json()["previewDigest"],
                "confirmation": True,
            },
            format="json",
        )
        self.assertEqual(stale.status_code, 400, stale.content)
        rejection = {
            "appointment": str(self.appointment.pk),
            "kind": "reject",
            "reason": "Reprepare after the company entitlement fact",
        }
        preview_reject = self.client.post(
            f"{endpoint}{pending.json()['uuid']}/decision-preview/", rejection, format="json"
        )
        rejected = self.client.post(
            f"{endpoint}{pending.json()['uuid']}/decide/",
            {
                **rejection,
                "idempotency_key": str(uuid4()),
                "preview_digest": preview_reject.json()["previewDigest"],
                "confirmation": True,
            },
            format="json",
        )
        self.assertEqual(rejected.status_code, 200, rejected.content)
        sufficient_reject = self.client.post(
            f"{endpoint}{still_available.json()['uuid']}/decision-preview/", rejection, format="json"
        )
        refused_pending = self.client.post(
            f"{endpoint}{still_available.json()['uuid']}/decide/",
            {
                **rejection,
                "idempotency_key": str(uuid4()),
                "preview_digest": sufficient_reject.json()["previewDigest"],
                "confirmation": True,
            },
            format="json",
        )
        self.assertEqual(refused_pending.status_code, 200, refused_pending.content)
        reversal_payload = {
            "operation_id": str(uuid4()),
            "appointment": str(self.appointment.pk),
            "vesting": vesting["operation_id"],
            "reversed_shares": "1",
            "company_event_on": timezone.now().date().isoformat(),
            "reason": "Correct an overstated vesting record",
            "evidence": str(end_evidence.pk),
        }
        reversals = "/api/v1/tokens/register-award-vesting-reversals/"
        reversed_fact = self.client.post(reversals, reversal_payload, format="json")
        self.assertEqual(reversed_fact.status_code, 201, reversed_fact.content)
        self.assertEqual(self.client.post(reversals, reversal_payload, format="json").status_code, 200)
        self.assertEqual(
            self.client.get(f"{reversals}{reversal_payload['operation_id']}/").json(), reversed_fact.json()
        )
        for changes in ({"reversed_shares": "2"}, {"vesting": str(uuid4())}):
            refused = self.client.post(
                reversals, {**reversal_payload, "operation_id": str(uuid4()), **changes}, format="json"
            )
            self.assertEqual(refused.status_code, 404 if "vesting" in changes else 400, refused.content)
        quantities = self.client.get(f"/api/v1/tokens/register-awards/{award['operation_id']}/").json()
        self.assertEqual(
            tuple(
                quantities[key]
                for key in (
                    "shares",
                    "vestedShares",
                    "issuedShares",
                    "endedUnvestedShares",
                    "endedVestedShares",
                    "availableShares",
                    "unvestedRemainingShares",
                    "remainingUnissuedShares",
                )
            ),
            ("10", "7", "6", "1", "1", "0", "2", "2"),
        )
        self.assertEqual(self.client.post("/api/v1/tokens/register-awards/", award, format="json").status_code, 200)
        self.assertEqual(
            self.client.post("/api/v1/tokens/register-award-vestings/", vesting, format="json").status_code, 200
        )
        self.assertEqual(
            self.client.post(f"{endpoint}{identifier}/decide/", earlier_decision, format="json").json()[
                "registerEntry"
            ],
            original_applied.json()["registerEntry"],
        )
        for model, operation in (
            (RegisterAwardEnd, end_payload["operation_id"]),
            (RegisterAwardVestingReversal, reversal_payload["operation_id"]),
        ):
            with self.assertRaises(IntegrityError), use_operator(), atomic():
                model.objects.filter(pk=operation).update(reason="Rewrite retained fact")
            with self.assertRaises(IntegrityError), use_operator(), atomic():
                model.objects.filter(pk=operation).delete()
        final_vesting = self.vesting_payload(award["operation_id"], shares="2")
        self.assertEqual(
            self.client.post("/api/v1/tokens/register-award-vestings/", final_vesting, format="json").status_code, 201
        )
        final_end = self.client.post(
            ends,
            {**end_payload, "operation_id": str(uuid4()), "unvested_shares": "0", "vested_shares": "2"},
            format="json",
        )
        self.assertEqual(final_end.status_code, 201, final_end.content)
        final_quantities = self.client.get(f"/api/v1/tokens/register-awards/{award['operation_id']}/").json()
        self.assertEqual(
            (
                final_quantities["issuedShares"],
                final_quantities["remainingUnissuedShares"],
                final_quantities["availableShares"],
            ),
            ("6", "0", "0"),
        )
        self.assertEqual(
            self.client.post(
                "/api/v1/tokens/register-award-vestings/",
                {**final_vesting, "operation_id": str(uuid4()), "shares": "1"},
                format="json",
            ).status_code,
            400,
        )
        revoke_company_appointment(requester=self.owner, appointment_id=appointment.pk)
        self.client.force_authenticate(preparer)
        refused = self.client.post(endpoint, {**reused, "operation_id": str(uuid4())}, format="json")
        self.assertEqual(refused.status_code, 404, refused.content)
        self.assertEqual(self.client.get(f"{endpoint}{retained_id}/terms-file/").status_code, 404)
