from django.test import TestCase

from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.models import BallotChoice, ResolutionKind
from shareholders.services.resolutions import (
    cast_ballot,
    close_resolution,
    verify_publication,
)
from shareholders.tests.fixtures import (
    a_company_with_members,
    a_resolution,
    voting_has_closed,
)

FOR = BallotChoice.FOR
AGAINST = BallotChoice.AGAINST
ABSTAIN = BallotChoice.ABSTAIN


class TallyTest(StubUploadDependencies, TestCase):
    def closed(self, resolution_kind, votes):
        world = a_company_with_members(f"tally-{len(votes)}", holdings=tuple(shares for shares, _ in votes))
        resolution = a_resolution(world, resolution_kind=resolution_kind)
        for holder, (_, choice) in zip(world.members, votes):
            if choice is not None:
                cast_ballot(holder.user, resolution.pk, choice)
        voting_has_closed(resolution)
        payload = close_resolution(resolution).payload
        self.assertEqual(verify_publication(resolution.pk)["tally"], payload)
        return payload

    def test_an_ordinary_resolution_is_carried_when_shares_for_exceed_shares_against(self):
        payload = self.closed(ResolutionKind.ORDINARY, [(60, FOR), (50, AGAINST), (500, ABSTAIN), (7, None)])

        self.assertEqual(
            payload,
            {
                "basis": "per_share",
                "resolution_kind": "ordinary",
                "for": {"shares": "60", "members": 1},
                "against": {"shares": "50", "members": 1},
                "abstain": {"shares": "500", "members": 1},
                "eligible": {"shares": "617", "members": 4},
                "carried": True,
            },
        )

    def test_an_ordinary_resolution_is_not_carried_on_a_tie(self):
        payload = self.closed(ResolutionKind.ORDINARY, [(50, FOR), (30, AGAINST), (20, AGAINST)])

        self.assertEqual((payload["for"]["shares"], payload["against"]["shares"]), ("50", "50"))
        self.assertEqual((payload["for"]["members"], payload["against"]["members"]), (1, 2))
        self.assertFalse(payload["carried"])

    def test_an_ordinary_resolution_carried_by_shares_is_carried_against_more_members(self):
        payload = self.closed(ResolutionKind.ORDINARY, [(51, FOR), (25, AGAINST), (25, AGAINST)])

        self.assertTrue(payload["carried"])

    def test_every_member_abstaining_carries_nothing(self):
        for resolution_kind in ResolutionKind.values:
            with self.subTest(resolution_kind=resolution_kind):
                payload = self.closed(resolution_kind, [(10, ABSTAIN), (20, ABSTAIN)])

                self.assertEqual(payload["abstain"], {"shares": "30", "members": 2})
                self.assertFalse(payload["carried"])

    def test_no_ballots_at_all_carries_nothing_and_counts_zero(self):
        for resolution_kind in ResolutionKind.values:
            with self.subTest(resolution_kind=resolution_kind):
                payload = self.closed(resolution_kind, [(10, None), (20, None)])

                for choice in BallotChoice.values:
                    self.assertEqual(payload[choice], {"shares": "0", "members": 0})
                self.assertEqual(payload["eligible"], {"shares": "30", "members": 2})
                self.assertFalse(payload["carried"])

    def test_a_special_resolution_is_carried_at_exactly_three_quarters_of_the_votes_cast(self):
        payload = self.closed(ResolutionKind.SPECIAL, [(75, FOR), (25, AGAINST)])

        self.assertTrue(payload["carried"])

    def test_a_special_resolution_is_not_carried_one_share_short_of_three_quarters(self):
        payload = self.closed(ResolutionKind.SPECIAL, [(299, FOR), (101, AGAINST)])

        self.assertFalse(payload["carried"])

    def test_a_special_resolution_needs_more_than_a_bare_majority(self):
        payload = self.closed(ResolutionKind.SPECIAL, [(74, FOR), (26, AGAINST)])

        self.assertFalse(payload["carried"])

    def test_abstentions_are_not_votes_cast_so_they_cannot_defeat_a_special_resolution(self):
        payload = self.closed(ResolutionKind.SPECIAL, [(75, FOR), (25, AGAINST), (1000, ABSTAIN)])

        self.assertEqual(payload["abstain"], {"shares": "1000", "members": 1})
        self.assertTrue(payload["carried"])

    def test_abstentions_do_not_count_toward_an_ordinary_resolution_either(self):
        payload = self.closed(ResolutionKind.ORDINARY, [(2, FOR), (1, AGAINST), (1000, ABSTAIN)])

        self.assertTrue(payload["carried"])

    def test_a_special_resolution_with_only_votes_for_is_carried(self):
        payload = self.closed(ResolutionKind.SPECIAL, [(1, FOR), (1000, None)])

        self.assertTrue(payload["carried"])
