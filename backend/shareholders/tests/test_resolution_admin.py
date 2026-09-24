from datetime import timedelta
from uuid import uuid4

from django.contrib import admin
from django.contrib.auth.models import Permission
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from shared.tests.test_admin_row_actions import ADMIN_STORAGES, grant, staff_user
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.models import (
    BallotChoice,
    Publication,
    PublicationEvent,
    PublicationKind,
    PublicationRecipient,
    ResolutionKind,
)
from shareholders.services.resolutions import cast_ballot, close_resolution
from shareholders.tests.fixtures import (
    DAY,
    INSTRUCTION,
    QUESTION,
    a_company_with_members,
    a_resolution,
    an_upload,
    published,
    voting_has_closed,
)

WINDOW = "%Y-%m-%dT%H:%M"


def reading_the_chain(user):
    user.user_permissions.add(Permission.objects.get(codename="view_publicationevent"))
    user.user_permissions.add(Permission.objects.get(codename="view_publicationrecipient"))
    return type(user).objects.get(pk=user.pk)


@override_settings(STORAGES=ADMIN_STORAGES)
class ResolutionsInTheAdminTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("admin-resolve", holdings=(100, 40))
        self.editor = reading_the_chain(
            grant(staff_user(f"resolution-editor-{uuid4().hex[:8]}"), admin.site._registry[Publication], "change")
        )
        self.client.force_login(self.editor)

    def change_page(self, publication):
        return self.client.get(reverse("admin:shareholders_publication_change", args=[publication.pk]))

    def ballot_page(self, publication):
        return reverse("admin:shareholders_publication_ballot", args=[publication.pk])

    def test_the_publish_page_makes_a_resolution_with_its_question_kind_and_window(self):
        opens = timezone.now().replace(second=0, microsecond=0) - timedelta(hours=1)
        closes = opens + timedelta(days=7)

        response = self.client.post(
            reverse("admin:shareholders_publication_publish"),
            {
                "token": str(self.world.token.pk),
                "kind": PublicationKind.RESOLUTION,
                "title": "Special resolution to change the company's name",
                "record_date": DAY.isoformat(),
                "instruction": INSTRUCTION,
                "authority_document": str(self.world.authority.pk),
                "file": an_upload("resolution.pdf"),
                "question": QUESTION,
                "resolution_kind": ResolutionKind.SPECIAL,
                "opens_at": opens.strftime(WINDOW),
                "closes_at": closes.strftime(WINDOW),
            },
        )

        resolution = Publication.objects.get()
        self.assertRedirects(
            response,
            reverse("admin:shareholders_publication_change", args=[resolution.pk]),
            fetch_redirect_response=False,
        )
        self.assertEqual(
            (resolution.question, resolution.resolution_kind, resolution.opens_at, resolution.closes_at),
            (QUESTION, ResolutionKind.SPECIAL, opens, closes),
        )

    def test_the_publish_page_refuses_a_question_on_a_document_and_records_nothing(self):
        response = self.client.post(
            reverse("admin:shareholders_publication_publish"),
            {
                "token": str(self.world.token.pk),
                "kind": PublicationKind.HOLDING_STATEMENT,
                "title": "Statement",
                "record_date": DAY.isoformat(),
                "instruction": INSTRUCTION,
                "authority_document": str(self.world.authority.pk),
                "file": an_upload(),
                "question": QUESTION,
            },
        )

        self.assertContains(response, "Only a resolution carries a question")
        self.assertFalse(Publication.objects.exists())

    def test_a_resolution_s_page_shows_its_window_its_chain_and_its_tally_once_closed(self):
        resolution = a_resolution(self.world)
        cast_ballot(self.world.members[0].user, resolution.pk, BallotChoice.FOR)

        before = self.change_page(resolution)

        self.assertContains(before, QUESTION)
        self.assertContains(before, "Voting opens")
        self.assertContains(before, "Not closed yet")
        self.assertContains(before, self.ballot_page(resolution))
        self.assertContains(before, PublicationEvent.objects.get().entry_hash)

        voting_has_closed(resolution)
        close_resolution(resolution)
        after = self.change_page(resolution)

        self.assertContains(after, "<strong>Carried</strong>. For: 100 shares from 1 members.", html=False)
        self.assertContains(after, "Eligible: 140 shares held by 2 members.")

    def test_a_document_s_page_carries_no_resolution_fields(self):
        statement = published(self.world)

        response = self.change_page(statement)

        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, "Tally")
        self.assertNotContains(response, self.ballot_page(statement))

    def test_staff_enter_a_ballot_for_a_member_on_the_roll_with_what_they_relied_on(self):
        resolution = a_resolution(self.world)
        holder = self.world.members[1]
        row = PublicationRecipient.objects.get(publication=resolution, user_id=holder.user.pk)

        response = self.client.post(
            self.ballot_page(resolution),
            {"recipient": str(row.pk), "choice": BallotChoice.AGAINST, "authority": "Proxy form P-30"},
        )

        self.assertRedirects(
            response,
            reverse("admin:shareholders_publication_change", args=[resolution.pk]),
            fetch_redirect_response=False,
        )
        ballot = PublicationEvent.objects.get()
        self.assertEqual(
            (ballot.recipient_id, ballot.choice, ballot.staff_entered, ballot.actor_id, ballot.authority),
            (row.pk, "against", True, self.editor.pk, "Proxy form P-30"),
        )

    def test_the_ballot_page_offers_only_members_without_a_ballot(self):
        resolution = a_resolution(self.world)
        voted, waiting = (
            PublicationRecipient.objects.get(publication=resolution, user_id=holder.user.pk)
            for holder in self.world.members
        )
        cast_ballot(self.world.members[0].user, resolution.pk, BallotChoice.FOR)

        response = self.client.get(self.ballot_page(resolution))

        self.assertContains(response, str(waiting.pk))
        self.assertNotContains(response, str(voted.pk))

    def test_a_ballot_the_service_refuses_says_why_and_records_nothing(self):
        resolution = a_resolution(self.world)
        row = PublicationRecipient.objects.filter(publication=resolution).first()
        voting_has_closed(resolution)

        response = self.client.post(
            self.ballot_page(resolution),
            {"recipient": str(row.pk), "choice": BallotChoice.FOR, "authority": "Proxy form P-31"},
        )

        self.assertContains(response, "Voting on this resolution has closed. Nothing was recorded.")
        self.assertFalse(PublicationEvent.objects.exists())

    def test_a_ballot_without_its_authority_is_not_recorded(self):
        resolution = a_resolution(self.world)
        row = PublicationRecipient.objects.filter(publication=resolution).first()

        response = self.client.post(self.ballot_page(resolution), {"recipient": str(row.pk), "choice": "for"})

        self.assertEqual(response.status_code, 200)
        self.assertFalse(PublicationEvent.objects.exists())

    def test_the_ballot_page_exists_only_for_a_resolution(self):
        statement = published(self.world)

        self.assertEqual(self.client.get(self.ballot_page(statement)).status_code, 404)

    def test_staff_who_may_only_view_publications_cannot_enter_a_ballot(self):
        resolution = a_resolution(self.world)
        row = PublicationRecipient.objects.filter(publication=resolution).first()
        self.client.force_login(
            grant(staff_user(f"resolution-viewer-{uuid4().hex[:8]}"), admin.site._registry[Publication], "view")
        )

        response = self.client.post(
            self.ballot_page(resolution),
            {"recipient": str(row.pk), "choice": BallotChoice.FOR, "authority": "Proxy form P-32"},
        )

        self.assertEqual(response.status_code, 403)
        self.assertFalse(PublicationEvent.objects.exists())

    def test_the_chain_has_no_admin_of_its_own_to_add_change_or_delete_through(self):
        self.assertNotIn(PublicationEvent, admin.site._registry)
        inline = admin.site._registry[Publication].get_inlines(None, a_resolution(self.world))[0]
        request = type("Request", (), {"user": self.editor})()

        self.assertEqual(inline.model, PublicationEvent)
        self.assertFalse(inline(Publication, admin.site).has_add_permission(request))
        self.assertFalse(inline(Publication, admin.site).has_change_permission(request))
        self.assertFalse(inline(Publication, admin.site).has_delete_permission(request))
