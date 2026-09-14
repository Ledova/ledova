import importlib
from datetime import timedelta
from unittest.mock import Mock, patch

from django.conf import settings
from django.db import DatabaseError
from django.test import TestCase, TransactionTestCase

from integrations.base_chain.client import (
    BROADCAST_ROUND_TRIPS,
    HTTP_TIMEOUT_SECONDS,
    BaseChainClient,
)
from shared.db import atomic
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.tenants import make_tenant
from tokens.models import (
    RequestStatus,
    ShareIssuance,
    ShareIssuanceRequest,
)
from tokens.serializers import CapitalIncreaseDetailSerializer
from tokens.services.capital_increase import submit_capital_increase
from tokens.services.dilution import dilution_for
from tokens.services.legacy_issuance import UNNAMED_MINT_GRACE
from tokens.tasks.review_request import STALE_EXECUTION_AGE

RECIPIENT = "0x" + "a" * 40


def issuance_request(token, amount=10, **fields):
    return ShareIssuanceRequest.objects.create(
        token=token, recipient_address=RECIPIENT, recipient_name="Alice", amount=amount, reason="Bonus", **fields
    )


class ReviewableRequestModelTest(TestCase):
    def setUp(self):
        self.tenant = make_tenant("owner")
        self.token = self.tenant.deployed_token

    def test_completed_supply_feeds_dilution_for_both_request_types(self):
        self.assertEqual(dilution_for(self.tenant.capital_increase), 0.0)
        ShareIssuance.objects.create(token=self.token, recipient_address=RECIPIENT, amount="900", status="completed")
        ShareIssuance.objects.create(token=self.token, recipient_address=RECIPIENT, amount="500", status="pending")

        self.assertEqual(ShareIssuance.objects.completed_supply(self.token), 900)
        self.assertEqual(dilution_for(self.tenant.capital_increase), 10.0)
        self.assertEqual(dilution_for(issuance_request(self.token, amount=100)), 10.0)

    def test_capital_increase_walks_submit_review_and_approval(self):
        request = self.tenant.capital_increase
        self.assertTrue(request.can_be_edited and request.can_be_submitted)
        self.assertFalse(request.can_be_approved)
        with self.assertRaises(ValueError):
            request.approve(self.tenant.user)

        submit_capital_increase(request, self.tenant.user)
        self.assertEqual(
            (request.status, request.submitted_by, request.dilution_percentage), ("submitted", self.tenant.user, 0.0)
        )
        self.assertFalse(request.can_be_edited)

        request.start_review(self.tenant.user)
        request.approve(self.tenant.user, notes="ok")
        self.assertEqual((request.status, request.review_notes), (RequestStatus.APPROVED, "ok"))
        self.assertIsNotNone(request.reviewed_at)
        self.assertTrue(request.can_be_executed)

    def test_new_request_requires_admission_before_claiming_execution(self):
        request = issuance_request(self.token)
        request.approve(self.tenant.user)
        with self.assertRaises(DatabaseError), atomic():
            request.mark_executing()
        request.refresh_from_db()
        self.assertEqual(request.status, RequestStatus.APPROVED)

    def test_issuance_request_starts_submitted_and_can_be_rejected(self):
        request = issuance_request(self.token)
        self.assertEqual(request.status, RequestStatus.SUBMITTED)
        request.start_review(self.tenant.user)
        request.reject(self.tenant.user, reason="Not now")
        self.assertEqual((request.status, request.rejection_reason), (RequestStatus.REJECTED, "Not now"))
        with self.assertRaises(ValueError):
            request.mark_executing()

    def test_detail_serializer_keeps_the_keys_the_dashboard_reads(self):
        data = CapitalIncreaseDetailSerializer(self.tenant.capital_increase).data
        self.assertEqual(data["status"], "draft")
        self.assertTrue(data["can_be_edited"] and data["can_be_submitted"])
        self.assertIsNone(data["dilution_percentage"])


class StatusDataMigrationTest(TransactionTestCase):
    def test_pending_approval_maps_to_submitted_and_back(self):
        migration = importlib.import_module("tokens.migrations.0012_reviewable_request")
        tenant = make_tenant("owner")
        submit_capital_increase(tenant.capital_increase, tenant.user)
        self.addCleanup(restore_every_migration)
        historical = migrate_to([("tokens", "0046_capital_execution_guards")])
        request = historical.get_model("tokens", "ShareIssuanceRequest").objects.create(
            token_id=tenant.deployed_token.pk,
            company_id=tenant.company.pk,
            recipient_address=RECIPIENT,
            amount=10,
            reason="Historical pending status",
            status="pending_approval",
        )
        migration.forwards(historical, None)
        request.refresh_from_db()
        self.assertEqual(request.status, "submitted")

        migration.backwards(historical, None)
        request.refresh_from_db()
        tenant.capital_increase.refresh_from_db()
        self.assertEqual(request.status, "pending_approval")
        self.assertEqual(tenant.capital_increase.status, "submitted")


class TheGraceIsJustifiedByTheWindowItCoversTest(TestCase):

    def test_the_grace_brackets_the_broadcast_below_and_the_sweep_above(self):
        longest_broadcast = BROADCAST_ROUND_TRIPS * timedelta(seconds=HTTP_TIMEOUT_SECONDS)

        self.assertGreaterEqual(UNNAMED_MINT_GRACE, longest_broadcast)
        self.assertLess(UNNAMED_MINT_GRACE, STALE_EXECUTION_AGE)

    def test_the_timeout_the_grace_is_derived_from_is_the_one_the_client_uses(self):
        with patch("integrations.base_chain.client.Web3") as web3:
            web3.HTTPProvider.return_value = Mock()
            web3.return_value.eth.chain_id = settings.BLOCKCHAIN_CHAIN_ID
            BaseChainClient._web3 = None
            try:
                BaseChainClient()
            finally:
                BaseChainClient._web3 = None

        self.assertEqual(web3.HTTPProvider.call_args.kwargs["request_kwargs"], {"timeout": HTTP_TIMEOUT_SECONDS})

    def test_the_operator_control_opens_before_the_sweep_can_act(self):
        self.assertLess(UNNAMED_MINT_GRACE, STALE_EXECUTION_AGE)
