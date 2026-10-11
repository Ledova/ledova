import hashlib
import io
import json
import zipfile
from uuid import UUID, uuid4

import pymupdf
from django.db import IntegrityError
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from shared.db import atomic, use_operator
from shared.tests.core_fixtures import CoreFixtures
from tokens.models import (
    MemberCertificateFulfilment,
    RegisterExport,
    RegisterGrant,
    RegisterTransfer,
)


class RegisterOutputsTest(CoreFixtures, APITransactionTestCase):
    def test_unsigned_company_own_transfer_certificate_and_complete_core_pack_retain_real_sources(self):
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
        company_endpoint = f"/api/v1/tokens/{self.token.pk}/register/certificate/"
        preview = self.client.get(f"{company_endpoint}?sequence={entry.sequence}")
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertEqual(preview.json()["pageCount"], 2)
        fields = {
            "sequence": entry.sequence,
            "appointment": str(self.appointment.pk),
            "source_digest": preview.json()["sourceDigest"],
            "instruction": "SYNTHETIC-UNSIGNED-COMPANY-CERTIFICATE",
        }
        stale = self.client.post(company_endpoint, {**fields, "source_digest": "0" * 64}, format="json")
        self.assertEqual(stale.status_code, 409, stale.content)
        company_pdf = self.client.post(company_endpoint, fields, format="json")
        self.assertEqual(company_pdf.status_code, 200, company_pdf.content)
        with pymupdf.open(stream=company_pdf.content, filetype="pdf") as document:
            self.assertEqual(document.page_count, 2)
            company_text = "".join(page.get_text() for page in document)
        self.assertIn("Synthetic Member", company_text)
        self.assertIn("Synthetic Employee", company_text)
        self.assertIn("Prepared unsigned", company_text)
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
        self.client.force_authenticate(self.foreign)
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
        packed.close()
        with zipfile.ZipFile(io.BytesIO(archive)) as bundle:
            manifest_bytes = bundle.read("manifest.json")
            manifest = json.loads(manifest_bytes)
            self.assertEqual((manifest["format"], manifest["version"]), ("ledova-company-pack", 1))
            for file in manifest["files"]:
                data = bundle.read(file["path"])
                self.assertEqual((len(data), hashlib.sha256(data).hexdigest()), (file["size"], file["sha256"]))
            sources = json.loads(bundle.read("company_mandates.json"))
            self.assertEqual(sources["awards"][0]["data"]["is_entitlement"], True)
            self.assertEqual(sources["vestings"][0]["data"]["shares"], "25")
            self.assertEqual(sources["grants"][0]["command"]["award"], award["operation_id"])
            self.assertEqual(sources["contributions"][0]["data"]["company_recorded"], True)
            self.assertEqual(sources["contributions"][0]["data"]["verified_by_ledova"], False)
            self.assertEqual(sources["allotments"][0]["command"]["consideration"], "250.00")
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
            audit = RegisterExport.objects.get(kind="company_pack")
            self.assertEqual(audit.digest, hashlib.sha256(manifest_bytes).hexdigest())
            self.assertEqual(audit.requested_by_id, self.owner.pk)
            self.assertEqual(int(self.token.stored_register.issued_supply), 150)
            self.assertEqual(RegisterGrant.objects.get(pk=grant.json()["uuid"]).award_id, UUID(award["operation_id"]))
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
