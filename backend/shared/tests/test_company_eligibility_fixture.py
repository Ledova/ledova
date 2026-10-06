from datetime import timedelta
from time import sleep
from unittest.mock import patch
from uuid import uuid4

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TransactionTestCase
from django.utils import timezone

from companies.models import (
    CompanyAppointment,
    CompanyAuthorityRequest,
    CompanyCapability,
)
from companies.services.authority import DECLARATION_VERSION, admit_authority_request
from companies.services.authority_requests import submit_authority_request
from companies.services.team import revoke_company_appointment
from companies.tests.registry_fixtures import matching_observation
from shared.db import use_operator
from shared.seeds.synthetic.authority import historical_owner_appointment
from shared.tests.company_eligibility import accept_company_eligibility
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_eligible, make_tenant
from shared.tests.upload_fixtures import pdf_bytes
from users.models import CompanyEligibilityDecision, UserAccount


class CompanyEligibilityFixtureCases:
    def setUp(self):
        super().setUp()
        with use_operator():
            self.tenant = make_tenant(f"eligibility-fixture-{uuid4().hex[:8]}")
        make_eligible(self.tenant)
        with use_operator():
            self.accounts = UserAccount.objects.count()
        scanner = patch("shared.uploads.scan_upload")
        scanner.start()
        self.addCleanup(scanner.stop)
        registry = patch(
            "companies.services.registry.lookup_company", return_value=matching_observation(self.tenant.company)
        )
        registry.start()
        self.addCleanup(registry.stop)

    def test_existing_historical_admin_is_reused_without_inventing_another_initial_admission(self):
        initial = historical_owner_appointment(self.tenant.company)
        retained = (initial.legacy_owner_id, initial.capabilities, initial.delegatable_capabilities)
        with use_operator():
            requests = CompanyAuthorityRequest.objects.count()
        decision = accept_company_eligibility(self.tenant)
        with use_operator():
            initial.refresh_from_db()
            decision.refresh_from_db()
            self.assertEqual(CompanyAuthorityRequest.objects.count(), requests)
            self.assertEqual(CompanyAppointment.objects.filter(legacy_owner__isnull=False).count(), 1)
            self.assertEqual(
                (initial.legacy_owner_id, initial.capabilities, initial.delegatable_capabilities), retained
            )
            self.assertEqual(decision.appointment.invitation.inviter_appointment_id, initial.pk)
            self.assertEqual(decision.outcome, "accepted")
            self.assertEqual(decision.request.company_id, self.tenant.company.pk)

    def test_current_personal_admin_without_the_required_delegation_cannot_be_replaced_with_bootstrap(self):
        request, _ = submit_authority_request(
            requester=self.tenant.user,
            company_id=self.tenant.company.pk,
            idempotency_key=uuid4(),
            file=SimpleUploadedFile("authority.pdf", pdf_bytes(), content_type="application/pdf"),
            requested_capabilities=[CompanyCapability.ADMIN],
        )
        appointment = admit_authority_request(
            requester=self.tenant.user,
            request_id=request.pk,
            declaration_version=DECLARATION_VERSION,
            accept_declaration=True,
        ).appointment
        with self.assertRaisesMessage(AssertionError, "Existing fixture authority must be current personal"):
            accept_company_eligibility(self.tenant)
        with use_operator():
            appointment.refresh_from_db()
            self.assertEqual(appointment.delegatable_capabilities, [])
            self.assertEqual(CompanyAuthorityRequest.objects.count(), 1)
            self.assertEqual(CompanyAppointment.objects.count(), 1)
            self.assertFalse(CompanyEligibilityDecision.objects.exists())
            self.assertEqual(UserAccount.objects.count(), self.accounts)

    def test_revoked_historical_admin_is_neither_reused_nor_replaced_with_bootstrap(self):
        initial = historical_owner_appointment(self.tenant.company)
        revoke_company_appointment(requester=self.tenant.user, appointment_id=initial.pk)
        with self.assertRaisesMessage(AssertionError, "Existing fixture authority must be current personal"):
            accept_company_eligibility(self.tenant)
        with use_operator():
            self.assertEqual(CompanyAppointment.objects.count(), 1)
            self.assertFalse(CompanyAuthorityRequest.objects.exists())
            self.assertFalse(CompanyEligibilityDecision.objects.exists())
            self.assertEqual(UserAccount.objects.count(), self.accounts)

    def test_missing_appointment_on_an_unrooted_company_gets_actual_declaration_and_activation(self):
        decision = accept_company_eligibility(self.tenant)
        with use_operator():
            initial = decision.appointment.invitation.inviter_appointment
            self.assertIsNotNone(initial.request_id)
            self.assertIsNone(initial.legacy_owner_id)
            self.assertEqual(initial.request.status, "admitted")
            self.assertEqual(initial.capabilities, [CompanyCapability.ADMIN])
            self.assertEqual(CompanyAuthorityRequest.objects.count(), 1)
            self.tenant.company.refresh_from_db()
            self.assertEqual(self.tenant.company.status, "active")
            self.assertFalse(self.tenant.user.is_staff)

    def test_expired_initial_admin_cannot_be_replaced_with_bootstrap(self):
        expiry = timezone.now() + timedelta(seconds=10)
        request, _ = submit_authority_request(
            requester=self.tenant.user,
            company_id=self.tenant.company.pk,
            idempotency_key=uuid4(),
            file=SimpleUploadedFile("authority.pdf", pdf_bytes(), content_type="application/pdf"),
            requested_capabilities=[CompanyCapability.ADMIN],
            delegatable_capabilities=[CompanyCapability.PREPARE, CompanyCapability.APPROVE],
            requested_expires_at=expiry,
        )
        appointment = admit_authority_request(
            requester=self.tenant.user,
            request_id=request.pk,
            declaration_version=DECLARATION_VERSION,
            accept_declaration=True,
        ).appointment
        sleep(max(0, (expiry - timezone.now()).total_seconds()) + 0.05)
        with self.assertRaisesMessage(AssertionError, "Existing fixture authority must be current personal"):
            accept_company_eligibility(self.tenant)
        with use_operator():
            appointment.refresh_from_db()
            self.assertLessEqual(appointment.expires_at, timezone.now())
            self.assertEqual(CompanyAuthorityRequest.objects.count(), 1)
            self.assertEqual(CompanyAppointment.objects.count(), 1)
            self.assertFalse(CompanyEligibilityDecision.objects.exists())
            self.assertEqual(UserAccount.objects.count(), self.accounts)

    def test_current_foreign_company_admin_is_not_reused_for_another_rooted_company(self):
        own = historical_owner_appointment(self.tenant.company)
        with use_operator():
            foreign = make_tenant(f"foreign-fixture-{uuid4().hex[:8]}")
        make_eligible(foreign)
        other = historical_owner_appointment(foreign.company)
        self.tenant.company = foreign.company
        with self.assertRaisesMessage(AssertionError, "Existing fixture authority must be current personal"):
            accept_company_eligibility(self.tenant)
        with use_operator():
            self.assertNotEqual(own.company_id, other.company_id)
            self.assertEqual(CompanyAppointment.objects.count(), 2)
            self.assertFalse(CompanyAuthorityRequest.objects.exists())
            self.assertFalse(CompanyEligibilityDecision.objects.exists())
            self.assertEqual(UserAccount.objects.count(), self.accounts + 1)


class CompanyEligibilityFixtureTest(CompanyEligibilityFixtureCases, TransactionTestCase):
    pass


class ScopedCompanyEligibilityFixtureTest(
    RunsOnTheScopedConnection, CompanyEligibilityFixtureCases, TransactionTestCase
):
    pass
