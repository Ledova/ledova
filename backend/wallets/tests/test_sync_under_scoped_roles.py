import json
from decimal import Decimal
from unittest.mock import patch

from django.conf import settings
from django.db import connections
from django.test import TransactionTestCase
from django.utils import timezone

from assets.models import AssetChainDeployment
from compliance.constants import RULE_TYPE_THRESHOLD
from compliance.models import ComplianceAlert, MonitoringRule
from shared.db import (
    APP_ALIAS,
    OPERATOR_ALIAS,
    current_alias,
    principal_of,
    use_operator,
)
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_tenant
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Holding, Transaction, Wallet
from wallets.tasks.sync import sync_wallet


class ScopedWalletSyncTest(RunsOnTheScopedConnection, TransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            self.owner = make_tenant("sync-owner")
            self.other = make_tenant("sync-other")
            for tenant in (self.owner, self.other):
                tenant.wallet = Wallet.objects.create(
                    user_account=tenant.account,
                    address="0x" + f"{tenant.user.pk + 1000:040x}",
                    chain="base",
                    verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
                    verification_challenge="synthetic-challenge",
                    verification_challenge_issued_at=timezone.now(),
                )
                tenant.holding = Holding.objects.create(wallet=tenant.wallet, asset=tenant.refs.asset, quantity=5)
            AssetChainDeployment.objects.create(
                asset=self.owner.refs.asset,
                chain="base",
                contract_address=self.other.deployed_token.contract_address,
                decimals=0,
            )
            MonitoringRule.objects.create(
                rule_code="MON-001", name="Synthetic threshold", rule_type=RULE_TYPE_THRESHOLD, parameters={"amount": 0}
            )
        client = patch("wallets.services.sync.get_blockchain_client")
        self.addCleanup(client.stop)
        self.history = client.start().return_value.get_transaction_history
        self.history.side_effect = self.transaction_history
        balance = patch("tokens.services.share_token_service.get_token_balance")
        self.addCleanup(balance.stop)
        self.balance = balance.start()
        self.balance.return_value = 9
        self.observed = []
        self.initial_jobs = set(self.queued())
        self.addCleanup(lambda: self.delete_jobs(set(self.queued()) - self.initial_jobs))

    def transaction_history(self, address):
        alias = current_alias()
        with connections[alias].cursor() as cursor:
            cursor.execute("SELECT current_user, current_setting('app.user_id', true)")
            role, principal = cursor.fetchone()
        self.observed.append((alias, role, principal, Wallet.objects.filter(pk=self.other.wallet.pk).exists()))
        return [
            {
                "tx_hash": "0x" + "1" * 64,
                "from_address": "0x" + "a" * 40,
                "to_address": address,
                "amount": "2",
                "contract_address": self.other.deployed_token.contract_address,
                "block_timestamp": timezone.now(),
                "block_number": 12,
            }
        ]

    def run_task(self, wallet, principal_id):
        with use_operator():
            result = sync_wallet.func(wallet_uuid=str(wallet.pk), principal_id=principal_id)
            self.assertEqual(current_alias(), OPERATOR_ALIAS)
        self.assertIn(principal_of(APP_ALIAS), (None, ""))
        return result

    def state_of(self, tenant):
        with use_operator():
            return (
                Wallet.objects.get(pk=tenant.wallet.pk).last_synced_at,
                Holding.objects.get(pk=tenant.holding.pk).quantity,
                Transaction.objects.filter(wallet=tenant.wallet).count(),
                ComplianceAlert.objects.filter(user_account=tenant.account).count(),
            )

    def test_a_foreign_wallet_is_refused_before_the_chain_and_its_owner_can_sync_it(self):
        before = self.state_of(self.other)
        result = self.run_task(self.other.wallet, self.owner.user.pk)

        self.assertEqual(result, {"status": "error", "error": "Wallet not found"})
        self.history.assert_not_called()
        self.balance.assert_not_called()
        self.assertEqual(self.state_of(self.other), before)
        self.assertEqual(self.run_task(self.other.wallet, self.other.user.pk)["status"], "success")
        self.assertNotEqual(self.state_of(self.other), before)

    def test_an_explicit_operator_job_switches_from_app_and_restores_it(self):
        self.assertEqual(current_alias(), APP_ALIAS)
        result = sync_wallet.func(wallet_uuid=str(self.other.wallet.pk), principal_id=None)

        self.assertEqual(result["status"], "success")
        alias, role, principal, sees_other = self.observed[0]
        self.assertEqual((alias, role, sees_other), (OPERATOR_ALIAS, settings.RLS_ROLES[OPERATOR_ALIAS], True))
        self.assertIn(principal, (None, ""))
        self.assertEqual(current_alias(), APP_ALIAS)
        self.assertEqual(self.state_of(self.other)[1], Decimal("9"))

    def queued(self):
        with use_operator(), connections[OPERATOR_ALIAS].cursor() as cursor:
            cursor.execute("SELECT id, task_name, args FROM procrastinate_jobs ORDER BY id")
            rows = cursor.fetchall()
        return {r[0]: (r[1], r[2] if isinstance(r[2], dict) else json.loads(r[2])) for r in rows}

    def delete_jobs(self, identifiers):
        with use_operator(), connections[OPERATOR_ALIAS].cursor() as cursor:
            for identifier in identifiers:
                cursor.execute("DELETE FROM procrastinate_jobs WHERE id = %s", [identifier])

    def test_a_job_without_a_principal_is_refused_before_any_sync(self):
        before = self.state_of(self.other)
        with use_operator(), self.assertRaises(TypeError):
            sync_wallet.func(wallet_uuid=str(self.other.wallet.pk))
        self.history.assert_not_called()
        self.assertEqual(self.state_of(self.other), before)

    def test_an_unexpected_service_failure_clears_the_user_principal(self):
        before = self.state_of(self.owner)
        with use_operator(), patch(
            "wallets.tasks.sync.wallet_sync.sync_wallet", side_effect=RuntimeError("unavailable")
        ):
            with self.assertRaisesRegex(RuntimeError, "unavailable"):
                sync_wallet.func(wallet_uuid=str(self.owner.wallet.pk), principal_id=self.owner.user.pk)
            self.assertEqual(current_alias(), OPERATOR_ALIAS)
        self.assertIn(principal_of(APP_ALIAS), (None, ""))
        self.assertEqual(self.state_of(self.owner), before)
