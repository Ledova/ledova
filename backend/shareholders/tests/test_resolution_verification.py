from django.test import TestCase

from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.exceptions import PublicationIntegrityError
from shareholders.models import BallotChoice
from shareholders.services.resolutions import (
    CHAIN_BROKEN,
    cast_ballot,
    close_resolution,
    verify_publication,
)
from shareholders.tests.fixtures import (
    a_company_with_members,
    a_resolution,
    the_chain_is_rewritten,
    voting_has_closed,
)


def refusal(template):
    return template.split("{publication}")[1].split("{")[0].strip()


class VerifyingAResolutionTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("verify-chain", holdings=(100, 40, 10, 5))
        self.resolution = a_resolution(self.world)
        self.first, self.second, self.third = (
            cast_ballot(holder.user, self.resolution.pk, choice)[0]
            for holder, choice in zip(self.world.members, (BallotChoice.FOR, BallotChoice.AGAINST, BallotChoice.FOR))
        )

    def closed(self):
        voting_has_closed(self.resolution)
        return close_resolution(self.resolution)

    def refused(self, template):
        with self.assertRaisesMessage(PublicationIntegrityError, refusal(template)):
            verify_publication(self.resolution.pk)

    def test_an_untouched_chain_verifies_and_reports_its_head_and_tally(self):
        close = self.closed()

        self.assertEqual(
            verify_publication(self.resolution.pk),
            {"events": 4, "head_hash": close.entry_hash, "ballots": 3, "tally": close.payload},
        )
        self.assertTrue(close.payload["carried"])

    def test_a_rewritten_choice_no_longer_matches_its_hash(self):
        the_chain_is_rewritten(
            ("UPDATE shareholders_publicationevent SET choice = 'against' WHERE uuid = %s", [self.first.pk])
        )

        self.refused(CHAIN_BROKEN)
