from unittest.mock import patch
from uuid import uuid4

from django.core.cache import cache
from django.db import connections
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils.dateparse import parse_datetime
from rest_framework.test import APIClient
from rest_framework.throttling import ScopedRateThrottle

from shared.db import current_alias
from shared.tests.test_admin_row_actions import staff_user
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.models import (
    BallotChoice,
    Publication,
    PublicationEvent,
    PublicationEventKind,
    PublicationRecipient,
)
from shareholders.services.resolutions import (
    ALREADY_CAST,
    NOT_OPEN_YET,
    UNKNOWN_CHOICE,
    VOTING_CLOSED,
    close_resolution,
    enter_ballot,
)
from shareholders.tests.fixtures import (
    QUESTION,
    a_company_with_members,
    a_person,
    a_resolution,
    published,
    voting_has_closed,
    voting_has_not_opened,
)

LISTING = "/api/v1/publications/"
RESOLUTION_FIELDS = ("question", "resolutionKind", "opensAt", "closesAt", "myBallot", "result")


def ballot_route(publication):
    return f"{LISTING}{publication.pk}/ballot/"


class TheBallotRouteTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("ballot", holdings=(100, 40, 10))
        self.elsewhere = a_company_with_members("ballot-elsewhere")
        self.resolution = a_resolution(self.world)
        self.holder, self.other, self.silent = self.world.members
        self.client = APIClient()

    def cast(self, user, choice=BallotChoice.FOR, publication=None):
        self.client.force_authenticate(user)
        return self.client.post(ballot_route(publication or self.resolution), {"choice": choice}, format="json")

    def listed_for(self, user):
        self.client.force_authenticate(user)
        response = self.client.get(LISTING)
        self.assertEqual(response.status_code, 200, response.content)
        return {row["uuid"]: row for row in response.json()["results"]}

    def row_for(self, user, publication=None):
        return self.listed_for(user)[str((publication or self.resolution).pk)]

    def queries_listing(self, user):
        self.client.force_authenticate(user)
        with CaptureQueriesContext(connections[current_alias()]) as captured:
            response = self.client.get(LISTING)
        self.assertEqual(response.status_code, 200, response.content)
        return len(captured), response.json()["results"]

    def closed(self):
        voting_has_closed(self.resolution)
        return close_resolution(self.resolution)

    def refused_like_a_missing_resolution(self, user):
        denied = self.cast(user)
        missing = self.client.post(f"{LISTING}{uuid4()}/ballot/", {"choice": BallotChoice.FOR}, format="json")
        self.assertEqual((denied.status_code, denied.content), (missing.status_code, missing.content))
        self.assertEqual(denied.status_code, 404)

    def test_a_member_casts_and_is_answered_with_their_row_carrying_the_ballot(self):
        response = self.cast(self.holder.user, BallotChoice.FOR)

        self.assertEqual(response.status_code, 200, response.content)
        row = response.json()
        cast = PublicationEvent.objects.get(kind=PublicationEventKind.BALLOT)
        self.assertEqual((row["uuid"], row["shares"]), (str(self.resolution.pk), str(self.holder.shares)))
        self.assertEqual((row["myBallot"]["choice"], row["myBallot"]["staffEntered"]), ("for", False))
        self.assertEqual(parse_datetime(row["myBallot"]["castAt"]), cast.created_at)
        self.assertIsNone(row["result"])
        self.assertEqual(
            (cast.actor_id, cast.recipient.user_id, cast.shares, cast.choice, cast.staff_entered),
            (self.holder.user.pk, self.holder.user.pk, self.holder.shares, BallotChoice.FOR, False),
        )

    def test_a_person_on_the_roll_twice_is_shown_and_casts_their_whole_holding(self):
        world = a_company_with_members("ballot-twice", holdings=(100, 40, 10), first_person_holds_twice=True)
        resolution = a_resolution(world)
        person = world.members[0].user

        self.assertEqual(self.row_for(person, resolution)["shares"], "140")
        response = self.cast(person, BallotChoice.AGAINST, resolution)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            sorted(
                PublicationEvent.objects.filter(publication=resolution, actor_id=person.pk).values_list(
                    "choice", "shares"
                )
            ),
            [("against", 40), ("against", 100)],
        )
        self.assertEqual(response.json()["myBallot"]["choice"], "against")

    def test_a_ballot_is_outstanding_for_a_member_until_they_cast_and_never_for_the_company_or_a_document(self):
        statement = published(self.world)
        before = self.listed_for(self.holder.user)

        self.assertEqual(self.cast(self.holder.user).json()["ballotOutstanding"], False)

        self.assertEqual(
            (before[str(self.resolution.pk)]["ballotOutstanding"], before[str(statement.pk)]["ballotOutstanding"]),
            (True, False),
        )
        self.assertFalse(self.row_for(self.holder.user)["ballotOutstanding"])
        self.assertTrue(self.row_for(self.silent.user)["ballotOutstanding"])
        self.assertFalse(self.row_for(self.world.owner)["ballotOutstanding"])

    def test_a_person_on_the_roll_twice_with_one_holding_voted_by_staff_may_still_cast_the_rest(self):
        world = a_company_with_members("ballot-partial", holdings=(100, 40, 10), first_person_holds_twice=True)
        resolution = a_resolution(world)
        person = world.members[0].user
        proxied = PublicationRecipient.objects.get(publication=resolution, user_id=person.pk, shares=40)
        enter_ballot(staff_user("ballot-partial-proxy"), resolution, proxied, BallotChoice.AGAINST, "Proxy form SYN-2")

        partly = self.row_for(person, resolution)
        cast = self.cast(person, BallotChoice.FOR, resolution)

        self.assertEqual(
            (partly["ballotOutstanding"], partly["myBallot"]["choice"], partly["myBallot"]["staffEntered"]),
            (True, "against", True),
        )
        self.assertEqual(cast.status_code, 200, cast.content)
        self.assertFalse(cast.json()["ballotOutstanding"])
        self.assertEqual(
            sorted(
                PublicationEvent.objects.filter(publication=resolution).values_list("choice", "shares", "staff_entered")
            ),
            [("against", 40, True), ("for", 100, False)],
        )

    def test_a_ballot_is_cast_once_and_a_second_cast_neither_changes_nor_adds_one(self):
        self.assertEqual(self.cast(self.holder.user, BallotChoice.FOR).status_code, 200)

        again = self.cast(self.holder.user, BallotChoice.AGAINST)

        self.assertEqual((again.status_code, again.json()), (400, [ALREADY_CAST]))
        self.assertEqual(
            list(PublicationEvent.objects.values_list("actor_id", "choice")), [(self.holder.user.pk, "for")]
        )

    def test_a_cast_before_the_window_opens_is_refused_and_says_so(self):
        voting_has_not_opened(self.resolution)

        refused = self.cast(self.holder.user)

        self.assertEqual((refused.status_code, refused.json()), (400, [NOT_OPEN_YET]))
        self.assertFalse(PublicationEvent.objects.exists())

    def test_a_cast_after_the_window_closes_is_refused_and_says_so_before_and_after_the_count(self):
        voting_has_closed(self.resolution)
        before_the_count = self.cast(self.holder.user)
        close = close_resolution(self.resolution)
        after_the_count = self.cast(self.holder.user)

        for refused in (before_the_count, after_the_count):
            self.assertEqual((refused.status_code, refused.json()), (400, [VOTING_CLOSED]))
        self.assertEqual(list(PublicationEvent.objects.values_list("pk", flat=True)), [close.pk])

    def test_a_choice_that_is_not_for_against_or_abstain_is_refused_and_says_what_is_accepted(self):
        unknown = self.cast(self.holder.user, "maybe")
        self.client.force_authenticate(self.holder.user)
        absent = self.client.post(ballot_route(self.resolution), {}, format="json")

        self.assertEqual((unknown.status_code, unknown.json()), (400, {"choice": [UNKNOWN_CHOICE]}))
        self.assertEqual(absent.status_code, 400)
        self.assertIn("choice", absent.json())
        self.assertFalse(PublicationEvent.objects.exists())

    def test_the_company_owner_cannot_cast_though_it_reads_the_whole_roll(self):
        self.assertEqual(
            PublicationRecipient.objects.filter(publication=self.resolution).count(), len(self.world.members)
        )
        self.assertIsNone(self.row_for(self.world.owner)["shares"])

        self.refused_like_a_missing_resolution(self.world.owner)

        self.assertFalse(PublicationEvent.objects.exists())

    def test_nobody_off_the_roll_can_cast_and_each_is_refused_like_a_resolution_that_does_not_exist(self):
        stranger = a_person("ballot-stranger", "Passing Stranger")[0]
        for user in (self.elsewhere.members[0].user, self.elsewhere.owner, staff_user("ballot-staff"), stranger):
            with self.subTest(user=user.pk):
                self.refused_like_a_missing_resolution(user)
        self.assertFalse(PublicationEvent.objects.exists())

    def test_a_publication_that_is_not_a_resolution_takes_no_ballot(self):
        statement = published(self.world)

        refused = self.cast(self.holder.user, publication=statement)

        self.assertEqual(refused.status_code, 404)
        self.assertFalse(PublicationEvent.objects.exists())

    def test_an_unauthenticated_caller_cannot_cast(self):
        self.client.force_authenticate(None)

        refused = self.client.post(ballot_route(self.resolution), {"choice": BallotChoice.FOR}, format="json")

        self.assertEqual(refused.status_code, 401)
        self.assertFalse(PublicationEvent.objects.exists())

    def test_a_resolution_row_carries_its_question_kind_and_window_and_a_document_carries_none(self):
        statement = published(self.world)

        rows = self.listed_for(self.holder.user)

        resolution = rows[str(self.resolution.pk)]
        self.assertEqual(
            (resolution["kind"], resolution["question"], resolution["resolutionKind"], resolution["shares"]),
            ("resolution", QUESTION, "ordinary", str(self.holder.shares)),
        )
        self.assertEqual(
            (parse_datetime(resolution["opensAt"]), parse_datetime(resolution["closesAt"])),
            (self.resolution.opens_at, self.resolution.closes_at),
        )
        self.assertEqual((resolution["myBallot"], resolution["result"]), (None, None))
        self.assertEqual(
            {field: rows[str(statement.pk)][field] for field in RESOLUTION_FIELDS}, dict.fromkeys(RESOLUTION_FIELDS)
        )

    def test_each_member_is_shown_their_own_ballot_and_never_another_members(self):
        self.cast(self.holder.user, BallotChoice.FOR)
        self.cast(self.other.user, BallotChoice.AGAINST)

        shown = {holder.user.pk: self.row_for(holder.user)["myBallot"] for holder in self.world.members}

        self.assertEqual(shown[self.holder.user.pk]["choice"], "for")
        self.assertEqual(shown[self.other.user.pk]["choice"], "against")
        self.assertIsNone(shown[self.silent.user.pk])

    def test_the_annotation_names_the_given_members_ballot_even_where_every_ballot_is_readable(self):
        self.cast(self.holder.user, BallotChoice.FOR)
        self.cast(self.other.user, BallotChoice.AGAINST)
        self.assertEqual(PublicationEvent.objects.filter(kind=PublicationEventKind.BALLOT).count(), 2)

        seen = {
            user.pk: Publication.objects.seen_by(user.pk).get(pk=self.resolution.pk).ballot_choice
            for user in (self.holder.user, self.other.user, self.silent.user, self.world.owner)
        }

        self.assertEqual(
            seen,
            {
                self.holder.user.pk: "for",
                self.other.user.pk: "against",
                self.silent.user.pk: None,
                self.world.owner.pk: None,
            },
        )

    def test_a_ballot_staff_entered_for_a_member_is_shown_to_them_as_staff_entered(self):
        row = PublicationRecipient.objects.get(publication=self.resolution, user_id=self.other.user.pk)
        enter_ballot(staff_user("ballot-proxy"), self.resolution, row, BallotChoice.AGAINST, "Proxy form SYN-1")

        shown = self.row_for(self.other.user)["myBallot"]

        self.assertEqual((shown["choice"], shown["staffEntered"]), ("against", True))
        self.assertIsNone(self.row_for(self.holder.user)["myBallot"])

    def test_after_the_close_a_member_is_shown_the_tally_beside_their_own_ballot(self):
        self.cast(self.holder.user, BallotChoice.FOR)
        self.cast(self.other.user, BallotChoice.AGAINST)
        close = self.closed()

        row = self.row_for(self.holder.user)

        self.assertEqual(row["myBallot"]["choice"], "for")
        self.assertEqual(
            row["result"],
            {
                "for": {"shares": "100", "members": 1},
                "against": {"shares": "40", "members": 1},
                "abstain": {"shares": "0", "members": 0},
                "eligible": {"shares": "150", "members": 3},
                "carried": True,
            },
        )
        self.assertEqual(close.payload["carried"], row["result"]["carried"])

    def test_the_company_owner_is_shown_the_tally_once_closed_and_never_a_ballot(self):
        self.cast(self.holder.user, BallotChoice.AGAINST)
        self.cast(self.other.user, BallotChoice.FOR)
        before = self.row_for(self.world.owner)
        self.closed()

        after = self.row_for(self.world.owner)

        self.assertEqual((before["myBallot"], before["result"]), (None, None))
        self.assertIsNone(after["myBallot"])
        self.assertEqual(
            (after["result"]["for"], after["result"]["against"], after["result"]["carried"]),
            ({"shares": "40", "members": 1}, {"shares": "100", "members": 1}, False),
        )

    def test_the_listing_reads_any_number_of_resolutions_in_the_same_number_of_queries(self):
        self.cast(self.holder.user, BallotChoice.FOR)
        first, one = self.queries_listing(self.holder.user)
        for choice in (BallotChoice.AGAINST, BallotChoice.ABSTAIN, BallotChoice.FOR):
            self.cast(self.holder.user, choice, a_resolution(self.world))
        published(self.world)
        self.closed()

        second, many = self.queries_listing(self.holder.user)

        self.assertEqual((len(one), len(many)), (1, 5))
        self.assertEqual(sum(row["myBallot"] is not None for row in many), 4)
        self.assertEqual(sum(row["result"] is not None for row in many), 1)
        self.assertEqual(second, first)

    def test_casting_is_throttled_per_member_and_the_listing_is_not(self):
        cache.clear()
        self.addCleanup(cache.clear)
        with patch.dict(ScopedRateThrottle.THROTTLE_RATES, {"ballot": "2/min"}):
            answers = [self.cast(self.holder.user).status_code for _ in range(3)]
            elsewhere = self.cast(self.other.user).status_code
            self.client.force_authenticate(self.holder.user)
            listed = [self.client.get(LISTING).status_code for _ in range(3)]

        self.assertEqual((answers, elsewhere, listed), ([200, 400, 429], 200, [200, 200, 200]))
        self.assertEqual(PublicationEvent.objects.count(), 2)
