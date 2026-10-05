from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.db import IntegrityError, connection, transaction
from django.test import TestCase, override_settings
from django.urls import reverse
from django.utils import timezone

from companies.models import Company, CompanyType
from users.models import (
    InvestorCategory,
    InvestorClassification,
    InvestorClassificationStatus,
)
from users.models.investor_classification import (
    plus_years,
)
from users.tests.factories import (
    make_classification,
    make_investor,
    rejected_classification,
    revoked_classification,
    verified_classification,
)

User = get_user_model()
ADMIN_TEST_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


class InvestorClassificationExpiryTest(TestCase):

    def setUp(self):
        self.reviewer = User.objects.create_user(email="expiry@example.test", password="pw-12345678", is_staff=True)
        _, self.account = make_investor("expiry")

    def test_a_verified_claim_past_its_expiry_is_not_live_without_any_sweep(self):
        classification = verified_classification(
            self.account, self.reviewer, expires_at=timezone.now() - timedelta(seconds=1)
        )

        self.assertEqual(classification.status, InvestorClassificationStatus.VERIFIED)
        self.assertFalse(classification.is_live)
        self.assertTrue(classification.is_expired)
        self.assertFalse(InvestorClassification.objects.live().exists())

    def test_a_verified_claim_inside_its_window_is_live(self):
        verified_classification(self.account, self.reviewer, expires_at=timezone.now() + timedelta(days=1))

        self.assertEqual(InvestorClassification.objects.live().count(), 1)

    def test_default_expiry_is_two_years_after_the_certificate_date(self):
        classification = make_classification(self.account, certificate_issued_at=date(2026, 3, 1))

        self.assertEqual(classification.default_expiry, plus_years(date(2026, 3, 1)))
        self.assertEqual(classification.default_expiry.year, 2028)

    def test_a_leap_day_certificate_expires_on_the_last_february_day(self):
        self.assertEqual(plus_years(date(2024, 2, 29)).date(), date(2026, 2, 28))


class InvestorClassificationOpenSubmissionConstraintTest(TestCase):

    def setUp(self):
        self.reviewer = User.objects.create_user(email="constraint@example.test", password="pw-1234567", is_staff=True)
        _, self.account = make_investor("constraint")

    def test_the_database_retains_multiple_private_submitted_sources(self):
        first = make_classification(self.account)
        second = make_classification(self.account)

        self.assertNotEqual(first.pk, second.pk)
        self.assertEqual(InvestorClassification.objects.filter(user_account=self.account).count(), 2)

    def test_a_second_claim_is_allowed_once_the_first_is_verified(self):
        verified_classification(self.account, self.reviewer)

        make_classification(self.account)

        self.assertEqual(InvestorClassification.objects.filter(user_account=self.account).count(), 2)

    def test_a_second_claim_is_allowed_once_the_first_is_rejected(self):
        rejected_classification(self.account, self.reviewer)

        make_classification(self.account)

        self.assertEqual(InvestorClassification.objects.filter(user_account=self.account).count(), 2)

    def test_a_second_claim_is_allowed_once_the_first_is_revoked(self):
        revoked_classification(self.account, self.reviewer)

        make_classification(self.account)

        self.assertEqual(InvestorClassification.objects.filter(user_account=self.account).count(), 2)

    def test_the_retired_one_open_constraint_is_absent(self):
        constraints = connection.introspection.get_constraints(
            connection.cursor(), InvestorClassification._meta.db_table
        )
        self.assertNotIn("investor_classification_one_open_submission", constraints)


class AssociatedPersonScopeConstraintTest(TestCase):

    def setUp(self):
        self.reviewer = User.objects.create_user(email="scope@example.test", password="pw-12345678", is_staff=True)
        _, self.account = make_investor("scope")
        self.owner = User.objects.create_user(email="scope-owner@example.test", password="pw-12345678")
        self.company = Company.objects.create(
            owner=self.owner, name="Scope Pty Ltd", company_type=CompanyType.PROPRIETARY, acn="123456789"
        )

    def test_the_database_refuses_an_associated_person_claim_that_names_no_issuer(self):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                make_classification(self.account, category=InvestorCategory.ASSOCIATED_PERSON)

    def test_the_database_refuses_an_issuer_on_any_other_category(self):
        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                make_classification(self.account, category=InvestorCategory.PROFESSIONAL_INVESTOR, company=self.company)

    def test_the_database_refuses_blanking_the_issuer_on_an_associated_person_claim(self):
        classification = make_classification(
            self.account, category=InvestorCategory.ASSOCIATED_PERSON, company=self.company
        )

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                InvestorClassification.objects.filter(pk=classification.pk).update(company=None)

    def test_deleting_the_issuer_is_refused_while_an_associated_person_claim_names_it(self):
        classification = verified_classification(
            self.account, self.reviewer, category=InvestorCategory.ASSOCIATED_PERSON, company=self.company
        )

        with self.assertRaises(IntegrityError):
            with transaction.atomic():
                Company.objects.filter(pk=self.company.pk).delete()

        classification.refresh_from_db()
        self.assertEqual(classification.company, self.company)

    def test_an_associated_person_claim_that_names_its_issuer_is_accepted(self):
        classification = make_classification(
            self.account, category=InvestorCategory.ASSOCIATED_PERSON, company=self.company
        )

        self.assertEqual(classification.company, self.company)

    def test_the_constraint_is_one_the_backend_actually_carries(self):
        constraints = connection.introspection.get_constraints(
            connection.cursor(), InvestorClassification._meta.db_table
        )

        self.assertIn("investor_classification_associated_person_names_the_issuer", constraints)

    def test_staff_cannot_create_private_sources_for_another_holder(self):
        staff = User.objects.create_superuser(email="scope-staff@example.test", password="pw-12345678")
        self.client.force_login(staff)

        with override_settings(STORAGES=ADMIN_TEST_STORAGES):
            response = self.client.post(reverse("admin:users_investorclassification_add"), {})

        self.assertEqual(response.status_code, 403)
        self.assertFalse(InvestorClassification.objects.exists())
