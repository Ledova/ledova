from copy import deepcopy
from unittest.mock import patch
from uuid import uuid4

from django.db import DatabaseError
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITransactionTestCase

from companies.services.team import revoke_company_appointment
from operators.models import Operator
from shared.db import atomic, use_operator
from shared.tests.core_fixtures import CoreFixtures, retained_evidence
from tokens.constants import MAX_UINT256
from tokens.models import (
    RegisterAward,
    RegisterEntry,
    RegisterEvidenceKind,
    RegisterImport,
    RegisterMember,
    RegisterMemberDocument,
    RegisterMemberParticulars,
    RegisterPosition,
    ShareToken,
)
from tokens.services.company_pack_documents import member_documents
from tokens.services.register import _stored_register
from tokens.services.register_authority import register_command
from tokens.services.register_events import verify_register
from tokens.services.register_imports import _rows


class RegisterMirrorTest(CoreFixtures, APITransactionTestCase):
    def mirror_payload(self, token, **changes):
        return {
            "operation_id": str(uuid4()),
            "appointment": str(self.appointment.pk),
            "token_id": str(token.pk),
            "source_reference": "Company's existing register, 14 October 2026",
            "source_confirmed": True,
            "as_at": timezone.now().date().isoformat(),
            "members": [
                {
                    "member": str(uuid4()),
                    "name": "Synthetic Founder",
                    "residential_address": "1 Example Street",
                    "shares": "100",
                    "entered_on": "2020-01-01",
                    "allotments": [
                        {
                            "allotted_on": "2019-01-01",
                            "shares": "40",
                            "share_reference": "1-40",
                            "certificate_reference": "SYNTHETIC-A",
                            "amount_paid": "40",
                            "amount_unpaid": "0",
                            "fully_paid": True,
                            "beneficially_held": True,
                        },
                        {
                            "allotted_on": "2022-01-01",
                            "shares": "60",
                            "share_reference": None,
                            "certificate_reference": None,
                            "amount_paid": "30",
                            "amount_unpaid": "30",
                            "fully_paid": False,
                            "beneficially_held": False,
                        },
                    ],
                }
            ],
            "former_members": [],
            "reason": "Mirror the existing company records",
            **changes,
        }

    def test_mirror_records_full_allotments_and_corrects_without_rewriting_the_opening(self):
        created = self.client.post(
            "/api/v1/tokens/",
            {"company": str(self.company.pk), "name": "Synthetic A shares", "symbol": "a", "total_supply": "1000"},
            format="json",
        )
        self.assertEqual(created.status_code, 201, created.content)
        self.assertEqual(created.json()["symbol"], "A")
        token = ShareToken.objects.get(pk=created.json()["uuid"])
        endpoint = "/api/v1/tokens/register-imports/"
        payload = self.mirror_payload(token)
        supporting = retained_evidence(self.owner, self.appointment, RegisterEvidenceKind.SUPPORTING)
        payload["members"][0]["documents"] = [{"evidence": str(supporting.pk), "category": "share_certificate"}]
        allotments = payload["members"][0]["allotments"]
        allotments[1].update(shares="30", amount_paid="15", amount_unpaid="15")
        allotments.append({**allotments[1], "beneficially_held": None})
        payload["former_members"] = [
            {
                "name": "Synthetic former member",
                "residential_address": "3 Example Street",
                "shares": "20",
                "ceased_on": "2020-06-01",
            }
        ]
        legacy_members, legacy_former = _rows(payload["members"], payload["former_members"], timezone.localdate())
        legacy_members[0]["amount_paid"] = "70.00"
        with patch("tokens.services.register_imports._rows", return_value=(legacy_members, legacy_former)):
            prepared = self.client.post(endpoint, payload, format="json")
        self.assertEqual(prepared.status_code, 201, prepared.content)
        identifier = prepared.json()["uuid"]
        self.assertIsNone(RegisterImport.objects.get(pk=identifier).members[0]["allotments"][2]["beneficially_held"])
        with use_operator():
            retained_documents, retained_files = member_documents(self.company)
        self.assertEqual(retained_documents["links"], [])
        self.assertEqual(retained_documents["openings"][0]["status"], "submitted")
        self.assertEqual(str(retained_documents["openings"][0]["source_import"]), identifier)
        self.assertEqual(len(retained_files), 1)
        self.assertEqual(next(iter(retained_files.values()))["recorded"]["sha256"], supporting.sha256)
        retried = self.client.post(endpoint, payload, format="json")
        self.assertEqual(retried.status_code, 200, retried.content)
        changed_status = deepcopy(payload)
        changed_status["members"][0]["allotments"][2]["beneficially_held"] = False
        refused = self.client.post(endpoint, changed_status, format="json")
        self.assertEqual(refused.status_code, 409, refused.content)
        with patch(
            "tokens.services.register_member_documents.matching_bytes", side_effect=ValidationError("Unavailable file")
        ):
            unavailable = self.client.post(
                f"{endpoint}{identifier}/decision-preview/",
                {"appointment": str(self.appointment.pk), "kind": "approve"},
                format="json",
            )
            self.assertFalse(unavailable.json()["canDecide"])
            self.assertIn("evidence_unavailable", unavailable.json()["unmetRequirements"])
        self.decision(endpoint, identifier, "approve")
        self.decision(endpoint, identifier, "apply")
        documents_endpoint = "/api/v1/tokens/register-member-documents/"
        documents = self.client.get(
            documents_endpoint, {"member": payload["members"][0]["member"], "token": str(token.pk)}
        )
        self.assertEqual(documents.status_code, 200, documents.content)
        document = documents.json()["results"][0]
        self.assertEqual(
            (document["evidence"], document["sourceImport"], document["category"]),
            (str(supporting.pk), identifier, "share_certificate"),
        )
        downloaded = self.client.get(f"{documents_endpoint}{document['uuid']}/file/")
        self.assertEqual(downloaded.status_code, 200)
        self.assertEqual(b"".join(downloaded.streaming_content), supporting.file.open("rb").read())
        self.client.force_authenticate(self.foreign)
        self.assertEqual(self.client.get(documents_endpoint).json()["results"], [])
        self.assertEqual(self.client.get(f"{documents_endpoint}{document['uuid']}/file/").status_code, 404)
        self.client.force_authenticate(self.owner)
        later = {
            "company_id": str(self.company.pk),
            "member": str(self.member.pk),
            "token": str(self.token.pk),
            "evidence": str(supporting.pk),
            "category": "shareholder_agreement",
            "appointment": str(self.appointment.pk),
            "idempotency_key": str(uuid4()),
        }
        added = self.client.post(documents_endpoint, later, format="json")
        self.assertEqual(added.status_code, 201, added.content)
        self.assertIsNone(added.json()["sourceImport"])
        self.assertEqual(self.client.post(documents_endpoint, later, format="json").status_code, 200)
        changed_document = {**later, "category": "subscription_agreement"}
        self.assertEqual(self.client.post(documents_endpoint, changed_document, format="json").status_code, 409)
        duplicate_document = {**later, "idempotency_key": str(uuid4())}
        self.assertEqual(self.client.post(documents_endpoint, duplicate_document, format="json").status_code, 409)
        foreign_document = retained_evidence(self.foreign, self.foreign_appointment, RegisterEvidenceKind.SUPPORTING)
        self.assertEqual(
            self.client.post(
                documents_endpoint,
                {**later, "evidence": str(foreign_document.pk), "idempotency_key": str(uuid4())},
                format="json",
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.post(
                documents_endpoint, {**later, "member": str(uuid4()), "idempotency_key": str(uuid4())}, format="json"
            ).status_code,
            404,
        )
        with use_operator():
            self.assertEqual(RegisterMemberDocument.objects.filter(evidence=supporting).count(), 2)
            with self.assertRaises(DatabaseError), atomic():
                RegisterMemberDocument.objects.filter(pk=document["uuid"]).update(category="other")
            with self.assertRaises(DatabaseError), register_command(
                self.owner, self.company.pk, "register_member_document"
            ):
                RegisterMemberDocument.objects.create(
                    company=self.company,
                    member=self.member,
                    token=self.token,
                    evidence=foreign_document,
                    category="other",
                    snapshot=document["snapshot"],
                    recorded_by=self.owner,
                    appointment=self.appointment,
                    idempotency_key=uuid4(),
                )
        opening = RegisterEntry.objects.get(register__token=token, kind="opening")
        original_changes, original_hash = deepcopy(opening.changes), opening.entry_hash
        confirmed = self.client.get(f"{endpoint}{identifier}/").json()
        self.assertTrue(confirmed["correctionAllowed"])
        self.assertIsNone(confirmed["asicEvidence"])
        self.assertIsNone(confirmed["registerEvidence"])
        self.assertEqual(confirmed["members"][0]["amountPaid"], "70.00")
        self.assertEqual(confirmed["members"][0]["enteredOn"], "2020-01-01")
        self.assertEqual(confirmed["members"][0]["allotments"][0]["allottedOn"], "2019-01-01")
        self.assertIs(confirmed["members"][0]["allotments"][0]["beneficiallyHeld"], True)
        self.assertIs(confirmed["members"][0]["allotments"][1]["beneficiallyHeld"], False)
        self.assertIsNone(confirmed["members"][0]["allotments"][2]["beneficiallyHeld"])
        award = self.award_payload(
            token_id=str(token.pk),
            member=payload["members"][0]["member"],
            new_member=False,
            name=payload["members"][0]["name"],
            residential_address=payload["members"][0]["residential_address"],
        )
        recorded_award = self.client.post("/api/v1/tokens/register-awards/", award, format="json")
        self.assertEqual(recorded_award.status_code, 201, recorded_award.content)
        correction = deepcopy(payload)
        correction.update(operation_id=str(uuid4()), correction_of=identifier, reason="Correct a copied quantity")
        correction["members"][0]["shares"] = "90"
        prepared = self.client.post(endpoint, correction, format="json")
        self.assertEqual(prepared.status_code, 201, prepared.content)
        corrected_id = prepared.json()["uuid"]
        retry = self.client.post(endpoint, correction, format="json")
        self.assertEqual(retry.status_code, 200, retry.content)
        changed = deepcopy(correction)
        changed["reason"] = "A different correction"
        refused = self.client.post(endpoint, changed, format="json")
        self.assertEqual(refused.status_code, 409, refused.content)
        self.decision(endpoint, corrected_id, "approve")
        applied, decision = self.decision(endpoint, corrected_id, "apply")
        corrected_member = self.client.get(f"{endpoint}{corrected_id}/").json()["members"][0]
        corrected = corrected_member["allotments"]
        self.assertEqual([row["beneficiallyHeld"] for row in corrected], [True, False, None])
        self.assertEqual(sum(int(row["shares"]) for row in corrected), 100)
        self.assertEqual(corrected_member["shares"], "90")
        self.assertIsNone(corrected_member["amountPaid"])
        with use_operator():
            self.assertIsNone(_stored_register(token)["rows"][0]["amount_paid"])
        retried = self.client.post(f"{endpoint}{corrected_id}/decide/", decision, format="json")
        self.assertEqual(retried.status_code, 200, retried.content)
        self.assertEqual(applied.json()["correctionOf"], identifier)
        opening.refresh_from_db()
        self.assertEqual((opening.changes, opening.entry_hash), (original_changes, original_hash))
        delta = RegisterEntry.objects.get(register__token=token, kind="mirror_correction")
        self.assertEqual(delta.changes, [{"member": payload["members"][0]["member"], "shares": "-10"}])
        self.assertEqual(RegisterPosition.objects.get(register__token=token).shares, 90)
        with use_operator():
            self.assertEqual(verify_register(token.stored_register.pk)["issued_supply"], "90")
            with self.assertRaises(DatabaseError), atomic():
                RegisterImport.objects.filter(pk=identifier).update(members=correction["members"])
        metadata = deepcopy(correction)
        metadata.update(
            operation_id=str(uuid4()),
            correction_of=corrected_id,
            reason="Correct copied address and original entry date",
        )
        metadata["members"][0]["residential_address"] = "2 Example Street"
        metadata["members"][0]["name"] = "Corrected Synthetic Founder"
        metadata["members"][0]["entered_on"] = "2018-01-01"
        metadata["former_members"][0]["name"] = "Corrected synthetic former member"
        prepared = self.client.post(endpoint, metadata, format="json")
        self.assertEqual(prepared.status_code, 201, prepared.content)
        metadata_id = prepared.json()["uuid"]
        reviewed = self.client.post(
            f"{endpoint}{metadata_id}/decision-preview/",
            {
                "appointment": str(self.appointment.pk),
                "kind": "approve",
            },
            format="json",
        )
        self.assertEqual(reviewed.status_code, 200, reviewed.content)
        self.assertEqual(reviewed.json()["comparison"][0]["enteredOn"], "2020-01-01")
        self.decision(endpoint, metadata_id, "approve")
        self.decision(endpoint, metadata_id, "apply")
        self.assertEqual(RegisterEntry.objects.filter(register__token=token).count(), 2)
        particulars = RegisterMemberParticulars.objects.get(member_id=payload["members"][0]["member"])
        self.assertEqual(particulars.residential_address, "2 Example Street")
        self.assertEqual(particulars.name, "Corrected Synthetic Founder")
        self.assertEqual(particulars.source_import_id, RegisterImport.objects.get(pk=metadata_id).pk)
        retained_award = RegisterAward.objects.get(pk=recorded_award.json()["uuid"])
        self.assertEqual(
            (retained_award.name, retained_award.residential_address), (award["name"], award["residential_address"])
        )
        another_class = self.client.post(
            "/api/v1/tokens/",
            {
                "company": str(self.company.pk),
                "name": "Existing shareholder class",
                "symbol": "B",
                "total_supply": "1000",
            },
            format="json",
        )
        self.assertEqual(another_class.status_code, 201, another_class.content)
        another_opening = deepcopy(metadata)
        another_opening.update(
            operation_id=str(uuid4()), token_id=another_class.json()["uuid"], correction_of=None, former_members=[]
        )
        another_opening["members"][0]["allotments"] = []
        prepared = self.client.post(endpoint, another_opening, format="json")
        self.assertEqual(prepared.status_code, 201, prepared.content)
        self.assertEqual(prepared.json()["members"][0]["allotments"], [])
        self.assertIsNone(prepared.json()["members"][0]["amountPaid"])
        self.assertEqual(self.client.post(endpoint, another_opening, format="json").status_code, 200)
        another_id = prepared.json()["uuid"]
        self.decision(endpoint, another_id, "approve")
        self.decision(endpoint, another_id, "apply")
        particulars.refresh_from_db()
        self.assertEqual(particulars.source_import_id, RegisterImport.objects.get(pk=another_id).pk)
        self.assertEqual(
            (particulars.name, particulars.residential_address), ("Corrected Synthetic Founder", "2 Example Street")
        )
        self.assertEqual(RegisterPosition.objects.get(register__token_id=another_class.json()["uuid"]).shares, 90)
        holders = self.client.get(f"/api/v1/tokens/{token.pk}/holders/")
        self.assertEqual(holders.status_code, 200, holders.content)
        self.assertEqual(holders.json()["holders"][0]["enteredOn"], "2018-01-01")
        picker = self.client.get(f"/api/v1/tokens/{token.pk}/register/members/")
        self.assertEqual(picker.status_code, 200, picker.content)
        selected = next(row for row in picker.json()["members"] if row["member"] == payload["members"][0]["member"])
        self.assertEqual(selected["enteredOn"], "2018-01-01")
        self.assertEqual(RegisterPosition.objects.get(register__token=token).entered_on, opening.effective_on)
        invitation = self.client.post(
            "/api/v1/tokens/member-invitations/",
            self.invitation_payload(
                member=payload["members"][0]["member"],
            ),
            format="json",
        )
        self.assertEqual(invitation.status_code, 201, invitation.content)
        self.client.force_authenticate(self.foreign)
        accepted = self.client.post(
            "/api/v1/tokens/member-invitations/accept/",
            {
                "code": invitation.json()["code"],
                "user_account": str(self.foreign_profile.user_account.pk),
                "confirmation": True,
            },
            format="json",
        )
        self.assertEqual(accepted.status_code, 200, accepted.content)
        member_record = self.client.get(f"/api/v1/tokens/member-records/{accepted.json()['uuid']}/")
        self.assertEqual(member_record.status_code, 200, member_record.content)
        self.assertEqual(self.client.get(documents_endpoint).json()["results"], [])
        self.assertEqual(self.client.get(f"{documents_endpoint}{document['uuid']}/file/").status_code, 404)
        self.assertEqual(member_record.json()["classes"][0]["enteredOn"], "2018-01-01")
        self.client.force_authenticate(self.owner)
        self.assertEqual(
            [row["name"] for row in holders.json()["formerMembers"]], ["Corrected synthetic former member"]
        )
        self.assertEqual(RegisterImport.objects.get(pk=identifier).former_members[0]["name"], "Synthetic former member")
        self.assertFalse(self.client.get(f"{endpoint}{identifier}/").json()["correctionAllowed"])
        grant_endpoint = "/api/v1/tokens/register-grants/"
        grant = self.client.post(grant_endpoint, self.grant_payload(token_id=str(token.pk)), format="json")
        self.assertEqual(grant.status_code, 201, grant.content)
        self.decision(grant_endpoint, grant.json()["uuid"], "approve")
        self.decision(grant_endpoint, grant.json()["uuid"], "apply")
        metadata.update(operation_id=str(uuid4()), correction_of=metadata_id)
        refused = self.client.post(endpoint, metadata, format="json")
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertEqual(RegisterEntry.objects.filter(register__token=token).count(), 3)
        empty_class = self.client.post(
            "/api/v1/tokens/",
            {
                "company": str(self.company.pk),
                "name": "Synthetic empty class",
                "symbol": "EMPTY",
                "total_supply": str(MAX_UINT256),
            },
            format="json",
        )
        self.assertEqual(empty_class.status_code, 201, empty_class.content)
        empty_token = ShareToken.objects.get(pk=empty_class.json()["uuid"])
        asic = retained_evidence(self.owner, self.appointment, RegisterEvidenceKind.ASIC_EXTRACT)
        empty = self.mirror_payload(
            empty_token, members=[], asic_evidence=str(asic.pk), asic_issued_total="0", asic_member_count=0
        )
        prepared = self.client.post(endpoint, empty, format="json")
        self.assertEqual(prepared.status_code, 201, prepared.content)
        empty_id = prepared.json()["uuid"]
        member_count = RegisterMember.objects.filter(company=self.company).count()
        self.decision(endpoint, empty_id, "approve")
        _, decision = self.decision(endpoint, empty_id, "apply")
        self.assertEqual(self.client.post(f"{endpoint}{empty_id}/decide/", decision, format="json").status_code, 200)
        self.assertEqual(self.client.post(endpoint, empty, format="json").status_code, 200)
        self.assertEqual(RegisterMember.objects.filter(company=self.company).count(), member_count)
        opening = RegisterEntry.objects.get(register__token=empty_token)
        self.assertEqual((opening.kind, opening.changes), ("opening", []))
        with use_operator():
            self.assertEqual(verify_register(opening.register_id)["issued_supply"], "0")
        self.assertFalse(RegisterPosition.objects.filter(register__token=empty_token).exists())
        erased = self.mirror_payload(empty_token, members=[], correction_of=empty_id)
        refused = self.client.post(endpoint, erased, format="json")
        self.assertEqual(refused.status_code, 400, refused.content)
        self.assertEqual(refused.json()["unmetRequirements"], ["empty_non_tokenised_opening_required"])
        investor = self.allotment_payload(token_id=str(empty_token.pk))
        investor_endpoint = "/api/v1/tokens/register-allotments/"
        prepared = self.client.post(investor_endpoint, investor, format="json")
        self.assertEqual(prepared.status_code, 201, prepared.content)
        reviewed = self.client.post(
            f"{investor_endpoint}{prepared.json()['uuid']}/decision-preview/",
            {"appointment": str(self.appointment.pk), "kind": "approve"},
            format="json",
        )
        self.assertEqual(reviewed.status_code, 200, reviewed.content)
        self.assertEqual(reviewed.json()["currentHolders"], [])
        self.assertEqual((reviewed.json()["issuedSupply"], reviewed.json()["afterIssuedSupply"]), ("0", "25"))
        self.decision(investor_endpoint, prepared.json()["uuid"], "approve")
        _, decision = self.decision(investor_endpoint, prepared.json()["uuid"], "apply")
        self.assertEqual(
            self.client.post(
                f"{investor_endpoint}{prepared.json()['uuid']}/decide/", decision, format="json"
            ).status_code,
            200,
        )
        opening.register.refresh_from_db()
        self.assertEqual((opening.register.sequence, int(opening.register.issued_supply)), (2, 25))
        self.assertEqual(RegisterPosition.objects.get(register=opening.register).shares, 25)
        self.assertEqual(RegisterEntry.objects.filter(register=opening.register, kind="issue").count(), 1)
        configuration = Operator.get()
        with use_operator():
            Operator.objects.filter(pk=configuration.pk).update(issuer_kyc_required=True)
            self.profile.is_id_verified = False
            self.profile.save(update_fields=["is_id_verified"])
        self.assertEqual(self.client.get(documents_endpoint).json()["results"], [])
        self.assertEqual(self.client.get(f"{documents_endpoint}{document['uuid']}/file/").status_code, 404)
        with use_operator():
            self.profile.is_id_verified = True
            self.profile.save(update_fields=["is_id_verified"])
        self.assertTrue(self.client.get(documents_endpoint).json()["results"])
        revoke_company_appointment(requester=self.owner, appointment_id=self.appointment.pk)
        self.assertEqual(self.client.get(documents_endpoint).json()["results"], [])
        self.assertEqual(self.client.get(f"{documents_endpoint}{document['uuid']}/file/").status_code, 404)

    def test_mirror_refuses_incomplete_records_stale_heads_and_later_member_or_share_activity(self):
        endpoint = "/api/v1/tokens/register-imports/"
        award = self.award_payload()
        recorded = self.client.post("/api/v1/tokens/register-awards/", award, format="json")
        self.assertEqual(recorded.status_code, 201, recorded.content)
        with use_operator():
            copied_token = ShareToken.objects.create(
                company=self.company, name="Copied employee holding", symbol="EMP", total_supply="1000"
            )
        copied = self.mirror_payload(copied_token)
        copied["members"][0].update(
            member=award["member"], name=award["name"], residential_address=award["residential_address"]
        )
        for field in ("name", "residential_address"):
            mismatched = deepcopy(copied)
            mismatched["members"][0][field] = "A different retained identity"
            refused = self.client.post(endpoint, mismatched, format="json")
            self.assertEqual(refused.status_code, 400, refused.content)
            with patch("tokens.services.register_imports._award_identities_valid", return_value=True):
                refused = self.client.post(endpoint, mismatched, format="json")
                self.assertEqual(refused.status_code, 409, refused.content)
        prepared = self.client.post(endpoint, copied, format="json")
        self.assertEqual(prepared.status_code, 201, prepared.content)
        copied_id = prepared.json()["uuid"]
        self.decision(endpoint, copied_id, "approve")
        fields = {"appointment": str(self.appointment.pk), "kind": "apply"}
        preview = self.client.post(f"{endpoint}{copied_id}/decision-preview/", fields, format="json")
        self.assertTrue(preview.json()["canDecide"])
        conflicting = self.client.post(
            "/api/v1/tokens/register-awards/",
            {**award, "operation_id": str(uuid4()), "name": "Conflicting employee identity"},
            format="json",
        )
        self.assertEqual(conflicting.status_code, 400, conflicting.content)
        selections = self.client.get(f"/api/v1/tokens/{self.token.pk}/register/members/")
        self.assertEqual(selections.json()["awardRecipients"], [])
        original = RegisterImport.objects.get(token=self.token, status="applied")
        payload = self.mirror_payload(self.token, correction_of=str(original.pk))
        payload["members"] = [
            {key: value for key, value in row.items() if key != "amount_paid"} for row in original.members
        ]
        invalid_members = []
        for field, value in (
            ("amount_unpaid", None),
            ("beneficially_held", "false"),
            ("shares", str(MAX_UINT256 + 1)),
        ):
            raw_members = deepcopy(original.members)
            raw_members[0]["allotments"][0][field] = value
            invalid_members.append(raw_members)
        missing_status = deepcopy(original.members)
        del missing_status[0]["allotments"][0]["beneficially_held"]
        invalid_members.append(missing_status)
        for raw_members in invalid_members:
            with self.assertRaises(DatabaseError), register_command(
                self.owner, self.company.pk, "register_import_prepare"
            ):
                RegisterImport.objects.create(
                    company=self.company,
                    token=self.token,
                    as_at=timezone.now().date(),
                    members=raw_members,
                    former_members=[],
                    source_reference="SYNTHETIC-RAW-MIRROR",
                    source_confirmed=True,
                    authority="company_records",
                    authority_reference="SYNTHETIC-RAW-MIRROR",
                    reason="Malformed copied records",
                    preparing_appointment=self.appointment,
                    correction_of=original,
                    base_sequence=self.token.stored_register.sequence,
                    base_hash=self.token.stored_register.head_hash,
                    submitted_by=self.owner,
                    evidence_fingerprint="",
                    asic_fingerprint="",
                    evidence_snapshot=None,
                )
            invalid = deepcopy(payload)
            invalid["members"] = [
                {key: value for key, value in row.items() if key != "amount_paid"} for row in raw_members
            ]
            refused = self.client.post(endpoint, invalid, format="json")
            self.assertEqual(refused.status_code, 400, refused.content)
        with self.assertRaises(DatabaseError), register_command(self.owner, self.company.pk, "register_import_prepare"):
            RegisterImport.objects.create(
                company=self.company,
                token=self.token,
                as_at=timezone.now().date(),
                members=[],
                former_members=[],
                source_reference="SYNTHETIC-EMPTY-CORRECTION",
                source_confirmed=True,
                authority="company_records",
                authority_reference="SYNTHETIC-EMPTY-CORRECTION",
                reason="Refuse erasing a populated opening",
                preparing_appointment=self.appointment,
                correction_of=original,
                base_sequence=self.token.stored_register.sequence,
                base_hash=self.token.stored_register.head_hash,
                submitted_by=self.owner,
                evidence_fingerprint="",
                asic_fingerprint="",
                evidence_snapshot=None,
            )
        too_many = deepcopy(payload)
        too_many["members"][0]["shares"] = str(MAX_UINT256 + 1)
        refused = self.client.post(endpoint, too_many, format="json")
        self.assertEqual(refused.status_code, 400, refused.content)
        first = self.client.post(endpoint, payload, format="json")
        self.assertEqual(first.status_code, 201, first.content)
        sibling = deepcopy(payload)
        sibling["operation_id"] = str(uuid4())
        second = self.client.post(endpoint, sibling, format="json")
        self.assertEqual(second.status_code, 201, second.content)
        self.decision(endpoint, first.json()["uuid"], "approve")
        self.decision(endpoint, first.json()["uuid"], "apply")
        stale = self.client.post(
            f"{endpoint}{second.json()['uuid']}/decision-preview/",
            {
                "appointment": str(self.appointment.pk),
                "kind": "approve",
            },
            format="json",
        )
        self.assertFalse(stale.json()["canDecide"])
        self.assertIn("mirror_snapshot_changed", stale.json()["unmetRequirements"])
        invite = self.client.post("/api/v1/tokens/member-invitations/", self.invitation_payload(), format="json")
        self.assertEqual(invite.status_code, 201, invite.content)
        current = self.client.get(f"{endpoint}{first.json()['uuid']}/")
        self.assertFalse(current.json()["correctionAllowed"])
        correction = deepcopy(payload)
        correction.update(operation_id=str(uuid4()), correction_of=first.json()["uuid"])
        refused = self.client.post(endpoint, correction, format="json")
        self.assertEqual(refused.status_code, 400, refused.content)
        renamed = self.client.post(
            "/api/v1/tokens/register-particulars-changes/",
            {
                "operation_id": str(uuid4()),
                "appointment": str(self.appointment.pk),
                "member": award["member"],
                "name": "Changed employee identity",
                "residential_address": award["residential_address"],
                "reason": "Correct the recipient's recorded name",
                "expected": {"name": award["name"], "residential_address": award["residential_address"]},
            },
            format="json",
        )
        self.assertEqual(renamed.status_code, 201, renamed.content)
        changed = self.client.post(f"{endpoint}{copied_id}/decision-preview/", fields, format="json")
        self.assertFalse(changed.json()["canDecide"])
        self.assertIn("award_recipient_identity_changed", changed.json()["unmetRequirements"])
        application = {
            **fields,
            "idempotency_key": str(uuid4()),
            "preview_digest": changed.json()["previewDigest"],
            "confirmation": True,
        }
        refused = self.client.post(f"{endpoint}{copied_id}/decide/", application, format="json")
        self.assertEqual(refused.status_code, 400, refused.content)
        with patch("tokens.services.register_imports._award_identities_valid", return_value=True):
            refused = self.client.post(f"{endpoint}{copied_id}/decide/", application, format="json")
            self.assertEqual(refused.status_code, 409, refused.content)
        self.assertFalse(RegisterPosition.objects.filter(member_id=award["member"]).exists())
        self.assertFalse(RegisterEntry.objects.filter(register__token=copied_token).exists())
