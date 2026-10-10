from decimal import Decimal

from django.test import TestCase

from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.constants import CENT
from shareholders.models import PublicationKind, PublicationRecipient
from shareholders.tests.fixtures import (
    DECLARED_ON,
    PAYABLE_ON,
    a_company_with_members,
    a_distribution,
)


def entitlements_of(publication):
    return {int(row.shares): row.entitlement for row in PublicationRecipient.objects.filter(publication=publication)}


class PublishingADistributionTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("dividend", holdings=(100, 40))

    def test_a_distribution_records_its_rate_currency_dates_total_and_remainder_beside_its_notice_and_roll(self):
        distribution = a_distribution(self.world, rate="0.025")

        self.assertEqual(
            (
                distribution.kind,
                distribution.rate_per_share,
                distribution.currency,
                distribution.declared_on,
                distribution.payment_date,
                distribution.declared_total,
                distribution.undistributed,
            ),
            (PublicationKind.DISTRIBUTION, Decimal("0.025"), "AUD", DECLARED_ON, PAYABLE_ON, Decimal("3.50"), 0),
        )
        self.assertEqual((distribution.member_rows, distribution.mime_type), (2, "application/pdf"))
        self.assertEqual(len(distribution.digest), 64)

    def test_a_sub_cent_remainder_across_several_holders_is_recorded_as_undistributed(self):
        world = a_company_with_members("dividend-remainder", holdings=(7, 5, 3))

        distribution = a_distribution(world, rate="0.335")

        self.assertEqual(entitlements_of(distribution), {7: Decimal("2.34"), 5: Decimal("1.67"), 3: Decimal("1.00")})
        self.assertEqual((distribution.declared_total, distribution.undistributed), (Decimal("5.02"), CENT))
