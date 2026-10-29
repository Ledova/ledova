import hashlib
import io
import json
import zipfile
from datetime import timedelta
from unittest.mock import patch
from uuid import UUID, uuid4

import pymupdf
from django.conf import settings
from django.db import IntegrityError
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.models import CompanyCapability
from companies.services.authority import DECLARATION_VERSION
from companies.services.team import (
    accept_team_invitation,
    issue_team_invitation,
    revoke_company_appointment,
)
from shared.db import atomic, use_operator
from shared.tests.core_fixtures import CoreFixtures, person, retained_evidence
from tokens.models import (
    MemberCertificateFulfilment,
    RegisterEvidenceKind,
    RegisterExport,
    RegisterGrant,
    RegisterTransfer,
)
from tokens.services.company_pack import produce_company_pack
from tokens.services.former_holders import purge_register_exports


class RegisterOutputsTest(CoreFixtures, APITransactionTestCase):
    def test_unsigned_company_own_transfer_certificate_and_complete_core_pack_retain_real_sources(self):
        rights_endpoint = f"/api/v1/tokens/{self.token.pk}/class-rights/"
        class_document = retained_evidence(self.owner, self.appointment, RegisterEvidenceKind.CLASS_RIGHTS)
        rights = {
            "appointment": str(self.appointment.pk),
            "idempotency_key": str(uuid4()),
            "previous_revision": 0,
            "summary": "Company-supplied ordinary share rights.",
            "document_reference": "Synthetic constitution, clause 4",
            "documents": [str(class_document.pk)],
            "attributes": {"voting": {"type": "general", "votes_per_share": "1"}},
            "effective_date": "2020-01-01",
        }
        first_rights = self.client.post(rights_endpoint, rights, format="json")
        self.assertEqual(first_rights.status_code, 201, first_rights.content)
        latest_rights = self.client.post(
            rights_endpoint,
            {
                **rights,
                "idempotency_key": str(uuid4()),
                "previous_revision": 1,
                "summary": "Clarified company summary.",
            },
            format="json",
        )
        self.assertEqual(latest_rights.status_code, 201, latest_rights.content)
        award = self.award_payload()
        promised = self.client.post("/api/v1/tokens/register-awards/", award, format="json")
        self.assertEqual(promised.status_code, 201, promised.content)
        vested = self.client.post(
            "/api/v1/tokens/register-award-vestings/", self.vesting_payload(award["operation_id"]), format="json"
        )
        self.assertEqual(vested.status_code, 201, vested.content)
        grant = self.client.post("/api/v1/tokens/register-grants/", self.linked_grant_payload(award), format="json")
        self.assertEqual(grant.status_code, 201, grant.content)
        self.decision("/api/v1/tokens/register-grants/", grant.json()["uuid"], "approve")
        self.decision("/api/v1/tokens/register-grants/", grant.json()["uuid"], "apply")
        allotment_payload = self.allotment_payload()
        allotment = self.client.post("/api/v1/tokens/register-allotments/", allotment_payload, format="json")
        self.assertEqual(allotment.status_code, 201, allotment.content)
        self.decision("/api/v1/tokens/register-allotments/", allotment.json()["uuid"], "approve")
        self.decision("/api/v1/tokens/register-allotments/", allotment.json()["uuid"], "apply")
        evidence = self.grant_payload()
        transfer = self.client.post(
            "/api/v1/tokens/register-transfers/",
            {
                "operation_id": str(uuid4()),
                "appointment": str(self.appointment.pk),
                "token_id": str(self.token.pk),
                "from_member": str(self.member.pk),
                "to_member": award["member"],
                "new_member": False,
                "name": award["name"],
                "residential_address": award["residential_address"],
                "shares": "10",
                "company_event_on": timezone.now().date().isoformat(),
                "signed_on": timezone.now().date().isoformat(),
                "lodged_on": timezone.now().date().isoformat(),
                "terms": "Synthetic signed instrument",
                "approving_director": "Synthetic Independent Director",
                "authority_reference": "SYNTHETIC-OUTPUT-TRANSFER",
                "reason": "Record the company-approved transfer",
                "authority_evidence": evidence["authority_evidence"],
                "instrument_evidence": evidence["terms_evidence"],
            },
            format="json",
        )
        self.assertEqual(transfer.status_code, 201, transfer.content)
        self.decision("/api/v1/tokens/register-transfers/", transfer.json()["uuid"], "approve")
        applied, _ = self.decision("/api/v1/tokens/register-transfers/", transfer.json()["uuid"], "apply")
        entry_id = applied.json()["registerEntry"]
        with use_operator():
            entry = RegisterTransfer.objects.get(pk=transfer.json()["uuid"]).register_entry
        entries_endpoint = f"/api/v1/tokens/{self.token.pk}/register/entries/"
        matching = {"certificate_status": "all", "search": "EMPLOYEE synthetic", "page_size": 1}
        first_match = self.client.get(entries_endpoint, matching)
        self.assertEqual(first_match.status_code, 200, first_match.content)
        self.assertEqual((first_match.json()["count"], len(first_match.json()["results"])), (2, 1))
        self.assertEqual(first_match.json()["results"][0]["uuid"], entry_id)
        later_match = self.client.get(entries_endpoint, {**matching, "page": 2})
        self.assertEqual(later_match.status_code, 200, later_match.content)
        self.assertEqual(later_match.json()["results"][0]["kind"], "issue")
        self.assertNotEqual(later_match.json()["results"][0]["uuid"], entry_id)
        self.assertEqual(self.client.get(entries_endpoint).json()["count"], 4)
        self.assertEqual(self.client.get(entries_endpoint, {"certificate_status": "all"}).json()["count"], 3)
        self.assertEqual(self.client.get(entries_endpoint, {"certificate_status": "not_applicable"}).json()["count"], 0)
        self.assertEqual(self.client.get(entries_endpoint, {"search": "no matching person"}).json()["count"], 0)
        self.assertEqual(self.client.get(entries_endpoint, {"search": "x" * 101}).status_code, 400)
        self.assertEqual(self.client.get(entries_endpoint, {"certificate_status": "invented"}).status_code, 400)
        company_endpoint = f"/api/v1/tokens/{self.token.pk}/register/certificate/"
        preview = self.client.get(f"{company_endpoint}?sequence={entry.sequence}")
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertEqual(preview.json()["pageCount"], 2)
        fields = {
            "sequence": entry.sequence,
            "appointment": str(self.appointment.pk),
            "source_digest": preview.json()["sourceDigest"],
        }
        stale = self.client.post(company_endpoint, {**fields, "source_digest": "0" * 64}, format="json")
        self.assertEqual(stale.status_code, 409, stale.content)
        with use_operator():
            self.assertFalse(RegisterExport.objects.exists())
        company_pdf = self.client.post(company_endpoint, fields, format="json")
        self.assertEqual(company_pdf.status_code, 200, company_pdf.content)
        with use_operator():
            certificate_audit = RegisterExport.objects.get(kind="certificate")
            self.assertEqual(
                certificate_audit.instruction,
                f"Unsigned certificate requested for ledger entry {entry.pk} (sequence {entry.sequence}).",
            )
            self.assertEqual(certificate_audit.requested_by_id, self.owner.pk)
            self.assertEqual(certificate_audit.register_sequence, entry.sequence)
            self.assertEqual(certificate_audit.digest, hashlib.sha256(company_pdf.content).hexdigest())
        referenced_pdf = self.client.post(
            company_endpoint,
            {**fields, "instruction": "SYNTHETIC-UNSIGNED-COMPANY-CERTIFICATE"},
            format="json",
        )
        self.assertEqual(referenced_pdf.status_code, 200, referenced_pdf.content)
        with use_operator():
            referenced_audit = RegisterExport.objects.exclude(pk=certificate_audit.pk).get(kind="certificate")
            self.assertEqual(referenced_audit.instruction, "SYNTHETIC-UNSIGNED-COMPANY-CERTIFICATE")
        with pymupdf.open(stream=company_pdf.content, filetype="pdf") as document:
            self.assertEqual(document.page_count, 2)
            company_text = "".join(page.get_text() for page in document)
        self.assertIn("Synthetic Member", company_text)
        self.assertIn("Synthetic Employee", company_text)
        self.assertIn("Prepared unsigned", company_text)
        self.assertIn(f"Company event date: {transfer.json()['companyEventOn']}", company_text)
        self.assertIn(f"Recorded at: {entry.created_at.date().isoformat()}", company_text)
        invitation = self.client.post(
            "/api/v1/tokens/member-invitations/", self.invitation_payload(member=award["member"]), format="json"
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
        own_filters = {"association": accepted.json()["uuid"], "page_size": 1}
        self.assertEqual(
            self.client.get(entries_endpoint, {**own_filters, "certificate_status": "all"}).status_code, 404
        )
        self.client.force_authenticate(self.owner)
        self.assertEqual(
            self.client.get(entries_endpoint, {**own_filters, "certificate_status": "all"}).status_code, 404
        )
        _, team_code, _ = issue_team_invitation(
            requester=self.owner,
            company_id=self.company.pk,
            inviter_appointment_id=self.appointment.pk,
            idempotency_key=uuid4(),
            capabilities=[CompanyCapability.READ_REGISTER],
        )
        reader = accept_team_invitation(
            requester=self.foreign, code=team_code, declaration_version=DECLARATION_VERSION, accept_declaration=True
        )
        self.client.force_authenticate(self.foreign)
        available = self.client.get(entries_endpoint, {**own_filters, "certificate_status": "not_requested"})
        self.assertEqual(available.status_code, 200, available.content)
        self.assertEqual(available.json()["count"], 2)
        self.assertEqual(
            self.client.get(entries_endpoint, {**own_filters, "certificate_status": "can_prepare"}).json()["count"], 1
        )
        told = self.enterContext(patch("tokens.services.member_events.defer"))
        requested = self.client.post(
            "/api/v1/tokens/member-certificate-requests/",
            {
                "operation_id": str(uuid4()),
                "association": accepted.json()["uuid"],
                "entry": entry_id,
            },
            format="json",
        )
        self.assertEqual(requested.status_code, 201, requested.content)
        filtered_request = self.client.get(entries_endpoint, {**own_filters, "certificate_status": "requested"})
        self.assertEqual(filtered_request.status_code, 200, filtered_request.content)
        self.assertEqual(filtered_request.json()["count"], 1)
        self.assertEqual(filtered_request.json()["results"][0]["uuid"], entry_id)
        request_endpoint = f"/api/v1/tokens/member-certificate-requests/{requested.json()['uuid']}/"
        self.client.force_authenticate(self.owner)
        preview = self.client.get(f"{request_endpoint}fulfilment-preview/")
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertEqual(preview.json()["pageCount"], 1)
        fulfil = {
            "operation_id": str(uuid4()),
            "appointment": str(self.appointment.pk),
            "source_digest": preview.json()["sourceDigest"],
            "instruction": "SYNTHETIC-MEMBER-UNSIGNED-CERTIFICATE",
        }
        stale_member = self.client.post(
            f"{request_endpoint}fulfil/", {**fulfil, "source_digest": "0" * 64}, format="json"
        )
        self.assertEqual(stale_member.status_code, 409, stale_member.content)
        fulfilled = self.client.post(f"{request_endpoint}fulfil/", fulfil, format="json")
        self.assertEqual(fulfilled.status_code, 200, fulfilled.content)
        self.assertEqual(fulfilled.json()["status"], "fulfilled")
        self.assertEqual(
            self.client.post(f"{request_endpoint}fulfil/", fulfil, format="json").json()["fulfilment"]["uuid"],
            fulfil["operation_id"],
        )
        changed_retry = self.client.post(
            f"{request_endpoint}fulfil/", {**fulfil, "instruction": "Different instruction"}, format="json"
        )
        self.assertEqual(changed_retry.status_code, 409, changed_retry.content)
        self.assertEqual(
            [(call.kwargs["user_id"], call.kwargs["data"]) for call in told.call_args_list],
            [
                (
                    str(self.foreign.pk),
                    {
                        "type": "certificate",
                        "event": "ready",
                        "company": str(self.company.pk),
                        "record": accepted.json()["uuid"],
                    },
                )
            ],
        )
        self.client.force_authenticate(self.foreign)
        self.assertEqual(
            self.client.get(entries_endpoint, {**own_filters, "certificate_status": "fulfilled"}).json()["count"], 1
        )
        newest_request = self.client.post(
            "/api/v1/tokens/member-certificate-requests/",
            {"operation_id": str(uuid4()), "association": accepted.json()["uuid"], "entry": entry_id},
            format="json",
        )
        self.assertEqual(newest_request.status_code, 201, newest_request.content)
        self.assertEqual(
            self.client.get(entries_endpoint, {**own_filters, "certificate_status": "fulfilled"}).json()["count"], 0
        )
        self.assertEqual(
            self.client.get(entries_endpoint, {**own_filters, "certificate_status": "requested"}).json()["count"], 1
        )
        cancelled_request = self.client.post(
            f"/api/v1/tokens/member-certificate-requests/{newest_request.json()['uuid']}/withdraw/",
            {"idempotency_key": str(uuid4())},
            format="json",
        )
        self.assertEqual(cancelled_request.status_code, 200, cancelled_request.content)
        self.assertEqual(
            self.client.get(entries_endpoint, {**own_filters, "certificate_status": "withdrawn"}).json()["count"], 1
        )
        self.assertEqual(
            self.client.get(entries_endpoint, {**own_filters, "certificate_status": "reversed"}).json()["count"], 0
        )
        revoke_company_appointment(requester=self.owner, appointment_id=reader.pk)
        own_pdf = self.client.get(f"{request_endpoint}file/")
        self.assertEqual(own_pdf.status_code, 200, own_pdf.content)
        with pymupdf.open(stream=own_pdf.content, filetype="pdf") as document:
            self.assertEqual(document.page_count, 1)
            own_text = "".join(page.get_text() for page in document)
        self.assertIn("Synthetic Employee", own_text)
        self.assertIn("2 Example Street", own_text)
        self.assertNotIn("Synthetic Member", own_text)
        self.assertNotIn("1 Example Street", own_text)
        self.assertIn("Prepared unsigned", own_text)
        with use_operator():
            output = MemberCertificateFulfilment.objects.get(pk=fulfil["operation_id"])
            self.assertEqual((output.digest, output.export.digest), (hashlib.sha256(own_pdf.content).hexdigest(),) * 2)
            self.assertEqual(MemberCertificateFulfilment.objects.count(), 1)
            with self.assertRaises(IntegrityError), atomic():
                MemberCertificateFulfilment.objects.filter(pk=output.pk).update(instruction="Forged instruction")
            with output.file.open("wb") as target:
                target.write(b"corrupt synthetic PDF")
        corrupt = self.client.get(f"{request_endpoint}file/")
        self.assertEqual(corrupt.status_code, 400, corrupt.content)
        with use_operator(), output.file.open("wb") as target:
            target.write(own_pdf.content)
        withdrawal = self.client.post(f"{request_endpoint}withdraw/", {"idempotency_key": str(uuid4())}, format="json")
        self.assertEqual(withdrawal.status_code, 400, withdrawal.content)
        self.client.force_authenticate(self.owner)
        ending_evidence = retained_evidence(self.owner, self.appointment, RegisterEvidenceKind.SUPPORTING)
        ending = self.client.post(
            "/api/v1/tokens/register-award-ends/",
            {
                "operation_id": str(uuid4()),
                "appointment": str(self.appointment.pk),
                "award": award["operation_id"],
                "unvested_shares": "1",
                "vested_shares": "0",
                "company_event_on": timezone.now().date().isoformat(),
                "reason": "Company ends unissued entitlement",
                "evidence": str(ending_evidence.pk),
            },
            format="json",
        )
        self.assertEqual(ending.status_code, 201, ending.content)
        shareholder_document = retained_evidence(self.owner, self.appointment, RegisterEvidenceKind.SUPPORTING)
        for member in (str(self.member.pk), award["member"]):
            linked = self.client.post(
                "/api/v1/tokens/register-member-documents/",
                {
                    "company_id": str(self.company.pk),
                    "member": member,
                    "token": str(self.token.pk),
                    "evidence": str(shareholder_document.pk),
                    "category": "shareholder_agreement",
                    "appointment": str(self.appointment.pk),
                    "idempotency_key": str(uuid4()),
                },
                format="json",
            )
            self.assertEqual(linked.status_code, 201, linked.content)
        packed = self.client.post(
            f"/api/v1/companies/{self.company.pk}/pack/",
            {
                "appointment": str(self.appointment.pk),
                "instruction": "SYNTHETIC-CORE-COMPANY-PACK",
                "recipient": "Synthetic administrator",
            },
            format="json",
        )
        self.assertEqual(packed.status_code, 200, getattr(packed, "content", b""))
        archive = b"".join(packed.streaming_content)
        staff, _ = person("core-staff")
        with use_operator():
            type(staff).objects.filter(pk=staff.pk).update(is_staff=True)
            produced, _ = produce_company_pack(
                self.company, staff, instruction="SYNTHETIC-COMPELLED-REQUEST", recipient="Synthetic regulator"
            )
            produced.close()
        history = self.client.get(f"/api/v1/companies/{self.company.pk}/packs/")
        self.assertEqual(history.status_code, 200, history.content)
        self.assertEqual(
            [(row["instruction"], row["recipient"]) for row in history.json()["packs"]],
            [("SYNTHETIC-CORE-COMPANY-PACK", "Synthetic administrator")],
        )
        packed.close()
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            manifest_bytes = bundle.read("manifest.json")
            manifest = json.loads(manifest_bytes)
            self.assertEqual((manifest["format"], manifest["version"]), ("ledova-company-pack", 1))
            for file in manifest["files"]:
                data = bundle.read(file["path"])
                self.assertEqual((len(data), hashlib.sha256(data).hexdigest()), (file["size"], file["sha256"]))
            exported_rights = json.loads(bundle.read(f"classes/{self.token.pk}/class_rights.json"))
            self.assertEqual([record["revision"] for record in exported_rights], [1, 2])
            self.assertEqual(exported_rights[0]["summary"], rights["summary"])
            self.assertEqual(exported_rights[1]["summary"], "Clarified company summary.")
            self.assertEqual(exported_rights[0]["document_reference"], rights["document_reference"])
            self.assertEqual(exported_rights[0]["attributes"], rights["attributes"])
            self.assertEqual(exported_rights[0]["effective_date"], "2020-01-01")
            self.assertEqual(exported_rights[0]["recorded_by_id"], self.owner.pk)
            self.assertEqual(exported_rights[0]["appointment_id"], str(self.appointment.pk))
            self.assertEqual(exported_rights[0]["idempotency_key"], rights["idempotency_key"])
            self.assertTrue(exported_rights[0]["created_at"])
            self.assertEqual(exported_rights[0]["documents"][0]["evidence"], str(class_document.pk))
            class_documents = json.loads(bundle.read("class_documents.json"))
            self.assertEqual(len(class_documents), 2)
            self.assertEqual(
                {row["revision"] for row in class_documents},
                {first_rights.json()["uuid"], latest_rights.json()["uuid"]},
            )
            class_path = class_documents[0]["path"]
            self.assertEqual(bundle.namelist().count(class_path), 1)
            self.assertEqual(hashlib.sha256(bundle.read(class_path)).hexdigest(), class_document.sha256)
            shareholder_documents = json.loads(bundle.read("member_documents.json"))["links"]
            self.assertEqual(len(shareholder_documents), 2)
            self.assertEqual({row["member"] for row in shareholder_documents}, {str(self.member.pk), award["member"]})
            self.assertEqual(len({row["path"] for row in shareholder_documents}), 1)
            document_path = shareholder_documents[0]["path"]
            self.assertEqual(bundle.namelist().count(document_path), 1)
            self.assertEqual(bundle.read(document_path), shareholder_document.file.open("rb").read())
            sources = json.loads(bundle.read("company_mandates.json"))
            self.assertEqual(sources["awards"][0]["data"]["is_entitlement"], True)
            self.assertEqual(sources["vestings"][0]["data"]["shares"], "25")
            self.assertEqual(sources["award_ends"][0]["data"]["unvested_shares"], "1")
            self.assertEqual(sources["award_ends"][0]["data"]["award"], award["operation_id"])
            self.assertTrue(bundle.read(sources["award_ends"][0]["sources"]["evidence"]["path"]).startswith(b"%PDF"))
            self.assertEqual(sources["grants"][0]["command"]["award"], award["operation_id"])
            self.assertEqual(sources["contributions"][0]["data"]["company_recorded"], True)
            self.assertEqual(sources["contributions"][0]["data"]["verified_by_ledova"], False)
            self.assertEqual(sources["allotments"][0]["command"]["consideration"], "250.00")
            for family in ("grants", "allotments", "transfers"):
                self.assertEqual(sources[family][0]["command"]["company_event_on"], transfer.json()["companyEventOn"])
            self.assertEqual(
                sources["allotments"][0]["result"]["entry"]["uuid"],
                allotment.json().get("registerEntry")
                or self.client.get(f"/api/v1/tokens/register-allotments/{allotment.json()['uuid']}/").json()[
                    "registerEntry"
                ],
            )
            agreement_path = sources["awards"][0]["sources"]["agreement"]["path"]
            self.assertTrue(bundle.read(agreement_path).startswith(b"%PDF"))
            self.assertNotIn(str(self.foreign_company.pk), str(sources))
        with use_operator():
            audit = RegisterExport.objects.get(kind="company_pack", requested_by_id=self.owner.pk)
            self.assertEqual(audit.digest, hashlib.sha256(manifest_bytes).hexdigest())
            self.assertEqual(audit.requested_by_id, self.owner.pk)
            self.assertEqual(int(self.token.stored_register.issued_supply), 150)
            self.assertEqual(RegisterGrant.objects.get(pk=grant.json()["uuid"]).award_id, UUID(award["operation_id"]))
            self.assertEqual(RegisterExport.objects.count(), 5)
            self.assertEqual(
                purge_register_exports(now=timezone.now() + timedelta(days=settings.FORMER_MEMBER_RETENTION_DAYS + 1)),
                4,
            )
            self.assertEqual(list(RegisterExport.objects.values_list("pk", flat=True)), [output.export_id])
            output.refresh_from_db()
            with output.file.open("rb") as original:
                self.assertEqual(original.read(), own_pdf.content)
        revoked = self.client.post(
            f"/api/v1/tokens/member-associations/{accepted.json()['uuid']}/revoke/",
            {
                "appointment": str(self.appointment.pk),
                "idempotency_key": str(uuid4()),
                "reason": "End own output access",
            },
            format="json",
        )
        self.assertEqual(revoked.status_code, 200, revoked.content)
        self.client.force_authenticate(self.foreign)
        self.assertEqual(self.client.get(request_endpoint).json()["status"], "fulfilled")
        hidden_pdf = self.client.get(f"{request_endpoint}file/")
        self.assertEqual(hidden_pdf.status_code, 404, hidden_pdf.content)
