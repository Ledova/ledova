import hashlib
from datetime import timedelta
from uuid import uuid4

from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError, IntegrityError, connections
from django.test import TestCase
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from shared.db import atomic, current_alias
from shared.tests.test_admin_row_actions import staff_user
from shared.tests.under_the_policies import what_the_policies_admit_to
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.models import (
    BallotChoice,
    PublicationEvent,
    PublicationEventKind,
    PublicationRecipient,
)
from shareholders.services.distributions import (
    ALREADY_RECORDED,
    NO_PAYMENT_AUTHORITY,
    NO_REFERENCE,
    NO_WITHDRAWAL_REASON,
    NOT_A_DISTRIBUTION,
    NOT_ON_THE_ROLL,
    NOTHING_TO_RECORD,
    NOTHING_TO_WITHDRAW,
    ONLY_STAFF,
    RECORDED_BEFORE_DECLARATION,
    RECORDED_IN_THE_FUTURE,
    record_payment,
    withdraw_payment,
)
from shareholders.tests.fixtures import (
    DECLARED_ON,
    PAYABLE_ON,
    PAYMENT_REFERENCE,
    PUBLICATION_BYTES,
    a_company_with_members,
    a_distribution,
    a_payment,
    a_person,
    a_resolution,
    an_upload,
    published,
    roll_row,
)
from tokens.constants import STATUTORY_CALENDAR

ZEROS = "0" * 64


class Undone(Exception):
    pass


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

    def test_the_rate_leaves_the_smallest_holding_entitled_to_nothing(self):
        self.assertEqual(
            [str(roll_row(self.distribution, holder).entitlement) for holder in self.world.members],
            ["0.50", "0.20", "0.00"],
        )

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

    def test_a_member_entitled_to_less_than_a_cent_has_no_payment_to_record(self):
        with self.assertRaisesMessage(ValidationError, NOTHING_TO_RECORD):
            a_payment(self.world, self.distribution, self.smallest)

        self.assertFalse(PublicationEvent.objects.exists())

    def test_only_a_standing_record_can_be_withdrawn(self):
        row = roll_row(self.distribution, self.second)
        with self.assertRaisesMessage(ValidationError, NOTHING_TO_WITHDRAW):
            withdraw_payment(self.world.staff, self.distribution, row, "Correction C-2")
        a_payment(self.world, self.distribution, self.second)
        withdraw_payment(self.world.staff, self.distribution, row, "Correction C-3")

        with self.assertRaisesMessage(ValidationError, NOTHING_TO_WITHDRAW):
            withdraw_payment(self.world.staff, self.distribution, row, "Correction C-4")

        self.assertEqual(list(PublicationEvent.objects.values_list("kind", flat=True)), ["payment", "payment_void"])

    def test_recording_refuses_what_it_cannot_stand_behind(self):
        today = timezone.localdate(timezone=STATUTORY_CALENDAR)
        for refusal, changes in (
            (NO_REFERENCE, {"reference": "  "}),
            (NO_PAYMENT_AUTHORITY, {"authority": "\t"}),
            (RECORDED_IN_THE_FUTURE, {"paid_on": today + timedelta(days=1)}),
            (RECORDED_BEFORE_DECLARATION, {"paid_on": DECLARED_ON - timedelta(days=1)}),
            ("evidence", {"evidence": SimpleUploadedFile("advice.txt", b"plain text", content_type="text/plain")}),
        ):
            with self.subTest(refusal=refusal), self.assertRaisesMessage(ValidationError, refusal):
                a_payment(self.world, self.distribution, self.first, **changes)
        self.assertFalse(PublicationEvent.objects.exists())

    def test_recording_and_withdrawing_refuse_the_wrong_publication_member_or_person(self):
        other = a_distribution(self.world, rate="0.005")
        resolution = a_resolution(self.world)
        statement = published(self.world)
        row = roll_row(self.distribution, self.first)
        elsewhere = roll_row(other, self.first)
        for refusal, error, arguments in (
            (NOT_A_DISTRIBUTION, ValidationError, (self.world.staff, resolution, row)),
            (NOT_A_DISTRIBUTION, ValidationError, (self.world.staff, statement, row)),
            (NOT_ON_THE_ROLL, ValidationError, (self.world.staff, self.distribution, elsewhere)),
            (ONLY_STAFF, PermissionDenied, (self.world.owner, self.distribution, row)),
            (ONLY_STAFF, PermissionDenied, (self.first.user, self.distribution, row)),
        ):
            with self.subTest(refusal=refusal, arguments=arguments):
                with self.assertRaisesMessage(error, refusal):
                    record_payment(
                        *arguments,
                        paid_on=PAYABLE_ON,
                        reference=PAYMENT_REFERENCE,
                        evidence=an_upload("remittance.pdf"),
                        authority="Payment advice PA-2",
                    )
                with self.assertRaisesMessage(error, refusal):
                    withdraw_payment(*arguments, "Correction C-5")
        self.assertFalse(PublicationEvent.objects.exists())

    def test_a_withdrawal_names_why(self):
        a_payment(self.world, self.distribution, self.first)

        with self.assertRaisesMessage(ValidationError, NO_WITHDRAWAL_REASON):
            withdraw_payment(self.world.staff, self.distribution, roll_row(self.distribution, self.first), " ")

        self.assertEqual(PublicationEvent.objects.count(), 1)


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
            **changes,
        }
        with atomic():
            return PublicationEvent.objects.create(**fields)

    def withdrawal(self, **changes):
        return {
            "kind": PublicationEventKind.PAYMENT_VOID,
            "paid_on": None,
            "reference": "",
            "evidence": "",
            "evidence_digest": "",
            "authority": "Correction C-6",
            **changes,
        }

    def test_a_record_the_trigger_admits_is_inserted_so_the_refusals_below_discriminate(self):
        record = self.insert()
        withdrawn = self.insert(**self.withdrawal())

        self.assertEqual([record.kind, withdrawn.kind], ["payment", "payment_void"])
        self.assertEqual(PublicationEvent.objects.count(), 2)

    def test_a_payment_on_a_row_entitled_to_nothing_is_refused(self):
        with self.assertRaisesMessage(IntegrityError, "A payment is recorded only for a member entitled to at least"):
            self.insert(recipient=roll_row(self.distribution, self.smallest))

        self.assertFalse(PublicationEvent.objects.exists())

    def test_a_second_record_while_the_first_stands_is_refused(self):
        self.insert()

        with self.assertRaisesMessage(IntegrityError, "This member already has a payment recorded"):
            self.insert(reference="LDV-SECOND")

        self.assertEqual(PublicationEvent.objects.count(), 1)

    def test_a_record_after_its_withdrawal_is_admitted_as_the_correction(self):
        self.insert()
        self.insert(**self.withdrawal())

        self.insert(reference="LDV-CORRECTED")

        self.assertEqual(
            list(PublicationEvent.objects.values_list("sequence", "kind")),
            [
                (1, "payment"),
                (2, "payment_void"),
                (3, "payment"),
            ],
        )

    def test_a_withdrawal_with_no_record_and_a_second_withdrawal_are_refused(self):
        with self.assertRaisesMessage(IntegrityError, "Only a recorded payment can be withdrawn"):
            self.insert(**self.withdrawal())
        self.insert()
        self.insert(**self.withdrawal())

        with self.assertRaisesMessage(IntegrityError, "Only a recorded payment can be withdrawn"):
            self.insert(**self.withdrawal())

        self.assertEqual(PublicationEvent.objects.count(), 2)

    def test_a_payment_record_needs_an_active_staff_actor(self):
        retired = staff_user(f"retired-payment-clerk-{uuid4().hex[:8]}")
        retired.is_active = False
        retired.save(update_fields=["is_active"])
        for actor in (self.first.user.pk, self.world.owner.pk, retired.pk):
            for changes in ({}, self.withdrawal()):
                with self.subTest(actor=actor, kind=changes.get("kind", "payment")):
                    with self.assertRaisesMessage(IntegrityError, "A payment record names an active staff member"):
                        self.insert(actor_id=actor, **changes)
        self.assertFalse(PublicationEvent.objects.exists())

    def test_payments_belong_to_a_distribution_and_ballots_to_a_resolution(self):
        resolution = a_resolution(self.world)
        statement = published(self.world)
        stranger = a_company_with_members("paying-stranger")
        refusal = "Only a resolution records ballots and a close, and only a distribution records payments"
        for changes in (
            {"publication": resolution, "recipient": roll_row(resolution, self.first)},
            {"publication": statement, "recipient": roll_row(statement, self.first)},
            {"company": stranger.company},
            {
                "kind": PublicationEventKind.BALLOT,
                "choice": BallotChoice.FOR,
                "actor_id": self.first.user.pk,
                "staff_entered": False,
                "authority": "",
                "paid_on": None,
                "reference": "",
                "evidence": "",
                "evidence_digest": "",
            },
        ):
            with self.subTest(changes=sorted(changes)), self.assertRaisesMessage(IntegrityError, refusal):
                self.insert(**changes)
        self.assertFalse(PublicationEvent.objects.exists())

    def test_a_record_for_a_row_off_this_distribution_s_roll_is_refused(self):
        other = a_distribution(self.world, rate="0.005")

        with self.assertRaisesMessage(IntegrityError, "A payment is recorded for a member on this distribution's"):
            self.insert(recipient=roll_row(other, self.first))

    def test_evidence_stored_anywhere_but_under_its_own_record_is_refused(self):
        with self.assertRaisesMessage(IntegrityError, "A payment's evidence is stored under its own record"):
            self.insert(evidence=f"companies/{self.world.company.pk}/publications/{self.distribution.pk}/other.bin")

    def test_a_payment_record_has_the_shape_of_its_kind(self):
        for changes in (
            {"reference": "  "},
            {"paid_on": None},
            {"evidence_digest": "not-a-digest"},
            {"choice": BallotChoice.FOR},
            {"kind": PublicationEventKind.PAYMENT_VOID, "authority": "Correction C-7"},
        ):
            with self.subTest(changes=changes):
                if changes.get("kind") == PublicationEventKind.PAYMENT_VOID:
                    self.insert()
                with self.assertRaisesMessage(IntegrityError, "publication_event_has_the_shape_of_its_kind"):
                    self.insert(**changes)

    def test_the_hash_covers_the_date_the_reference_and_the_evidence(self):
        record = self.insert()
        record.refresh_from_db()
        self.assertEqual(record.entry_hash, hash_of(record))
        for column, value in (
            ("paid_on", DECLARED_ON),
            ("reference", "LDV-REWRITTEN"),
            ("evidence_digest", "f" * 64),
            ("evidence", "companies/rewritten.bin"),
        ):
            with self.subTest(column=column), self.assertRaises(Undone), atomic():
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
                    cursor.execute(
                        "ALTER TABLE shareholders_publicationevent DISABLE TRIGGER shareholders_publication_event_chain"
                    )
                    cursor.execute(
                        f"UPDATE shareholders_publicationevent SET {column} = %s WHERE uuid = %s", [value, record.pk]
                    )
                self.assertNotEqual(hash_of(record), record.entry_hash)
                raise Undone
        self.assertEqual(hash_of(record), record.entry_hash)

    def test_a_payment_record_cannot_be_rewritten(self):
        record = self.insert()

        with self.assertRaisesMessage(DatabaseError, "A publication's record of events cannot be rewritten"), atomic():
            PublicationEvent.objects.filter(pk=record.pk).update(reference="LDV-REWRITTEN")

        self.assertEqual(PublicationEvent.objects.get(pk=record.pk).reference, PAYMENT_REFERENCE)


class WhoReadsThePaymentRecordsTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world, self.distribution = a_paying_company("paying-readers")
        self.elsewhere, self.theirs = a_paying_company("paying-readers-elsewhere")
        self.first, self.second, _ = self.world.members
        self.firsts = [
            a_payment(self.world, self.distribution, self.first, reference="LDV-1"),
            withdraw_payment(
                self.world.staff, self.distribution, roll_row(self.distribution, self.first), "Correction C-8"
            ),
            a_payment(self.world, self.distribution, self.first, reference="LDV-2"),
        ]
        self.seconds = [a_payment(self.world, self.distribution, self.second)]
        self.theirs_recorded = [a_payment(self.elsewhere, self.theirs, self.elsewhere.members[0])]

    def admitted(self, user, model=PublicationEvent):
        return set(what_the_policies_admit_to(user, model).values_list("pk", flat=True))

    def test_a_member_reads_their_own_records_and_withdrawals_and_no_other_member_s(self):
        self.assertEqual(self.admitted(self.first.user), {event.pk for event in self.firsts})
        self.assertEqual(self.admitted(self.second.user), {event.pk for event in self.seconds})

    def test_a_member_reads_their_own_entitlement_and_no_other_member_s(self):
        rows = what_the_policies_admit_to(self.first.user, PublicationRecipient)

        self.assertEqual(
            list(rows.filter(publication=self.distribution).values_list("user_id", "entitlement")),
            [(self.first.user.pk, roll_row(self.distribution, self.first).entitlement)],
        )

    def test_the_company_reads_every_payment_record_of_its_own_distributions_and_nothing_of_another_s(self):
        self.assertEqual(self.admitted(self.world.owner), {event.pk for event in (*self.firsts, *self.seconds)})
        self.assertEqual(self.admitted(self.elsewhere.owner), {event.pk for event in self.theirs_recorded})

    def test_a_member_of_another_company_reads_none_of_this_company_s_records_or_entitlements(self):
        stranger = self.elsewhere.members[0].user

        self.assertEqual(self.admitted(stranger), {event.pk for event in self.theirs_recorded})
        self.assertFalse(
            what_the_policies_admit_to(stranger, PublicationRecipient).filter(publication=self.distribution).exists()
        )

    def test_a_principal_on_no_roll_reads_no_record(self):
        stranger = a_person("paying-stranger", "Passing Stranger")[0]

        self.assertEqual(self.admitted(stranger), set())
