import json
from contextlib import ExitStack
from decimal import Decimal
from unittest.mock import call, patch

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
from shared.tests.tenants import a_profile, make_tenant
from tokens.models import ShareToken
from users.models import UserAccount
from wallets.constants import (
    WALLET_VERIFICATION_STATUS_PENDING,
    WALLET_VERIFICATION_STATUS_VERIFIED,
)
from wallets.models import Holding, HoldingSnapshot, Transaction, Wallet
from wallets.services.verification import complete_wallet_verification
from wallets.tasks.sync import sync_all_wallets, sync_wallet

TABLES = tuple(
    model._meta.db_table for model in (Wallet, Holding, HoldingSnapshot, Transaction, ShareToken, ComplianceAlert)
)


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
        balance = patch("tokens.services.share_token_service.ShareTokenService")
        self.addCleanup(balance.stop)
        self.balance = balance.start().return_value.get_token_balance
        self.balance.return_value = 9
        self.observed = []

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

    def recorder(self, calls):
        def execute(execute, sql, params, many, context):
            for table in TABLES:
                if f'"{table}"' in sql:
                    calls.append((context["connection"].alias, sql.split()[0], table))
            return execute(sql, params, many, context)

        return execute

    def state_of(self, tenant):
        with use_operator():
            return (
                Wallet.objects.get(pk=tenant.wallet.pk).last_synced_at,
                Holding.objects.get(pk=tenant.holding.pk).quantity,
                Transaction.objects.filter(wallet=tenant.wallet).count(),
                HoldingSnapshot.objects.filter(holding=tenant.holding).count(),
                ComplianceAlert.objects.filter(user_account=tenant.account).count(),
            )

    def test_the_user_principal_carries_history_balance_snapshot_and_wallet_writes(self):
        other_before = self.state_of(self.other)
        observed = []
        with ExitStack() as stack:
            for alias in (APP_ALIAS, OPERATOR_ALIAS):
                stack.enter_context(connections[alias].execute_wrapper(self.recorder(observed)))
            result = self.run_task(self.owner.wallet, self.owner.user.pk)

        self.assertEqual(result, {"status": "success", "transactions": 1, "snapshots": 1, "holdings": 1})
        self.assertEqual(self.observed, [(APP_ALIAS, settings.RLS_ROLES[APP_ALIAS], str(self.owner.user.pk), False)])
        self.assertEqual({alias for alias, _, _ in observed}, {APP_ALIAS})
        self.assertLessEqual(
            {
                ("INSERT", Transaction._meta.db_table),
                ("INSERT", HoldingSnapshot._meta.db_table),
                ("INSERT", ComplianceAlert._meta.db_table),
                ("UPDATE", Holding._meta.db_table),
                ("UPDATE", Wallet._meta.db_table),
                ("SELECT", ShareToken._meta.db_table),
            },
            {(operation, table) for _, operation, table in observed},
        )
        self.balance.assert_called_once_with(self.other.deployed_token.contract_address, self.owner.wallet.address)
        last_synced, quantity, transactions, snapshots, alerts = self.state_of(self.owner)
        self.assertIsNotNone(last_synced)
        self.assertEqual((quantity, transactions, snapshots, alerts), (Decimal("9"), 1, 1, 1))
        self.assertEqual(self.state_of(self.other), other_before)

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

    def test_verification_captures_the_user_and_lost_access_is_refused_when_the_job_runs(self):
        before = self.queued()
        with use_operator(), patch("wallets.services.verification.verify_wallet_signature", return_value=True):
            Wallet.objects.filter(pk=self.owner.wallet.pk).update(
                verification_status=WALLET_VERIFICATION_STATUS_PENDING
            )
            complete_wallet_verification(self.owner.user, self.owner.wallet.pk, "0x01")
        jobs = {key: row for key, row in self.queued().items() if key not in before}
        self.addCleanup(self.delete_jobs, list(jobs))
        self.assertEqual(len(jobs), 1)
        name, args = next(iter(jobs.values()))
        self.assertEqual(name, sync_wallet.name)
        self.assertEqual(args, {"wallet_uuid": str(self.owner.wallet.pk), "principal_id": self.owner.user.pk})
        with use_operator():
            UserAccount.objects.filter(pk=self.owner.account.pk).update(user_profile=a_profile("replacement"))
        state = self.state_of(self.owner)
        with use_operator():
            result = sync_wallet.func(**args)
        self.assertEqual(result, {"status": "error", "error": "Wallet not found"})
        self.history.assert_not_called()
        self.assertEqual(self.state_of(self.owner), state)
        self.assertEqual(self.run_task(self.owner.wallet, None)["status"], "success")
        self.assertNotEqual(self.state_of(self.owner), state)

    def test_the_sweep_explicitly_queues_operator_jobs_only_for_verified_wallets(self):
        with use_operator(), patch("wallets.tasks.sync.sync_wallet.defer") as defer:
            result = sync_all_wallets.func(timestamp=0)
        self.assertEqual(result, {"total": 4, "queued": 4})
        self.assertCountEqual(
            defer.call_args_list,
            [
                call(wallet_uuid=str(wallet_id), principal_id=None)
                for tenant in (self.owner, self.other)
                for wallet_id in (tenant.wallet.pk, tenant.company.operator_wallet_id)
            ],
        )

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
