from datetime import timedelta

from django.contrib import admin
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from shared.tests.test_admin_row_actions import ADMIN_STORAGES, grant, staff_user
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.models import Publication, PublicationKind, PublicationRecipient
from shareholders.tests.fixtures import (
    DAY,
    INSTRUCTION,
    TITLE,
    a_company_with_members,
    an_upload,
)


@override_settings(STORAGES=ADMIN_STORAGES)
class PublishingFromTheAdminTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("admin-publish")
        self.operator = grant(staff_user("publications-editor"), admin.site._registry[Publication], "change")
        self.client.force_login(self.operator)
        self.url = reverse("admin:shareholders_publication_publish")

    def form(self, **changes):
        return {
            "token": str(self.world.token.pk),
            "kind": PublicationKind.MEETING_NOTICE,
            "title": TITLE,
            "record_date": DAY.isoformat(),
            "instruction": INSTRUCTION,
            "authority_document": str(self.world.authority.pk),
            "file": an_upload(),
            **changes,
        }

    def test_the_page_offers_only_share_classes_whose_register_is_open(self):
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, self.world.token.symbol)

    def test_publishing_records_the_publication_its_roll_and_the_staff_member_who_prepared_it(self):
        response = self.client.post(self.url, self.form())

        publication = Publication.objects.get()
        self.assertRedirects(
            response,
            reverse("admin:shareholders_publication_change", args=[publication.pk]),
            fetch_redirect_response=False,
        )
        self.assertEqual(
            (publication.kind, publication.prepared_by_id, publication.member_rows),
            (PublicationKind.MEETING_NOTICE, self.operator.pk, 2),
        )
        self.assertEqual(PublicationRecipient.objects.filter(publication=publication).count(), 2)

    def test_a_refused_publication_says_why_and_records_nothing(self):
        tomorrow = (timezone.localdate() + timedelta(days=1)).isoformat()

        response = self.client.post(self.url, self.form(record_date=tomorrow))

        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "Nothing was published.")
        self.assertFalse(Publication.objects.exists())

    def test_staff_without_change_permission_cannot_open_the_page(self):
        self.client.force_login(staff_user("publications-plain"))

        self.assertEqual(self.client.get(self.url).status_code, 403)
