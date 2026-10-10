import hashlib
from uuid import uuid4

from django.core.files.base import ContentFile
from django.db import DatabaseError, connections
from django.test import TestCase
from rest_framework.exceptions import ValidationError

from shared.db import atomic, current_alias
from shared.tests.test_admin_row_actions import staff_user
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.models import PublicationEvent, PublicationEventKind
from shareholders.services.distributions import ALREADY_RECORDED, withdraw_payment
from shareholders.tests.fixtures import (
    PAYABLE_ON,
    PAYMENT_REFERENCE,
    PUBLICATION_BYTES,
    a_company_with_members,
    a_distribution,
    a_payment,
    roll_row,
)

ZEROS = "0" * 64


def hash_of(event):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(
            "SELECT shareholders_publication_event_hash(shareholders_publicationevent) "
            "FROM shareholders_publicationevent WHERE uuid = %s",
            [event.pk],
        )
        return cursor.fetchone()[0]


def a_paying_company(label):
    world = a_company_with_members(label, holdings=(100, 40, 1))
    return world, a_distribution(world, rate="0.005")


class RecordingAPaymentTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world, self.distribution = a_paying_company("paying")
        self.first, self.second, self.smallest = self.world.members

    def test_staff_record_a_payment_and_the_database_chains_it_with_its_evidence(self):
        record = a_payment(self.world, self.distribution, self.first)

        self.assertEqual(
            (
                record.sequence,
                record.kind,
                record.recipient_id,
                record.paid_on,
                record.reference,
                record.actor_id,
                record.staff_entered,
                record.authority,
            ),
            (
                1,
                PublicationEventKind.PAYMENT,
                roll_row(self.distribution, self.first).pk,
                PAYABLE_ON,
                PAYMENT_REFERENCE,
                self.world.staff.pk,
                True,
                "Payment advice PA-1",
            ),
        )
        self.assertEqual((record.shares, record.payload, record.choice), (None, None, ""))
        self.assertEqual((record.previous_hash, record.entry_hash), (ZEROS, hash_of(record)))
        self.assertTrue(
            record.evidence.name.startswith(
                f"companies/{self.world.company.pk}/publications/{self.distribution.pk}/payments/{record.pk}/"
            )
        )
        with record.evidence.open("rb") as stored:
            self.assertEqual(hashlib.sha256(stored.read()).hexdigest(), record.evidence_digest)
        self.assertEqual(record.evidence_digest, hashlib.sha256(PUBLICATION_BYTES).hexdigest())
        self.assertEqual(record.evidence_mime_type, "application/pdf")

    def test_a_second_record_is_refused_until_the_first_is_withdrawn_and_a_correction_is_both(self):
        first = a_payment(self.world, self.distribution, self.first, reference="LDV-WRONG")
        with self.assertRaisesMessage(ValidationError, ALREADY_RECORDED):
            a_payment(self.world, self.distribution, self.first)

        withdrawn = withdraw_payment(
            self.world.staff, self.distribution, roll_row(self.distribution, self.first), " Correction C-1 "
        )
        corrected = a_payment(self.world, self.distribution, self.first)

        self.assertEqual(
            [(event.sequence, event.kind, event.reference) for event in (first, withdrawn, corrected)],
            [(1, "payment", "LDV-WRONG"), (2, "payment_void", ""), (3, "payment", PAYMENT_REFERENCE)],
        )
        self.assertEqual((withdrawn.authority, withdrawn.previous_hash), ("Correction C-1", first.entry_hash))
        self.assertEqual(PublicationEvent.objects.get(pk=first.pk).reference, "LDV-WRONG")
        first.refresh_from_db()
        self.assertTrue(first.evidence.storage.exists(first.evidence.name))
        with first.evidence.open("rb") as stored:
            self.assertEqual(hashlib.sha256(stored.read()).hexdigest(), first.evidence_digest)


class TheDatabaseOwnsThePaymentRecordsTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world, self.distribution = a_paying_company("paying-owns")
        self.first, self.second, self.smallest = self.world.members
        self.row = roll_row(self.distribution, self.first)
        self.clerk = staff_user(f"payment-clerk-{uuid4().hex[:8]}")

    def insert(self, **changes):
        fields = {
            "publication": self.distribution,
            "company": self.world.company,
            "kind": PublicationEventKind.PAYMENT,
            "recipient": self.row,
            "actor_id": self.clerk.pk,
            "staff_entered": True,
            "authority": "Payment advice PA-3",
            "paid_on": PAYABLE_ON,
            "reference": PAYMENT_REFERENCE,
            "evidence": ContentFile(PUBLICATION_BYTES, name="evidence.bin"),
            "evidence_digest": hashlib.sha256(PUBLICATION_BYTES).hexdigest(),
            "evidence_mime_type": "application/pdf",
            **changes,
        }
        with atomic():
            return PublicationEvent.objects.create(**fields)

    def test_a_payment_record_cannot_be_rewritten(self):
        record = self.insert()

        with self.assertRaisesMessage(DatabaseError, "A publication's record of events cannot be rewritten"), atomic():
            PublicationEvent.objects.filter(pk=record.pk).update(reference="LDV-REWRITTEN")

        self.assertEqual(PublicationEvent.objects.get(pk=record.pk).reference, PAYMENT_REFERENCE)
