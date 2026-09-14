from contextlib import ExitStack
from decimal import Decimal
from unittest.mock import patch

from django.conf import settings
from django.db import connections
from django.test import TransactionTestCase, override_settings

from assets.models import AssetChainDeployment
from offerings.models import SubscriptionStatus
from offerings.services.subscription import allot
from offerings.tasks import allot_subscription_task
from offerings.tests.factories import (
    configure_operator,
    eligible_subscriber,
    open_offering,
    paid_subscription,
)
from shared.db import (
    APP_ALIAS,
    OPERATOR_ALIAS,
    acting_for,
    current_alias,
    principal_of,
    use_operator,
)
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_tenant
from tokens.models import RequestStatus, ShareIssuance, ShareIssuanceRequest
from tokens.services import share_token_service
from tokens.tasks import execute_review_request_task
from tokens.tests.mint_results import recorded_mint_result
from wallets.models import Holding, HoldingSnapshot
from whitelist.models import WhitelistEntry


@override_settings(BLOCKCHAIN_OPERATOR_KEY="synthetic-key")
class OperatorExecutionFromScopedContextTest(RunsOnTheScopedConnection, TransactionTestCase):
    def setUp(self):
        super().setUp()
        stack = ExitStack()
        self.addCleanup(stack.close)
        chain = stack.enter_context(patch("tokens.services.share_token_service.get_base_chain_client")).return_value
        chain.is_valid_address.return_value = True
        chain.to_checksum_address.side_effect = lambda address: address
        chain.get_address_from_private_key.return_value = "0x" + "e" * 40
        stack.enter_context(patch.object(share_token_service, "read_paused", return_value=False))
        stack.enter_context(patch.object(share_token_service, "is_recipient_whitelisted", return_value=True))
        stack.enter_context(patch.object(share_token_service, "share_supply", return_value=(1000, 0)))
        stack.enter_context(patch("wallets.services.holdings.fetch_chain_balance", return_value=Decimal("10")))
        self.defer = stack.enter_context(patch("offerings.tasks.subscription.allot_subscription_task.defer"))
        self.mint = stack.enter_context(
            patch.object(
                share_token_service,
                "_mint_to",
                side_effect=recorded_mint_result({"tx_hash": "0x" + "ab" * 32, "block_number": 7, "gas_used": 21000}),
            )
        )
        with use_operator():
            self.issuer = make_tenant("operator-issuer")
            self.investor = make_tenant("operator-investor")
            self.staff = make_tenant("operator-staff", staff=True).user
            configure_operator()
            self.investor.offering = open_offering(self.issuer, target_shares=200, cap_shares=500)
            eligible_subscriber(self.investor)
            WhitelistEntry.objects.create(wallet=self.investor.wallet, is_whitelisted=True)
            self.subscription = paid_subscription(self.investor)
            allot(self.subscription, self.staff)
            self.request = self.subscription.issuance_request
            AssetChainDeployment.objects.create(
                asset=self.issuer.refs.spare_asset,
                chain="base",
                contract_address=self.issuer.deployed_token.contract_address,
                decimals=0,
            )
        self.statements = []

    def record_sql(self, execute, sql, params, many, context):
        if any(table in sql for table in ("tokens_shareissuance", "offerings_subscription", "wallets_holding")):
            connection = context["connection"]
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_user")
                role = cursor.fetchone()[0]
            self.statements.append((connection.alias, role, sql.split()[0]))
        return execute(sql, params, many, context)

    def run_job(self, task, payload):
        with acting_for(self.investor.user.pk), ExitStack() as stack:
            for alias in (APP_ALIAS, OPERATOR_ALIAS):
                stack.enter_context(connections[alias].execute_wrapper(self.record_sql))
            try:
                return task.func(**payload)
            finally:
                self.assertEqual(current_alias(), APP_ALIAS)
                self.assertEqual(principal_of(APP_ALIAS), str(self.investor.user.pk))

    def assert_operator_writes(self):
        self.assertTrue(self.statements)
        self.assertEqual(
            {(alias, role) for alias, role, _ in self.statements},
            {(OPERATOR_ALIAS, settings.RLS_ROLES[OPERATOR_ALIAS])},
        )
        self.assertIn("INSERT", [operation for _, _, operation in self.statements])
        self.assertIn("UPDATE", [operation for _, _, operation in self.statements])
        self.assertIn(principal_of(APP_ALIAS), (None, ""))

    def assert_issuance_completed(self):
        with use_operator():
            self.request.refresh_from_db()
            self.assertEqual(self.request.status, RequestStatus.EXECUTED)
            issuance = ShareIssuance.objects.get(idempotency_key=share_token_service.issuance_key(self.request))
            self.assertEqual(issuance.initiated_by_id, self.staff.pk)
            holding = Holding.objects.get(wallet=self.investor.wallet, asset=self.issuer.refs.spare_asset)
            self.assertEqual(holding.quantity, Decimal("10"))
            self.assertTrue(HoldingSnapshot.objects.filter(holding=holding, quantity=Decimal("10")).exists())
        self.mint.assert_called_once()
        self.assert_operator_writes()

    def test_review_execution_writes_the_issuer_ledger_and_investor_holding_as_operator(self):
        result = self.run_job(
            execute_review_request_task,
            {
                "model_label": ShareIssuanceRequest._meta.label,
                "request_uuid": str(self.request.pk),
                "executed_by": self.staff.pk,
            },
        )
        self.assertTrue(result["success"], result)
        self.assert_issuance_completed()

    def test_allotment_writes_both_parties_as_operator_and_retains_the_enqueued_audit_actor(self):
        self.defer.assert_called_once_with(subscription_uuid=str(self.subscription.pk), executed_by=self.staff.pk)
        result = self.run_job(allot_subscription_task, self.defer.call_args.kwargs)
        self.assertTrue(result["success"], result)
        self.assert_issuance_completed()
        with use_operator():
            self.subscription.refresh_from_db()
            self.assertEqual(self.subscription.status, SubscriptionStatus.ALLOTTED)

    def test_execution_failure_restores_the_callers_role_and_principal_for_both_jobs(self):
        payloads = (
            (
                execute_review_request_task,
                {"model_label": ShareIssuanceRequest._meta.label, "request_uuid": str(self.request.pk)},
            ),
            (allot_subscription_task, {"subscription_uuid": str(self.subscription.pk)}),
        )
        with patch.object(share_token_service, "execute_request", side_effect=RuntimeError("execution stopped")):
            for task, payload in payloads:
                with self.subTest(task=task.name), self.assertRaisesMessage(RuntimeError, "execution stopped"):
                    self.run_job(task, payload)
                self.assertIn(principal_of(APP_ALIAS), (None, ""))
