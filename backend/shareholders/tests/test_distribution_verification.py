from django.test import TestCase

from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.exceptions import PublicationIntegrityError
from shareholders.services.distributions import withdraw_payment
from shareholders.services.resolutions import CHAIN_BROKEN, verify_publication
from shareholders.tests.fixtures import (
    a_company_with_members,
    a_distribution,
    a_payment,
    roll_row,
    the_chain_is_rewritten,
)


def refusal(template):
    return template.split("{publication}")[1].split("{")[0].strip()


class VerifyingADistributionTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("verify-dividend", holdings=(100, 40, 1))
        self.distribution = a_distribution(self.world, rate="0.005")
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
