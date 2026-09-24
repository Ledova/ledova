import re
from decimal import Decimal

from django.db import connections
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils.dateparse import parse_datetime
from djangorestframework_camel_case.util import camelize
from rest_framework.test import APIClient

from shared.db import current_alias
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.models import Publication
from shareholders.serializers import PublicationSerializer, PublicationSummarySerializer
from shareholders.serializers.publication import PublicationPaymentRecordSerializer
from shareholders.services.distributions import withdraw_payment
from shareholders.tests.fixtures import (
    DECLARED_ON,
    PAYABLE_ON,
    PAYMENT_REFERENCE,
    a_company_with_members,
    a_distribution,
    a_payment,
    a_resolution,
    published,
    roll_row,
)

LISTING = "/api/v1/publications/"
DISTRIBUTION_FIELDS = (
    "ratePerShare",
    "currency",
    "declaredOn",
    "paymentDate",
    "myEntitlement",
    "myRecordedEntitlement",
    "myPaymentRecord",
)


class TheDistributionListingTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("route-dividend", holdings=(100, 40))
        self.distribution = a_distribution(self.world, rate="0.025")
        self.holder, self.other = self.world.members
        self.client = APIClient()

    def listed_for(self, user):
        self.client.force_authenticate(user)
        response = self.client.get(LISTING)
        self.assertEqual(response.status_code, 200, response.content)
        return {row["uuid"]: row for row in response.json()["results"]}

    def row_for(self, user, publication=None):
        return self.listed_for(user)[str((publication or self.distribution).pk)]

    def queries_listing(self, user):
        self.client.force_authenticate(user)
        with CaptureQueriesContext(connections[current_alias()]) as captured:
            response = self.client.get(LISTING)
        self.assertEqual(response.status_code, 200, response.content)
        return len(captured), response.json()["results"]

    def test_a_distribution_row_carries_its_rate_currency_dates_and_the_member_s_own_entitlement(self):
        row = self.row_for(self.holder.user)

        self.assertEqual(
            {field: row[field] for field in ("kind", "shares", *DISTRIBUTION_FIELDS)},
            {
                "kind": "distribution",
                "shares": "100",
                "ratePerShare": "0.025000",
                "currency": "AUD",
                "declaredOn": DECLARED_ON.isoformat(),
                "paymentDate": PAYABLE_ON.isoformat(),
                "myEntitlement": "2.50",
                "myRecordedEntitlement": "0.00",
                "myPaymentRecord": None,
            },
        )
        self.assertNotIn("declaredTotal", row)
        self.assertNotIn("undistributed", row)

    def test_a_recorded_payment_is_shown_to_its_member_as_what_the_company_recorded(self):
        record = a_payment(self.world, self.distribution, self.holder)

        shown = self.row_for(self.holder.user)["myPaymentRecord"]

        self.assertEqual((shown["recordedPaidOn"], shown["reference"]), (PAYABLE_ON.isoformat(), PAYMENT_REFERENCE))
        self.assertEqual(parse_datetime(shown["recordedAt"]), record.created_at)
        self.assertEqual(set(shown), {"recordedPaidOn", "reference", "recordedAt"})

    def test_each_member_is_shown_their_own_entitlement_and_record_and_never_another_member_s(self):
        a_payment(self.world, self.distribution, self.holder, reference="LDV-HOLDER")

        mine, theirs = self.row_for(self.holder.user), self.row_for(self.other.user)

        self.assertEqual(
            (mine["myEntitlement"], mine["myRecordedEntitlement"], mine["myPaymentRecord"]["reference"]),
            ("2.50", "2.50", "LDV-HOLDER"),
        )
        self.assertEqual(
            (theirs["myEntitlement"], theirs["myRecordedEntitlement"], theirs["myPaymentRecord"]),
            ("1.00", "0.00", None),
        )

    def test_a_withdrawn_record_is_no_longer_shown_and_the_correction_that_follows_it_is(self):
        a_payment(self.world, self.distribution, self.holder, reference="LDV-WRONG")
        withdraw_payment(self.world.staff, self.distribution, roll_row(self.distribution, self.holder), "C-10")

        self.assertIsNone(self.row_for(self.holder.user)["myPaymentRecord"])

        a_payment(self.world, self.distribution, self.holder, reference="LDV-RIGHT")

        self.assertEqual(self.row_for(self.holder.user)["myPaymentRecord"]["reference"], "LDV-RIGHT")

    def test_a_person_on_the_roll_twice_is_shown_how_much_of_their_whole_entitlement_is_recorded(self):
        world = a_company_with_members("route-dividend-twice", holdings=(100, 40, 10), first_person_holds_twice=True)
        distribution = a_distribution(world, rate="0.025")
        person = world.members[0].user
        first, second = world.members[0], world.members[1]

        def shown():
            row = self.row_for(person, distribution)
            record = row["myPaymentRecord"]
            return row["myEntitlement"], row["myRecordedEntitlement"], None if record is None else record["reference"]

        self.assertEqual(self.row_for(person, distribution)["shares"], "140")
        self.assertEqual(shown(), ("3.50", "0.00", None))
        a_payment(world, distribution, second, reference="LDV-SECOND-HOLDING")
        self.assertEqual(shown(), ("3.50", "1.00", "LDV-SECOND-HOLDING"))
        a_payment(world, distribution, first, reference="LDV-FIRST-HOLDING")
        self.assertEqual(shown(), ("3.50", "3.50", "LDV-FIRST-HOLDING"))
        withdraw_payment(world.staff, distribution, roll_row(distribution, first), "C-40")
        self.assertEqual(shown(), ("3.50", "1.00", "LDV-SECOND-HOLDING"))

    def test_the_company_owner_sees_the_distribution_with_no_entitlement_or_record_of_its_own(self):
        a_payment(self.world, self.distribution, self.holder)

        row = self.row_for(self.world.owner)

        self.assertEqual((row["ratePerShare"], row["paymentDate"]), ("0.025000", PAYABLE_ON.isoformat()))
        self.assertEqual(
            (row["shares"], row["myEntitlement"], row["myRecordedEntitlement"], row["myPaymentRecord"]),
            (None, None, None, None),
        )

    def test_a_document_or_a_resolution_carries_none_of_a_distribution_s_fields(self):
        statement = published(self.world)
        resolution = a_resolution(self.world)

        rows = self.listed_for(self.holder.user)

        for publication in (statement, resolution):
            with self.subTest(kind=publication.kind):
                self.assertEqual(
                    {field: rows[str(publication.pk)][field] for field in DISTRIBUTION_FIELDS},
                    dict.fromkeys(DISTRIBUTION_FIELDS),
                )

    def test_the_annotation_names_the_given_member_s_record_even_where_every_record_is_readable(self):
        a_payment(self.world, self.distribution, self.holder, reference="LDV-HOLDER")
        a_payment(self.world, self.distribution, self.other, reference="LDV-OTHER")

        seen = {
            user.pk: Publication.objects.seen_by(user.pk)
            .values_list("payment_reference", "recorded_entitlement")
            .get(pk=self.distribution.pk)
            for user in (self.holder.user, self.other.user, self.world.owner)
        }

        self.assertEqual(
            seen,
            {
                self.holder.user.pk: ("LDV-HOLDER", Decimal("2.50")),
                self.other.user.pk: ("LDV-OTHER", Decimal("1.00")),
                self.world.owner.pk: (None, None),
            },
        )

    def test_the_listing_reads_any_number_of_distributions_in_the_same_number_of_queries(self):
        a_payment(self.world, self.distribution, self.holder)
        first, one = self.queries_listing(self.holder.user)
        for _ in range(3):
            more = a_distribution(self.world, rate="0.01")
            a_payment(self.world, more, self.holder)
        published(self.world)

        second, many = self.queries_listing(self.holder.user)

        self.assertEqual((len(one), len(many)), (1, 5))
        self.assertEqual(sum(row["myPaymentRecord"] is not None for row in many), 4)
        self.assertEqual(
            [row["myRecordedEntitlement"] for row in many if row["kind"] == "distribution"],
            [row["myEntitlement"] for row in many if row["kind"] == "distribution"],
        )
        self.assertEqual(second, first)


class PaymentWordingTest(TestCase):
    def names(self, serializer):
        return list(camelize({name: None for name in serializer.fields}))

    def test_no_field_a_member_is_served_about_a_payment_says_paid_without_saying_recorded(self):
        served = (
            self.names(PublicationSerializer())
            + self.names(PublicationPaymentRecordSerializer())
            + self.names(PublicationSummarySerializer())
        )
        claims = [name for name in served if re.search("paid", name, re.IGNORECASE)]

        self.assertIn("recordedPaidOn", claims)
        self.assertEqual([name for name in claims if not re.search("recorded", name, re.IGNORECASE)], [])
