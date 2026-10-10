from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings
from rest_framework.exceptions import NotFound

from shared.db import atomic, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.test_admin_row_actions import ADMIN_STORAGES
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.models import BallotChoice, PublicationEvent, PublicationEventKind
from shareholders.services.resolutions import (
    cast_ballot,
    close_resolution,
    verify_publication,
)
from shareholders.tests.fixtures import (
    a_company_with_members,
    a_person,
    a_resolution,
    voting_has_closed,
)


@override_settings(STORAGES=ADMIN_STORAGES)
class ScopedResolutionTest(RunsOnTheScopedConnection, StubUploadDependencies, TransactionTestCase):
    def setUp(self):
        with use_operator():
            self.here = a_company_with_members("scoped-vote-here", holdings=(100, 40))
            self.there = a_company_with_members("scoped-vote-there")
            self.resolution = a_resolution(self.here)
            self.theirs = a_resolution(self.there)

    def voted_and_closed(self):
        first, second = self.here.members
        with use_operator():
            self.ballots = {
                first.user.pk: cast_ballot(first.user, self.resolution.pk, BallotChoice.FOR)[0],
                second.user.pk: cast_ballot(second.user, self.resolution.pk, BallotChoice.AGAINST)[0],
                self.there.members[0].user.pk: cast_ballot(
                    self.there.members[0].user, self.theirs.pk, BallotChoice.ABSTAIN
                )[0],
            }
        voting_has_closed(self.resolution)
        voting_has_closed(self.theirs)
        with use_operator():
            self.closes = {
                self.here.company.pk: close_resolution(self.resolution),
                self.there.company.pk: close_resolution(self.theirs),
            }

    def test_a_member_casts_under_the_policies_and_the_ballot_is_written_on_the_operator_connection(self):
        holder = self.here.members[0]
        self.the_principal_the_middleware_would_set(holder.user)

        ballot = cast_ballot(holder.user, self.resolution.pk, BallotChoice.FOR)[0]

        self.assertEqual(ballot._state.db, "operator")
        with atomic():
            self.assertEqual(list(PublicationEvent.objects.values_list("pk", flat=True)), [ballot.pk])

    def test_a_member_of_another_company_cannot_cast_on_this_company_s_resolution(self):
        stranger = self.there.members[0]
        self.the_principal_the_middleware_would_set(stranger.user)

        with self.assertRaises(NotFound):
            cast_ballot(stranger.user, self.resolution.pk, BallotChoice.FOR)

        with use_operator():
            self.assertFalse(PublicationEvent.objects.exists())

    def test_a_principal_on_no_roll_reads_nothing(self):
        self.voted_and_closed()
        with use_operator():
            stranger = a_person("scoped-vote-stranger", "Passing Stranger")[0]
        self.the_principal_the_middleware_would_set(stranger)

        with atomic():
            self.assertFalse(PublicationEvent.objects.exists())
        self.no_principal_is_set()
        with atomic():
            self.assertFalse(PublicationEvent.objects.exists())

    def test_the_app_role_can_neither_write_rewrite_nor_delete_an_event(self):
        self.voted_and_closed()
        holder = self.here.members[0]
        own = self.ballots[holder.user.pk]
        self.the_principal_the_middleware_would_set(holder.user)

        with self.assertRaises(DatabaseError), atomic():
            PublicationEvent.objects.create(
                publication_id=self.resolution.pk,
                company_id=self.here.company.pk,
                kind=PublicationEventKind.BALLOT,
                recipient_id=own.recipient_id,
                choice=BallotChoice.AGAINST,
                actor_id=holder.user.pk,
            )
        with self.assertRaises(DatabaseError), atomic():
            PublicationEvent.objects.filter(pk=own.pk).update(choice=BallotChoice.AGAINST)
        with atomic():
            removed, _ = PublicationEvent.objects.filter(pk=own.pk).delete()

        self.assertEqual(removed, 0)
        with use_operator():
            self.assertEqual(PublicationEvent.objects.get(pk=own.pk).choice, BallotChoice.FOR)
            self.assertEqual(verify_publication(self.resolution.pk)["events"], 3)
