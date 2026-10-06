from contextlib import contextmanager
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError, connections
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from companies.services.authority_requests import _requester_principal
from companies.services.company import transition_company
from documents.models import Document
from offerings.models import Offering, OfferingExemption, OfferingStatus
from offerings.services.offering import submit_offering, transition_offering
from operators.models import Operator
from shared.db import (
    APP_ALIAS,
    OPERATOR_ALIAS,
    atomic,
    configured,
    current_alias,
    principal_of,
    use_app,
    use_migrate,
    use_operator,
)
from shared.tests.upload_fixtures import StubUploadDependencies, pdf_bytes
from tokens.models import ShareToken, ShareTokenStatus
from users.exceptions import InvestorNotEligibleException
from users.models import (
    InvestorCategory,
    InvestorClassification,
    InvestorClassificationStatus,
    UserAccount,
    UserProfile,
)
from users.models.company_eligibility import (
    CompanyEligibilityDecision,
    CompanyEligibilityRequest,
)
from users.models.investor_classification import plus_years
from users.services.company_eligibility_consumption import (
    COMPANY_CONTEXT_REQUIRED,
    EXACT_PRODUCT_CONTEXT_REQUIRED,
    NO_LIVE_COMPANY_DECISION,
    company_eligibility,
    require_company_eligibility,
    require_subscription_eligibility,
    subscription_eligibility,
)
from users.tests.factories import (
    attach_evidence,
    make_investor,
    verified_classification,
)
from users.tests.test_company_eligibility_requests import (
    PDF,
    REQUESTS,
    SOURCES,
    CompanyEligibilityCases,
)


class CompanyEligibilityConsumptionCases(CompanyEligibilityCases):
    @contextmanager
    def company_context(self, company, initial):
        previous = self.company, self.initial, self.approver, self.appointment
        self.company, self.initial = company, initial
        try:
            yield
        finally:
            self.company, self.initial, self.approver, self.appointment = previous

    @contextmanager
    def database_role(self, role, actor):
        with use_app() if role == "app" else use_operator(), _requester_principal(actor.pk), atomic():
            connection = connections[current_alias()]
            with connection.cursor() as cursor:
                cursor.execute(f"SET LOCAL ROLE {connection.ops.quote_name(settings.RLS_ROLES[role])}")
                cursor.execute("SELECT current_user")
                self.assertEqual(cursor.fetchone()[0], settings.RLS_ROLES[role])
            yield

    def accepted(self, **changes):
        self.key = uuid4()
        self.client.force_authenticate(self.participant)
        request, _ = self.created_request(**changes)
        self.client.force_authenticate(self.approver)
        response = self.decide(request)
        self.assertEqual(response.status_code, 200, response.content)
        with use_operator():
            decision = CompanyEligibilityDecision.objects.get(request=request)
        self.assertEqual(decision.outcome, "accepted")
        self.assertEqual(decision.decided_by_id, self.approver.pk)
        self.assertEqual(decision.appointment_id, self.appointment.pk)
        return request, decision

    def eligibility(self, account=None, company=None, *, actor=None, purpose="primary", **changes):
        with use_operator(), _requester_principal((actor or self.participant).pk):
            return company_eligibility(account or self.account, company or self.company, purpose=purpose, **changes)

    def subscription(self, offering, quantity, *, account=None, actor=None, **changes):
        with use_operator(), _requester_principal((actor or self.participant).pk):
            return subscription_eligibility(account or self.account, offering, quantity, **changes)

    def sql_current(
        self, decision, *, account=None, company=None, purpose="primary", offering=None, quantity=None, at=None
    ):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT users_company_eligibility_decision_current(%s, %s, %s, %s, %s, %s, %s)",
                [
                    decision.pk,
                    (account or self.account).pk,
                    (company or self.company).pk,
                    purpose,
                    offering.pk if offering else None,
                    quantity,
                    at or timezone.now(),
                ],
            )
            return cursor.fetchone()[0]

    def assert_admitted(self, outcome, request, decision, *, account=None):
        self.assertTrue(outcome.is_eligible, outcome.reasons)
        self.assertEqual(outcome.reasons, ())
        self.assertEqual(outcome.account.pk, (account or self.account).pk)
        self.assertEqual(outcome.request.pk, request.pk)
        self.assertEqual(outcome.decision.pk, decision.pk)
        self.assertEqual(outcome.request.source_id, request.source_id)

    def assert_refused(self, outcome, reason=NO_LIVE_COMPANY_DECISION, *, account=None):
        self.assertFalse(outcome.is_eligible)
        self.assertEqual(outcome.reasons, (reason,))
        self.assertIsNone(outcome.decision)
        self.assertIsNone(outcome.request)
        if account is not None:
            self.assertEqual(outcome.account.pk, account.pk)

    def replace_source(self, **changes):
        self.client.force_authenticate(self.participant)
        response = self.client.delete(f"{SOURCES}{self.source.pk}/")
        self.assertEqual(response.status_code, 204, response.content)
        with use_operator():
            self.source.refresh_from_db()
            self.assertEqual(self.source.status, InvestorClassificationStatus.WITHDRAWN)
            self.assertEqual(self.source.withdrawn_by_id, self.participant.pk)
        self.source = self.submit_source(**changes)
        return self.source

    def offering(self, *, company=None, price="500000.00", currency="AUD", label="CONSUME"):
        with use_migrate():
            token = ShareToken.objects.create(
                company=company or self.company,
                name=f"Synthetic {label} shares",
                symbol=label,
                total_supply="10",
                status=ShareTokenStatus.DEPLOYED,
                contract_address="0x" + uuid4().hex + "12345678",
                chain="base",
                deployed_at=timezone.now(),
            )
        with use_operator():
            offering = Offering.objects.create(
                token=token,
                exemption=OfferingExemption.PROFESSIONAL,
                price_per_share=Decimal(price),
                price_currency=currency,
                minimum_shares=1,
                target_shares=5,
                cap_shares=10,
                maximum_shares=10,
                opens_at=timezone.now() - timedelta(days=1),
                summary=f"Synthetic approved {label} exact terms",
            )
            reviewer, _ = make_investor(f"consumption-publisher-{label}", staff=True)
            submit_offering(offering, submitted_by=self.owner)
            transition_offering(offering, "approve", reviewed_by=reviewer)
            offering.refresh_from_db()
        self.assertEqual(offering.status, OfferingStatus.APPROVED)
        return offering

    def revoke(self, request):
        self.client.force_authenticate(self.approver)
        response = self.client.post(
            self.company_url(request, "revoke"),
            {
                "appointment": str(self.appointment.pk),
                "idempotency_key": str(uuid4()),
                "reason": "Synthetic decision revoked before a new consumer action",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["outcome"], "revoked")


class CompanyEligibilityConsumptionTest(
    CompanyEligibilityConsumptionCases, StubUploadDependencies, APITransactionTestCase
):
    def test_actual_professional_decision_admits_primary_and_secondary_for_exact_company(self):
        request, decision = self.accepted()
        for purpose in ("primary", "secondary"):
            with self.subTest(purpose=purpose):
                self.assert_admitted(self.eligibility(purpose=purpose), request, decision)
                with self.database_role("operator", self.participant):
                    self.assertTrue(self.sql_current(decision, purpose=purpose))
        with use_operator():
            self.source.refresh_from_db()
            self.assertEqual(self.source.status, InvestorClassificationStatus.SUBMITTED)
            self.assertIsNone(self.source.reviewed_by_id)
            self.assertIsNone(self.source.withdrawn_by_id)

    def test_nonempty_company_and_account_matrix_never_substitutes_sibling_decisions(self):
        request_a, decision_a = self.accepted()
        foreign, initial = self.company_fixture("Consumption Other Pty Ltd", "004085616")
        original_participant, original_account, original_source = self.participant, self.account, self.source
        other_source = self.submit_source(actor=self.other)
        with self.company_context(foreign, initial):
            self.approver, _, self.appointment = self.appointee("foreign-consumption-approver", ["prepare", "approve"])
            self.participant, self.account, self.source = self.other, self.other_account, other_source
            request_b, decision_b = self.accepted()
        self.participant, self.account, self.source = original_participant, original_account, original_source
        self.assert_admitted(self.eligibility(), request_a, decision_a)
        self.assert_admitted(
            self.eligibility(account=self.other_account, company=foreign, actor=self.other),
            request_b,
            decision_b,
            account=self.other_account,
        )
        self.assert_refused(self.eligibility(company=foreign))
        self.assert_refused(self.eligibility(account=self.other_account, actor=self.other), account=self.other_account)
        self.assert_refused(self.eligibility(decision_id=decision_b.pk))
        with self.database_role("operator", self.participant):
            self.assertFalse(self.sql_current(decision_a, company=foreign))
            self.assertFalse(self.sql_current(decision_a, account=self.other_account))
            self.assertFalse(self.sql_current(decision_b))
            self.assertTrue(self.sql_current(decision_a))

    def test_company_context_is_mandatory_even_with_an_accepted_decision(self):
        request, decision = self.accepted()
        with use_operator(), _requester_principal(self.participant.pk):
            self.assert_refused(company_eligibility(self.account, None, purpose="primary"), COMPANY_CONTEXT_REQUIRED)
            missing = company_eligibility(None, self.company, purpose="primary")
            self.assert_refused(missing, COMPANY_CONTEXT_REQUIRED)
            self.assertIsNone(missing.account)
        self.assert_admitted(self.eligibility(), request, decision)

    def test_historical_global_verified_source_supplies_no_company_permission(self):
        with use_migrate():
            legacy = verified_classification(self.other_account, self.owner)
            attach_evidence(legacy, PDF)
        self.assert_refused(self.eligibility(account=self.other_account, actor=self.other), account=self.other_account)
        with use_operator():
            self.assertEqual(InvestorClassification.objects.get(pk=legacy.pk).status, "verified")
            self.assertFalse(CompanyEligibilityRequest.objects.filter(user_account=self.other_account).exists())
        request, decision = self.accepted()
        self.assert_admitted(self.eligibility(), request, decision)

    def test_prepare_and_pending_source_or_refused_company_decision_never_grant_permission(self):
        self.assert_refused(self.eligibility())
        request, _ = self.created_request()
        self.assert_refused(self.eligibility())
        self.client.force_authenticate(self.approver)
        response = self.decide(request, outcome="refused", expires_at=None, reason="Synthetic evidence insufficient")
        self.assertEqual(response.status_code, 200, response.content)
        with use_operator():
            decision = CompanyEligibilityDecision.objects.get(request=request)
        self.assertEqual(decision.outcome, "refused")
        self.assert_refused(self.eligibility())
        with self.database_role("operator", self.participant):
            self.assertFalse(self.sql_current(decision))
        accepted, actual = self.accepted()
        self.assert_admitted(self.eligibility(), accepted, actual)

    def test_certificate_decision_is_company_scoped_and_respects_its_true_expiry_boundary(self):
        issued = timezone.localdate() - timedelta(days=700)
        self.replace_source(
            category=InvestorCategory.ACCOUNTANT_CERTIFICATE,
            certificate_issued_at=issued.isoformat(),
            certifier_name="Synthetic Qualified Accountant",
            certifier_body="ca_anz",
            certifier_membership_number="CONSUMER-863",
        )
        boundary = plus_years(issued)
        self.requested_expiry = boundary
        request, decision = self.accepted()
        for purpose in ("primary", "secondary"):
            self.assert_admitted(self.eligibility(purpose=purpose), request, decision)
            self.assert_refused(self.eligibility(purpose=purpose, at=boundary))
        foreign, _ = self.company_fixture("Certificate Other Pty Ltd", "004085616")
        self.assert_refused(self.eligibility(company=foreign))
        with self.database_role("operator", self.participant):
            self.assertTrue(self.sql_current(decision, at=boundary - timedelta(microseconds=1)))
            self.assertFalse(self.sql_current(decision, at=boundary))
            self.assertFalse(self.sql_current(decision, company=foreign))

    def test_associated_person_admits_only_named_company_primary_context(self):
        self.replace_source(category=InvestorCategory.ASSOCIATED_PERSON, company=str(self.company.pk))
        request, decision = self.accepted()
        offering = self.offering(price="1.00")
        self.assert_admitted(self.eligibility(), request, decision)
        self.assert_admitted(self.subscription(offering, 1), request, decision)
        self.assert_refused(self.eligibility(purpose="secondary"))
        foreign, _ = self.company_fixture("Associated Consumer Other Pty Ltd", "004085616")
        self.assert_refused(self.eligibility(company=foreign))
        with self.database_role("operator", self.participant):
            self.assertTrue(self.sql_current(decision))
            self.assertFalse(self.sql_current(decision, purpose="secondary"))
            self.assertFalse(self.sql_current(decision, company=foreign))

    def test_product_acceptance_at_500000_requires_exact_offering_token_and_whole_quantity(self):
        offering = self.offering()
        sibling = self.offering(label="SIBLING")
        self.replace_source(category=InvestorCategory.PRODUCT_VALUE)
        request, decision = self.accepted(offering=str(offering.pk), quantity=1)
        self.assertEqual(request.amount_aud, Decimal("500000.00"))
        self.assert_admitted(self.subscription(offering, 1), request, decision)
        self.assert_refused(self.subscription(offering, 2))
        self.assert_refused(self.subscription(sibling, 1))
        self.assert_refused(self.eligibility())
        self.assert_refused(self.eligibility(purpose="secondary"))
        with self.database_role("operator", self.participant):
            self.assertTrue(self.sql_current(decision, offering=offering, quantity=1))
            self.assertFalse(self.sql_current(decision, offering=offering, quantity=2))
            self.assertFalse(self.sql_current(decision, offering=sibling, quantity=1))
            self.assertFalse(self.sql_current(decision))
            self.assertFalse(self.sql_current(decision, purpose="secondary", offering=offering, quantity=1))

    def test_product_499999_99_refuses_genuine_proposal_while_server_500000_accepts(self):
        below = self.offering(price="499999.99", label="BELOW")
        boundary = self.offering(label="BOUNDARY")
        self.replace_source(category=InvestorCategory.PRODUCT_VALUE)
        preview = self.preview(offering=str(below.pk), quantity=1)
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertFalse(preview.json()["canSubmit"])
        refused = self.create(digest=preview.json()["previewDigest"], offering=str(below.pk), quantity=1)
        self.assertEqual(refused.status_code, 400, refused.content)
        with use_operator():
            self.assertFalse(CompanyEligibilityRequest.objects.exists())
        self.assert_refused(self.subscription(below, 1))
        request, decision = self.accepted(offering=str(boundary.pk), quantity=1)
        self.assert_admitted(self.subscription(boundary, 1), request, decision)
        self.assert_refused(self.subscription(below, 1))

    def test_subscription_rejects_unbounded_or_noninteger_quantity_without_company_fallback(self):
        offering = self.offering(price="1.00")
        request, decision = self.accepted()
        self.assert_admitted(self.subscription(offering, 1), request, decision)
        for quantity in (None, True, False, 0, -1, "1", 1.0, Decimal("1"), 2147483648):
            with self.subTest(quantity=quantity):
                self.assert_refused(self.subscription(offering, quantity), EXACT_PRODUCT_CONTEXT_REQUIRED)
        self.assert_refused(self.subscription(None, 1), EXACT_PRODUCT_CONTEXT_REQUIRED)
        foreign, _ = self.company_fixture("Foreign Subscription Consumer Pty Ltd", "004085616")
        foreign_offering = self.offering(company=foreign, price="1.00", label="FOREIGN")
        self.assert_refused(self.subscription(foreign_offering, 1))
        foreign_offering.company = self.company
        self.assert_refused(self.subscription(foreign_offering, 1))
        with self.database_role("operator", self.participant):
            self.assertFalse(self.sql_current(decision, offering=foreign_offering, quantity=1))
            self.assertTrue(self.sql_current(decision, offering=offering, quantity=1))

    def test_product_frozen_price_currency_and_terms_drift_each_stop_consumption(self):
        offering = self.offering()
        self.replace_source(category=InvestorCategory.PRODUCT_VALUE)
        request, decision = self.accepted(offering=str(offering.pk), quantity=1)
        self.assert_admitted(self.subscription(offering, 1), request, decision)
        for field, value in (
            ("price_per_share", Decimal("500001.00")),
            ("price_currency", "USD"),
            ("summary", "Synthetic changed published company terms"),
        ):
            previous = getattr(offering, field)
            with self.subTest(field=field):
                with use_operator():
                    Offering.objects.filter(pk=offering.pk).update(**{field: value})
                    offering.refresh_from_db()
                self.assert_refused(self.subscription(offering, 1))
                with self.database_role("operator", self.participant):
                    self.assertFalse(self.sql_current(decision, offering=offering, quantity=1))
                with use_operator():
                    Offering.objects.filter(pk=offering.pk).update(**{field: previous})
                    offering.refresh_from_db()
                self.assert_admitted(self.subscription(offering, 1), request, decision)

    def test_product_offering_closure_stops_new_consumption_without_rewriting_decision(self):
        offering = self.offering()
        self.replace_source(category=InvestorCategory.PRODUCT_VALUE)
        request, decision = self.accepted(offering=str(offering.pk), quantity=1)
        before = self.snapshots()
        self.assert_admitted(self.subscription(offering, 1), request, decision)
        with use_operator():
            transition_offering(offering, "close", reason="Synthetic offer closed")
            offering.refresh_from_db()
        self.assertEqual(offering.status, OfferingStatus.CLOSED)
        self.assert_refused(self.subscription(offering, 1))
        self.assertEqual(self.snapshots(), before)

    def test_source_actual_bytes_changed_or_missing_refuse_then_exact_restoration_recovers(self):
        request, decision = self.accepted()
        self.assert_admitted(self.eligibility(), request, decision)
        path = self.source.evidence_file.path
        with open(path, "wb") as evidence:
            evidence.write(pdf_bytes(width=641))
        self.assert_refused(self.eligibility())
        self.source.evidence_file.storage.delete(self.source.evidence_file.name)
        self.assert_refused(self.eligibility())
        with open(path, "wb") as evidence:
            evidence.write(PDF)
        self.assert_admitted(self.eligibility(), request, decision)

    def test_supporting_evidence_actual_bytes_and_missing_file_are_consumed(self):
        supporting = pdf_bytes(width=643)
        with patch("documents.services.document.extract_document.defer"):
            response = self.client.post(
                "/api/v1/documents/",
                {
                    "file": SimpleUploadedFile(
                        "consumer-private-support.pdf", supporting, content_type="application/pdf"
                    ),
                    "classification": str(self.source.pk),
                },
                format="multipart",
            )
        self.assertEqual(response.status_code, 202, response.content)
        with use_operator():
            document = Document.objects.get(pk=response.json()["uuid"])
        request, decision = self.accepted()
        self.assert_admitted(self.eligibility(), request, decision)
        with open(document.file.path, "wb") as evidence:
            evidence.write(pdf_bytes(width=645))
        self.assert_refused(self.eligibility())
        document.file.storage.delete(document.file.name)
        self.assert_refused(self.eligibility())
        with open(document.file.path, "wb") as evidence:
            evidence.write(supporting)
        self.assert_admitted(self.eligibility(), request, decision)

    def test_source_metadata_is_guarded_while_the_retained_decision_remains_consumable(self):
        request, decision = self.accepted()
        with self.database_role("operator", self.participant):
            with self.assertRaises(DatabaseError) as caught, atomic():
                InvestorClassification.objects.filter(pk=self.source.pk).update(declared_basis="Changed private source")
            self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514")
            self.assertTrue(self.sql_current(decision))
        self.assert_admitted(self.eligibility(), request, decision)

    def test_exact_decision_expiry_boundary_refuses_and_keeps_original_records(self):
        request, decision = self.accepted()
        before = self.snapshots()
        self.assert_admitted(self.eligibility(at=decision.expires_at - timedelta(microseconds=1)), request, decision)
        self.assert_refused(self.eligibility(at=decision.expires_at))
        self.assert_refused(self.eligibility(at=decision.expires_at + timedelta(microseconds=1)))
        with self.database_role("operator", self.participant):
            self.assertFalse(self.sql_current(decision, at=decision.expires_at))
        self.assertEqual(self.snapshots(), before)

    def test_a_caller_stale_time_cannot_restore_a_genuinely_expired_decision(self):
        self.requested_expiry = timezone.now() + timedelta(seconds=5)
        request, decision = self.accepted()
        captured_at = timezone.now()
        before = self.snapshots()
        self.assert_admitted(self.eligibility(at=captured_at), request, decision)
        with self.database_role("operator", self.participant):
            self.assertTrue(self.sql_current(decision, at=captured_at))
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM %s::timestamptz - clock_timestamp())) + 0.02)",
                    [decision.expires_at],
                )
                cursor.execute("SELECT clock_timestamp() >= %s", [decision.expires_at])
                self.assertIs(cursor.fetchone()[0], True)
            self.assertFalse(self.sql_current(decision, at=captured_at))
        self.assert_refused(self.eligibility(at=captured_at))
        self.assertEqual(self.snapshots(), before)

    def test_genuine_request_withdrawal_invalidates_consumption_and_preserves_decision(self):
        request, decision = self.accepted()
        self.assert_admitted(self.eligibility(), request, decision)
        self.client.force_authenticate(self.participant)
        response = self.client.post(
            f"{REQUESTS}{request.pk}/withdraw/", {"idempotency_key": str(uuid4())}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["withdrawal"]["withdrawnBy"], self.participant.pk)
        self.assert_refused(self.eligibility())
        with self.database_role("operator", self.participant):
            self.assertFalse(self.sql_current(decision))
        with use_operator():
            decision.refresh_from_db()
            self.assertEqual(decision.outcome, "accepted")
            self.assertEqual(decision.decided_by_id, self.approver.pk)

    def test_genuine_holder_source_withdrawal_stops_decision_consumption(self):
        request, decision = self.accepted()
        self.assert_admitted(self.eligibility(), request, decision)
        self.client.force_authenticate(self.participant)
        response = self.client.delete(f"{SOURCES}{self.source.pk}/")
        self.assertEqual(response.status_code, 204, response.content)
        self.assert_refused(self.eligibility())
        with self.database_role("operator", self.participant):
            self.assertFalse(self.sql_current(decision))
        with use_operator():
            self.source.refresh_from_db()
            self.assertEqual(self.source.withdrawn_by_id, self.participant.pk)
            self.assertIsNone(self.source.reviewed_by_id)
            self.assertEqual(CompanyEligibilityDecision.objects.get(pk=decision.pk).outcome, "accepted")

    def test_original_decision_d1_never_falls_back_to_current_d2(self):
        request_one, decision_one = self.accepted()
        self.assert_admitted(self.eligibility(decision_id=decision_one.pk), request_one, decision_one)
        self.revoke(request_one)
        request_two, decision_two = self.accepted()
        self.assertNotEqual(decision_one.pk, decision_two.pk)
        self.assert_admitted(self.eligibility(), request_two, decision_two)
        self.assert_admitted(self.eligibility(decision_id=decision_two.pk), request_two, decision_two)
        self.assert_refused(self.eligibility(decision_id=decision_one.pk))
        self.assert_refused(self.eligibility(decision_id=uuid4()))
        with self.database_role("operator", self.participant):
            self.assertFalse(self.sql_current(decision_one))
            self.assertTrue(self.sql_current(decision_two))

    def test_identity_change_is_rechecked_from_current_database_not_the_cached_account(self):
        request, decision = self.accepted()
        self.assertTrue(self.account.user_profile.is_id_verified)
        self.assert_admitted(self.eligibility(), request, decision)
        with use_operator():
            UserProfile.objects.filter(pk=self.account.user_profile_id).update(is_id_verified=False)
        self.assertTrue(self.account.user_profile.is_id_verified)
        self.assert_refused(self.eligibility())
        with self.database_role("operator", self.participant):
            self.assertFalse(self.sql_current(decision))
        with use_operator():
            UserProfile.objects.filter(pk=self.account.user_profile_id).update(is_id_verified=True)
        self.assert_admitted(self.eligibility(), request, decision)

    def test_current_refused_standing_blocks_under_both_kyc_policies(self):
        request, decision = self.accepted()
        self.assert_admitted(self.eligibility(), request, decision)
        for required in (True, False):
            with use_operator():
                Operator.objects.filter(pk=1).update(investor_kyc_required=required)
            for status in ("rejected", "suspended", "terminated"):
                with self.subTest(required=required, status=status):
                    with use_operator():
                        UserAccount.objects.filter(pk=self.account.pk).update(account_status=status)
                    self.assert_refused(self.eligibility())
                    with self.database_role("operator", self.participant):
                        self.assertFalse(self.sql_current(decision))
            with use_operator():
                UserAccount.objects.filter(pk=self.account.pk).update(account_status="active")
            self.assert_admitted(self.eligibility(), request, decision)

    def test_pending_and_unverified_account_only_passes_the_installed_kyc_off_policy(self):
        request, decision = self.accepted()
        with use_operator():
            UserAccount.objects.filter(pk=self.account.pk).update(account_status="pending", role="both")
            UserProfile.objects.filter(pk=self.account.user_profile_id).update(is_id_verified=False)
            Operator.objects.filter(pk=1).update(investor_kyc_required=False)
        self.assert_admitted(self.eligibility(), request, decision)
        with use_operator():
            Operator.objects.filter(pk=1).update(investor_kyc_required=True)
        self.assert_refused(self.eligibility())
        with use_operator():
            Operator.objects.filter(pk=1).update(investor_kyc_required=False)
        self.assert_admitted(self.eligibility(), request, decision)

    def test_inactive_unverified_email_and_noninvestor_role_stop_consumption_even_without_kyc(self):
        request, decision = self.accepted()
        with use_operator():
            Operator.objects.filter(pk=1).update(investor_kyc_required=False)
        for field in ("is_active", "is_email_verified"):
            with self.subTest(field=field):
                with use_operator():
                    type(self.participant).objects.filter(pk=self.participant.pk).update(**{field: False})
                self.assert_refused(self.eligibility())
                with use_operator():
                    type(self.participant).objects.filter(pk=self.participant.pk).update(**{field: True})
                self.assert_admitted(self.eligibility(), request, decision)
        with use_operator():
            UserAccount.objects.filter(pk=self.account.pk).update(role="company")
        self.assert_refused(self.eligibility())
        with use_operator():
            UserAccount.objects.filter(pk=self.account.pk).update(role="investor")
        self.assert_admitted(self.eligibility(), request, decision)

    def test_real_technical_company_suspension_blocks_new_consumption(self):
        request, decision = self.accepted()
        before = self.snapshots()
        self.assert_admitted(self.eligibility(), request, decision)
        with use_operator():
            technical, _ = make_investor("consumption-company-technical", staff=True)
        suspended = transition_company(
            self.company, "suspend", actor=technical, reason="Synthetic technical suspension"
        )
        self.assertEqual(suspended.status, "suspended")
        self.assert_refused(self.eligibility())
        with self.database_role("operator", self.participant):
            self.assertFalse(self.sql_current(decision))
        self.assertEqual(self.snapshots(), before)

    def test_missing_configuration_fails_without_bootstrap_or_record_changes(self):
        request, decision = self.accepted()
        before = self.snapshots()
        self.assert_admitted(self.eligibility(), request, decision)
        with use_operator():
            Operator.objects.filter(pk=1).delete()
        with self.assertRaisesMessage(ImproperlyConfigured, "Company eligibility configuration is missing."):
            self.eligibility()
        with use_operator():
            self.assertFalse(Operator.objects.exists())
        with self.database_role("operator", self.participant):
            self.assertFalse(self.sql_current(decision))
        self.assertEqual(self.snapshots(), before)

    def test_changed_retention_or_certificate_timezone_configuration_fails_closed(self):
        request, decision = self.accepted()
        self.assert_admitted(self.eligibility(), request, decision)
        with override_settings(
            CLASSIFICATION_EVIDENCE_RETENTION_DAYS=settings.CLASSIFICATION_EVIDENCE_RETENTION_DAYS + 1
        ):
            with self.assertRaisesMessage(ImproperlyConfigured, "retention configuration changed"):
                self.eligibility()
        changed_zone = "UTC" if settings.TIME_ZONE != "UTC" else "Australia/Sydney"
        with override_settings(TIME_ZONE=changed_zone):
            with self.assertRaisesMessage(ImproperlyConfigured, "Certificate time-zone configuration changed"):
                self.eligibility()
        self.assert_admitted(self.eligibility(), request, decision)

    def test_real_app_principal_reaches_bounded_operator_selector_and_is_restored(self):
        request, decision = self.accepted()
        with use_operator():
            previous_operator = principal_of()
        with self.app_as(self.participant):
            previous_app = principal_of()
            self.assertEqual(previous_app, str(self.participant.pk))
            self.assert_admitted(company_eligibility(self.account, self.company, purpose="primary"), request, decision)
            self.assertEqual(principal_of(), previous_app)
            with use_operator():
                expected = previous_operator if configured(APP_ALIAS) != configured(OPERATOR_ALIAS) else previous_app
                self.assertEqual(principal_of(), expected)
        with self.app_as(self.other):
            self.assert_refused(company_eligibility(self.account, self.company, purpose="primary"))
            self.assertEqual(principal_of(), str(self.other.pk))
            with use_operator():
                expected = (
                    previous_operator if configured(APP_ALIAS) != configured(OPERATOR_ALIAS) else str(self.other.pk)
                )
                self.assertEqual(principal_of(), expected)
        with use_operator():
            self.assertEqual(principal_of(), previous_operator)

    def test_installed_invoker_function_respects_real_private_source_visibility(self):
        request, decision = self.accepted()
        with self.database_role("operator", self.participant):
            self.assertTrue(self.sql_current(decision))
        with self.database_role("app", self.participant):
            self.assertTrue(InvestorClassification.objects.filter(pk=self.source.pk).exists())
        self.assert_admitted(self.eligibility(), request, decision)
        self.appoint_actor(self.participant, ["admin"])
        with self.database_role("app", self.participant):
            self.assertTrue(type(self.company).objects.filter(pk=self.company.pk).exists())
            self.assertTrue(self.sql_current(decision))
        with self.database_role("app", self.other):
            self.assertFalse(InvestorClassification.objects.filter(pk=self.source.pk).exists())
            self.assertFalse(self.sql_current(decision))
        self.assert_admitted(self.eligibility(), request, decision)

    def test_require_helpers_return_actual_basis_or_raise_403_without_substitution(self):
        request, decision = self.accepted()
        offering = self.offering(price="1.00")
        with use_operator(), _requester_principal(self.participant.pk):
            self.assert_admitted(
                require_company_eligibility(self.account, self.company, purpose="primary"), request, decision
            )
            self.assert_admitted(require_subscription_eligibility(self.account, offering, 1), request, decision)
        self.revoke(request)
        with use_operator(), _requester_principal(self.participant.pk):
            with self.assertRaises(InvestorNotEligibleException) as caught:
                require_company_eligibility(self.account, self.company, purpose="primary", decision_id=decision.pk)
            self.assertEqual(caught.exception.status_code, 403)
            self.assertEqual(caught.exception.reasons, (NO_LIVE_COMPANY_DECISION,))
            with self.assertRaises(InvestorNotEligibleException) as subscription:
                require_subscription_eligibility(self.account, offering, 1)
            self.assertEqual(subscription.exception.status_code, 403)
        with use_operator():
            self.assertEqual(CompanyEligibilityDecision.objects.get(pk=decision.pk).outcome, "accepted")
