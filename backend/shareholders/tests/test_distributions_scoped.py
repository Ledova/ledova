import hashlib

from django.db import DatabaseError
from django.test import override_settings
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APITransactionTestCase

from shared.db import atomic, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.test_admin_row_actions import ADMIN_STORAGES
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.models import (
    PublicationEvent,
    PublicationEventKind,
    PublicationRecipient,
)
from shareholders.services.distributions import withdraw_payment
from shareholders.services.resolutions import verify_publication
from shareholders.tests.fixtures import (
    PAYABLE_ON,
    PUBLICATION_BYTES,
    a_company_with_members,
    a_distribution,
    a_payment,
    roll_row,
)

LISTING = "/api/v1/publications/"


@override_settings(STORAGES=ADMIN_STORAGES)
class ScopedDistributionTest(RunsOnTheScopedConnection, StubUploadDependencies, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.here = a_company_with_members("scoped-dividend-here", holdings=(100, 40))
            self.there = a_company_with_members("scoped-dividend-there")
            self.mine = a_distribution(self.here, rate="0.025")
            self.theirs = a_distribution(self.there, rate="0.025")
            holder, other = self.here.members
            self.holders = [
                a_payment(self.here, self.mine, holder, reference="LDV-WRONG"),
                withdraw_payment(self.here.staff, self.mine, roll_row(self.mine, holder), "Correction C-20"),
                a_payment(self.here, self.mine, holder, reference="LDV-RIGHT"),
            ]
            self.others = [a_payment(self.here, self.mine, other, reference="LDV-OTHER")]
            self.strangers = [a_payment(self.there, self.theirs, self.there.members[0], reference="LDV-THERE")]

    def visible(self, model, **filters):
        with atomic():
            return set(model.objects.filter(**filters).values_list("pk", flat=True))

    def test_a_member_reads_their_own_entitlement_and_payment_records_and_no_other_member_s(self):
        holder = self.here.members[0]
        self.the_principal_the_middleware_would_set(holder.user)

        with atomic():
            entitled = list(PublicationRecipient.objects.values_list("user_id", "entitlement"))

        self.assertEqual(entitled, [(holder.user.pk, roll_row(self.mine, holder).entitlement)])
        self.assertEqual(self.visible(PublicationEvent), {event.pk for event in self.holders})

    def test_a_member_of_another_company_reads_none_of_this_company_s_records_or_entitlements(self):
        self.the_principal_the_middleware_would_set(self.there.members[0].user)

        self.assertEqual(self.visible(PublicationEvent, publication_id=self.mine.pk), set())
        self.assertEqual(self.visible(PublicationRecipient, publication_id=self.mine.pk), set())
        self.assertEqual(self.visible(PublicationEvent), {event.pk for event in self.strangers})

    def test_the_company_reads_every_payment_record_and_entitlement_of_its_own_distribution_and_no_other(self):
        self.the_principal_the_middleware_would_set(self.here.owner)

        self.assertEqual(self.visible(PublicationEvent), {event.pk for event in (*self.holders, *self.others)})
        with atomic():
            entitled = sorted(PublicationRecipient.objects.values_list("entitlement", flat=True))
        self.assertEqual([str(amount) for amount in entitled], ["1.00", "2.50"])

    def test_the_route_serves_each_reader_their_own_entitlement_and_standing_record_on_the_app_connection(self):
        holder, other = self.here.members

        def shown_to(user):
            self.client.force_authenticate(user)
            rows = self.client.get(LISTING).json()["results"]
            return {row["uuid"]: row for row in rows}

        mine, theirs, company, stranger = (
            shown_to(user) for user in (holder.user, other.user, self.here.owner, self.there.members[0].user)
        )
        row = mine[str(self.mine.pk)]
        self.assertEqual(
            (row["myEntitlement"], row["myPaymentRecord"]["reference"], row["myPaymentRecord"]["recordedPaidOn"]),
            ("2.50", "LDV-RIGHT", PAYABLE_ON.isoformat()),
        )
        self.assertEqual(theirs[str(self.mine.pk)]["myPaymentRecord"]["reference"], "LDV-OTHER")
        self.assertEqual(
            (company[str(self.mine.pk)]["myEntitlement"], company[str(self.mine.pk)]["myPaymentRecord"]), (None, None)
        )
        self.assertEqual(
            [shown[str(self.mine.pk)]["myRecordedEntitlement"] for shown in (mine, theirs, company)],
            ["2.50", "1.00", None],
        )
        self.assertNotIn(str(self.mine.pk), stranger)

    def test_a_person_holding_twice_is_shown_how_much_the_company_has_recorded_on_the_app_connection(self):
        with use_operator():
            world = a_company_with_members("scoped-dividend-twice", holdings=(100, 40), first_person_holds_twice=True)
            distribution = a_distribution(world, rate="0.025")
        person = world.members[0].user
        self.client.force_authenticate(person)

        def shown():
            row = next(row for row in self.client.get(LISTING).json()["results"] if row["uuid"] == str(distribution.pk))
            return row["myEntitlement"], row["myRecordedEntitlement"]

        self.assertEqual(shown(), ("3.50", "0.00"))
        with use_operator():
            a_payment(world, distribution, world.members[1], reference="LDV-SMALLER-HOLDING")
        self.assertEqual(shown(), ("3.50", "1.00"))
        with use_operator():
            a_payment(world, distribution, world.members[0], reference="LDV-LARGER-HOLDING")
        self.assertEqual(shown(), ("3.50", "3.50"))
        with use_operator():
            withdraw_payment(world.staff, distribution, roll_row(distribution, world.members[1]), "Correction C-21")
        self.assertEqual(shown(), ("3.50", "2.50"))

    def test_the_app_role_can_neither_record_rewrite_nor_delete_a_payment_record(self):
        holder = self.here.members[0]
        standing = self.holders[-1]
        self.the_principal_the_middleware_would_set(self.here.owner)

        with self.assertRaises(DatabaseError), atomic():
            PublicationEvent.objects.create(
                publication_id=self.mine.pk,
                company_id=self.here.company.pk,
                kind=PublicationEventKind.PAYMENT_VOID,
                recipient_id=roll_row(self.mine, holder).pk,
                actor_id=self.here.owner.pk,
                staff_entered=True,
                authority="The company withdrawing it itself",
            )
        with self.assertRaises(DatabaseError), atomic():
            PublicationEvent.objects.filter(pk=standing.pk).update(reference="LDV-REWRITTEN")
        with atomic():
            removed, _ = PublicationEvent.objects.filter(pk=standing.pk).delete()

        self.assertEqual(removed, 0)
        with use_operator():
            self.assertEqual(PublicationEvent.objects.get(pk=standing.pk).reference, "LDV-RIGHT")
            self.assertEqual(verify_publication(self.mine.pk)["payments_recorded"], 2)

    def test_recording_a_payment_refuses_the_scoped_connection(self):
        self.the_principal_the_middleware_would_set(self.here.owner)

        with self.assertRaises(PermissionDenied), atomic():
            a_payment(self.here, self.mine, self.here.members[1])

    def test_the_evidence_is_stored_privately_and_its_digest_is_what_was_stored(self):
        with use_operator():
            record = PublicationEvent.objects.get(pk=self.holders[-1].pk)
            with record.evidence.open("rb") as stored:
                self.assertEqual(stored.read(), PUBLICATION_BYTES)
        self.assertEqual(record.evidence_digest, hashlib.sha256(PUBLICATION_BYTES).hexdigest())
        with self.assertRaises(ValueError):
            record.evidence.url
