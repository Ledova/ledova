import time
from concurrent.futures import ThreadPoolExecutor
from queue import Queue
from threading import Barrier

from django.conf import settings
from django.db import DatabaseError, IntegrityError, connections
from django.test import TransactionTestCase, override_settings
from rest_framework.exceptions import NotFound

from shared.db import (
    APP_ALIAS,
    atomic,
    current_alias,
    set_principal,
    use_migrate,
    use_operator,
)
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.test_admin_row_actions import ADMIN_STORAGES
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.models import (
    BallotChoice,
    PublicationEvent,
    PublicationEventKind,
    PublicationRecipient,
)
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

BLOCKED = "SELECT bool_and(cardinality(pg_blocking_pids(pid)) > 0) FROM unnest(%s::int[]) AS pid"


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
                first.user.pk: cast_ballot(first.user, self.resolution.pk, BallotChoice.FOR),
                second.user.pk: cast_ballot(second.user, self.resolution.pk, BallotChoice.AGAINST),
                self.there.members[0].user.pk: cast_ballot(
                    self.there.members[0].user, self.theirs.pk, BallotChoice.ABSTAIN
                ),
            }
        voting_has_closed(self.resolution)
        voting_has_closed(self.theirs)
        with use_operator():
            self.closes = {
                self.here.company.pk: close_resolution(self.resolution),
                self.there.company.pk: close_resolution(self.theirs),
            }

    def racing(self, *jobs):
        started = Queue()
        lined_up = Barrier(len(jobs))

        def run(job):
            try:
                with use_operator(), connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid(), current_user")
                    started.put(cursor.fetchone())
                lined_up.wait(timeout=10)
                return job()
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=len(jobs)) as pool:
            with use_migrate(), atomic(), connections[current_alias()].cursor() as cursor:
                cursor.execute("LOCK TABLE shareholders_publicationevent IN SHARE MODE")
                futures = [pool.submit(run, job) for job in jobs]
                workers = [started.get(timeout=10) for _ in jobs]
                self.assertEqual({role for _, role in workers}, {settings.RLS_ROLES["operator"]})
                self.assertEqual(len({pid for pid, _ in workers}), len(jobs))
                deadline = time.monotonic() + 10
                blocked = False
                while not blocked and time.monotonic() < deadline:
                    cursor.execute(BLOCKED, [[pid for pid, _ in workers]])
                    blocked = cursor.fetchone()[0]
                    if not blocked:
                        time.sleep(0.02)
                self.assertTrue(blocked, "The two writers never reached the event chain together")
            return [future.result(timeout=30) for future in futures]

    def a_member_casting(self, holder, choice):
        def cast():
            set_principal(holder.user.pk, APP_ALIAS)
            return cast_ballot(holder.user, self.resolution.pk, choice).pk

        return cast

    def test_two_members_casting_at_once_leave_consecutive_sequences_and_a_chain_that_verifies(self):
        first, second = self.here.members

        cast = self.racing(
            self.a_member_casting(first, BallotChoice.FOR), self.a_member_casting(second, BallotChoice.AGAINST)
        )

        with use_operator():
            recorded = PublicationEvent.objects.filter(pk__in=cast).order_by("sequence")
            self.assertEqual([event.sequence for event in recorded], [1, 2])
            self.assertEqual(recorded[1].previous_hash, recorded[0].entry_hash)
            self.assertEqual(
                sorted((event.actor_id, event.choice) for event in recorded),
                sorted([(first.user.pk, "for"), (second.user.pk, "against")]),
            )
            verified = verify_publication(self.resolution.pk)
        self.assertEqual((verified["events"], verified["ballots"]), (2, 2))
        self.assertEqual(verified["head_hash"], recorded[1].entry_hash)

    def test_two_closes_at_once_record_one_close_and_both_return_it(self):
        voting_has_closed(self.resolution)

        def close():
            with use_operator():
                return close_resolution(self.resolution).pk

        closed = self.racing(close, close)

        self.assertEqual(len(set(closed)), 1)
        with use_operator():
            self.assertEqual(PublicationEvent.objects.filter(publication=self.resolution).count(), 1)
            self.assertEqual(verify_publication(self.resolution.pk)["events"], 1)

    def test_a_member_casts_under_the_policies_and_the_ballot_is_written_on_the_operator_connection(self):
        holder = self.here.members[0]
        self.the_principal_the_middleware_would_set(holder.user)

        ballot = cast_ballot(holder.user, self.resolution.pk, BallotChoice.FOR)

        self.assertEqual(ballot._state.db, "operator")
        with atomic():
            self.assertEqual(list(PublicationEvent.objects.values_list("pk", flat=True)), [ballot.pk])

    def test_the_roll_row_is_the_one_the_policies_admit_so_no_member_casts_another_s_ballot(self):
        holder, other = self.here.members
        self.the_principal_the_middleware_would_set(holder.user)

        with self.assertRaises(NotFound):
            cast_ballot(other.user, self.resolution.pk, BallotChoice.FOR)

        with use_operator():
            self.assertFalse(PublicationEvent.objects.exists())

    def test_the_company_owner_cannot_cast_in_a_member_s_name_though_it_reads_the_whole_roll(self):
        holder = self.here.members[0]
        self.the_principal_the_middleware_would_set(self.here.owner)
        with atomic():
            self.assertEqual(
                PublicationRecipient.objects.filter(publication=self.resolution, user_id=holder.user.pk).count(), 1
            )

        with self.assertRaises(NotFound):
            cast_ballot(holder.user, self.resolution.pk, BallotChoice.FOR)

        with use_operator():
            self.assertFalse(PublicationEvent.objects.exists())

    def test_a_member_of_another_company_cannot_cast_on_this_company_s_resolution(self):
        stranger = self.there.members[0]
        self.the_principal_the_middleware_would_set(stranger.user)

        with self.assertRaises(NotFound):
            cast_ballot(stranger.user, self.resolution.pk, BallotChoice.FOR)

        with use_operator():
            self.assertFalse(PublicationEvent.objects.exists())

    def test_a_member_reads_their_own_ballot_and_the_close_and_no_other_member_s_ballot(self):
        self.voted_and_closed()
        holder, other = self.here.members
        self.the_principal_the_middleware_would_set(holder.user)

        with atomic():
            visible = set(PublicationEvent.objects.values_list("pk", flat=True))

        self.assertEqual(visible, {self.ballots[holder.user.pk].pk, self.closes[self.here.company.pk].pk})
        self.assertNotIn(self.ballots[other.user.pk].pk, visible)

    def test_a_member_of_another_company_reads_none_of_this_company_s_events(self):
        self.voted_and_closed()
        stranger = self.there.members[0]
        self.the_principal_the_middleware_would_set(stranger.user)

        with atomic():
            visible = set(PublicationEvent.objects.values_list("pk", flat=True))
            mine = set(PublicationEvent.objects.filter(publication=self.resolution).values_list("pk", flat=True))

        self.assertEqual(visible, {self.ballots[stranger.user.pk].pk, self.closes[self.there.company.pk].pk})
        self.assertEqual(mine, set())

    def test_the_company_reads_its_own_close_and_no_ballot_and_nothing_of_another_company(self):
        self.voted_and_closed()
        self.the_principal_the_middleware_would_set(self.here.owner)

        with atomic():
            visible = list(PublicationEvent.objects.values_list("pk", "kind"))

        self.assertEqual(visible, [(self.closes[self.here.company.pk].pk, PublicationEventKind.CLOSE)])

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

    def test_an_operator_insert_of_a_member_s_ballot_by_anyone_else_is_refused_by_the_database(self):
        holder, other = self.here.members
        with use_operator():
            row = PublicationRecipient.objects.get(publication=self.resolution, user_id=holder.user.pk)
            for actor in (other.user.pk, self.here.owner.pk, self.here.staff.pk):
                with self.subTest(actor=actor):
                    with self.assertRaisesMessage(IntegrityError, "A member casts only their own ballot"), atomic():
                        PublicationEvent.objects.create(
                            publication_id=self.resolution.pk,
                            company_id=self.here.company.pk,
                            kind=PublicationEventKind.BALLOT,
                            recipient_id=row.pk,
                            choice=BallotChoice.FOR,
                            actor_id=actor,
                        )
            self.assertFalse(PublicationEvent.objects.exists())
