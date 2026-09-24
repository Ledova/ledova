from datetime import timedelta

from django.db import connections
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.test import APIClient

from shared.db import current_alias
from shared.tests.test_admin_row_actions import staff_user
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.constants import RECENTLY_PUBLISHED_DAYS
from shareholders.models import BallotChoice
from shareholders.services.distributions import withdraw_payment
from shareholders.services.resolutions import close_resolution, enter_ballot
from shareholders.services.summary import summarise_for
from shareholders.tests.fixtures import (
    a_company_with_members,
    a_distribution,
    a_payment,
    a_resolution,
    as_the_schema_owner,
    published,
    roll_row,
    voting_has_closed,
    voting_has_not_opened,
)

SUMMARY = "/api/v1/publications/summary/"
LISTING = "/api/v1/publications/"
NOTHING = {"openResolutions": 0, "nextClosesAt": None, "publishedSince": 0, "dividendsWithoutRecord": 0}


def published_days_ago(publication, days):
    as_the_schema_owner(
        "shareholders_publication",
        "shareholders_publication_is_frozen",
        (
            "UPDATE shareholders_publication SET created_at = %s WHERE uuid = %s",
            [timezone.now() - timedelta(days=days), publication.pk],
        ),
    )


def closing_in(world, days):
    return a_resolution(world, closes_at=timezone.now() + timedelta(days=days))


class ThePublicationSummaryTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("summary", holdings=(100, 40))
        self.holder, self.other = self.world.members
        self.client = APIClient()

    def summary_for(self, user):
        self.client.force_authenticate(user)
        response = self.client.get(SUMMARY)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def counted_for(self, user, name):
        return self.summary_for(user)[name]

    def test_a_member_nothing_was_published_to_counts_nothing(self):
        self.assertEqual(self.summary_for(self.holder.user), NOTHING)

    def test_everything_published_to_a_member_in_the_last_thirty_days_is_counted_whatever_its_kind(self):
        published(self.world)
        a_resolution(self.world)
        a_distribution(self.world)
        recent, old = published(self.world), published(self.world)
        published_days_ago(recent, RECENTLY_PUBLISHED_DAYS - 1)
        published_days_ago(old, RECENTLY_PUBLISHED_DAYS + 1)

        self.assertEqual(self.counted_for(self.holder.user, "publishedSince"), 4)
        self.assertEqual(self.counted_for(self.other.user, "publishedSince"), 4)

    def test_an_open_resolution_counts_for_each_member_until_that_member_has_voted(self):
        resolution = a_resolution(self.world)

        before = self.summary_for(self.holder.user)
        self.client.post(f"{LISTING}{resolution.pk}/ballot/", {"choice": BallotChoice.FOR}, format="json")
        after = self.summary_for(self.holder.user)

        self.assertEqual(before["openResolutions"], 1)
        self.assertEqual(parse_datetime(before["nextClosesAt"]), resolution.closes_at)
        self.assertEqual((after["openResolutions"], after["nextClosesAt"]), (0, None))
        self.assertEqual(self.counted_for(self.other.user, "openResolutions"), 1)

    def test_a_person_on_the_roll_twice_counts_a_resolution_until_both_holdings_have_a_ballot(self):
        world = a_company_with_members("summary-twice", holdings=(100, 40, 10), first_person_holds_twice=True)
        resolution = a_resolution(world)
        person = world.members[0].user
        proxy = staff_user("summary-proxy")

        enter_ballot(proxy, resolution, roll_row(resolution, world.members[0]), BallotChoice.FOR, "Proxy form P-1")
        one_of_two = self.counted_for(person, "openResolutions")
        enter_ballot(proxy, resolution, roll_row(resolution, world.members[1]), BallotChoice.FOR, "Proxy form P-2")

        self.assertEqual((one_of_two, self.counted_for(person, "openResolutions")), (1, 0))

    def test_a_resolution_not_open_yet_or_past_its_window_awaits_no_ballot(self):
        open_now = a_resolution(self.world)
        voting_has_not_opened(a_resolution(self.world))
        voting_has_closed(a_resolution(self.world))
        close_resolution(voting_has_closed(a_resolution(self.world)))

        summary = self.summary_for(self.holder.user)

        self.assertEqual(summary["openResolutions"], 1)
        self.assertEqual(parse_datetime(summary["nextClosesAt"]), open_now.closes_at)
        self.assertEqual(summary["publishedSince"], 4)

    def test_the_next_closing_time_is_the_soonest_among_the_resolutions_still_awaiting_a_ballot(self):
        voted = closing_in(self.world, 1)
        sooner = closing_in(self.world, 3)
        closing_in(self.world, 5)
        self.client.force_authenticate(self.holder.user)
        self.client.post(f"{LISTING}{voted.pk}/ballot/", {"choice": BallotChoice.AGAINST}, format="json")

        summary = self.summary_for(self.holder.user)

        self.assertEqual(summary["openResolutions"], 2)
        self.assertEqual(parse_datetime(summary["nextClosesAt"]), sooner.closes_at)
        self.assertEqual(parse_datetime(self.counted_for(self.other.user, "nextClosesAt")), voted.closes_at)

    def test_a_dividend_awaits_a_record_until_the_company_records_a_payment_and_again_once_it_is_withdrawn(self):
        distribution = a_distribution(self.world)

        declared = self.counted_for(self.holder.user, "dividendsWithoutRecord")
        a_payment(self.world, distribution, self.holder, reference="LDV-WRONG")
        recorded = self.counted_for(self.holder.user, "dividendsWithoutRecord")
        withdraw_payment(self.world.staff, distribution, roll_row(distribution, self.holder), "Correction C-1")
        withdrawn = self.counted_for(self.holder.user, "dividendsWithoutRecord")
        a_payment(self.world, distribution, self.holder, reference="LDV-RIGHT")

        self.assertEqual((declared, recorded, withdrawn), (1, 0, 1))
        self.assertEqual(self.counted_for(self.holder.user, "dividendsWithoutRecord"), 0)
        self.assertEqual(self.counted_for(self.other.user, "dividendsWithoutRecord"), 1)

    def test_a_dividend_that_comes_to_less_than_a_cent_awaits_no_record(self):
        world = a_company_with_members("summary-cent", holdings=(100, 1))
        a_distribution(world, rate="0.001")

        self.assertEqual(self.counted_for(world.members[0].user, "dividendsWithoutRecord"), 1)
        self.assertEqual(self.counted_for(world.members[1].user, "dividendsWithoutRecord"), 0)
        self.assertEqual(self.counted_for(world.members[1].user, "publishedSince"), 1)

    def test_a_person_on_the_roll_twice_counts_a_dividend_until_each_holding_has_a_record(self):
        world = a_company_with_members("summary-dividend-twice", holdings=(100, 40, 10), first_person_holds_twice=True)
        distribution = a_distribution(world)
        person = world.members[0].user

        a_payment(world, distribution, world.members[1], reference="LDV-SECOND")
        one_of_two = self.counted_for(person, "dividendsWithoutRecord")
        a_payment(world, distribution, world.members[0], reference="LDV-FIRST")

        self.assertEqual((one_of_two, self.counted_for(person, "dividendsWithoutRecord")), (1, 0))

    def test_the_company_owner_reads_its_publications_and_counts_none_it_is_not_on_the_roll_of(self):
        published(self.world)
        a_resolution(self.world)
        a_distribution(self.world)
        self.client.force_authenticate(self.world.owner)
        listed = self.client.get(LISTING).json()["results"]

        owner, holder = self.summary_for(self.world.owner), self.summary_for(self.holder.user)

        self.assertEqual(len(listed), 3)
        self.assertEqual(owner, NOTHING)
        self.assertEqual(
            (holder["openResolutions"], holder["publishedSince"], holder["dividendsWithoutRecord"]), (1, 3, 1)
        )

    def test_the_summary_is_one_query_however_much_was_published(self):
        with self.assertNumQueries(1, using=current_alias()):
            summarise_for(self.holder.user)
        for _ in range(3):
            published(self.world)
            a_resolution(self.world)
            a_payment(self.world, a_distribution(self.world), self.other)

        with self.assertNumQueries(1, using=current_alias()):
            counted = summarise_for(self.holder.user)

        self.assertEqual(
            (counted["open_resolutions"], counted["published_since"], counted["dividends_without_record"]), (3, 9, 3)
        )

    def test_the_route_answers_in_the_same_number_of_queries_however_much_was_published(self):
        self.client.force_authenticate(self.holder.user)
        with CaptureQueriesContext(connections[current_alias()]) as sparse:
            self.client.get(SUMMARY)
        for _ in range(3):
            published(self.world)
            a_resolution(self.world)
            a_distribution(self.world)

        with self.assertNumQueries(len(sparse.captured_queries), using=current_alias()):
            response = self.client.get(SUMMARY)

        self.assertEqual(response.json()["publishedSince"], 9)

    def test_an_unauthenticated_caller_is_refused(self):
        self.client.force_authenticate(None)

        self.assertEqual(self.client.get(SUMMARY).status_code, 401)
