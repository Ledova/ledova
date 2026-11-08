from unittest.mock import patch

from django.conf import settings
from django.db import DatabaseError, connection
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient, APITransactionTestCase

from authentication.models import TermsAcceptance
from authentication.services.terms import TERMS_STATEMENT, TERMS_VERSION
from companies import authority_guards
from companies.models import CompanyAppointment
from companies.services.authority import is_company_appointment_effective
from shared.db import atomic, use_operator
from shared.tests.core_fixtures import company_for, person
from tokens.database_mirror_guards import _function
from users.services.profile import _mark


class TermsAcceptanceTest(APITransactionTestCase):
    def test_explicit_versioned_acceptance_is_atomic_private_immutable_and_preserves_old_authority(self):
        user, profile = person("new-terms")
        legacy_user, legacy_profile = person("existing-terms")
        with use_operator():
            profile.is_signup_completed = False
            profile.save(update_fields=["is_signup_completed"])
            legacy_profile.terms_and_conditions = True
            legacy_profile.save(update_fields=["terms_and_conditions"])
        self.client.force_authenticate(user)
        endpoint = f"/api/user-profiles/{profile.pk}/"
        acknowledgement = {
            "terms_version": TERMS_VERSION,
            "terms_and_conditions": True,
            "is_signup_completed": True,
        }
        for payload in (
            {"is_signup_completed": True},
            {"terms_and_conditions": True, "is_signup_completed": True},
            {"terms_version": TERMS_VERSION},
            {**acknowledgement, "terms_version": "2026-10-14"},
        ):
            with self.subTest(payload=payload):
                refused = self.client.patch(endpoint, payload, format="json")
                self.assertEqual(refused.status_code, 400, refused.content)
        self.assertFalse(TermsAcceptance.objects.exists())
        with patch("users.services.profile.follow_profile", side_effect=ValidationError("Synthetic rollback")):
            rolled_back = self.client.patch(endpoint, {**acknowledgement, "full_name": "Changed"}, format="json")
        self.assertEqual(rolled_back.status_code, 400, rolled_back.content)
        self.assertFalse(TermsAcceptance.objects.exists())
        profile.refresh_from_db()
        self.assertFalse(profile.is_signup_completed)

        accepted = self.client.patch(endpoint, acknowledgement, format="json")
        retry = self.client.patch(endpoint, acknowledgement, format="json")
        self.assertEqual(accepted.status_code, 200, accepted.content)
        self.assertEqual(retry.status_code, 200, retry.content)
        receipt = accepted.json()["termsAcceptance"]
        self.assertEqual(receipt, retry.json()["termsAcceptance"])
        self.assertEqual(receipt["version"], TERMS_VERSION)
        self.assertEqual(receipt["statement"], TERMS_STATEMENT)
        self.assertTrue(receipt["acceptedAt"])
        self.assertEqual(TermsAcceptance.objects.filter(user=user).count(), 1)
        self.assertEqual(self.client.get("/api/user-profiles/").json()["results"][0]["termsAcceptance"], receipt)

        legacy_client = APIClient()
        legacy_client.force_authenticate(legacy_user)
        legacy_path = f"/api/user-profiles/{legacy_profile.pk}/"
        self.assertIsNone(legacy_client.get("/api/user-profiles/").json()["results"][0]["termsAcceptance"])
        unchanged = legacy_client.patch(legacy_path, {"full_name": "Existing account"}, format="json")
        self.assertEqual(unchanged.status_code, 200, unchanged.content)
        self.assertFalse(TermsAcceptance.objects.filter(user=legacy_user).exists())
        foreign = legacy_client.patch(endpoint, acknowledgement, format="json")
        self.assertEqual(foreign.status_code, 404, foreign.content)

        with use_operator():
            original = list(TermsAcceptance.objects.values())
            for change in (
                lambda: TermsAcceptance.objects.filter(user=user).update(statement="Changed"),
                lambda: TermsAcceptance.objects.filter(user=user).delete(),
            ):
                with self.subTest(change=change), self.assertRaises(DatabaseError), atomic():
                    change()
            with self.assertRaises(DatabaseError), atomic():
                _mark(str(user.pk))
                TermsAcceptance.objects.create(user=legacy_user, version=TERMS_VERSION, statement=TERMS_STATEMENT)
            self.assertEqual(list(TermsAcceptance.objects.values()), original)
        with self.assertRaises(DatabaseError), atomic(), connection.cursor() as cursor:
            cursor.execute("SELECT quote_ident(%s)", [settings.RLS_ROLES["app"]])
            app = cursor.fetchone()[0]
            cursor.execute(f"SET LOCAL ROLE {app}")
            cursor.execute("SELECT * FROM authentication_termsacceptance")
        renewed = legacy_client.patch(legacy_path, acknowledgement, format="json")
        self.assertEqual(renewed.status_code, 200, renewed.content)
        self.assertEqual(TermsAcceptance.objects.filter(user=legacy_user).count(), 1)

        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
                [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"], settings.RLS_ROLES["app"]],
            )
            operator, migrate, app = cursor.fetchone()
            current = (
                _function(authority_guards.SQL, "companies_guard_initial_appointment")
                .replace("@OPERATOR_ROLE@", operator)
                .replace("@MIGRATE_ROLE@", migrate)
                .replace("@APP_ROLE@", app)
            )
            cursor.execute(current.replace(TERMS_VERSION, "2026-10-14"))
        try:
            with (
                patch("companies.services.authority.SIGNUP_DECLARATION_VERSION", "2026-10-14"),
                patch(
                    "companies.services.authority.SIGNUP_DECLARATION_TEXT",
                    "I am authorised to set up and administer this company’s workspace, including managing its users, "
                    "and I accept the Terms of Service (version 2026-10-14) on the company’s behalf. The company is "
                    "responsible for the company and share information it provides, its ASIC filings and legal "
                    "obligations.",
                ),
                patch("shared.tests.core_fixtures.SIGNUP_DECLARATION_VERSION", "2026-10-14"),
            ):
                company, appointment = company_for(legacy_user, "Historical Terms Pty Ltd", "777888999")
        finally:
            with connection.cursor() as cursor:
                cursor.execute(current)
        self.assertTrue(is_company_appointment_effective(appointment))
        retained = CompanyAppointment.objects.get(company=company)
        self.assertEqual(retained.declaration_version, "2026-10-14")
        self.assertIn("version 2026-10-14", retained.declaration_text)
