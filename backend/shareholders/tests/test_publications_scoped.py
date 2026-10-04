from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, connections
from django.test import override_settings
from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.test import APITransactionTestCase

from companies.models import CompanyAppointment
from shared.db import OPERATOR_ALIAS, acting_for, atomic, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.test_admin_row_actions import ADMIN_STORAGES, staff_user
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.models import (
    Publication,
    PublicationEvent,
    PublicationRead,
    PublicationRecipient,
)
from shareholders.services.publications import read_publication
from shareholders.services.resolutions import close_resolution, enter_ballot
from shareholders.tests.fixtures import (
    PUBLICATION_BYTES,
    a_company_with_members,
    a_distribution,
    a_resolution,
    published,
    the_class_is_paused,
    voting_has_closed,
)
from tokens.models import ShareToken

LISTING = "/api/v1/publications/"


@override_settings(STORAGES=ADMIN_STORAGES)
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

    def test_paused_issuer_keeps_its_publications_without_basic_company_administration(self):
        with use_operator():
            the_class_is_paused(self.here)
            self.assertFalse(CompanyAppointment.objects.filter(company=self.here.company).exists())
        self.client.force_authenticate(self.here.owner)

        listed = self.client.get(LISTING, {"issuer": self.here.company.pk})
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertEqual([row["uuid"] for row in listed.json()["results"]], [str(self.mine.pk)])
        served = self.client.get(f"{LISTING}{self.mine.pk}/file/")
        self.assertEqual(served.status_code, 200)
        self.assertEqual(b"".join(served.streaming_content), PUBLICATION_BYTES)
        self.assertEqual(self.client.get(f"/api/v1/companies/{self.here.company.pk}/").status_code, 404)
        with use_operator():
            self.assertEqual(
                list(PublicationRead.objects.values_list("actor_id", "publication_uuid", "kind")),
                [(self.here.owner.pk, self.mine.pk, "company")],
            )
        for company, publication in ((self.there.company.pk, self.theirs.pk), (uuid4(), uuid4())):
            refused = self.client.get(LISTING, {"issuer": company})
            self.assertEqual(refused.status_code, 400, refused.content)
            self.assertEqual(self.client.get(f"{LISTING}{publication}/file/").status_code, 404)
        with use_operator():
            self.assertEqual(PublicationRead.objects.count(), 1)

    def test_paused_issuer_file_read_keeps_company_audit_without_administration(self):
        with use_operator():
            the_class_is_paused(self.here)
            self.assertFalse(CompanyAppointment.objects.filter(company=self.here.company).exists())
        self.client.force_authenticate(self.here.owner)

        served = self.client.get(f"{LISTING}{self.mine.pk}/file/")
        self.assertEqual(served.status_code, 200)
        self.assertEqual(b"".join(served.streaming_content), PUBLICATION_BYTES)
        self.assertEqual(self.client.get(f"/api/v1/companies/{self.here.company.pk}/").status_code, 404)
        with use_operator():
            self.assertEqual(
                list(PublicationRead.objects.values_list("actor_id", "publication_uuid", "kind")),
                [(self.here.owner.pk, self.mine.pk, "company")],
            )

    def test_paused_owner_addressee_keeps_frozen_holding_with_issuer_filter(self):
        with use_operator():
            owned = a_company_with_members("scoped-paused-owner-member", owner_holds_first=True)
            paper = published(owned)
            the_class_is_paused(owned)
            self.assertFalse(CompanyAppointment.objects.filter(company=owned.company).exists())
        self.client.force_authenticate(owned.owner)

        for query in ({"issuer": owned.company.pk}, {"issuer": owned.company.pk, "addressed": "me"}):
            with self.subTest(query=query):
                response = self.client.get(LISTING, query)
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual([row["uuid"] for row in response.json()["results"]], [str(paper.pk)])
                self.assertEqual(response.json()["results"][0]["shares"], str(owned.members[0].shares))
        served = self.client.get(f"{LISTING}{paper.pk}/file/")
        self.assertEqual(served.status_code, 200)
        self.assertEqual(b"".join(served.streaming_content), PUBLICATION_BYTES)
        with use_operator():
            self.assertEqual(PublicationRead.objects.get().kind, "member")
        self.assertEqual(self.client.get(f"/api/v1/companies/{owned.company.pk}/").status_code, 404)

    def test_existing_staff_read_service_does_not_grant_customer_publication_or_company_access(self):
        staff = self.here.staff
        self.client.force_authenticate(staff)

        listed = self.client.get(LISTING)
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertEqual(listed.json()["results"], [])
        refused = self.client.get(f"{LISTING}{self.mine.pk}/file/")
        absent = self.client.get(f"{LISTING}{uuid4()}/file/")
        self.assertEqual(refused.status_code, 404)
        self.assertEqual(absent.status_code, 404)
        self.assertEqual((refused.status_code, refused.content), (absent.status_code, absent.content))
        self.assertEqual(self.client.get(f"/api/v1/companies/{self.here.company.pk}/").status_code, 404)
        with use_operator():
            self.assertFalse(PublicationRead.objects.exists())
        publication, recipient = read_publication(staff, self.mine.pk)
        self.assertIsNone(recipient)
        self.assertEqual(publication.pk, self.mine.pk)
        publication.file.close()
        with use_operator():
            self.assertEqual(
                list(PublicationRead.objects.values_list("actor_id", "publication_uuid", "kind")),
                [(staff.pk, self.mine.pk, "staff")],
            )

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

    def test_the_route_binds_its_reader_on_the_real_operator_connection(self):
        holder = self.here.members[0]
        self.client.force_authenticate(holder.user)

        reads = []

        def record(execute, sql, params, many, context):
            if 'FROM "shareholders_publication"' in sql:
                connection = context["connection"]
                with connection.cursor() as cursor:
                    cursor.execute("SELECT current_user")
                    role = cursor.fetchone()[0]
                reads.append((connection.alias, role, sql, params))
            return execute(sql, params, many, context)

        with connections[OPERATOR_ALIAS].execute_wrapper(record):
            listed = self.client.get(LISTING)

        self.assertEqual(listed.status_code, 200)
        self.assertEqual([row["uuid"] for row in listed.json()["results"]], [str(self.mine.pk)])
        self.assertEqual(listed.json()["results"][0]["shares"], str(holder.shares))
        self.assertTrue(reads)
        for alias, role, sql, params in reads:
            self.assertEqual((alias, role), (OPERATOR_ALIAS, settings.RLS_ROLES[OPERATOR_ALIAS]))
            self.assertIn(holder.user.pk, params)

    def test_a_member_of_a_paused_class_reads_and_votes_on_what_was_published_after_the_pause(self):
        holder = self.here.members[0]
        with use_operator():
            the_class_is_paused(self.here)
            resolution = a_resolution(self.here)
            dividend = a_distribution(self.here)
        self.client.force_authenticate(holder.user)

        listed = self.client.get(LISTING, {"addressed": "me"})
        voted = self.client.post(f"{LISTING}{resolution.pk}/ballot/", {"choice": "for"}, format="json")

        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertEqual(
            {row["uuid"] for row in listed.json()["results"]},
            {str(self.mine.pk), str(resolution.pk), str(dividend.pk)},
        )
        self.assertEqual(voted.status_code, 200, voted.content)
        self.assertEqual(voted.json()["myBallot"]["choice"], "for")
        with acting_for(holder.user.pk):
            self.assertFalse(ShareToken.objects.filter(pk=self.here.token.pk).exists())

    def test_the_issuer_filter_is_owned_company_only_on_the_bounded_operator_connection(self):
        owner = self.there.members[0].user
        with use_operator():
            owned = a_company_with_members("scoped-owner-invests", owner=owner)
            own_paper = published(owned)
        self.client.force_authenticate(owner)

        unfiltered = self.client.get(LISTING)
        issued = self.client.get(LISTING, {"issuer": owned.company.pk})
        personal = self.client.get(LISTING, {"addressed": "me"})
        nonowned = self.client.get(LISTING, {"issuer": self.there.company.pk})
        absent = self.client.get(LISTING, {"issuer": uuid4()})

        self.assertEqual(unfiltered.status_code, 200)
        self.assertEqual(
            {row["uuid"] for row in unfiltered.json()["results"]}, {str(own_paper.pk), str(self.theirs.pk)}
        )
        self.assertEqual(issued.status_code, 200)
        self.assertEqual([row["uuid"] for row in issued.json()["results"]], [str(own_paper.pk)])
        self.assertEqual(personal.status_code, 200)
        self.assertEqual([row["uuid"] for row in personal.json()["results"]], [str(self.theirs.pk)])
        self.assertEqual((nonowned.status_code, nonowned.content), (absent.status_code, absent.content))
        self.assertEqual(nonowned.status_code, 400)

    def test_the_route_refuses_a_publication_addressed_to_a_member_of_another_company(self):
        self.client.force_authenticate(self.here.members[0].user)

        refused = self.client.get(f"{LISTING}{self.theirs.pk}/file/")
        absent = self.client.get(f"{LISTING}{uuid4()}/file/")

        self.assertEqual((refused.status_code, refused.content), (absent.status_code, absent.content))
        self.assertEqual(refused.status_code, 404)
        with use_operator():
            self.assertEqual(PublicationRead.objects.count(), 0)

    def test_the_route_serves_the_document_and_records_the_read_on_the_operator_connection(self):
        holder = self.here.members[0]
        self.client.force_authenticate(holder.user)

        served = self.client.get(f"{LISTING}{self.mine.pk}/file/")

        self.assertEqual(served.status_code, 200)
        self.assertEqual(b"".join(served.streaming_content), PUBLICATION_BYTES)
        with use_operator():
            self.assertEqual(
                list(PublicationRead.objects.values_list("actor_id", "publication_uuid", "kind")),
                [(holder.user.pk, self.mine.pk, "member")],
            )

    def test_a_read_the_operator_connection_cannot_record_serves_nothing(self):
        self.client.force_authenticate(self.here.members[0].user)

        with patch.object(PublicationRead.objects, "create", side_effect=DatabaseError("no audit")):
            refused = self.client.get(f"{LISTING}{self.mine.pk}/file/")

        self.assertEqual(refused.status_code, 503)
        self.assertNotIn(PUBLICATION_BYTES, refused.content)
        with use_operator():
            self.assertEqual(PublicationRead.objects.count(), 0)

    def a_resolution_here(self):
        with use_operator():
            return a_resolution(self.here)

    def cast(self, user, resolution, choice="for"):
        self.client.force_authenticate(user)
        return self.client.post(f"{LISTING}{resolution.pk}/ballot/", {"choice": choice}, format="json")

    def ballots(self):
        with use_operator():
            return list(PublicationEvent.objects.values_list("publication_id", "actor_id", "choice"))

    def test_the_route_casts_a_members_ballot_through_the_app_and_operator_split(self):
        resolution = self.a_resolution_here()
        holder = self.here.members[0]

        cast = self.cast(holder.user, resolution)

        self.assertEqual(cast.status_code, 200, cast.content)
        self.assertEqual((cast.json()["myBallot"]["choice"], cast.json()["shares"]), ("for", str(holder.shares)))
        self.assertEqual(self.ballots(), [(resolution.pk, holder.user.pk, "for")])
        self.as_principal(holder.user)
        with atomic():
            self.assertEqual(PublicationEvent.objects.count(), 1)

    def test_a_member_of_another_company_is_refused_the_ballot_like_a_missing_one_and_nothing_is_written(self):
        resolution = self.a_resolution_here()
        stranger = self.there.members[0].user

        refused = self.cast(stranger, resolution)
        missing = self.client.post(f"{LISTING}{uuid4()}/ballot/", {"choice": "for"}, format="json")

        self.assertEqual((refused.status_code, refused.content), (missing.status_code, missing.content))
        self.assertEqual(refused.status_code, 404)
        self.assertEqual(self.ballots(), [])

    def test_the_company_owner_cannot_cast_through_the_route_and_nothing_is_written(self):
        resolution = self.a_resolution_here()

        refused = self.cast(self.here.owner, resolution)

        self.assertEqual(refused.status_code, 404)
        self.assertEqual(self.ballots(), [])

    def test_the_listing_shows_each_reader_their_own_ballot_and_the_tally_and_never_another_members_ballot(self):
        resolution = self.a_resolution_here()
        holder, other = self.here.members
        self.assertEqual(self.cast(holder.user, resolution, "for").status_code, 200)
        self.assertEqual(self.cast(other.user, resolution, "against").status_code, 200)
        voting_has_closed(resolution)
        with use_operator():
            close_resolution(resolution)

        def shown_to(user):
            self.client.force_authenticate(user)
            rows = self.client.get(LISTING).json()["results"]
            return next(row for row in rows if row["uuid"] == str(resolution.pk))

        mine, theirs, company = shown_to(holder.user), shown_to(other.user), shown_to(self.here.owner)
        self.assertEqual((mine["myBallot"]["choice"], theirs["myBallot"]["choice"]), ("for", "against"))
        self.assertIsNone(company["myBallot"])
        self.assertEqual(mine["result"], theirs["result"])
        self.assertEqual(company["result"], mine["result"])
        self.assertEqual(
            (mine["result"]["for"], mine["result"]["against"], mine["result"]["carried"]),
            ({"shares": str(holder.shares), "members": 1}, {"shares": str(other.shares), "members": 1}, True),
        )

    def test_a_person_on_the_roll_twice_with_one_holding_voted_by_staff_casts_the_rest_through_the_route(self):
        with use_operator():
            world = a_company_with_members("scoped-partial", holdings=(100, 40), first_person_holds_twice=True)
            resolution = a_resolution(world)
            person = world.members[0].user
            proxied = PublicationRecipient.objects.get(publication=resolution, user_id=person.pk, shares=40)
            proxy = staff_user("scoped-partial-proxy")
            enter_ballot(proxy, resolution, proxied, "against", "Proxy form SYN-3")

        self.client.force_authenticate(person)
        partly = next(row for row in self.client.get(LISTING).json()["results"] if row["uuid"] == str(resolution.pk))
        cast = self.cast(person, resolution)

        self.assertEqual(
            (partly["ballotOutstanding"], partly["shares"], partly["myBallot"]["staffEntered"]), (True, "140", True)
        )
        self.assertEqual(cast.status_code, 200, cast.content)
        self.assertFalse(cast.json()["ballotOutstanding"])
        with use_operator():
            self.assertEqual(
                sorted(
                    PublicationEvent.objects.filter(publication=resolution).values_list("actor_id", "choice", "shares")
                ),
                sorted([(proxy.pk, "against", 40), (person.pk, "for", 100)]),
            )
