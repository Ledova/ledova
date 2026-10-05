import hashlib
from datetime import timedelta
from types import SimpleNamespace

from django.db import DatabaseError, connections
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.models import (
    Company,
    CompanyAppointment,
    CompanyCapability,
    CompanyStatus,
)
from companies.services.authority_requests import _requester_principal
from shared.db import atomic, current_alias, principal_of, use_migrate, use_operator
from shared.seeds.synthetic.authority import (
    OWNER_PROVENANCE,
    historical_owner_appointment,
)
from shared.seeds.synthetic.chain.offerings import historical_subscription
from shared.seeds.synthetic.chain.population import _investor
from shared.seeds.synthetic.eligibility import (
    accept_source,
    company_approver,
)
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.upload_fixtures import StubUploadDependencies
from users.models import (
    CompanyEligibilityDecision,
    CompanyEligibilityRequest,
    InvestorCategory,
)
from users.services.company_eligibility_consumption import (
    company_eligibility,
    subscription_eligibility,
)
from users.tests.test_company_eligibility_consumption import (
    CompanyEligibilityConsumptionCases,
)
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet


class SyntheticCompanyEligibilityTest(
    CompanyEligibilityConsumptionCases, StubUploadDependencies, APITransactionTestCase
):
    def evidence_digest(self):
        with self.source.evidence_file.open("rb") as stored:
            return hashlib.sha256(stored.read()).hexdigest()

    def seeded_decision(self, **changes):
        with use_operator():
            return accept_source(self.source, self.company, self.approver, self.appointment, **changes)

    def test_holder_consent_and_real_company_appointment_admit_only_the_actual_issuer(self):
        with use_operator():
            source_before = self.source.__class__.objects.filter(pk=self.source.pk).values().get()
            holder_permissions = set(self.participant.user_permissions.values_list("pk", flat=True))
            approver_permissions = set(self.approver.user_permissions.values_list("pk", flat=True))
        digest = self.evidence_digest()
        with use_operator(), _requester_principal(self.other.pk):
            decision = self.seeded_decision()
            self.assertEqual(principal_of(), str(self.other.pk))
        self.assertEqual(decision.decided_by_id, self.approver.pk)
        self.assertEqual(decision.appointment_id, self.appointment.pk)
        self.assertTrue(decision.request.sharing_accepted)
        self.assertTrue(decision.request.declaration_accepted)
        self.assertEqual(decision.request.submitted_by_id, self.participant.pk)
        self.assertEqual(decision.request.source_id, self.source.pk)
        self.assertGreater(decision.decided_at, self.source.submitted_at)
        self.assertEqual(self.evidence_digest(), digest)
        with use_operator():
            self.assertEqual(self.source.__class__.objects.filter(pk=self.source.pk).values().get(), source_before)
            self.assertEqual(set(self.participant.user_permissions.values_list("pk", flat=True)), holder_permissions)
            self.assertEqual(set(self.approver.user_permissions.values_list("pk", flat=True)), approver_permissions)
        self.assertTrue(self.eligibility(purpose="secondary").is_eligible)
        self.assertFalse(self.eligibility(account=self.other_account, actor=self.other).is_eligible)

    def test_source_expiry_is_the_company_decision_limit(self):
        expires_at = timezone.now() + timedelta(days=8)
        with use_migrate():
            self.source.__class__.objects.filter(pk=self.source.pk).update(expires_at=expires_at)
            self.source.refresh_from_db()
        decision = self.seeded_decision()
        self.assertEqual(decision.expires_at, expires_at)
        self.assertEqual(decision.request.requested_expires_at, expires_at)

    def test_product_source_binds_the_genuine_exact_offer_and_whole_quantity(self):
        self.replace_source(category=InvestorCategory.PRODUCT_VALUE)
        offering = self.offering()
        decision = self.seeded_decision(offering=offering, quantity=1)
        self.assertEqual(decision.request.offering_id, offering.pk)
        self.assertEqual(decision.request.token_id, offering.token_id)
        self.assertEqual(decision.request.quantity, 1)
        with use_operator(), _requester_principal(self.participant.pk):
            self.assertTrue(subscription_eligibility(self.account, offering, 1).is_eligible)
            self.assertFalse(subscription_eligibility(self.account, offering, 2).is_eligible)
            self.assertFalse(company_eligibility(self.account, self.company, purpose="primary").is_eligible)
            self.assertFalse(company_eligibility(self.account, self.company, purpose="secondary").is_eligible)

    def test_associated_source_remains_primary_for_its_actual_company(self):
        self.replace_source(category=InvestorCategory.ASSOCIATED_PERSON, company=str(self.company.pk))
        decision = self.seeded_decision()
        self.assertEqual(decision.request.company_id, self.source.company_id)
        self.assertTrue(self.eligibility().is_eligible)
        self.assertFalse(self.eligibility(purpose="secondary").is_eligible)

    def test_missing_real_evidence_creates_no_request_or_decision(self):
        self.source.evidence_file.storage.delete(self.source.evidence_file.name)
        with use_operator():
            before = (CompanyEligibilityRequest.objects.count(), CompanyEligibilityDecision.objects.count())
        self.assertIsNone(self.seeded_decision())
        with use_operator():
            self.assertEqual(
                (CompanyEligibilityRequest.objects.count(), CompanyEligibilityDecision.objects.count()), before
            )

    def test_historical_verified_source_is_not_a_candidate_permission_without_a_new_decision(self):
        with use_migrate():
            self.source.__class__.objects.filter(pk=self.source.pk).update(
                status="verified", reviewed_at=timezone.now(), reviewed_by=self.approver
            )
            self.source.refresh_from_db()
        before = _investor(self.account, (), {"actual": self.company})
        self.assertEqual(before["companies"], frozenset())
        decision = self.seeded_decision()
        after = _investor(self.account, (), {"actual": self.company})
        self.assertEqual(after["companies"], frozenset({"actual"}))
        self.assertEqual(decision.request.source_id, self.source.pk)
        self.assertEqual(after["ready_at"], before["ready_at"])
        self.assertIsNone(after["ready_at"])
        self.assertLess(self.source.reviewed_at, decision.decided_at)

    def test_new_company_pa_is_a_real_accepted_invitation_without_staff_permission(self):
        appointment = company_approver(self.company, self.other)
        self.assertEqual(appointment.appointee_id, self.other.pk)
        self.assertIsNotNone(appointment.invitation_id)
        self.assertEqual(set(appointment.capabilities), {CompanyCapability.PREPARE, CompanyCapability.APPROVE})
        self.assertFalse(self.other.is_staff)
        self.assertEqual(company_approver(self.company, self.other).pk, appointment.pk)
        self.assertEqual(appointment.invitation.inviter_id, self.owner.pk)
        self.assertEqual(appointment.invitation.inviter_appointment_id, self.initial.pk)

    def test_historical_owner_source_is_explicit_and_does_not_claim_initial_admission(self):
        with use_migrate():
            company = Company.objects.create(
                owner=self.owner, name="Synthetic retained owner", acn="987654321", status=CompanyStatus.ACTIVE
            )
        appointment = historical_owner_appointment(company)
        self.assertEqual(appointment.legacy_owner.provenance, OWNER_PROVENANCE)
        self.assertEqual(appointment.legacy_owner.owner_id, self.owner.pk)
        self.assertIsNone(appointment.request_id)
        self.assertIsNone(appointment.registry_check_id)
        self.assertIsNone(appointment.declaration_version)
        self.assertEqual(appointment.capabilities, [CompanyCapability.ADMIN])
        self.assertEqual(historical_owner_appointment(company).pk, appointment.pk)
        with use_operator():
            self.assertEqual(CompanyAppointment.objects.filter(company=company).count(), 1)

    def test_historical_owner_fixture_restores_both_guards_before_current_operator_writes(self):
        with use_migrate():
            company = Company.objects.create(
                owner=self.owner, name="Synthetic guarded owner", acn="987654322", status=CompanyStatus.ACTIVE
            )
        appointment = historical_owner_appointment(company)
        with use_migrate(), connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT tgname, tgenabled FROM pg_trigger WHERE tgname IN "
                "('companies_legacy_owner_source_identity', 'companies_initial_appointment_identity') ORDER BY tgname"
            )
            self.assertEqual(
                cursor.fetchall(),
                [("companies_initial_appointment_identity", "O"), ("companies_legacy_owner_source_identity", "O")],
            )
        with self.database_role("operator", self.owner):
            with self.assertRaises(DatabaseError) as caught, atomic():
                appointment.legacy_owner.__class__.objects.filter(pk=appointment.legacy_owner_id).update(
                    provenance="forged historical source"
                )
            self.assertEqual(caught.exception.__cause__.sqlstate, "23514")
            with self.assertRaises(DatabaseError) as caught, atomic():
                CompanyAppointment.objects.filter(pk=appointment.pk).update(capabilities=["prepare", "approve"])
            self.assertEqual(caught.exception.__cause__.sqlstate, "23514")
        with use_operator():
            appointment.refresh_from_db()
            self.assertEqual(appointment.capabilities, [CompanyCapability.ADMIN])
            self.assertEqual(appointment.legacy_owner.provenance, OWNER_PROVENANCE)

    def test_historical_subscription_keeps_null_basis_and_the_original_timeline(self):
        offering = self.offering()
        with use_migrate():
            wallet = Wallet.objects.create(
                user_account=self.account,
                chain="base",
                address="0x" + "41" * 20,
                verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
                verified_at=timezone.now(),
            )
        now = timezone.now()
        application = SimpleNamespace(
            created_at=now - timedelta(days=15),
            submitted_at=now - timedelta(days=14),
            accepted_at=now - timedelta(days=13),
            quantity=1,
        )
        subscription = historical_subscription(application, offering, self.account, wallet, self.participant)
        self.assertIsNone(subscription.eligibility_decision_id)
        self.assertEqual(subscription.submitted_at, application.submitted_at)
        self.assertEqual(subscription.accepted_at, application.accepted_at)
        self.assertEqual(subscription.created_at, application.created_at)
        self.assertEqual(subscription.status, "accepted")
        with use_operator():
            self.assertFalse(CompanyEligibilityDecision.objects.exists())


class ScopedSyntheticCompanyEligibilityTest(RunsOnTheScopedConnection, SyntheticCompanyEligibilityTest):
    pass
