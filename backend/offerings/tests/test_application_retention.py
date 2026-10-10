from contextlib import nullcontext
from decimal import Decimal

from django.conf import settings
from rest_framework.test import APITransactionTestCase

from companies.models import Company, CompanyStatus
from offerings.models import Offering, Subscription, SubscriptionStatus
from offerings.services.subscription import accept, issue_instruction, submit
from offerings.tests.factories import (
    configure_operator,
    draft_subscription,
    eligible_subscriber,
    forget_fixture_subscriptions,
    open_offering,
    subscription_technical_actor,
)
from shared.db import APP_ALIAS, acting_for, use_migrate, use_operator
from shared.tests.tenants import make_tenant
from tokens.models import (
    RequestStatus,
    ShareIssuanceRequest,
    ShareToken,
    ShareTokenStatus,
)

BASE = "/api/v1/subscriptions/"
VISIBILITY = ("open", "paused", "closed", "warning", "suspended", "paused_closed")


class ApplicationRetentionCases:
    def operator(self):
        return use_operator() if settings.RLS_AMBIENT_ALIAS == APP_ALIAS else nullcontext()

    def setUp(self):
        super().setUp()
        with self.operator():
            self.issuer = make_tenant("retained-issuer")
            self.investor = make_tenant("retained-investor")
            self.bystander = make_tenant("retained-bystander")
            forget_fixture_subscriptions()
            configure_operator()
            self.offering = open_offering(self.issuer)
            with use_migrate():
                Company.objects.filter(pk=self.issuer.company.pk).update(
                    trading_name="Synthetic retained company", is_open_to_investors=True
                )
            eligible_subscriber(self.issuer)
            eligible_subscriber(self.investor, issuer_decision=self.issuer.eligibility_decision)
            self.technical = subscription_technical_actor()
            self.offering = Offering.objects.with_relations().get(pk=self.offering.pk)
            self.application = draft_subscription(self.investor, offering=self.offering)
            with acting_for(self.investor.user.pk):
                submit(self.application, submitted_by=self.investor.user)
            with acting_for(self.technical.pk):
                accept(self.application)
            issue_instruction(self.application, rail="bank_transfer")
            self.draft = draft_subscription(self.investor, offering=self.offering)
        self.client.force_authenticate(self.investor.user)

    def visibility(self, state):
        with self.operator():
            with use_migrate():
                Company.objects.filter(pk=self.issuer.company.pk).update(
                    is_open_to_investors=state not in ("closed", "paused_closed"),
                    status={"warning": CompanyStatus.WARNING, "suspended": CompanyStatus.SUSPENDED}.get(
                        state, CompanyStatus.ACTIVE
                    ),
                )
            ShareToken.objects.filter(pk=self.offering.token_id).update(
                status=ShareTokenStatus.PAUSED if state in ("paused", "paused_closed") else ShareTokenStatus.DEPLOYED
            )

    def assert_identity(self, row):
        self.assertEqual(row["companyName"], "Synthetic retained company")
        self.assertEqual(row["tokenName"], self.offering.token.name)
        self.assertEqual(row["tokenSymbol"], self.offering.token.symbol)
        self.assertEqual(row["currency"], "AUD")
        self.assertEqual(row["offeringUuid"], str(self.offering.uuid))

    def test_creation_captures_identity_including_the_legal_name_fallback(self):
        with use_migrate():
            Company.objects.filter(pk=self.issuer.company.pk).update(trading_name="")
        response = self.client.post(
            BASE,
            {
                "offering": str(self.offering.pk),
                "wallet": str(self.investor.wallet.pk),
                "quantity": 10,
                "companyName": "Forged",
                "currency": "USD",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["companyName"], self.issuer.company.name)
        self.assertEqual(response.json()["currency"], "AUD")
        self.assertEqual(response.json()["tokenName"], self.offering.token.name)
        self.assertEqual(response.json()["tokenSymbol"], self.offering.token.symbol)

    def test_every_visibility_state_keeps_the_list_detail_and_bank_reference(self):
        for state in VISIBILITY:
            with self.subTest(state=state):
                self.visibility(state)
                listed = self.client.get(BASE)
                self.assertEqual(listed.status_code, 200, listed.content)
                self.assertEqual(listed.json()["count"], 2)
                self.assertEqual(len(listed.json()["results"]), 2)
                for row in listed.json()["results"]:
                    self.assert_identity(row)
                response = self.client.get(f"{BASE}{self.application.uuid}/")
                self.assertEqual(response.status_code, 200, response.content)
                self.assert_identity(response.json())
                instruction = response.json()["paymentInstruction"]
                self.assertEqual(instruction["currency"], "AUD")
                self.assertEqual(instruction["reference"], self.application.reference)
                self.assertEqual(instruction["bankBsb"], "062000")
                self.assertEqual(instruction["bankAccountNumber"], "12345678")

    def test_withdrawal_persists_when_any_parent_is_hidden(self):
        for state in VISIBILITY:
            with self.subTest(state=state):
                self.visibility("open")
                with self.operator():
                    application = draft_subscription(self.investor, offering=self.offering)
                self.visibility(state)
                response = self.client.post(f"{BASE}{application.uuid}/withdraw/", {"reason": "No longer applying"})
                self.assertEqual(response.status_code, 200, response.content)
                with self.operator():
                    application.refresh_from_db()
                    self.assertEqual(application.status, SubscriptionStatus.WITHDRAWN)
                    self.assertEqual(application.payment_notes, "No longer applying")
                    self.assertIsNotNone(application.closed_at)
                    self.assertEqual(application.company_id, self.issuer.company.pk)

    def test_hidden_drafts_are_refused_without_becoming_submitted(self):
        for state in VISIBILITY[1:]:
            with self.subTest(state=state):
                self.visibility(state)
                response = self.client.post(f"{BASE}{self.draft.uuid}/submit/", {})
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn("not open for subscription", response.json()["detail"])
                with self.operator():
                    self.draft.refresh_from_db()
                    self.assertEqual(self.draft.status, SubscriptionStatus.DRAFT)
                    self.assertIsNone(self.draft.submitted_at)
        self.visibility("open")
        response = self.client.post(f"{BASE}{self.draft.uuid}/submit/", {})
        self.assertEqual(response.status_code, 200, response.content)

    def test_other_applicants_and_issuer_do_not_gain_personal_application_access(self):
        for state in ("open", "paused_closed"):
            self.visibility(state)
            for actor in (self.issuer, self.bystander):
                with self.subTest(state=state, actor=actor.label):
                    self.client.force_authenticate(actor.user)
                    self.assertEqual(self.client.get(BASE).json()["results"], [])
                    for method, suffix in (("get", ""), ("post", "withdraw/"), ("post", "submit/")):
                        response = getattr(self.client, method)(f"{BASE}{self.application.uuid}/{suffix}")
                        self.assertEqual(response.status_code, 404, response.content)
        self.client.force_authenticate(self.investor.user)
        self.assertEqual(self.client.get(f"{BASE}{self.application.uuid}/").status_code, 200)

    def test_parent_renames_and_currency_changes_do_not_rewrite_existing_applications(self):
        with self.operator():
            original = Subscription.objects.filter(pk=self.draft.pk).values().get()
            with use_migrate():
                Company.objects.filter(pk=self.issuer.company.pk).update(
                    name="Renamed legal company", trading_name="New name"
                )
            ShareToken.objects.filter(pk=self.offering.token_id).update(name="New class", symbol="NEW")
            Offering.objects.filter(pk=self.offering.pk).update(price_currency="USD", price_per_share=Decimal("9.00"))
        response = self.client.post(f"{BASE}{self.draft.uuid}/submit/", {})
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json(), {"detail": "The subscription's frozen offering terms have changed."})
        with self.operator():
            self.assertEqual(Subscription.objects.filter(pk=self.draft.pk).values().get(), original)
        response = self.client.get(f"{BASE}{self.draft.uuid}/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assert_identity(response.json())
        self.assertEqual(response.json()["status"], SubscriptionStatus.DRAFT)
        self.assertIsNone(response.json()["submittedAt"])
        response = self.client.get(f"{BASE}{self.application.uuid}/")
        self.assert_identity(response.json())
        self.assertEqual(response.json()["paymentInstruction"]["currency"], "AUD")
        self.assertEqual(response.json()["pricePerShare"], "2.50")
        self.assertEqual(response.json()["amountDue"], "25.00")

    def test_hidden_applications_still_refuse_withdrawal_when_money_or_a_mint_is_committed(self):
        with self.operator():
            Subscription.objects.filter(pk=self.application.pk).update(amount_received=Decimal("1.00"))
            mint = ShareIssuanceRequest.objects.create(
                token=self.offering.token,
                recipient_address=self.investor.wallet.address,
                amount=10,
                issuance_type="additional",
                dispatch_id=None,
                status=RequestStatus.EXECUTING,
            )
            Subscription.objects.filter(pk=self.draft.pk).update(issuance_request=mint)
        self.visibility("paused_closed")
        for application, message in ((self.application, "already been received"), (self.draft, "already claimed")):
            response = self.client.post(f"{BASE}{application.uuid}/withdraw/", {})
            self.assertEqual(response.status_code, 400, response.content)
            self.assertIn(message, response.json()["detail"])
            with self.operator():
                application.refresh_from_db()
                self.assertNotEqual(application.status, SubscriptionStatus.WITHDRAWN)


class ApplicationRetentionTest(ApplicationRetentionCases, APITransactionTestCase):
    pass
