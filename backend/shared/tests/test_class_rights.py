from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.models import CompanyCapability
from companies.services.authority import DECLARATION_VERSION
from companies.services.team import revoke_company_appointment
from shared.db import atomic, use_operator
from shared.tests.core_fixtures import CoreFixtures, pdf_bytes, retained_evidence
from tokens.models import (
    ClassRightsRevision,
    RegisterEvidenceKind,
    RegisterPosition,
    ShareToken,
)
from tokens.services.register_authority import register_command


class ClassRightsTest(CoreFixtures, APITransactionTestCase):
    def test_class_rights_descriptions_retain_revisions_without_changing_ownership_or_granting_authority(self):
        endpoint = f"/api/v1/tokens/{self.token.pk}/class-rights/"
        initial = self.client.get(endpoint)
        self.assertEqual(initial.status_code, 200, initial.content)
        self.assertIsNone(initial.json()["current"])
        self.assertEqual(initial.json()["results"], [])
        self.assertEqual(initial.json()["administrationAppointment"], str(self.appointment.pk))
        raw = pdf_bytes()
        upload = self.client.post(
            "/api/v1/tokens/register-evidence/",
            {
                "company_id": str(self.company.pk),
                "appointment": str(self.appointment.pk),
                "kind": "class_rights",
                "idempotency_key": str(uuid4()),
                "file": SimpleUploadedFile("Synthetic constitution.pdf", raw, content_type="application/pdf"),
            },
            format="multipart",
        )
        self.assertEqual(upload.status_code, 201, upload.content)
        self.scanner.assert_called()
        document_id = upload.json()["uuid"]
        payload = {
            "appointment": str(self.appointment.pk),
            "idempotency_key": str(uuid4()),
            "previous_revision": 0,
            "summary": "One vote per share; other rights follow the company's constitution.",
            "document_reference": "Synthetic constitution, clause 4, 21 October 2026",
            "documents": [document_id],
            "attributes": {
                "voting": {"type": "general", "votes_per_share": "1"},
                "dividends": {"type": "participating"},
                "capital": {"type": "residual"},
                "transfers": {"type": "restricted", "board_consent": True, "pre_emption": False},
                "conversion": {"type": "none"},
                "redemption": {"type": "not_redeemable"},
            },
            "effective_date": "2020-01-01",
        }
        saved = self.client.post(endpoint, payload, format="json")
        self.assertEqual(saved.status_code, 201, saved.content)
        first = saved.json()
        self.assertEqual(first["revision"], 1)
        self.assertEqual(first["attributes"]["voting"], {"type": "general", "votesPerShare": "1"})
        self.assertEqual(first["effectiveDate"], "2020-01-01")
        self.assertIs(first["attributes"]["transfers"]["preEmption"], False)
        self.assertEqual(first["recordedBy"], self.owner.pk)
        self.assertEqual(first["recordedByName"], self.profile.full_name)
        self.assertEqual(first["idempotencyKey"], payload["idempotency_key"])
        self.assertEqual(first["documents"][0]["evidence"], document_id)
        self.assertEqual(first["documents"][0]["name"], "Synthetic constitution.pdf")
        self.assertEqual(first["documents"][0]["company"], str(self.company.pk))
        file_endpoint = f"/api/v1/tokens/{self.token.pk}/class-rights-file/"
        file_query = {"revision": first["uuid"], "evidence": document_id}
        downloaded = self.client.get(file_endpoint, file_query)
        self.assertEqual(downloaded.status_code, 200)
        self.assertEqual(b"".join(downloaded.streaming_content), raw)
        self.assertEqual(downloaded["Cache-Control"], "private, no-store")
        replay = self.client.post(endpoint, payload, format="json")
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertEqual(replay.json(), first)
        changed = self.client.post(endpoint, {**payload, "summary": payload["summary"] + " "}, format="json")
        self.assertEqual(changed.status_code, 409, changed.content)
        changed_files = self.client.post(endpoint, {**payload, "documents": []}, format="json")
        self.assertEqual(changed_files.status_code, 409, changed_files.content)
        changed_terms = self.client.post(endpoint, {**payload, "attributes": {}}, format="json")
        self.assertEqual(changed_terms.status_code, 409, changed_terms.content)
        changed_date = self.client.post(endpoint, {**payload, "effective_date": None}, format="json")
        self.assertEqual(changed_date.status_code, 409, changed_date.content)
        invalid_terms = [
            {"unknown": {"type": "custom"}},
            {"voting": {"type": "general", "unknown": True}},
            {"voting": {"type": "general", "votes_per_share": "0"}},
            {"voting": {"type": "no_general_vote", "votes_per_share": "1"}},
            {"voting": {"type": "general", "votes_per_share": 1}},
            {"dividends": {"type": "preferential", "rate": "8"}},
            {"dividends": {"type": "preferential", "basis": "Per share"}},
            {"capital": {"type": "preferential", "basis": "Per share"}},
            {"dividends": {"type": "preferential", "currency": "AUD"}},
            {"capital": {"type": "preferential", "currency": "AUD"}},
            {"capital": {"type": "preferential", "cap": "2x"}},
            {"capital": {"type": "preferential", "participation": "participating", "cap": "2x"}},
            {"capital": {"type": "preferential", "amount": "100", "basis": "Per share"}},
            {"conversion": {"type": "convertible", "ratio": "1"}},
            {"redemption": {"type": "not_recorded", "trigger": "holder"}},
        ]
        for attributes in invalid_terms:
            refused = self.client.post(endpoint, {**payload, "attributes": attributes}, format="json")
            self.assertEqual(refused.status_code, 400, refused.content)
        future = self.client.post(
            endpoint,
            {**payload, "effective_date": (timezone.now().date() + timedelta(days=1)).isoformat()},
            format="json",
        )
        self.assertEqual(future.status_code, 400, future.content)
        stale = self.client.post(endpoint, {**payload, "idempotency_key": str(uuid4())}, format="json")
        self.assertEqual(stale.status_code, 409, stale.content)
        revised = self.client.post(
            endpoint,
            {
                **payload,
                "idempotency_key": str(uuid4()),
                "previous_revision": 1,
                "summary": "Company-supplied correction: two votes per share.",
                "attributes": {
                    **payload["attributes"],
                    "voting": {"type": "general", "votes_per_share": "2"},
                },
            },
            format="json",
        )
        self.assertEqual(revised.status_code, 201, revised.content)
        self.assertEqual(revised.json()["revision"], 2)
        replay = self.client.post(endpoint, payload, format="json")
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertEqual(replay.json(), first)
        cleared = self.client.post(
            endpoint,
            {
                **payload,
                "idempotency_key": str(uuid4()),
                "previous_revision": 2,
                "summary": "",
                "document_reference": "",
                "documents": [],
                "attributes": {},
                "effective_date": None,
            },
            format="json",
        )
        self.assertEqual(cleared.status_code, 201, cleared.content)
        history = self.client.get(endpoint, {"page_size": 1})
        self.assertEqual(history.status_code, 200, history.content)
        self.assertEqual(history.json()["current"]["revision"], 3)
        self.assertEqual(history.json()["current"]["summary"], "")
        self.assertEqual(history.json()["current"]["documents"], [])
        self.assertEqual(history.json()["current"]["attributes"], {})
        self.assertIsNone(history.json()["current"]["effectiveDate"])
        self.assertEqual(history.json()["count"], 3)
        self.assertEqual(len(history.json()["results"]), 1)
        self.assertIsNotNone(history.json()["next"])
        retained_file = self.client.get(file_endpoint, file_query)
        self.assertEqual(retained_file.status_code, 200)
        self.assertEqual(b"".join(retained_file.streaming_content), raw)
        self.assertEqual(
            self.client.get(file_endpoint, {**file_query, "revision": cleared.json()["uuid"]}).status_code, 404
        )
        foreign_document = retained_evidence(self.foreign, self.foreign_appointment, RegisterEvidenceKind.CLASS_RIGHTS)
        member_document = retained_evidence(self.owner, self.appointment, RegisterEvidenceKind.SUPPORTING)
        for documents in ([str(foreign_document.pk)], [str(member_document.pk)], [document_id, document_id]):
            refused = self.client.post(
                endpoint,
                {**payload, "previous_revision": 3, "idempotency_key": str(uuid4()), "documents": documents},
                format="json",
            )
            self.assertEqual(refused.status_code, 400, refused.content)
        with use_operator():
            another_class = ShareToken.objects.create(
                company=self.company, name="Another class", symbol="OTHER", total_supply="1000"
            )
        self.assertEqual(
            self.client.get(f"/api/v1/tokens/{another_class.pk}/class-rights-file/", file_query).status_code, 404
        )
        self.assertEqual(
            self.client.get(file_endpoint, {**file_query, "evidence": str(foreign_document.pk)}).status_code, 404
        )
        with use_operator():
            self.assertEqual(ClassRightsRevision.objects.count(), 3)
            retained_snapshot = ClassRightsRevision.objects.get(pk=first["uuid"]).documents[0]
            self.assertEqual(RegisterPosition.objects.get(member=self.member).shares, 100)
            self.token.stored_register.refresh_from_db()
            self.assertEqual(self.token.stored_register.sequence, 1)
            self.assertEqual(int(self.token.stored_register.issued_supply), 100)
            with self.assertRaises(DatabaseError), atomic():
                ClassRightsRevision.objects.filter(pk=first["uuid"]).update(summary="Overwrite")
            with self.assertRaises(DatabaseError), atomic():
                ClassRightsRevision.objects.filter(pk=first["uuid"]).delete()
            with self.assertRaises(DatabaseError), atomic():
                ClassRightsRevision.objects.filter(pk=first["uuid"]).update(documents=[])
            with self.assertRaises(DatabaseError), atomic():
                ClassRightsRevision.objects.filter(pk=first["uuid"]).update(attributes={})
            with self.assertRaises(DatabaseError), atomic():
                ClassRightsRevision.objects.create(
                    token=self.token,
                    revision=4,
                    summary="Unbound SQL must fail",
                    document_reference="",
                    recorded_by=self.owner,
                    recorded_by_name=self.profile.full_name,
                    appointment=self.appointment,
                    idempotency_key=uuid4(),
                )
        with self.assertRaises(DatabaseError), register_command(self.owner, self.company.pk, "class_rights_record"):
            ClassRightsRevision.objects.create(
                token=self.token,
                revision=4,
                summary="Forged retained document",
                documents=[{**retained_snapshot, "sha256": "0" * 64}],
                recorded_by=self.owner,
                recorded_by_name=self.profile.full_name,
                appointment=self.appointment,
                idempotency_key=uuid4(),
            )
        invitation = self.client.post(
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
        self.assertEqual(invitation.status_code, 201, invitation.content)
        self.client.force_authenticate(self.foreign)
        accepted = self.client.post(
            "/api/v1/company-authority/invitations/accept/",
            {"code": invitation.json()["code"], "declaration_version": DECLARATION_VERSION, "accept_declaration": True},
            format="json",
        )
        self.assertEqual(accepted.status_code, 200, accepted.content)
        read_only = self.client.get(endpoint)
        self.assertEqual(read_only.status_code, 200, read_only.content)
        self.assertIsNone(read_only.json()["administrationAppointment"])
        readable_file = self.client.get(file_endpoint, file_query)
        self.assertEqual(readable_file.status_code, 200)
        self.assertEqual(b"".join(readable_file.streaming_content), raw)
        refused_upload = self.client.post(
            "/api/v1/tokens/register-evidence/",
            {
                "company_id": str(self.company.pk),
                "appointment": accepted.json()["uuid"],
                "kind": "class_rights",
                "idempotency_key": str(uuid4()),
                "file": SimpleUploadedFile("Not authorised.pdf", raw, content_type="application/pdf"),
            },
            format="multipart",
        )
        self.assertEqual(refused_upload.status_code, 404, refused_upload.content)
        refused = self.client.post(
            endpoint,
            {
                **payload,
                "idempotency_key": str(uuid4()),
                "appointment": accepted.json()["uuid"],
                "previous_revision": 3,
            },
            format="json",
        )
        self.assertEqual(refused.status_code, 404, refused.content)
        self.client.force_authenticate(self.owner)
        revoke_company_appointment(requester=self.owner, appointment_id=accepted.json()["uuid"])
        self.client.force_authenticate(self.foreign)
        self.assertEqual(self.client.get(file_endpoint, file_query).status_code, 404)
        self.client.force_authenticate(self.owner)
        create_revision = ClassRightsRevision.objects.create

        def revoke_before_commit(**values):
            revision = create_revision(**values)
            revoke_company_appointment(requester=self.owner, appointment_id=self.appointment.pk)
            return revision

        with patch("tokens.services.class_rights.ClassRightsRevision.objects.create", side_effect=revoke_before_commit):
            raced = self.client.post(
                endpoint,
                {**payload, "idempotency_key": str(uuid4()), "previous_revision": 3},
                format="json",
            )
        self.assertEqual(raced.status_code, 503, raced.content)
        with use_operator():
            self.assertEqual(ClassRightsRevision.objects.count(), 3)
        revoke_company_appointment(requester=self.owner, appointment_id=self.appointment.pk)
        revoked_retry = self.client.post(endpoint, payload, format="json")
        self.assertEqual(revoked_retry.status_code, 404, revoked_retry.content)
        recovered = self.client.get(endpoint, {"idempotency_key": payload["idempotency_key"]})
        self.assertEqual(recovered.status_code, 200, recovered.content)
        self.assertIsNone(recovered.json()["administrationAppointment"])
        self.assertEqual(recovered.json()["results"], [first])
        self.assertEqual(recovered.json()["current"]["revision"], 3)
