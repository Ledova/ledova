from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase

from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.constants import PUBLICATION_NOTICE
from shareholders.models import DOCUMENT_KINDS, PublicationKind, PublicationRecipient
from shareholders.services.publications import ANNOUNCEMENTS, notify_the_roll
from shareholders.tests.fixtures import (
    DAY,
    a_company_with_members,
    a_distribution,
    a_member,
    a_resolution,
    a_treasury_address,
    published,
)
from tokens.models import RegisterEntryKind
from tokens.services.register_events import record_entry
from users.models import Notification
from users.tasks.notifications import _send_push_notification


class AnnouncingAPublicationTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("notice")
        self.publication = published(self.world)

    def deferred(self, publication_id=None):
        with patch("users.tasks.notifications.send_push_notification.defer") as defer:
            told = notify_the_roll(publication_id or self.publication.pk)
        return told, [call.kwargs for call in defer.call_args_list]

    def test_every_member_with_an_account_is_told_once_and_the_notice_names_the_publication(self):
        told, notices = self.deferred()

        self.assertEqual(told, 2)
        self.assertEqual(
            sorted(notice["user_id"] for notice in notices), sorted(str(m.user.pk) for m in self.world.members)
        )
        self.assertEqual(
            notices[0]["data"],
            {
                "type": PUBLICATION_NOTICE,
                "event": "published",
                "publication_id": str(self.publication.pk),
                "kind": PublicationKind.HOLDING_STATEMENT.value,
            },
        )
        self.assertEqual(notices[0]["notification_type"], "general")
        self.assertIn(self.world.company.name, notices[0]["body"])
        self.assertIn(self.world.token.name, notices[0]["body"])

    def test_the_notice_carries_no_holding_and_no_document(self):
        _, notices = self.deferred()

        holdings = {str(member.shares) for member in self.world.members}
        for notice in notices:
            self.assertFalse(holdings & set(notice["body"].split()))
            self.assertNotIn("file", notice["data"])
            self.assertNotIn("shares", notice["data"])

    def test_a_meeting_notice_is_announced_in_its_own_words(self):
        meeting = published(self.world, kind=PublicationKind.MEETING_NOTICE, title="Notice of general meeting")

        _, notices = self.deferred(meeting.pk)

        self.assertEqual(notices[0]["data"]["kind"], PublicationKind.MEETING_NOTICE.value)
        self.assertNotEqual(notices[0]["title"], "Your holding statement is ready")

    def test_a_member_the_register_cannot_name_is_on_the_roll_and_is_told_nothing(self):
        treasury = a_member(self.world.company, a_treasury_address("Operator treasury"))
        record_entry(
            register_id=self.world.register.pk,
            operation_id=uuid4(),
            kind=RegisterEntryKind.ISSUE,
            changes=[{"member": str(treasury.pk), "shares": "11"}],
            effective_on=DAY,
            recorded_by=self.world.owner,
        )
        with_treasury = published(self.world, title="A statement including the treasury")

        told, notices = self.deferred(with_treasury.pk)

        self.assertEqual(
            PublicationRecipient.objects.filter(publication=with_treasury).count(), len(self.world.members) + 1
        )
        self.assertEqual(told, len(self.world.members))
        self.assertEqual(len(notices), len(self.world.members))

    def test_a_resolution_is_announced_as_one_put_to_the_members(self):
        resolution = a_resolution(self.world)

        told, notices = self.deferred(resolution.pk)

        self.assertEqual(told, 2)
        self.assertEqual(notices[0]["title"], ANNOUNCEMENTS[PublicationKind.RESOLUTION][0])
        self.assertEqual(notices[0]["data"]["kind"], PublicationKind.RESOLUTION.value)

    def test_a_distribution_is_announced_as_a_declared_dividend_without_the_member_s_entitlement(self):
        distribution = a_distribution(self.world)

        told, notices = self.deferred(distribution.pk)

        self.assertEqual(told, 2)
        self.assertEqual(notices[0]["title"], "A dividend has been declared")
        self.assertEqual(
            notices[0]["body"], f"{self.world.company.name} has declared a dividend on your {self.world.token.name}."
        )
        self.assertEqual(notices[0]["data"]["kind"], PublicationKind.DISTRIBUTION.value)
        self.assertNotIn("entitlement", notices[0]["data"])

    def test_every_kind_a_publication_is_made_as_has_words_to_announce_it(self):
        self.assertEqual(sorted(ANNOUNCEMENTS), sorted(PublicationKind.values))
        self.assertEqual(sorted(DOCUMENT_KINDS), sorted(PublicationKind.values))

    def test_a_publication_that_no_longer_exists_announces_nothing(self):
        told, notices = self.deferred(uuid4())

        self.assertEqual((told, notices), (0, []))

    def test_publishing_defers_the_announcement_once_the_roll_is_committed(self):
        with patch("shareholders.tasks.publications.tell_the_members.defer") as defer:
            with self.captureOnCommitCallbacks(execute=True) as callbacks:
                made = published(self.world, title="A second statement")

        self.assertEqual(len(callbacks), 1)
        defer.assert_called_once_with(publication_id=str(made.pk))

    def test_what_is_deferred_is_what_the_existing_notification_task_puts_in_the_members_inbox(self):
        with patch("users.tasks.notifications.send_push_notification.defer", side_effect=_send_push_notification):
            notify_the_roll(self.publication.pk)

        inbox = Notification.objects.all()
        self.assertEqual(sorted(inbox.values_list("user_id", flat=True)), sorted(m.user.pk for m in self.world.members))
        self.assertEqual(inbox.first().notification_type, "general")
        self.assertEqual(inbox.first().data["publication_id"], str(self.publication.pk))
        self.assertEqual(inbox.first().data["type"], PUBLICATION_NOTICE)
