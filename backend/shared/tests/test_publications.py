import hashlib
from unittest.mock import patch
from uuid import uuid4

import psycopg
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import connections
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.models import CompanyDocument, DocumentType
from shared.db import current_alias, use_migrate, use_operator
from shared.tests.core_fixtures import CoreFixtures, pdf_bytes, person
from shareholders.models import PublicationKind, PublicationRead, PublicationRecipient
from shareholders.services.publications import (
    notify_the_roll,
    publish_to_members,
    verify_roll,
)
from shareholders.services.roll import frozen_rows
from tokens.models import RegisterMemberWallet, ShareToken, ShareTokenStatus


class PublicationsTest(CoreFixtures, APITransactionTestCase):
    def test_walletless_member_receives_publications_and_keeps_the_frozen_roll_after_revocation(self):
        invited = self.client.post("/api/v1/tokens/member-invitations/", self.invitation_payload(), format="json")
        self.assertEqual(invited.status_code, 201, invited.content)
        self.client.force_authenticate(self.foreign)
        accepted = self.client.post(
            "/api/v1/tokens/member-invitations/accept/",
            {
                "code": invited.json()["code"],
                "user_account": str(self.foreign_profile.user_account.pk),
                "confirmation": True,
            },
            format="json",
        )
        self.assertEqual(accepted.status_code, 200, accepted.content)
        publisher, _ = person("publication-staff")
        outsider, _ = person("publication-outsider")
        raw = pdf_bytes()
        with use_migrate():
            type(publisher).objects.filter(pk=publisher.pk).update(is_staff=True)
            ShareToken.objects.filter(pk=self.token.pk).update(
                status=ShareTokenStatus.DEPLOYED, contract_address="0x" + "1" * 40
            )
            document = CompanyDocument.objects.create(
                company=self.company,
                document_type=DocumentType.OTHER,
                name="Synthetic publication authority",
                file=SimpleUploadedFile("authority.pdf", raw, content_type="application/pdf"),
                file_size=len(raw),
                mime_type="application/pdf",
                is_verified=True,
                verified_fingerprint=hashlib.sha256(raw).hexdigest(),
                verified_by=publisher,
                verified_at=timezone.now(),
            )
        with use_operator():
            self.token.refresh_from_db()
            self.assertFalse(RegisterMemberWallet.objects.filter(member=self.member).exists())
        values = {
            "kind": PublicationKind.MEETING_NOTICE,
            "title": "Synthetic shareholder meeting",
            "record_date": timezone.localdate(),
            "instruction": "SYNTHETIC-PUBLICATION-AUTHORITY",
            "authority_document": document.pk,
        }

        def probe_company_lock():
            parameters = connections[current_alias()].get_connection_params()
            with psycopg.connect(**(parameters | {"autocommit": True, "connect_timeout": 5})) as competing:
                with competing.cursor() as cursor:
                    cursor.execute(
                        "SELECT uuid FROM companies_company WHERE uuid = %s FOR UPDATE NOWAIT", [self.company.pk]
                    )
                    self.assertEqual(cursor.fetchone(), (self.company.pk,))

        def capture_locked_roll(token, register, record_date):
            with self.assertRaises(psycopg.errors.LockNotAvailable):
                probe_company_lock()
            return frozen_rows(token, register, record_date)

        with (
            patch("shareholders.services.publications.defer") as queued,
            patch("shareholders.services.publications.frozen_rows", side_effect=capture_locked_roll) as captured,
            use_operator(),
        ):
            probe_company_lock()
            publication = publish_to_members(
                self.token,
                publisher,
                upload=SimpleUploadedFile("notice.pdf", raw, content_type="application/pdf"),
                **values,
            )
            probe_company_lock()
            captured.assert_called_once()
            queued.assert_called_once()
            self.assertEqual(queued.call_args.kwargs["publication_id"], str(publication.pk))
            recipient = PublicationRecipient.objects.get(publication=publication)
            self.assertEqual(
                (recipient.member_id, recipient.user_id, recipient.shares), (self.member.pk, self.foreign.pk, 100)
            )
            original_roll = verify_roll(publication)
            queued.reset_mock()
            self.assertEqual(notify_the_roll(str(publication.pk)), 1)
            queued.assert_called_once()
            self.assertEqual(queued.call_args.kwargs["user_id"], str(self.foreign.pk))
        endpoint = f"/api/v1/publications/{publication.pk}/file/"
        own = self.client.get("/api/v1/publications/")
        self.assertEqual(own.status_code, 200, own.content)
        self.assertEqual(
            [(row["uuid"], row["shares"]) for row in own.json()["results"]], [(str(publication.pk), "100")]
        )
        delivered = self.client.get(endpoint)
        self.assertEqual(delivered.status_code, 200)
        self.assertEqual(b"".join(delivered.streaming_content), raw)
        delivered.close()
        with use_operator():
            self.assertEqual(PublicationRead.objects.get(publication_uuid=publication.pk).actor_id, self.foreign.pk)
        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.get("/api/v1/publications/").json()["count"], 0)
        self.assertEqual(self.client.get(endpoint).status_code, 404)
        self.client.force_authenticate(self.owner)
        revoked = self.client.post(
            f"/api/v1/tokens/member-associations/{accepted.json()['uuid']}/revoke/",
            {
                "appointment": str(self.appointment.pk),
                "idempotency_key": str(uuid4()),
                "reason": "End future member publication access",
            },
            format="json",
        )
        self.assertEqual(revoked.status_code, 200, revoked.content)
        with patch("shareholders.services.publications.defer") as queued, use_operator():
            later = publish_to_members(
                self.token,
                publisher,
                upload=SimpleUploadedFile("notice.pdf", raw, content_type="application/pdf"),
                **values,
            )
            self.assertIsNone(PublicationRecipient.objects.get(publication=later).user_id)
            queued.reset_mock()
            self.assertEqual(notify_the_roll(str(later.pk)), 0)
            queued.assert_not_called()
            recipient.refresh_from_db()
            self.assertEqual(recipient.user_id, self.foreign.pk)
            self.assertEqual(verify_roll(publication), original_roll)
        self.client.force_authenticate(self.foreign)
        self.assertEqual(self.client.get(f"/api/v1/publications/{later.pk}/file/").status_code, 404)
        retained = self.client.get(endpoint)
        self.assertEqual(retained.status_code, 200)
        self.assertEqual(b"".join(retained.streaming_content), raw)
        retained.close()
