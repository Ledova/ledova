from datetime import timedelta
from decimal import Decimal

from django.utils import timezone
from rest_framework.test import APITransactionTestCase

from offerings.models import Offering, OfferingExemption, OfferingStatus
from offerings.services.offering import submit_offering, transition_offering
from shared.db import use_migrate, use_operator
from shared.tests.upload_fixtures import StubUploadDependencies
from tokens.models import ShareToken, ShareTokenStatus
from users.models import InvestorCategory, InvestorClassificationStatus
from users.models.company_eligibility import (
    CompanyEligibilityDecision,
    CompanyEligibilityRequest,
)
from users.models.investor_classification import plus_years
from users.tests.factories import make_investor
from users.tests.test_company_eligibility_requests import (
    PDF,
    SOURCES,
    CompanyEligibilityCases,
)


class CompanyEligibilityCategoryTest(CompanyEligibilityCases, StubUploadDependencies, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        before = timezone.now()
        response = self.client.delete(f"{SOURCES}{self.source.pk}/")
        self.assertEqual(response.status_code, 204, response.content)
        with use_operator():
            self.source.refresh_from_db()
            self.assertEqual(self.source.status, InvestorClassificationStatus.WITHDRAWN)
            self.assertEqual(self.source.withdrawn_by_id, self.participant.pk)
            self.assertIsNone(self.source.reviewed_by_id)
            self.assertGreaterEqual(self.source.reviewed_at, before)
            with self.source.evidence_file.open("rb") as retained:
                self.assertEqual(retained.read(), PDF)

    def offering(self, *, price="500000.00", currency="AUD", future=False, label="PRODUCT"):
        with use_migrate():
            token = ShareToken.objects.create(
                company=self.company,
                name=f"Synthetic {label} shares",
                symbol=label,
                total_supply="10",
                status=ShareTokenStatus.DEPLOYED,
                contract_address="0x" + ("a" if label == "PRODUCT" else "b") * 40,
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
                opens_at=timezone.now() + timedelta(days=30) if future else timezone.now() - timedelta(days=1),
                summary="Synthetic deliberately published offer terms",
            )
            reviewer, _ = make_investor(f"eligibility-publisher-{label}", staff=True)
            submit_offering(offering, submitted_by=self.owner)
            transition_offering(offering, "approve", reviewed_by=reviewer)
            offering.refresh_from_db()
        self.assertEqual(offering.status, OfferingStatus.APPROVED)
        return offering

    def test_certificate_shares_exact_certifier_fields_and_acceptance_cannot_pass_its_real_boundary(self):
        issued = timezone.localdate() - timedelta(days=700)
        source = self.submit_source(
            category=InvestorCategory.ACCOUNTANT_CERTIFICATE,
            certificate_issued_at=issued.isoformat(),
            certifier_name="Synthetic Certifier",
            certifier_body="ca_anz",
            certifier_membership_number="SYNTHETIC-863",
        )
        self.source = source
        boundary = plus_years(issued)
        self.requested_expiry = boundary - timedelta(seconds=1)
        preview = self.preview()
        self.assertEqual(preview.status_code, 200, preview.content)
        summary = preview.json()["sharedSummary"]
        self.assertEqual(summary["certificateIssuedAt"], issued.isoformat())
        self.assertEqual(summary["certifierName"], "Synthetic Certifier")
        self.assertEqual(summary["certifierBody"], "ca_anz")
        self.assertEqual(summary["certifierMembershipNumber"], "SYNTHETIC-863")
        self.assert_private_summary(preview.json())
        request, _ = self.created_request()
        self.client.force_authenticate(self.approver)
        refused = self.decision_preview(request, expires_at=(boundary + timedelta(seconds=1)).isoformat())
        self.assertEqual(refused.status_code, 200, refused.content)
        self.assertFalse(refused.json()["canDecide"])
        attempted = self.decide(
            request,
            digest=refused.json()["previewDigest"],
            expires_at=(boundary + timedelta(seconds=1)).isoformat(),
        )
        self.assertEqual(attempted.status_code, 400, attempted.content)
        accepted = self.decide(request)
        self.assertEqual(accepted.status_code, 200, accepted.content)
        with use_operator():
            decision = CompanyEligibilityDecision.objects.get(request=request)
            self.assertLess(decision.expires_at, boundary)

    def test_future_dated_certificate_does_not_supply_an_acceptance_boundary(self):
        source = self.submit_source(
            category=InvestorCategory.ACCOUNTANT_CERTIFICATE,
            certificate_issued_at=(timezone.localdate() + timedelta(days=1)).isoformat(),
            certifier_name="Synthetic Future Certifier",
            certifier_body="cpa_australia",
            certifier_membership_number="FUTURE-863",
        )
        response = self.preview(source=str(source.pk))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()["canSubmit"])
        self.assertIn("certificate_not_current", response.json()["unmetRequirements"])
        attempted = self.create(source=str(source.pk), digest=response.json()["previewDigest"])
        self.assertEqual(attempted.status_code, 400, attempted.content)
        with use_operator():
            self.assertFalse(CompanyEligibilityRequest.objects.exists())

    def test_associated_source_names_only_its_actual_issuer_and_never_accepts_another_company(self):
        foreign, _ = self.company_fixture("Associated Foreign Pty Ltd", "004085616")
        self.source = self.submit_source(category=InvestorCategory.ASSOCIATED_PERSON, company=str(self.company.pk))
        preview = self.preview()
        self.assertEqual(preview.status_code, 200, preview.content)
        self.assertEqual(preview.json()["sharedSummary"]["associatedCompany"], str(self.company.pk))
        wrong = self.preview(company=str(foreign.pk))
        self.assertEqual(wrong.status_code, 200, wrong.content)
        self.assertFalse(wrong.json()["canSubmit"])
        self.assertIn("associated_company_mismatch", wrong.json()["unmetRequirements"])
        attempted = self.create(company=str(foreign.pk), digest=wrong.json()["previewDigest"])
        self.assertEqual(attempted.status_code, 400, attempted.content)
        request, _ = self.created_request()
        self.client.force_authenticate(self.approver)
        self.assertEqual(self.decide(request).status_code, 200)
        with use_operator():
            self.assertEqual(CompanyEligibilityRequest.objects.count(), 1)
            self.source.refresh_from_db()
            self.assertIsNone(self.source.reviewed_by_id)

    def test_product_request_uses_exact_published_offer_quantity_and_server_amount(self):
        offering = self.offering(future=True)
        self.assertFalse(offering.is_open)
        self.source = self.submit_source(category=InvestorCategory.PRODUCT_VALUE)
        preview = self.preview(offering=str(offering.pk), quantity=1)
        self.assertEqual(preview.status_code, 200, preview.content)
        summary = preview.json()["sharedSummary"]
        self.assertIsInstance(summary["offeringTerms"], dict)
        self.assertEqual(summary["offeringTerms"]["offering"], str(offering.pk))
        self.assertEqual(summary["offering"], str(offering.pk))
        self.assertEqual(summary["token"], str(offering.token_id))
        self.assertEqual(summary["company"], str(self.company.pk))
        self.assertEqual(summary["quantity"], 1)
        self.assertEqual(summary["pricePerShare"], "500000.00")
        self.assertEqual(summary["priceCurrency"], "AUD")
        self.assertEqual(summary["amountAud"], "500000.00")
        request, body = self.created_request(offering=str(offering.pk), quantity=1)
        self.assertEqual(request.offering_id, offering.pk)
        self.assertEqual(request.token_id, offering.token_id)
        self.assertEqual(request.amount_aud, Decimal("500000.00"))
        self.assertEqual(request.offering_terms_digest, summary["offeringTermsDigest"])
        self.assert_private_summary(body)
        self.client.force_authenticate(self.approver)
        self.assertEqual(self.decide(request).status_code, 200)

    def test_product_threshold_has_a_real_red_below_500000_and_no_company_only_context(self):
        offering = self.offering(price="499999.99")
        self.source = self.submit_source(category=InvestorCategory.PRODUCT_VALUE)
        below = self.preview(offering=str(offering.pk), quantity=1)
        self.assertEqual(below.status_code, 200, below.content)
        self.assertFalse(below.json()["canSubmit"])
        self.assertIn("product_context_invalid", below.json()["unmetRequirements"])
        attempted = self.create(digest=below.json()["previewDigest"], offering=str(offering.pk), quantity=1)
        self.assertEqual(attempted.status_code, 400, attempted.content)
        for terms in (
            {"company": str(self.company.pk)},
            {"offering": str(offering.pk), "quantity": 0},
            {"offering": str(offering.pk), "quantity": "1.1"},
        ):
            with self.subTest(terms=terms):
                response = self.preview(**terms)
                self.assertEqual(response.status_code, 400, response.content)
        with use_operator():
            self.assertFalse(CompanyEligibilityRequest.objects.exists())

    def test_non_aud_product_and_caller_chosen_second_company_are_refused(self):
        offering = self.offering(currency="USD")
        self.source = self.submit_source(category=InvestorCategory.PRODUCT_VALUE)
        response = self.preview(offering=str(offering.pk), quantity=1)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()["canSubmit"])
        self.assertIn("product_context_invalid", response.json()["unmetRequirements"])
        attempted = self.create(digest=response.json()["previewDigest"], offering=str(offering.pk), quantity=1)
        self.assertEqual(attempted.status_code, 400, attempted.content)
        aud = self.offering(label="OTHER")
        response = self.preview(offering=str(aud.pk), quantity=1, company=str(self.company.pk))
        self.assertEqual(response.status_code, 400, response.content)
        with use_operator():
            self.assertFalse(CompanyEligibilityRequest.objects.exists())

    def test_product_offer_terms_drift_invalidates_the_request_preview(self):
        offering = self.offering()
        self.source = self.submit_source(category=InvestorCategory.PRODUCT_VALUE)
        preview = self.preview(offering=str(offering.pk), quantity=1)
        self.assertEqual(preview.status_code, 200, preview.content)
        with use_operator():
            Offering.objects.filter(pk=offering.pk).update(price_per_share=Decimal("500001.00"))
        response = self.create(digest=preview.json()["previewDigest"], offering=str(offering.pk), quantity=1)
        self.assertEqual(response.status_code, 409, response.content)
        with use_operator():
            self.assertFalse(CompanyEligibilityRequest.objects.exists())

    def test_identical_product_request_retry_after_maintenance_marked_offering_withdrawal_is_retained(self):
        offering = self.offering()
        self.source = self.submit_source(category=InvestorCategory.PRODUCT_VALUE)
        preview = self.preview(offering=str(offering.pk), quantity=1)
        self.assertEqual(preview.status_code, 200, preview.content)
        digest = preview.json()["previewDigest"]
        first = self.create(digest=digest, offering=str(offering.pk), quantity=1)
        self.assertEqual(first.status_code, 201, first.content)
        before = self.snapshots()
        with use_migrate():
            Offering.objects.filter(pk=offering.pk).update(
                status=OfferingStatus.WITHDRAWN,
                closed_at=timezone.now(),
                close_reason="Synthetic historical offering withdrawal maintenance fixture",
            )
        repeated = self.create(digest=digest, offering=str(offering.pk), quantity=1)
        self.assertEqual(repeated.status_code, 200, repeated.content)
        self.assertEqual(repeated.json(), first.json())
        self.assertEqual(self.snapshots(), before)
