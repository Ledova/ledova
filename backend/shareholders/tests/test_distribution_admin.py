from decimal import Decimal
from uuid import uuid4

from django.contrib import admin
from django.contrib.auth.models import Permission
from django.test import TestCase, override_settings
from django.urls import reverse

from shared.tests.test_admin_row_actions import ADMIN_STORAGES, grant, staff_user
from shared.tests.upload_fixtures import StubUploadDependencies
from shareholders.models import Publication, PublicationEvent, PublicationKind
from shareholders.services.distributions import withdraw_payment
from shareholders.tests.fixtures import (
    DAY,
    DECLARED_ON,
    INSTRUCTION,
    PAYABLE_ON,
    PAYMENT_REFERENCE,
    a_company_with_members,
    a_distribution,
    a_payment,
    an_upload,
    published,
    roll_row,
)


def reading_the_chain(user):
    user.user_permissions.add(Permission.objects.get(codename="view_publicationevent"))
    user.user_permissions.add(Permission.objects.get(codename="view_publicationrecipient"))
    return type(user).objects.get(pk=user.pk)


@override_settings(STORAGES=ADMIN_STORAGES)
class DistributionsInTheAdminTest(StubUploadDependencies, TestCase):
    def setUp(self):
        self.world = a_company_with_members("admin-dividend", holdings=(100, 40, 1))
        self.first, self.second, self.smallest = self.world.members
        self.editor = reading_the_chain(
            grant(staff_user(f"dividend-editor-{uuid4().hex[:8]}"), admin.site._registry[Publication], "change")
        )
        self.client.force_login(self.editor)

    def publish(self, **changes):
        return self.client.post(
            reverse("admin:shareholders_publication_publish"),
            {
                "token": str(self.world.token.pk),
                "kind": PublicationKind.DISTRIBUTION,
                "title": "Final dividend 2026",
                "record_date": DAY.isoformat(),
                "instruction": INSTRUCTION,
                "authority_document": str(self.world.authority.pk),
                "file": an_upload("dividend.pdf"),
                "rate_per_share": "0.005",
                "declared_on": DECLARED_ON.isoformat(),
                "payment_date": PAYABLE_ON.isoformat(),
                "declared_total": "0.70",
                **changes,
            },
        )

    def payment_page(self, publication):
        return reverse("admin:shareholders_publication_payment", args=[publication.pk])

    def withdrawal_page(self, publication):
        return reverse("admin:shareholders_publication_withdrawal", args=[publication.pk])

    def record(self, publication, holder, **changes):
        return self.client.post(
            self.payment_page(publication),
            {
                "recipient": str(roll_row(publication, holder).pk),
                "paid_on": PAYABLE_ON.isoformat(),
                "reference": PAYMENT_REFERENCE,
                "evidence": an_upload("remittance.pdf"),
                "authority": "Payment advice PA-10",
                **changes,
            },
        )

    def test_the_publish_page_makes_a_distribution_with_its_rate_dates_and_checked_total(self):
        response = self.publish()

        distribution = Publication.objects.get()
        self.assertRedirects(
            response,
            reverse("admin:shareholders_publication_change", args=[distribution.pk]),
            fetch_redirect_response=False,
        )
        self.assertEqual(
            (distribution.kind, distribution.rate_per_share, distribution.declared_total, distribution.undistributed),
            (PublicationKind.DISTRIBUTION, Decimal("0.005"), Decimal("0.70"), Decimal("0.00")),
        )

    def test_the_publish_page_refuses_a_total_that_disagrees_with_the_rate_and_says_what_it_should_be(self):
        response = self.publish(declared_total="0.71")

        self.assertContains(response, "The declared total must be the 141 shares on the roll")
        self.assertContains(response, "0.70")
        self.assertFalse(Publication.objects.exists())

    def test_a_distribution_s_page_shows_its_terms_the_roll_s_entitlements_and_its_payment_records(self):
        distribution = a_distribution(self.world, rate="0.005")
        record = a_payment(self.world, distribution, self.first)

        response = self.client.get(reverse("admin:shareholders_publication_change", args=[distribution.pk]))

        self.assertContains(response, "Undistributed")
        self.assertContains(response, "0.005000")
        self.assertContains(response, self.payment_page(distribution))
        self.assertContains(response, self.withdrawal_page(distribution))
        self.assertContains(response, record.entry_hash)
        self.assertContains(response, record.evidence_digest)
        self.assertContains(response, "0.50")
        self.assertNotContains(response, "Tally")

    def test_a_document_s_page_offers_no_payment_pages(self):
        statement = published(self.world)

        response = self.client.get(reverse("admin:shareholders_publication_change", args=[statement.pk]))

        self.assertEqual(response.status_code, 200)
        self.assertNotContains(response, self.payment_page(statement))
        self.assertEqual(self.client.get(self.payment_page(statement)).status_code, 404)
        self.assertEqual(self.client.get(self.withdrawal_page(statement)).status_code, 404)

    def test_staff_record_a_payment_on_the_company_s_advice_with_its_evidence(self):
        distribution = a_distribution(self.world, rate="0.005")

        response = self.record(distribution, self.second)

        self.assertRedirects(
            response,
            reverse("admin:shareholders_publication_change", args=[distribution.pk]),
            fetch_redirect_response=False,
        )
        record = PublicationEvent.objects.get()
        self.assertEqual(
            (record.kind, record.recipient_id, record.actor_id, record.reference, record.authority),
            (
                "payment",
                roll_row(distribution, self.second).pk,
                self.editor.pk,
                PAYMENT_REFERENCE,
                "Payment advice PA-10",
            ),
        )
        self.assertEqual(len(record.evidence_digest), 64)

    def test_the_payment_page_offers_only_members_owed_something_with_no_standing_record(self):
        distribution = a_distribution(self.world, rate="0.005")
        a_payment(self.world, distribution, self.first)

        response = self.client.get(self.payment_page(distribution))

        self.assertContains(response, str(roll_row(distribution, self.second).pk))
        self.assertNotContains(response, str(roll_row(distribution, self.first).pk))
        self.assertNotContains(response, str(roll_row(distribution, self.smallest).pk))

    def test_a_record_the_service_refuses_says_why_and_records_nothing(self):
        distribution = a_distribution(self.world, rate="0.005")

        dated_early = self.record(distribution, self.first, paid_on=DECLARED_ON.replace(day=1).isoformat())
        not_a_pdf = self.record(distribution, self.first, evidence=an_upload("advice.txt", b"plain text"))

        self.assertContains(dated_early, "before the dividend was declared. Nothing was recorded.")
        self.assertContains(not_a_pdf, "Only .pdf, .png, .jpg, .jpeg files are allowed. Nothing was recorded.")
        self.assertFalse(PublicationEvent.objects.exists())

    def test_staff_withdraw_a_standing_record_with_the_reason_and_only_standing_records_are_offered(self):
        distribution = a_distribution(self.world, rate="0.005")
        a_payment(self.world, distribution, self.first)
        a_payment(self.world, distribution, self.second)
        withdraw_payment(self.world.staff, distribution, roll_row(distribution, self.second), "Correction C-11")

        offered = self.client.get(self.withdrawal_page(distribution))
        response = self.client.post(
            self.withdrawal_page(distribution),
            {"recipient": str(roll_row(distribution, self.first).pk), "reason": "Company correction C-12"},
        )

        self.assertContains(offered, str(roll_row(distribution, self.first).pk))
        self.assertNotContains(offered, str(roll_row(distribution, self.second).pk))
        self.assertRedirects(
            response,
            reverse("admin:shareholders_publication_change", args=[distribution.pk]),
            fetch_redirect_response=False,
        )
        withdrawn = PublicationEvent.objects.order_by("sequence").last()
        self.assertEqual(
            (withdrawn.kind, withdrawn.recipient_id, withdrawn.authority, withdrawn.actor_id),
            ("payment_void", roll_row(distribution, self.first).pk, "Company correction C-12", self.editor.pk),
        )

    def test_staff_who_may_only_view_publications_cannot_record_or_withdraw(self):
        distribution = a_distribution(self.world, rate="0.005")
        a_payment(self.world, distribution, self.first)
        self.client.force_login(
            grant(staff_user(f"dividend-viewer-{uuid4().hex[:8]}"), admin.site._registry[Publication], "view")
        )

        recorded = self.record(distribution, self.second)
        withdrawn = self.client.post(
            self.withdrawal_page(distribution),
            {"recipient": str(roll_row(distribution, self.first).pk), "reason": "Company correction C-13"},
        )

        self.assertEqual((recorded.status_code, withdrawn.status_code), (403, 403))
        self.assertEqual(PublicationEvent.objects.count(), 1)
