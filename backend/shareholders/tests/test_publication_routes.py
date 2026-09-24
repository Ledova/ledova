from unittest.mock import patch
from uuid import uuid4

from django.db import DatabaseError
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from shared.tests.test_admin_row_actions import ADMIN_STORAGES
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.constants import READ_AS_COMPANY, READ_AS_MEMBER
from shareholders.models import PublicationKind, PublicationRead
from shareholders.tests.fixtures import (
    PUBLICATION_BYTES,
    TITLE,
    a_company_with_members,
    a_distribution,
    a_person,
    a_resolution,
    published,
)
from tokens.models import ShareTokenStatus

LISTING = "/api/v1/publications/"


def file_route(publication):
    return f"{LISTING}{publication.pk}/file/"


@override_settings(STORAGES=ADMIN_STORAGES)
class ThePublicationsRouteTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("route")
        self.elsewhere = a_company_with_members("route-elsewhere")
        self.publication = published(self.world)
        self.theirs = published(self.elsewhere)
        self.holder, self.other = self.world.members
        self.client = APIClient()

    def rows(self, response):
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["results"]

    def listed_for(self, user):
        self.client.force_authenticate(user)
        return self.rows(self.client.get(LISTING))

    def test_a_member_lists_only_what_was_addressed_to_them_with_their_own_frozen_holding(self):
        rows = self.listed_for(self.holder.user)

        self.assertEqual([row["uuid"] for row in rows], [str(self.publication.pk)])
        self.assertEqual(
            {key: rows[0][key] for key in ("kind", "title", "companyName", "tokenName", "tokenSymbol", "shares")},
            {
                "kind": "holding_statement",
                "title": TITLE,
                "companyName": self.world.company.name,
                "tokenName": self.world.token.name,
                "tokenSymbol": self.world.token.symbol,
                "shares": str(self.holder.shares),
            },
        )
        self.assertEqual(rows[0]["recordDate"], str(self.publication.record_date))

    def test_each_member_is_shown_their_own_holding_and_never_another_members(self):
        mine = self.listed_for(self.holder.user)
        theirs = self.listed_for(self.other.user)

        self.assertEqual(mine[0]["shares"], str(self.holder.shares))
        self.assertEqual(theirs[0]["shares"], str(self.other.shares))
        self.assertNotEqual(mine[0]["shares"], theirs[0]["shares"])

    def test_the_company_owner_reads_its_own_publications_through_the_same_route_and_holds_nothing(self):
        rows = self.listed_for(self.world.owner)

        self.assertEqual([row["uuid"] for row in rows], [str(self.publication.pk)])
        self.assertIsNone(rows[0]["shares"])

    def test_a_pause_of_the_share_class_leaves_the_publication_and_its_names_where_they_were(self):
        self.world.token.status = ShareTokenStatus.PAUSED
        self.world.token.save(update_fields=["status"])

        rows = self.listed_for(self.holder.user)

        self.assertEqual([row["uuid"] for row in rows], [str(self.publication.pk)])
        self.assertEqual(rows[0]["companyName"], self.world.company.name)
        self.assertEqual(rows[0]["tokenName"], self.world.token.name)

    def test_a_member_of_another_company_lists_nothing_of_ours_and_is_refused_the_file(self):
        stranger = a_person("route-stranger", "Passing Stranger")[0]

        for user in (self.elsewhere.members[0].user, self.elsewhere.owner, stranger):
            with self.subTest(user=user.pk):
                self.client.force_authenticate(user)
                self.assertNotIn(str(self.publication.pk), [row["uuid"] for row in self.rows(self.client.get(LISTING))])
                refused = self.client.get(file_route(self.publication))
                absent = self.client.get(f"{LISTING}{uuid4()}/file/")
                self.assertEqual((refused.status_code, refused.content), (absent.status_code, absent.content))
                self.assertEqual(refused.status_code, 404)
        self.assertEqual(PublicationRead.objects.count(), 0)

    def test_the_listing_narrows_to_one_kind_and_stays_within_what_was_published_to_the_caller(self):
        resolution = a_resolution(self.world)
        distribution = a_distribution(self.world)
        a_distribution(self.elsewhere)
        self.client.force_authenticate(self.holder.user)

        listed = {
            kind: [row["uuid"] for row in self.rows(self.client.get(LISTING, {"kind": kind}))]
            for kind in PublicationKind.values
        }

        self.assertEqual(
            listed,
            {
                PublicationKind.HOLDING_STATEMENT: [str(self.publication.pk)],
                PublicationKind.MEETING_NOTICE: [],
                PublicationKind.RESOLUTION: [str(resolution.pk)],
                PublicationKind.DISTRIBUTION: [str(distribution.pk)],
            },
        )
        self.assertEqual(len(self.rows(self.client.get(LISTING))), 3)

    def test_a_kind_the_platform_does_not_publish_is_refused_and_the_refusal_names_the_filter(self):
        self.client.force_authenticate(self.holder.user)

        response = self.client.get(LISTING, {"kind": "dividend"})

        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(list(response.json()), ["kind"])

    def test_an_unauthenticated_caller_reaches_neither_the_listing_nor_the_file(self):
        self.client.force_authenticate(None)

        self.assertEqual(self.client.get(LISTING).status_code, 401)
        self.assertEqual(self.client.get(file_route(self.publication)).status_code, 401)
        self.assertEqual(PublicationRead.objects.count(), 0)

    def test_the_member_opens_the_stored_document_and_the_read_is_recorded_against_their_roll_row(self):
        self.client.force_authenticate(self.holder.user)

        response = self.client.get(file_route(self.publication))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), PUBLICATION_BYTES)
        self.assertEqual(response["Content-Disposition"][:10], "attachment")
        recorded = list(PublicationRead.objects.values_list("actor_id", "publication_uuid", "kind"))
        self.assertEqual(recorded, [(self.holder.user.pk, self.publication.pk, READ_AS_MEMBER)])
        self.assertIsNotNone(PublicationRead.objects.get().recipient_uuid)

    def test_the_company_owner_opens_the_same_document_and_the_read_is_recorded_as_the_company(self):
        self.client.force_authenticate(self.world.owner)

        response = self.client.get(file_route(self.publication))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), PUBLICATION_BYTES)
        self.assertEqual(
            list(PublicationRead.objects.values_list("actor_id", "recipient_uuid", "kind")),
            [(self.world.owner.pk, None, READ_AS_COMPANY)],
        )

    def test_a_read_that_cannot_be_recorded_serves_nothing_at_all(self):
        self.client.force_authenticate(self.holder.user)

        with patch.object(PublicationRead.objects, "create", side_effect=DatabaseError("no audit")):
            response = self.client.get(file_route(self.publication))

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "publication_read_unrecorded")
        self.assertNotIn(PUBLICATION_BYTES, response.content)
        self.assertEqual(PublicationRead.objects.count(), 0)

    def test_a_document_that_cannot_be_opened_serves_nothing_and_records_no_read(self):
        self.client.force_authenticate(self.holder.user)
        self.publication.file.storage.delete(self.publication.file.name)

        response = self.client.get(file_route(self.publication))

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json()["code"], "publication_unopened")
        self.assertEqual(PublicationRead.objects.count(), 0)

    def test_the_listing_and_the_file_take_no_writes(self):
        self.client.force_authenticate(self.holder.user)

        for method, path in (("post", LISTING), ("post", file_route(self.publication))):
            with self.subTest(method=method, path=path):
                self.assertEqual(getattr(self.client, method)(path, {}, format="json").status_code, 405)
        self.assertEqual(self.client.get(f"{LISTING}{self.publication.pk}/").status_code, 404)
