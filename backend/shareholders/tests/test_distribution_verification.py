import json
from io import StringIO
from uuid import uuid4

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.exceptions import PublicationIntegrityError
from shareholders.services.distributions import withdraw_payment
from shareholders.services.publications import verify_roll
from shareholders.services.resolutions import (
    CHAIN_BROKEN,
    ENTITLEMENT_DIFFERS,
    EVENT_OF_ANOTHER_KIND,
    PAYMENT_NOT_OWED,
    PAYMENT_TWICE,
    TOTAL_DIFFERS,
    WITHDRAWN_UNRECORDED,
    verify_publication,
)
from shareholders.tests.fixtures import (
    PAYABLE_ON,
    REHASH,
    a_company_with_members,
    a_distribution,
    a_payment,
    as_the_schema_owner,
    roll_row,
    the_chain_is_rewritten,
)

CHAINED_COLUMNS = (
    "uuid",
    "publication_id",
    "company_id",
    "sequence",
    "kind",
    "recipient_id",
    "choice",
    "shares",
    "actor_id",
    "staff_entered",
    "authority",
    "paid_on",
    "reference",
    "evidence",
    "evidence_digest",
    "evidence_mime_type",
    "previous_hash",
)
CHAINED = (
    f"INSERT INTO shareholders_publicationevent (created_at, updated_at, entry_hash, {', '.join(CHAINED_COLUMNS)}) "
    f"VALUES (now(), now(), '', {', '.join(['%s'] * len(CHAINED_COLUMNS))})"
)


def refusal(template):
    return template.split("{publication}")[1].split("{")[0].strip()


class VerifyingADistributionTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("verify-dividend", holdings=(100, 40, 1))
        self.distribution = a_distribution(self.world, rate="0.005")
        self.other = a_distribution(self.world, rate="0.005")
        self.first, self.second, self.smallest = self.world.members
        self.recorded = a_payment(self.world, self.distribution, self.first)
        self.wrong = a_payment(self.world, self.distribution, self.second, reference="LDV-WRONG")
        self.withdrawn = withdraw_payment(
            self.world.staff, self.distribution, roll_row(self.distribution, self.second), "Correction C-9"
        )
        self.corrected = a_payment(self.world, self.distribution, self.second)

    def refused(self, template):
        with self.assertRaisesMessage(PublicationIntegrityError, refusal(template)):
            verify_publication(self.distribution.pk)

    def chained(self, kind, holder, **columns):
        fresh = uuid4()
        values = {
            "choice": "",
            "shares": None,
            "actor_id": self.world.staff.pk,
            "staff_entered": True,
            "authority": "Forged advice",
            "paid_on": PAYABLE_ON if kind == "payment" else None,
            "reference": "LDV-FORGED" if kind == "payment" else "",
            "evidence": "companies/forged.bin" if kind == "payment" else "",
            "evidence_digest": "e" * 64 if kind == "payment" else "",
            "evidence_mime_type": "application/pdf" if kind == "payment" else "",
            **columns,
        }
        the_chain_is_rewritten(
            (
                CHAINED,
                [
                    fresh,
                    self.distribution.pk,
                    self.world.company.pk,
                    5,
                    kind,
                    roll_row(self.distribution, holder).pk,
                    *values.values(),
                    self.corrected.entry_hash,
                ],
            ),
            (REHASH, [fresh]),
        )

    def test_an_untouched_distribution_verifies_and_reports_its_standing_records_and_remainder(self):
        self.assertEqual(
            verify_publication(self.distribution.pk),
            {"events": 4, "head_hash": self.corrected.entry_hash, "payments_recorded": 2, "undistributed": "0.00"},
        )

    def test_a_rewritten_reference_no_longer_matches_its_hash(self):
        the_chain_is_rewritten(
            ("UPDATE shareholders_publicationevent SET reference = 'LDV-9999' WHERE uuid = %s", [self.recorded.pk])
        )

        self.refused(CHAIN_BROKEN)

    def test_a_rehashed_mark_whose_date_was_rewritten_breaks_the_link_to_the_next_event(self):
        the_chain_is_rewritten(
            ("UPDATE shareholders_publicationevent SET paid_on = paid_on - 1 WHERE uuid = %s", [self.recorded.pk]),
            (REHASH, [self.recorded.pk]),
        )

        self.refused(CHAIN_BROKEN)

    def test_a_rehashed_mark_moved_to_a_member_entitled_to_nothing_is_refused(self):
        the_chain_is_rewritten(
            (
                "UPDATE shareholders_publicationevent SET recipient_id = %s WHERE uuid = %s",
                [roll_row(self.distribution, self.smallest).pk, self.corrected.pk],
            ),
            (REHASH, [self.corrected.pk]),
        )

        self.refused(PAYMENT_NOT_OWED)

    def test_a_rehashed_mark_moved_to_another_distribution_s_roll_is_refused(self):
        the_chain_is_rewritten(
            (
                "UPDATE shareholders_publicationevent SET recipient_id = %s WHERE uuid = %s",
                [roll_row(self.other, self.second).pk, self.corrected.pk],
            ),
            (REHASH, [self.corrected.pk]),
        )

        self.refused(PAYMENT_NOT_OWED)

    def test_two_standing_records_for_one_member_are_refused_even_when_chained(self):
        self.chained("payment", self.first)

        self.refused(PAYMENT_TWICE)

    def test_a_chained_withdrawal_with_no_record_is_refused(self):
        self.chained("payment_void", self.smallest)

        self.refused(WITHDRAWN_UNRECORDED)

    def test_a_chained_ballot_on_a_distribution_is_refused(self):
        self.chained(
            "ballot",
            self.smallest,
            choice="for",
            shares=1,
            actor_id=self.smallest.user.pk,
            staff_entered=False,
            authority="",
        )

        self.refused(EVENT_OF_ANOTHER_KIND)

    def test_a_rewritten_entitlement_is_refused(self):
        as_the_schema_owner(
            "shareholders_publicationrecipient",
            "shareholders_publication_roll_is_frozen",
            (
                "UPDATE shareholders_publicationrecipient SET entitlement = 0.51 WHERE uuid = %s",
                [roll_row(self.distribution, self.first).pk],
            ),
        )

        self.refused(ENTITLEMENT_DIFFERS)

    def test_a_rewritten_remainder_or_total_is_refused(self):
        for column, value in (("undistributed", "0.01"), ("declared_total", "0.71")):
            with self.subTest(column=column):
                as_the_schema_owner(
                    "shareholders_publication",
                    "shareholders_publication_is_frozen",
                    (
                        f"UPDATE shareholders_publication SET {column} = %s WHERE uuid = %s",
                        [value, self.distribution.pk],
                    ),
                )
                self.refused(TOTAL_DIFFERS)
                as_the_schema_owner(
                    "shareholders_publication",
                    "shareholders_publication_is_frozen",
                    (
                        "UPDATE shareholders_publication SET undistributed = 0, declared_total = 0.70 WHERE uuid = %s",
                        [self.distribution.pk],
                    ),
                )
        self.assertEqual(verify_publication(self.distribution.pk)["undistributed"], "0.00")


class VerifyCommandReportsTheDistributionTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("verify-dividend-command")

    def verify(self, **options):
        output = StringIO()
        call_command("publications", "verify", stdout=output, **options)
        return json.loads(output.getvalue())

    def test_the_command_verifies_a_distribution_s_roll_arithmetic_and_payment_records(self):
        distribution = a_distribution(self.world)
        a_payment(self.world, distribution, self.world.members[0])

        reported = self.verify(publication=distribution.pk)[str(distribution.pk)]

        self.assertEqual(reported, {**verify_roll(distribution), **verify_publication(distribution.pk)})
        self.assertEqual(reported["payments_recorded"], 1)

    def test_the_command_names_a_distribution_whose_records_were_rewritten(self):
        distribution = a_distribution(self.world)
        record = a_payment(self.world, distribution, self.world.members[0])
        the_chain_is_rewritten(
            ("UPDATE shareholders_publicationevent SET reference = 'LDV-0000' WHERE uuid = %s", [record.pk])
        )

        with self.assertRaises(CommandError) as refused:
            self.verify(publication=distribution.pk)

        self.assertIn(str(distribution.pk), str(refused.exception))
