from django.db import DatabaseError
from django.test import TestCase

from shared.db import atomic
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.models import (
    BallotChoice,
    PublicationEvent,
    PublicationEventKind,
    PublicationKind,
    PublicationRecipient,
    ResolutionKind,
    VoteBasis,
)
from shareholders.tests.fixtures import QUESTION, a_company_with_members, a_resolution


class PublishingAResolutionTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("resolve")

    def test_a_resolution_records_its_question_kind_basis_and_window_beside_its_roll_and_document(self):
        resolution = a_resolution(self.world, resolution_kind=ResolutionKind.SPECIAL)

        self.assertEqual(
            (resolution.kind, resolution.question, resolution.resolution_kind, resolution.vote_basis),
            (PublicationKind.RESOLUTION, QUESTION, ResolutionKind.SPECIAL, VoteBasis.PER_SHARE),
        )
        self.assertLess(resolution.opens_at, resolution.closes_at)
        self.assertEqual(resolution.member_rows, 2)
        self.assertEqual(resolution.mime_type, "application/pdf")
        self.assertEqual(len(resolution.digest), 64)


class TheDatabaseOwnsTheBallotTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("owns")
        self.resolution = a_resolution(self.world)
        self.holder, self.other = self.world.members
        self.row = PublicationRecipient.objects.get(publication=self.resolution, user_id=self.holder.user.pk)

    def insert(self, **changes):
        fields = {
            "publication": self.resolution,
            "company": self.world.company,
            "kind": PublicationEventKind.BALLOT,
            "recipient": self.row,
            "choice": BallotChoice.FOR,
            "actor_id": self.holder.user.pk,
            **changes,
        }
        with atomic():
            return PublicationEvent.objects.create(**fields)

    def test_the_chain_cannot_be_rewritten(self):
        ballot = self.insert()

        with self.assertRaisesMessage(DatabaseError, "A publication's record of events cannot be rewritten"), atomic():
            PublicationEvent.objects.filter(pk=ballot.pk).update(choice=BallotChoice.AGAINST)

        self.assertEqual(PublicationEvent.objects.get(pk=ballot.pk).choice, BallotChoice.FOR)
