from unittest.mock import patch

from django.contrib import admin
from django.db import DatabaseError
from django.test import TestCase, override_settings
from django.urls import reverse
from rest_framework.exceptions import NotFound

from shared.tests.test_admin_row_actions import ADMIN_STORAGES, grant, staff_user
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.constants import READ_AS_COMPANY, READ_AS_MEMBER, READ_AS_STAFF
from shareholders.exceptions import PublicationNotDelivered
from shareholders.models import Publication, PublicationRead, PublicationRecipient
from shareholders.services.publications import read_publication
from shareholders.tests.fixtures import (
    PUBLICATION_BYTES,
    a_company_with_members,
    a_person,
    published,
)


class ReadingAPublicationTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("reads")
        self.publication = published(self.world)
        self.holder = self.world.members[0]

    def audited(self):
        return list(PublicationRead.objects.values_list("actor_id", "publication_uuid", "recipient_uuid", "kind"))

    def test_a_member_reads_the_publication_addressed_to_them_and_the_read_is_audited(self):
        publication, recipient = read_publication(self.holder.user, self.publication.pk)

        self.assertEqual(publication.pk, self.publication.pk)
        self.assertEqual(recipient.member_id, self.holder.member.pk)
        with publication.file.open("rb") as stored:
            self.assertEqual(stored.read(), PUBLICATION_BYTES)
        self.assertEqual(self.audited(), [(self.holder.user.pk, self.publication.pk, recipient.pk, READ_AS_MEMBER)])

    def test_the_company_reads_its_own_publication_and_the_read_is_audited_as_the_company(self):
        publication, recipient = read_publication(self.world.owner, self.publication.pk)

        self.assertIsNone(recipient)
        self.assertEqual(self.audited(), [(self.world.owner.pk, publication.pk, None, READ_AS_COMPANY)])

    def test_staff_read_every_publication_and_the_read_is_audited_as_staff(self):
        _, recipient = read_publication(self.world.staff, self.publication.pk)

        self.assertIsNone(recipient)
        self.assertEqual(self.audited(), [(self.world.staff.pk, self.publication.pk, None, READ_AS_STAFF)])

    def test_a_stranger_and_another_companys_member_are_both_refused_and_audited_nowhere(self):
        elsewhere = a_company_with_members("reads-elsewhere")
        stranger = a_person("reads-stranger", "Passing Stranger")[0]

        for user in (stranger, elsewhere.members[0].user, elsewhere.owner):
            with self.subTest(user=user.pk), self.assertRaises(NotFound):
                read_publication(user, self.publication.pk)

        self.assertEqual(self.audited(), [])

    def test_a_publication_that_does_not_exist_answers_the_same_refusal(self):
        with self.assertRaises(NotFound):
            read_publication(self.holder.user, self.world.company.pk)

    def test_a_failed_audit_write_refuses_the_delivery_rather_than_serving_the_file(self):
        with patch.object(PublicationRead.objects, "create", side_effect=DatabaseError("no audit")):
            with self.assertRaises(PublicationNotDelivered):
                read_publication(self.holder.user, self.publication.pk)

        self.assertEqual(self.audited(), [])

    def test_a_member_row_is_only_ever_the_readers_own(self):
        other = self.world.members[1]

        _, mine = read_publication(self.holder.user, self.publication.pk)
        _, theirs = read_publication(other.user, self.publication.pk)

        self.assertNotEqual(mine.pk, theirs.pk)
        self.assertEqual(
            sorted(PublicationRecipient.objects.filter(publication=self.publication).values_list("user_id", flat=True)),
            sorted([self.holder.user.pk, other.user.pk]),
        )


@override_settings(STORAGES=ADMIN_STORAGES)
class ThePublicationsAdminTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("admin-reads")
        self.publication = published(self.world)
        self.operator = grant(staff_user("publications-operator"), admin.site._registry[Publication], "view")
        self.client.force_login(self.operator)

    def test_a_staff_download_streams_the_stored_bytes_and_records_the_read(self):
        response = self.client.get(reverse("admin:shareholders_publication_file", args=[self.publication.pk]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), PUBLICATION_BYTES)
        self.assertEqual(
            list(PublicationRead.objects.values_list("actor_id", "publication_uuid", "kind")),
            [(self.operator.pk, self.publication.pk, READ_AS_STAFF)],
        )

    def test_a_staff_download_whose_read_cannot_be_recorded_serves_nothing(self):
        with patch.object(PublicationRead.objects, "create", side_effect=DatabaseError("no audit")):
            with self.assertRaises(PublicationNotDelivered):
                self.client.get(reverse("admin:shareholders_publication_file", args=[self.publication.pk]))

        self.assertEqual(PublicationRead.objects.count(), 0)

    def test_the_publication_and_its_read_records_cannot_be_added_changed_or_deleted_in_admin(self):
        superuser = staff_user("publications-superuser")
        superuser.is_superuser = True
        superuser.save(update_fields=["is_superuser"])
        self.client.force_login(superuser)

        for name, arguments in (
            ("shareholders_publication_add", []),
            ("shareholders_publicationread_add", []),
        ):
            with self.subTest(route=name):
                self.assertEqual(self.client.get(reverse(f"admin:{name}", args=arguments)).status_code, 403)
        change = self.client.get(reverse("admin:shareholders_publication_change", args=[self.publication.pk]))
        self.assertEqual(change.status_code, 200)
        self.assertNotContains(change, 'name="_save"')
        deleted = self.client.post(
            reverse("admin:shareholders_publication_delete", args=[self.publication.pk]), {"post": "yes"}
        )
        self.assertEqual(deleted.status_code, 403)
        self.assertTrue(Publication.objects.filter(pk=self.publication.pk).exists())
