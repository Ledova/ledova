from django.db import DatabaseError
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.test import APITransactionTestCase

from shared.db import atomic, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.models import Publication, PublicationRead, PublicationRecipient
from shareholders.services.publications import read_publication
from shareholders.tests.fixtures import a_company_with_members, published


class ScopedPublicationTest(RunsOnTheScopedConnection, StubUploadDependencies, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.here = a_company_with_members("scoped-here")
            self.there = a_company_with_members("scoped-there")
            self.mine = published(self.here)
            self.theirs = published(self.there)

    def as_principal(self, user):
        self.the_principal_the_middleware_would_set(user)

    def visible(self, model):
        with atomic():
            return sorted(str(pk) for pk in model.objects.values_list("pk", flat=True))

    def test_a_shareholder_of_one_company_cannot_read_another_companys_publication(self):
        self.as_principal(self.here.members[0].user)

        self.assertEqual(self.visible(Publication), [str(self.mine.pk)])
        with atomic():
            self.assertEqual(Publication.objects.filter(pk=self.theirs.pk).count(), 0)
        with self.assertRaises(NotFound), atomic():
            read_publication(self.here.members[0].user, self.theirs.pk)

    def test_a_shareholder_reads_the_publication_addressed_to_them(self):
        holder = self.here.members[0]
        self.as_principal(holder.user)

        with atomic():
            publication, recipient = read_publication(holder.user, self.mine.pk)

        self.assertEqual((publication.pk, recipient.member_id), (self.mine.pk, holder.member.pk))
        with use_operator():
            self.assertEqual(
                list(PublicationRead.objects.values_list("actor_id", "publication_uuid", "kind")),
                [(holder.user.pk, self.mine.pk, "member")],
            )

    def test_a_shareholder_sees_their_own_roll_row_and_no_other_members(self):
        holder, other = self.here.members
        self.as_principal(holder.user)

        with atomic():
            rows = sorted(PublicationRecipient.objects.values_list("user_id", flat=True))

        self.assertEqual(rows, [holder.user.pk])
        self.assertNotIn(other.user.pk, rows)

    def test_the_issuer_sees_its_own_publications_and_their_whole_roll_and_no_others(self):
        self.as_principal(self.here.owner)

        self.assertEqual(self.visible(Publication), [str(self.mine.pk)])
        with atomic():
            rows = sorted(PublicationRecipient.objects.values_list("user_id", flat=True))

        self.assertEqual(rows, sorted(holder.user.pk for holder in self.here.members))

    def test_the_app_role_can_neither_write_nor_delete_a_publication_or_its_roll(self):
        holder = self.here.members[0]
        self.as_principal(holder.user)

        with self.assertRaises(DatabaseError), atomic():
            Publication.objects.filter(pk=self.mine.pk).update(title="Rewritten")
        with self.assertRaises(DatabaseError), atomic():
            PublicationRecipient.objects.filter(publication_id=self.mine.pk).update(shares=1)
        with self.assertRaises(DatabaseError), atomic():
            PublicationRecipient.objects.create(
                publication_id=self.mine.pk,
                company_id=self.here.company.pk,
                member_id=holder.member.pk,
                user_id=holder.user.pk,
                name="Added by the member",
                holder_type="member",
                identity_source="profile",
                shares=1,
            )
        with atomic():
            removed, _ = PublicationRecipient.objects.filter(publication_id=self.mine.pk).delete()

        self.assertEqual(removed, 0)
        with use_operator():
            self.assertEqual(Publication.objects.get(pk=self.mine.pk).title, self.mine.title)
            self.assertEqual(PublicationRecipient.objects.filter(publication_id=self.mine.pk).count(), 2)

    def test_the_read_audit_is_out_of_reach_of_the_app_role_entirely(self):
        self.as_principal(self.here.members[0].user)

        with self.assertRaisesRegex(DatabaseError, "permission denied for table shareholders_publicationread"):
            with atomic():
                PublicationRead.objects.exists()

    def test_publishing_refuses_the_scoped_connection(self):
        self.as_principal(self.here.owner)

        with self.assertRaises(PermissionDenied), atomic():
            published(self.here)
