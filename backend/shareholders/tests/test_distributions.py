import importlib
import random
from datetime import timedelta
from decimal import Decimal, localcontext
from unittest.mock import patch
from uuid import uuid4

from django.db import IntegrityError, connections
from django.test import SimpleTestCase, TestCase
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from shared.db import atomic, current_alias
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.constants import CENT
from shareholders.models import Publication, PublicationKind, PublicationRecipient
from shareholders.services.distributions import (
    DECLARED_IN_THE_FUTURE,
    NO_DECLARATION_DATE,
    NO_DECLARED_TOTAL,
    NO_PAYMENT_DATE,
    NO_RATE,
    NOTHING_PAYABLE,
    ONLY_A_DISTRIBUTION_PAYS,
    PAYMENT_BEFORE_THE_RECORD_DATE,
    TOTAL_TOO_LARGE,
    entitle,
    entitlement,
)
from shareholders.tests.fixtures import (
    DAY,
    DECLARED_ON,
    PAYABLE_ON,
    a_company_with_members,
    a_distribution,
    a_member,
    a_treasury_address,
    published,
)
from tokens.constants import STATUTORY_CALENDAR
from tokens.models import RegisterEntryKind
from tokens.services.register_events import record_entry
from whitelist.models import HolderType

TOTAL_DIFFERS_OPENING = "The declared total must be the"
ADDS_UP = "A distribution's declared total is its roll's shares times its rate"
ROW_ENTITLED = "A distribution's roll row is entitled to its shares times the rate, rounded down to the cent"


class Undone(Exception):
    pass


def cents(shares, rate):
    micro = int(Decimal(rate) * 1_000_000)
    return Decimal(f"{int(shares) * micro // 10_000}E-2")


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

    def test_each_member_is_entitled_to_their_shares_times_the_rate_in_exact_cents(self):
        distribution = a_distribution(self.world, rate="0.025")

        self.assertEqual(entitlements_of(distribution), {100: Decimal("2.50"), 40: Decimal("1.00")})
        self.assertEqual(Publication.objects.get(pk=distribution.pk).undistributed, Decimal("0.00"))

    def test_a_sub_cent_remainder_across_several_holders_is_recorded_as_undistributed(self):
        world = a_company_with_members("dividend-remainder", holdings=(7, 5, 3))

        distribution = a_distribution(world, rate="0.335")

        self.assertEqual(entitlements_of(distribution), {7: Decimal("2.34"), 5: Decimal("1.67"), 3: Decimal("1.00")})
        self.assertEqual((distribution.declared_total, distribution.undistributed), (Decimal("5.02"), CENT))

    def test_a_rate_stated_to_six_decimal_places_is_applied_to_every_one_of_them(self):
        world = a_company_with_members("dividend-six", holdings=(100, 40, 7))

        distribution = a_distribution(world, rate="0.123456")

        self.assertEqual(
            entitlements_of(distribution), {100: Decimal("12.34"), 40: Decimal("4.93"), 7: Decimal("0.86")}
        )
        self.assertEqual((distribution.declared_total, distribution.undistributed), (Decimal("18.14"), CENT))

    def test_a_declared_total_a_cent_either_side_of_the_rate_is_refused_and_nothing_is_published(self):
        for declared in (Decimal("3.51"), Decimal("3.49")):
            with self.subTest(declared=declared):
                with self.assertRaisesMessage(ValidationError, TOTAL_DIFFERS_OPENING) as refused, atomic():
                    a_distribution(self.world, rate="0.025", declared_total=declared)
                self.assertIn("140 shares", str(refused.exception))
                self.assertIn("3.50", str(refused.exception))
        self.assertFalse(Publication.objects.exists())

    def test_a_member_the_register_cannot_name_is_entitled_on_the_roll_like_any_other(self):
        treasury = a_member(self.world.company, a_treasury_address("Dividend treasury"))
        record_entry(
            register_id=self.world.register.pk,
            operation_id=uuid4(),
            kind=RegisterEntryKind.ISSUE,
            changes=[{"member": str(treasury.pk), "shares": "60"}],
            effective_on=DAY,
            recorded_by=self.world.owner,
        )

        distribution = a_distribution(self.world, rate="0.025", declared_total=Decimal("5.00"))
        row = PublicationRecipient.objects.get(publication=distribution, member_id=treasury.pk)

        self.assertEqual((row.holder_type, row.user_id, row.entitlement), (HolderType.TREASURY, None, Decimal("1.50")))

    def test_publishing_refuses_a_distribution_it_cannot_stand_behind(self):
        today = timezone.localdate(timezone=STATUTORY_CALENDAR)
        for refusal, changes in (
            (NO_RATE, {"rate_per_share": None}),
            (NO_RATE, {"rate": "0"}),
            (NO_RATE, {"rate": "-0.01"}),
            (NO_RATE, {"rate": "0.0000001"}),
            (NO_RATE, {"rate": "1000000000000"}),
            (NO_DECLARATION_DATE, {"declared_on": None}),
            (DECLARED_IN_THE_FUTURE, {"declared_on": today + timedelta(days=1)}),
            (NO_PAYMENT_DATE, {"payment_date": None}),
            (PAYMENT_BEFORE_THE_RECORD_DATE, {"payment_date": DAY - timedelta(days=1)}),
            (NO_DECLARED_TOTAL, {"declared_total": None}),
            (NOTHING_PAYABLE, {"rate": "0.000001"}),
        ):
            with self.subTest(refusal=refusal, changes=changes):
                with self.assertRaisesMessage(ValidationError, refusal), atomic():
                    a_distribution(self.world, **changes)
        self.assertFalse(Publication.objects.exists())

    def test_a_document_kind_refuses_the_terms_of_a_distribution(self):
        for changes in (
            {"rate_per_share": Decimal("0.025")},
            {"declared_on": DECLARED_ON},
            {"payment_date": PAYABLE_ON},
            {"declared_total": Decimal("3.50")},
        ):
            with self.subTest(changes=changes):
                with self.assertRaisesMessage(ValidationError, ONLY_A_DISTRIBUTION_PAYS), atomic():
                    published(self.world, **changes)
        self.assertFalse(Publication.objects.exists())

    def test_a_document_carries_no_rate_and_its_roll_no_entitlement(self):
        statement = published(self.world)

        self.assertEqual(
            (statement.rate_per_share, statement.currency, statement.declared_total, statement.undistributed),
            (None, "", None, None),
        )
        self.assertEqual(set(entitlements_of(statement).values()), {None})


class RoundingTest(SimpleTestCase):
    def rows(self, *holdings):
        return [{"shares": shares} for shares in holdings]

    def test_each_entitlement_is_rounded_down_to_the_cent_never_to_the_nearest(self):
        for shares, rate, expected in (
            (1, "0.005", "0.00"),
            (3, "0.005", "0.01"),
            (1, "0.019999", "0.01"),
            (7, "0.025", "0.17"),
            (100, "0.025", "2.50"),
        ):
            with self.subTest(shares=shares, rate=rate):
                self.assertEqual(entitlement(shares, Decimal(rate)), Decimal(expected))

    def test_the_remainder_is_never_negative_and_always_less_than_a_cent_for_each_holder(self):
        chance = random.Random(649)
        for _ in range(400):
            holdings = [chance.randint(1, 10**9) for _ in range(chance.randint(1, 40))]
            rate = Decimal(chance.randint(1, 10**8)) / 1_000_000
            rows = self.rows(*holdings)
            terms = {"rate_per_share": rate, "declared_total": cents(sum(holdings), rate)}
            if terms["declared_total"] == 0:
                continue

            remainder = entitle(terms, rows)["undistributed"]

            self.assertEqual([row["entitlement"] for row in rows], [cents(shares, rate) for shares in holdings])
            self.assertGreaterEqual(remainder, 0)
            self.assertLess(remainder, CENT * len(holdings))
            self.assertEqual(sum(row["entitlement"] for row in rows) + remainder, terms["declared_total"])

    def test_a_holding_of_seventy_eight_digits_is_multiplied_exactly(self):
        shares = int("9" * 78)
        for rate in ("0.000001", "1.234567", "999999999999.999999"):
            with self.subTest(rate=rate):
                self.assertEqual(entitlement(shares, Decimal(rate)), cents(shares, rate))

    def test_the_default_decimal_context_would_have_rounded_a_holding_that_large(self):
        shares, rate = int("9" * 78), Decimal("1.234567")

        with localcontext() as ordinary:
            ordinary.prec = 28
            shortened = Decimal(shares) * rate

        self.assertNotEqual(shortened, cents(shares, rate))
        self.assertEqual(entitlement(shares, rate), cents(shares, rate))

    def test_a_total_that_cannot_be_recorded_is_refused(self):
        rows = self.rows(int("9" * 78))

        with self.assertRaisesMessage(ValidationError, TOTAL_TOO_LARGE):
            entitle({"rate_per_share": Decimal("0.000001"), "declared_total": Decimal("1")}, rows)


class PublishingAHoldingTooLargeToPayTest(StubUploadDependencies, TestCase):
    def test_a_roll_holding_seventy_eight_digits_is_published_as_a_document_and_refused_as_a_distribution(self):
        huge = 10**77 + 12345
        world = a_company_with_members("dividend-huge", holdings=(huge, 1))

        statement = published(world)
        with self.assertRaisesMessage(ValidationError, TOTAL_TOO_LARGE), atomic():
            a_distribution(world, rate="0.000001", declared_total=Decimal("1.00"))

        self.assertEqual(
            max(int(row.shares) for row in PublicationRecipient.objects.filter(publication=statement)), huge
        )
        self.assertEqual(list(Publication.objects.values_list("kind", flat=True)), [PublicationKind.HOLDING_STATEMENT])


class TheDatabaseOwnsTheEntitlementsTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("dividend-owns", holdings=(100, 40))
        self.distribution = a_distribution(self.world, rate="0.025")
        self.statement = published(self.world)

    def insert(self, publication, **changes):
        fields = {
            "publication": publication,
            "company": self.world.company,
            "member_id": uuid4(),
            "user_id": None,
            "name": "Added by the schema owner",
            "holder_type": HolderType.UNIDENTIFIED,
            "identity_source": "none",
            "shares": 7,
            "entitlement": Decimal("0.17"),
            **changes,
        }
        return PublicationRecipient.objects.create(**fields)

    def test_a_row_carrying_the_entitlement_its_shares_and_rate_give_is_admitted(self):
        with self.assertRaises(Undone), atomic():
            self.insert(self.distribution)
            self.assertEqual(PublicationRecipient.objects.filter(publication=self.distribution).count(), 3)
            raise Undone

    def test_a_row_whose_entitlement_is_not_its_shares_times_the_rate_rounded_down_is_refused(self):
        for wrong in (Decimal("0.18"), Decimal("0.16"), Decimal("0.00"), None):
            with self.subTest(entitlement=wrong), self.assertRaisesMessage(IntegrityError, ROW_ENTITLED), atomic():
                self.insert(self.distribution, entitlement=wrong)
        self.assertEqual(PublicationRecipient.objects.filter(publication=self.distribution).count(), 2)

    def test_a_document_s_roll_row_carries_no_entitlement(self):
        with self.assertRaisesMessage(IntegrityError, "Only a distribution's roll row carries an entitlement"):
            with atomic():
                self.insert(self.statement, entitlement=Decimal("0.00"))

    def test_the_database_refuses_at_commit_a_distribution_whose_roll_no_longer_adds_up_to_its_total(self):
        with self.assertRaisesMessage(IntegrityError, ADDS_UP), atomic():
            fresh = a_distribution(self.world, rate="0.025")
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "DELETE FROM shareholders_publicationrecipient WHERE publication_id = %s AND shares = 40",
                    [fresh.pk],
                )
                cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")

    def test_the_database_refuses_at_commit_a_remainder_that_does_not_make_up_the_total(self):
        def one_cent_short(terms, rows):
            return {"undistributed": entitle(terms, rows)["undistributed"] + CENT}

        with patch("shareholders.services.publications.entitle", side_effect=one_cent_short):
            with self.assertRaisesMessage(IntegrityError, ADDS_UP), atomic():
                a_distribution(self.world, rate="0.025")
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")

    def test_the_database_refuses_a_distribution_without_its_rate_dates_or_total_and_a_document_with_one(self):
        for publication, column, value in (
            (self.distribution, "rate_per_share", 0),
            (self.distribution, "currency", "USD"),
            (self.distribution, "declared_on", None),
            (self.distribution, "payment_date", DAY - timedelta(days=1)),
            (self.distribution, "declared_total", 0),
            (self.distribution, "undistributed", Decimal("-0.01")),
            (self.statement, "rate_per_share", Decimal("0.025")),
            (self.statement, "currency", "AUD"),
            (self.statement, "undistributed", 0),
        ):
            with self.subTest(column=column, kind=publication.kind):
                with self.assertRaisesMessage(IntegrityError, "publication_distribution_states_its_rate"), atomic():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
                        cursor.execute(
                            "ALTER TABLE shareholders_publication DISABLE TRIGGER shareholders_publication_is_frozen"
                        )
                        cursor.execute(
                            f"UPDATE shareholders_publication SET {column} = %s WHERE uuid = %s",
                            [value, publication.pk],
                        )


class DowngradingDistributionsTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("dividend-downgrade")
        self.migration = importlib.import_module("shareholders.migrations.0004_distributions")

    def remove_distributions(self):
        with atomic(), connections[current_alias()].schema_editor() as editor:
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
                self.migration.remove_distributions(None, editor)
                cursor.execute("SET CONSTRAINTS ALL DEFERRED")

    def installed(self):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT tgname FROM pg_trigger WHERE tgname LIKE %s AND NOT tgisinternal ORDER BY 1", ["shareholders%"]
            )
            triggers = [row[0] for row in cursor.fetchall()]
            cursor.execute("SELECT prosrc FROM pg_proc WHERE proname = %s", ["shareholders_publication_event_hash"])
            hashing = cursor.fetchone()[0]
            cursor.execute(
                "SELECT prosrc FROM pg_proc WHERE proname = %s", ["shareholders_guard_publication_recipient"]
            )
            guarding = cursor.fetchone()[0]
        return triggers, "event-v2" in hashing, "entitlement" in guarding

    def test_downgrade_refuses_while_a_distribution_exists(self):
        distribution = a_distribution(self.world)

        with self.assertRaisesRegex(RuntimeError, "Retain distributions"):
            self.remove_distributions()

        self.assertTrue(Publication.objects.filter(pk=distribution.pk).exists())
        self.assertIn("shareholders_distribution_adds_up", self.installed()[0])

    def test_downgrade_with_no_distribution_restores_the_guards_the_resolutions_left(self):
        published(self.world)
        self.assertEqual(self.installed()[1:], (True, True))

        self.remove_distributions()

        triggers, hashes_payments, guards_entitlements = self.installed()
        self.assertEqual(
            triggers,
            [
                "shareholders_publication_event_chain",
                "shareholders_publication_is_frozen",
                "shareholders_publication_roll_is_frozen",
            ],
        )
        self.assertEqual((hashes_payments, guards_entitlements), (False, False))
