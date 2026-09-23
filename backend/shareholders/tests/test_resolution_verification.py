import json
from io import StringIO
from uuid import uuid4

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connections
from django.test import TestCase

from shared.db import atomic, current_alias
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.exceptions import PublicationIntegrityError
from shareholders.models import BallotChoice, PublicationEvent, PublicationRecipient
from shareholders.services.publications import verify_roll
from shareholders.services.resolutions import (
    BALLOT_OFF_THE_ROLL,
    BALLOT_TWICE,
    CHAIN_BROKEN,
    EVENT_AFTER_CLOSE,
    EVENT_ELSEWHERE,
    TALLY_DIFFERS,
    cast_ballot,
    close_resolution,
    verify_publication,
)
from shareholders.tests.fixtures import (
    REHASH,
    a_company_with_members,
    a_resolution,
    published,
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
            cast_ballot(holder.user, self.resolution.pk, choice)
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

    def test_an_open_resolution_verifies_with_no_tally_yet(self):
        self.assertEqual(
            verify_publication(self.resolution.pk),
            {"events": 3, "head_hash": self.third.entry_hash, "ballots": 3, "tally": None},
        )

    def test_a_rewritten_choice_no_longer_matches_its_hash(self):
        the_chain_is_rewritten(
            ("UPDATE shareholders_publicationevent SET choice = 'against' WHERE uuid = %s", [self.first.pk])
        )

        self.refused(CHAIN_BROKEN)

    def test_a_rewritten_hash_breaks_the_link_to_the_next_event(self):
        the_chain_is_rewritten(
            ("UPDATE shareholders_publicationevent SET choice = 'against' WHERE uuid = %s", [self.first.pk]),
            (REHASH, [self.first.pk]),
        )

        self.refused(CHAIN_BROKEN)

    def test_a_broken_previous_hash_link_is_refused_even_when_the_event_is_rehashed(self):
        the_chain_is_rewritten(
            ("UPDATE shareholders_publicationevent SET previous_hash = %s WHERE uuid = %s", ["a" * 64, self.second.pk]),
            (REHASH, [self.second.pk]),
        )

        self.refused(CHAIN_BROKEN)

    def test_a_deleted_event_leaves_a_sequence_gap(self):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("DELETE FROM shareholders_publicationevent WHERE uuid = %s", [self.second.pk])

        self.refused(CHAIN_BROKEN)

    def test_a_rehashed_ballot_whose_shares_differ_from_the_roll_is_refused(self):
        the_chain_is_rewritten(
            ("UPDATE shareholders_publicationevent SET shares = 1000000 WHERE uuid = %s", [self.third.pk]),
            (REHASH, [self.third.pk]),
        )

        self.refused(BALLOT_OFF_THE_ROLL)

    def test_a_rehashed_ballot_pointing_at_another_resolution_s_roll_is_refused(self):
        other = a_resolution(self.world)
        stranger = PublicationRecipient.objects.filter(publication=other, shares=10).get()
        the_chain_is_rewritten(
            (
                "UPDATE shareholders_publicationevent SET recipient_id = %s WHERE uuid = %s",
                [stranger.pk, self.third.pk],
            ),
            (REHASH, [self.third.pk]),
        )

        self.refused(BALLOT_OFF_THE_ROLL)

    def test_a_rehashed_event_moved_to_another_company_is_refused(self):
        stranger = a_company_with_members("verify-chain-stranger")
        the_chain_is_rewritten(
            (
                "UPDATE shareholders_publicationevent SET company_id = %s WHERE uuid = %s",
                [stranger.company.pk, self.third.pk],
            ),
            (REHASH, [self.third.pk]),
        )

        self.refused(EVENT_ELSEWHERE)

    def test_two_ballots_for_one_member_are_refused_even_when_chained(self):
        row = PublicationRecipient.objects.get(pk=self.first.recipient_id)
        with atomic(), connections[current_alias()].cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
            cursor.execute("DROP INDEX publication_ballot_once")
            PublicationEvent.objects.create(
                publication=self.resolution,
                company=self.world.company,
                kind="ballot",
                recipient=row,
                choice=BallotChoice.AGAINST,
                actor_id=row.user_id,
            )

            self.refused(BALLOT_TWICE)

    def test_a_rehashed_tally_that_differs_from_the_ballots_is_refused(self):
        close = self.closed()
        forged = {**close.payload, "carried": False}
        the_chain_is_rewritten(
            ("UPDATE shareholders_publicationevent SET payload = %s WHERE uuid = %s", [json.dumps(forged), close.pk]),
            (REHASH, [close.pk]),
        )

        self.refused(TALLY_DIFFERS)

    def test_a_chained_ballot_after_the_close_is_refused(self):
        close = self.closed()
        row = PublicationRecipient.objects.get(publication=self.resolution, user_id=self.world.members[3].user.pk)
        late = uuid4()
        the_chain_is_rewritten(
            (
                "INSERT INTO shareholders_publicationevent (uuid, created_at, updated_at, publication_id, "
                "company_id, sequence, kind, recipient_id, choice, shares, actor_id, staff_entered, authority, "
                "previous_hash, entry_hash) VALUES (%s, now(), now(), %s, %s, 5, 'ballot', %s, 'for', %s, %s, "
                "false, '', %s, '')",
                [late, self.resolution.pk, self.world.company.pk, row.pk, row.shares, row.user_id, close.entry_hash],
            ),
            (REHASH, [late]),
        )

        self.refused(EVENT_AFTER_CLOSE)


class VerifyCommandReportsTheTallyTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("verify-tally")

    def verify(self, **options):
        output = StringIO()
        call_command("publications", "verify", stdout=output, **options)
        return json.loads(output.getvalue())

    def test_the_command_verifies_a_resolution_s_roll_and_chain_and_prints_its_tally(self):
        resolution = a_resolution(self.world)
        cast_ballot(self.world.members[0].user, resolution.pk, BallotChoice.FOR)
        voting_has_closed(resolution)
        close = close_resolution(resolution)
        statement = published(self.world)

        reported = self.verify()

        self.assertEqual(reported[str(resolution.pk)], {**verify_roll(resolution), **verify_publication(resolution.pk)})
        self.assertEqual(reported[str(resolution.pk)]["tally"], close.payload)
        self.assertEqual(reported[str(statement.pk)], verify_roll(statement))

    def test_the_command_names_a_resolution_whose_chain_was_rewritten(self):
        resolution = a_resolution(self.world)
        ballot = cast_ballot(self.world.members[0].user, resolution.pk, BallotChoice.FOR)
        the_chain_is_rewritten(
            ("UPDATE shareholders_publicationevent SET choice = 'abstain' WHERE uuid = %s", [ballot.pk])
        )

        with self.assertRaises(CommandError) as refused:
            self.verify(publication=resolution.pk)

        self.assertIn(str(resolution.pk), str(refused.exception))
