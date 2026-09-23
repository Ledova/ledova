from datetime import timedelta
from uuid import uuid4

from django.db import DatabaseError, IntegrityError, connections
from django.test import TestCase
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError

from shared.db import atomic, current_alias
from shared.tests.test_admin_row_actions import staff_user
from shared.tests.under_the_policies import what_the_policies_admit_to
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.models import (
    BallotChoice,
    Publication,
    PublicationEvent,
    PublicationEventKind,
    PublicationKind,
    PublicationRecipient,
    ResolutionKind,
    VoteBasis,
)
from shareholders.services.publications import (
    CLOSES_IN_THE_PAST,
    NO_QUESTION,
    NO_WINDOW,
    ONLY_A_RESOLUTION_VOTES,
    UNKNOWN_RESOLUTION_KIND,
    WINDOW_BACKWARDS,
)
from shareholders.services.resolutions import (
    ALREADY_CAST,
    NO_BALLOT_AUTHORITY,
    NOT_A_RESOLUTION,
    NOT_ON_THE_ROLL,
    NOT_OPEN_YET,
    ONLY_STAFF,
    STILL_OPEN,
    UNKNOWN_CHOICE,
    VOTING_CLOSED,
    cast_ballot,
    close_due_resolutions,
    close_resolution,
    enter_ballot,
)
from shareholders.tasks.resolutions import close_resolutions_past_their_window
from shareholders.tests.fixtures import (
    DAY,
    QUESTION,
    a_company_with_members,
    a_member,
    a_person,
    a_resolution,
    a_treasury_address,
    published,
    the_chain_is_rewritten,
    voting_has_closed,
    voting_has_not_opened,
)
from tokens.models import RegisterEntryKind
from tokens.services.register_events import record_entry
from whitelist.models import HolderType

ZEROS = "0" * 64


def hash_of(event):
    with connections[current_alias()].cursor() as cursor:
        cursor.execute(
            "SELECT shareholders_publication_event_hash(shareholders_publicationevent) "
            "FROM shareholders_publicationevent WHERE uuid = %s",
            [event.pk],
        )
        return cursor.fetchone()[0]


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

    def test_a_document_carries_no_question_and_no_window(self):
        statement = published(self.world)

        self.assertEqual(
            (statement.question, statement.resolution_kind, statement.vote_basis, statement.opens_at),
            ("", "", "", None),
        )

    def test_publishing_refuses_a_resolution_it_could_not_count(self):
        now = timezone.now()
        for refusal, changes in (
            (NO_QUESTION, {"question": " \n"}),
            (UNKNOWN_RESOLUTION_KIND, {"resolution_kind": "unanimous"}),
            (UNKNOWN_RESOLUTION_KIND, {"resolution_kind": ""}),
            (NO_WINDOW, {"opens_at": None}),
            (NO_WINDOW, {"closes_at": None}),
            (WINDOW_BACKWARDS, {"opens_at": now + timedelta(days=2), "closes_at": now + timedelta(days=1)}),
            (WINDOW_BACKWARDS, {"opens_at": now + timedelta(days=1), "closes_at": now + timedelta(days=1)}),
            (CLOSES_IN_THE_PAST, {"opens_at": now - timedelta(days=2), "closes_at": now - timedelta(minutes=1)}),
        ):
            with self.subTest(refusal=refusal, changes=changes):
                with self.assertRaisesMessage(ValidationError, refusal), atomic():
                    a_resolution(self.world, **changes)
        self.assertFalse(Publication.objects.exists())

    def test_a_document_kind_refuses_a_question_or_a_window(self):
        for changes in (
            {"question": QUESTION},
            {"resolution_kind": ResolutionKind.ORDINARY},
            {"opens_at": timezone.now()},
            {"closes_at": timezone.now() + timedelta(days=1)},
        ):
            with self.subTest(changes=changes):
                with self.assertRaisesMessage(ValidationError, ONLY_A_RESOLUTION_VOTES), atomic():
                    published(self.world, **changes)
        self.assertFalse(Publication.objects.exists())

    def test_the_database_refuses_a_resolution_without_its_question_or_window_and_a_document_with_one(self):
        resolution = a_resolution(self.world)
        statement = published(self.world)
        for publication, column, value in (
            (resolution, "question", "  "),
            (resolution, "vote_basis", "per_member"),
            (resolution, "resolution_kind", ""),
            (resolution, "closes_at", resolution.opens_at),
            (resolution, "opens_at", None),
            (statement, "question", QUESTION),
            (statement, "closes_at", timezone.now()),
        ):
            with self.subTest(column=column, kind=publication.kind):
                with self.assertRaisesMessage(IntegrityError, "publication_resolution_states_its_question"), atomic():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
                        cursor.execute(
                            "ALTER TABLE shareholders_publication DISABLE TRIGGER shareholders_publication_is_frozen"
                        )
                        cursor.execute(
                            f"UPDATE shareholders_publication SET {column} = %s WHERE uuid = %s",
                            [value, publication.pk],
                        )


class CastingABallotTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("cast", holdings=(100, 40))
        self.resolution = a_resolution(self.world)
        self.first, self.second = self.world.members

    def roll_row(self, holder):
        return PublicationRecipient.objects.get(publication=self.resolution, user_id=holder.user.pk)

    def test_a_member_casts_their_own_ballot_and_the_database_chains_it(self):
        ballot = cast_ballot(self.first.user, self.resolution.pk, BallotChoice.FOR)

        self.assertEqual(
            (ballot.sequence, ballot.kind, ballot.recipient_id, ballot.choice, ballot.actor_id, ballot.staff_entered),
            (1, PublicationEventKind.BALLOT, self.roll_row(self.first).pk, "for", self.first.user.pk, False),
        )
        self.assertEqual(int(ballot.shares), 100)
        self.assertEqual((ballot.previous_hash, ballot.company_id), (ZEROS, self.world.company.pk))
        self.assertEqual(ballot.entry_hash, hash_of(ballot))
        self.assertIsNone(ballot.payload)

    def test_each_ballot_chains_to_the_one_before(self):
        first = cast_ballot(self.first.user, self.resolution.pk, BallotChoice.FOR)
        second = cast_ballot(self.second.user, self.resolution.pk, BallotChoice.AGAINST)

        self.assertEqual((second.sequence, second.previous_hash), (2, first.entry_hash))
        self.assertEqual(int(second.shares), 40)
        self.assertNotEqual(first.entry_hash, second.entry_hash)

    def test_a_second_ballot_is_refused_clearly_and_the_first_stands(self):
        cast_ballot(self.first.user, self.resolution.pk, BallotChoice.FOR)

        with self.assertRaisesMessage(ValidationError, ALREADY_CAST):
            cast_ballot(self.first.user, self.resolution.pk, BallotChoice.AGAINST)

        self.assertEqual(list(PublicationEvent.objects.values_list("choice", flat=True)), ["for"])

    def test_a_ballot_outside_the_window_is_refused_clearly(self):
        for move, refusal in ((voting_has_not_opened, NOT_OPEN_YET), (voting_has_closed, VOTING_CLOSED)):
            with self.subTest(refusal=refusal):
                move(self.resolution)
                with self.assertRaisesMessage(ValidationError, refusal):
                    cast_ballot(self.first.user, self.resolution.pk, BallotChoice.FOR)
        self.assertFalse(PublicationEvent.objects.exists())

    def test_a_choice_the_ballot_does_not_offer_is_refused(self):
        with self.assertRaisesMessage(ValidationError, UNKNOWN_CHOICE):
            cast_ballot(self.first.user, self.resolution.pk, "yes")

        self.assertFalse(PublicationEvent.objects.exists())

    def test_a_caller_with_no_roll_row_gets_the_same_404_as_a_resolution_that_does_not_exist(self):
        elsewhere = a_company_with_members("cast-elsewhere")
        stranger = a_person("cast-stranger", "Passing Stranger")[0]
        statement = published(self.world)
        refusals = []
        for user, publication_id in (
            (stranger, self.resolution.pk),
            (elsewhere.members[0].user, self.resolution.pk),
            (self.world.owner, self.resolution.pk),
            (self.world.staff, self.resolution.pk),
            (self.first.user, statement.pk),
            (self.first.user, uuid4()),
        ):
            with self.subTest(user=user.pk, publication=publication_id), self.assertRaises(NotFound) as refused:
                cast_ballot(user, publication_id, BallotChoice.FOR)
            refusals.append(refused.exception.detail)

        self.assertEqual(len(set(refusals)), 1)
        self.assertFalse(PublicationEvent.objects.exists())

    def test_the_ballot_carries_the_frozen_holding_rather_than_the_holding_today(self):
        record_entry(
            register_id=self.world.register.pk,
            operation_id=uuid4(),
            kind=RegisterEntryKind.ISSUE,
            changes=[{"member": str(self.first.member.pk), "shares": "900"}],
            effective_on=DAY,
            recorded_by=self.world.owner,
        )

        ballot = cast_ballot(self.first.user, self.resolution.pk, BallotChoice.FOR)

        self.assertEqual(int(ballot.shares), 100)

    def test_shares_python_supplies_are_replaced_by_the_roll_s(self):
        ballot = PublicationEvent.objects.create(
            publication=self.resolution,
            company=self.world.company,
            kind=PublicationEventKind.BALLOT,
            recipient=self.roll_row(self.first),
            choice=BallotChoice.FOR,
            shares=999999,
            actor_id=self.first.user.pk,
            previous_hash="f" * 64,
            entry_hash="e" * 64,
        )
        ballot.refresh_from_db()

        self.assertEqual((int(ballot.shares), ballot.sequence, ballot.previous_hash), (100, 1, ZEROS))
        self.assertEqual(ballot.entry_hash, hash_of(ballot))


class StaffEnteredBallotTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("staff-ballot")
        treasury = a_member(self.world.company, a_treasury_address("Company treasury"))
        record_entry(
            register_id=self.world.register.pk,
            operation_id=uuid4(),
            kind=RegisterEntryKind.ISSUE,
            changes=[{"member": str(treasury.pk), "shares": "25"}],
            effective_on=DAY,
            recorded_by=self.world.owner,
        )
        self.resolution = a_resolution(self.world)
        self.treasury = PublicationRecipient.objects.get(publication=self.resolution, member_id=treasury.pk)
        self.clerk = staff_user(f"ballot-clerk-{uuid4().hex[:8]}")

    def test_a_member_the_register_cannot_name_votes_only_through_staff_entry(self):
        self.assertEqual((self.treasury.user_id, self.treasury.holder_type), (None, HolderType.TREASURY))

        ballot = enter_ballot(self.clerk, self.resolution, self.treasury, BallotChoice.AGAINST, " Proxy form P-17 ")

        self.assertEqual(
            (ballot.staff_entered, ballot.actor_id, ballot.authority, int(ballot.shares), ballot.choice),
            (True, self.clerk.pk, "Proxy form P-17", 25, "against"),
        )

    def test_a_proxy_for_a_member_with_an_account_is_entered_by_staff_and_the_member_cannot_vote_again(self):
        holder = self.world.members[0]
        row = PublicationRecipient.objects.get(publication=self.resolution, user_id=holder.user.pk)

        enter_ballot(self.clerk, self.resolution, row, BallotChoice.FOR, "Proxy appointing the chair, P-18")

        with self.assertRaisesMessage(ValidationError, ALREADY_CAST):
            cast_ballot(holder.user, self.resolution.pk, BallotChoice.AGAINST)
        with self.assertRaisesMessage(ValidationError, ALREADY_CAST):
            enter_ballot(self.clerk, self.resolution, row, BallotChoice.AGAINST, "A second proxy")

    def test_staff_entry_refuses_what_it_cannot_stand_behind(self):
        other = a_resolution(self.world)
        elsewhere = PublicationRecipient.objects.filter(publication=other).first()
        statement = published(self.world)
        for refusal, error, arguments in (
            (NO_BALLOT_AUTHORITY, ValidationError, (self.clerk, self.resolution, self.treasury, "for", " ")),
            (NOT_ON_THE_ROLL, ValidationError, (self.clerk, self.resolution, elsewhere, "for", "Proxy P-19")),
            (NOT_A_RESOLUTION, ValidationError, (self.clerk, statement, self.treasury, "for", "Proxy P-19")),
            (UNKNOWN_CHOICE, ValidationError, (self.clerk, self.resolution, self.treasury, "maybe", "Proxy P-19")),
            (ONLY_STAFF, PermissionDenied, (self.world.owner, self.resolution, self.treasury, "for", "Proxy P-19")),
        ):
            with self.subTest(refusal=refusal), self.assertRaisesMessage(error, refusal):
                enter_ballot(*arguments)
        self.assertFalse(PublicationEvent.objects.exists())

    def test_staff_entry_is_refused_once_voting_has_closed(self):
        voting_has_closed(self.resolution)

        with self.assertRaisesMessage(ValidationError, VOTING_CLOSED):
            enter_ballot(self.clerk, self.resolution, self.treasury, BallotChoice.FOR, "Proxy P-20")


class TheDatabaseOwnsTheBallotTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("owns")
        treasury = a_member(self.world.company, a_treasury_address("Owned treasury"))
        record_entry(
            register_id=self.world.register.pk,
            operation_id=uuid4(),
            kind=RegisterEntryKind.ISSUE,
            changes=[{"member": str(treasury.pk), "shares": "3"}],
            effective_on=DAY,
            recorded_by=self.world.owner,
        )
        self.resolution = a_resolution(self.world)
        self.holder, self.other = self.world.members
        self.row = PublicationRecipient.objects.get(publication=self.resolution, user_id=self.holder.user.pk)
        self.others_row = PublicationRecipient.objects.get(publication=self.resolution, user_id=self.other.user.pk)
        self.unnamed = PublicationRecipient.objects.get(publication=self.resolution, member_id=treasury.pk)

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

    def test_a_row_the_trigger_admits_is_inserted_so_the_refusals_below_discriminate(self):
        self.insert()

        self.assertEqual(PublicationEvent.objects.count(), 1)

    def test_a_ballot_that_is_not_staff_entered_is_refused_unless_its_actor_is_the_member_the_roll_names(self):
        for changes in (
            {"actor_id": self.other.user.pk},
            {"actor_id": self.world.owner.pk},
            {"actor_id": self.world.staff.pk},
            {"recipient": self.others_row},
            {"recipient": self.unnamed},
            {"recipient": self.unnamed, "actor_id": None},
        ):
            with self.subTest(changes=changes):
                with self.assertRaisesMessage(IntegrityError, "A member casts only their own ballot"):
                    self.insert(**changes)
        self.assertFalse(PublicationEvent.objects.exists())

    def test_a_staff_entered_ballot_needs_an_active_staff_actor_and_its_authority(self):
        retired = staff_user(f"retired-clerk-{uuid4().hex[:8]}")
        retired.is_active = False
        retired.save(update_fields=["is_active"])
        for changes in (
            {"staff_entered": True, "authority": "Proxy P-21", "actor_id": self.holder.user.pk},
            {"staff_entered": True, "authority": "Proxy P-21", "actor_id": retired.pk},
        ):
            with self.subTest(changes=changes):
                with self.assertRaisesMessage(IntegrityError, "A staff-entered ballot names its authority"):
                    self.insert(**changes)
        with self.assertRaisesMessage(IntegrityError, "A staff-entered ballot names its authority"):
            self.insert(staff_entered=True, authority=" ", actor_id=self.world.staff.pk)
        with self.assertRaisesMessage(IntegrityError, "publication_event_staff_entry_names_its_authority"):
            self.insert(authority="Proxy P-22")

    def test_the_trigger_refuses_a_ballot_off_the_roll_on_a_document_or_under_another_company(self):
        other = a_resolution(self.world)
        stranger = a_company_with_members("owns-stranger")
        statement = published(self.world)
        for message, changes in (
            ("A ballot is cast for a member on this resolution's roll", {"publication": other}),
            ("Only a resolution records ballots", {"publication": statement}),
            ("Only a resolution records ballots", {"company": stranger.company}),
        ):
            with self.subTest(changes=changes), self.assertRaisesMessage(IntegrityError, message):
                self.insert(**changes)

    def test_the_chain_cannot_be_rewritten(self):
        ballot = self.insert()

        with self.assertRaisesMessage(DatabaseError, "A resolution's record cannot be rewritten"), atomic():
            PublicationEvent.objects.filter(pk=ballot.pk).update(choice=BallotChoice.AGAINST)

        self.assertEqual(PublicationEvent.objects.get(pk=ballot.pk).choice, BallotChoice.FOR)


class ClosingAResolutionTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("close", holdings=(100, 40))
        self.resolution = a_resolution(self.world)

    def test_a_resolution_cannot_close_before_its_window_has_passed(self):
        with self.assertRaisesMessage(ValidationError, STILL_OPEN):
            close_resolution(self.resolution)

        self.assertFalse(PublicationEvent.objects.exists())

    def test_the_close_is_chained_after_the_ballots_and_carries_the_tally_the_database_computed(self):
        first = cast_ballot(self.world.members[0].user, self.resolution.pk, BallotChoice.FOR)
        voting_has_closed(self.resolution)

        close = close_resolution(self.resolution)

        self.assertEqual((close.sequence, close.previous_hash, close.kind), (2, first.entry_hash, "close"))
        self.assertEqual((close.recipient_id, close.shares, close.actor_id, close.choice), (None, None, None, ""))
        self.assertEqual(close.entry_hash, hash_of(close))
        self.assertEqual(
            close.payload,
            {
                "basis": "per_share",
                "resolution_kind": "ordinary",
                "for": {"shares": "100", "members": 1},
                "against": {"shares": "0", "members": 0},
                "abstain": {"shares": "0", "members": 0},
                "eligible": {"shares": "140", "members": 2},
                "carried": True,
            },
        )

    def test_a_payload_python_supplies_is_replaced_by_the_one_the_database_computes(self):
        voting_has_closed(self.resolution)

        close = PublicationEvent.objects.create(
            publication=self.resolution,
            company=self.world.company,
            kind=PublicationEventKind.CLOSE,
            payload={"carried": True, "for": {"shares": "1000000", "members": 9}},
        )
        close.refresh_from_db()

        self.assertFalse(close.payload["carried"])
        self.assertEqual(close.payload["for"], {"shares": "0", "members": 0})

    def test_a_resolution_closes_once_and_a_second_close_returns_the_first(self):
        voting_has_closed(self.resolution)
        close = close_resolution(self.resolution)

        self.assertEqual(close_resolution(self.resolution).pk, close.pk)
        with self.assertRaisesMessage(IntegrityError, "A resolution closes once"), atomic():
            PublicationEvent.objects.create(
                publication=self.resolution, company=self.world.company, kind=PublicationEventKind.CLOSE
            )
        self.assertEqual(PublicationEvent.objects.filter(kind=PublicationEventKind.CLOSE).count(), 1)

    def test_the_one_close_per_resolution_is_also_a_unique_index_the_trigger_cannot_be_disabled_around(self):
        voting_has_closed(self.resolution)
        close = close_resolution(self.resolution)

        with self.assertRaisesMessage(IntegrityError, "publication_closes_once"):
            the_chain_is_rewritten(
                (
                    "INSERT INTO shareholders_publicationevent (uuid, created_at, updated_at, publication_id, "
                    "company_id, sequence, kind, choice, staff_entered, authority, payload, previous_hash, "
                    "entry_hash) VALUES (%s, now(), now(), %s, %s, 2, 'close', '', false, '', %s, %s, '')",
                    [uuid4(), self.resolution.pk, self.world.company.pk, '{"carried": false}', close.entry_hash],
                )
            )

    def test_no_ballot_is_taken_after_the_close(self):
        voting_has_closed(self.resolution)
        close_resolution(self.resolution)
        row = PublicationRecipient.objects.filter(publication=self.resolution).first()

        with self.assertRaisesMessage(IntegrityError, "This resolution has closed and takes no more ballots"):
            with atomic():
                PublicationEvent.objects.create(
                    publication=self.resolution,
                    company=self.world.company,
                    kind=PublicationEventKind.BALLOT,
                    recipient=row,
                    choice=BallotChoice.FOR,
                    actor_id=row.user_id,
                )
        with self.assertRaisesMessage(ValidationError, VOTING_CLOSED):
            cast_ballot(self.world.members[0].user, self.resolution.pk, BallotChoice.FOR)

    def test_the_job_closes_every_resolution_past_its_window_once(self):
        due = a_resolution(self.world)
        voting_has_closed(due)
        open_one = self.resolution
        statement = published(self.world)

        self.assertEqual(close_resolutions_past_their_window(), {"resolutions_closed": 1})
        self.assertEqual(close_due_resolutions(), 0)

        self.assertEqual(list(PublicationEvent.objects.values_list("publication_id", "kind")), [(due.pk, "close")])
        self.assertFalse(PublicationEvent.objects.filter(publication__in=[open_one, statement]).exists())


class WhoReadsTheChainTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("chain-readers")
        self.elsewhere = a_company_with_members("chain-readers-elsewhere")
        self.resolution = a_resolution(self.world)
        self.theirs = a_resolution(self.elsewhere)
        self.holder, self.other = self.world.members
        self.own = cast_ballot(self.holder.user, self.resolution.pk, BallotChoice.FOR)
        self.others = cast_ballot(self.other.user, self.resolution.pk, BallotChoice.AGAINST)
        cast_ballot(self.elsewhere.members[0].user, self.theirs.pk, BallotChoice.FOR)
        voting_has_closed(self.resolution)
        voting_has_closed(self.theirs)
        self.close = close_resolution(self.resolution)
        self.their_close = close_resolution(self.theirs)

    def admitted(self, user):
        return set(what_the_policies_admit_to(user, PublicationEvent).values_list("pk", flat=True))

    def test_a_member_reads_their_own_ballot_and_the_close_of_a_resolution_they_are_on_the_roll_of(self):
        self.assertEqual(self.admitted(self.holder.user), {self.own.pk, self.close.pk})

    def test_the_company_reads_its_own_close_and_no_ballot(self):
        self.assertEqual(self.admitted(self.world.owner), {self.close.pk})

    def test_a_member_of_another_company_and_a_stranger_read_nothing_of_this_resolution(self):
        stranger = a_person("chain-stranger", "Passing Stranger")[0]

        self.assertEqual(self.admitted(self.elsewhere.members[0].user) & {self.own.pk, self.others.pk}, set())
        self.assertNotIn(self.close.pk, self.admitted(self.elsewhere.members[0].user))
        self.assertIn(self.their_close.pk, self.admitted(self.elsewhere.members[0].user))
        self.assertEqual(self.admitted(stranger), set())
