import json
from contextlib import ExitStack
from datetime import timedelta
from functools import partial
from unittest.mock import Mock, patch

from django.conf import settings
from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from web3 import Web3

from assets.models import Asset, AssetChainDeployment
from blockchain.models import BlockchainTransaction, TransactionStatus
from companies.models import Company, CompanyStatus
from integrations.base_chain.client import BaseChainClient
from shared.db import (
    APP_ALIAS,
    OPERATOR_ALIAS,
    acting_for,
    atomic,
    current_alias,
    principal_of,
    use_operator,
)
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_tenant
from tokens.exceptions import InvalidTokenStateException, TokenDeploymentFailedException
from tokens.models import ShareToken, ShareTokenStatus
from tokens.services import ShareTokenService
from tokens.services.deployment_journal import (
    create_deployment_record,
    record_signed_deployment,
)
from tokens.tasks import check_pending_token_deployments, deploy_share_token_task
from tokens.tests.test_deployment import CREATED, RECEIPT, SIGNER, factory
from tokens.tests.test_deployment_signing_boundary import SIGNED_BYTES, SIGNED_HASH
from wallets.models import Wallet

TABLES = tuple(
    model._meta.db_table for model in (ShareToken, Company, Wallet, BlockchainTransaction, Asset, AssetChainDeployment)
)


@override_settings(SHARE_TOKEN_FACTORY_ADDRESS="0x" + "f" * 40, BLOCKCHAIN_OPERATOR_KEY="synthetic-key")
class ScopedTokenDeploymentTest(RunsOnTheScopedConnection, TransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            self.owner = make_tenant("deploy-owner")
            self.other = make_tenant("deploy-other")
            Company.objects.filter(pk__in=[self.owner.company.pk, self.other.company.pk]).update(
                status=CompanyStatus.ACTIVE
            )
            self.owner.token.mark_deploying()
            self.other.token.mark_deploying()
        self.chain = Mock(spec=BaseChainClient)
        self.chain.account_from_key.return_value.address = SIGNER
        self.chain.get_address_from_private_key.return_value = SIGNER
        self.chain.sign_transaction.return_value = SIGNED_BYTES
        self.chain.send_raw_transaction.side_effect = self.broadcast
        self.chain.send_transaction.side_effect = partial(BaseChainClient.send_transaction, self.chain)
        self.chain.wait_for_receipt.return_value = {**RECEIPT, "status": 1}
        self.chain.get_transaction_receipt.return_value = None
        self.chain.to_checksum_address.side_effect = Web3.to_checksum_address
        self.chain.is_valid_address.side_effect = Web3.is_address
        self.factory = factory()
        self.factory.functions.authorizedShares.return_value.call.return_value = 1000
        self.factory.functions.getTokenByIdentifier.return_value.call.side_effect = [
            "0x" + "0" * 40,
            CREATED,
        ]
        self.chain.load_contract.return_value = self.factory
        client = patch("tokens.services.share_token_service.get_base_chain_client", return_value=self.chain)
        self.addCleanup(client.stop)
        self.client_factory = client.start()
        approval = patch("tokens.services.share_token_service.ShareTokenService._approve_for_swap")
        self.addCleanup(approval.stop)
        approval.start()
        self.broadcasts = []
        self.initial_jobs = set(self.queued())
        self.addCleanup(lambda: self.delete_jobs(set(self.queued()) - self.initial_jobs))

    def broadcast(self, raw):
        alias = current_alias()
        with connections[alias].cursor() as cursor:
            cursor.execute("SELECT current_user, current_setting('app.user_id', true)")
            role, principal = cursor.fetchone()
        with use_operator():
            record = BlockchainTransaction.objects.get(tx_hash=SIGNED_HASH)
        token = ShareToken.objects.get(deployment_transaction=record)
        self.broadcasts.append(
            (alias, role, principal, connections[alias].get_autocommit(), token.deployment_tx_hash, record.status)
        )
        return SIGNED_HASH

    def run_task(self, token, principal_id):
        with use_operator():
            result = deploy_share_token_task.func(token_uuid=str(token.pk), principal_id=principal_id)
            self.assertEqual(current_alias(), OPERATOR_ALIAS)
        self.assertIn(principal_of(APP_ALIAS), (None, ""))
        return result

    def record_sql(self, statements):
        def execute(execute, sql, params, many, context):
            for table in TABLES:
                if f'"{table}"' in sql:
                    statements.append((context["connection"].alias, sql.split()[0], table))
            return execute(sql, params, many, context)

        return execute

    def state_of(self, token):
        with use_operator():
            token.refresh_from_db()
            return token.status, token.contract_address, token.deployment_tx_hash, token.deployment_transaction_id

    def test_deployment_commits_its_journal_and_token_under_the_issuer_before_broadcast(self):
        other_before = self.state_of(self.other.token)
        statements = []
        with ExitStack() as stack:
            for alias in (APP_ALIAS, OPERATOR_ALIAS):
                stack.enter_context(connections[alias].execute_wrapper(self.record_sql(statements)))
            result = self.run_task(self.owner.token, self.owner.user.pk)

        self.assertEqual(result["contract_address"], CREATED)
        self.assertEqual(
            self.broadcasts,
            [
                (
                    APP_ALIAS,
                    settings.RLS_ROLES[APP_ALIAS],
                    str(self.owner.user.pk),
                    True,
                    SIGNED_HASH,
                    TransactionStatus.SUBMITTED,
                )
            ],
        )
        self.assertEqual(
            {alias for alias, _, table in statements if table == BlockchainTransaction._meta.db_table},
            {OPERATOR_ALIAS},
        )
        self.assertEqual(
            [
                (operation, table)
                for alias, operation, table in statements
                if alias == OPERATOR_ALIAS and table == ShareToken._meta.db_table and operation == "UPDATE"
            ],
            [("UPDATE", ShareToken._meta.db_table)],
        )
        self.assertIn((APP_ALIAS, "UPDATE", ShareToken._meta.db_table), statements)
        self.assertIn((APP_ALIAS, "INSERT", AssetChainDeployment._meta.db_table), statements)
        self.assertLessEqual(
            {
                ("UPDATE", ShareToken._meta.db_table),
                ("INSERT", BlockchainTransaction._meta.db_table),
                ("UPDATE", BlockchainTransaction._meta.db_table),
                ("INSERT", AssetChainDeployment._meta.db_table),
            },
            {(operation, table) for _, operation, table in statements},
        )
        with use_operator():
            self.owner.token.refresh_from_db()
            self.assertEqual(self.owner.token.status, ShareTokenStatus.DEPLOYED)
            self.assertEqual(self.owner.token.deployment_transaction.status, TransactionStatus.CONFIRMED)
            self.assertTrue(AssetChainDeployment.objects.filter(contract_address__iexact=CREATED).exists())
        self.assertEqual(self.state_of(self.other.token), other_before)

    def test_a_foreign_token_is_refused_before_chain_access_and_its_owner_can_deploy_it(self):
        before = self.state_of(self.other.token)
        self.assertEqual(
            self.run_task(self.other.token, self.owner.user.pk), {"success": False, "error": "Token not found"}
        )
        self.client_factory.assert_not_called()
        self.assertEqual(self.state_of(self.other.token), before)
        self.assertTrue(self.run_task(self.other.token, self.other.user.pk)["success"])
        self.assertEqual(self.state_of(self.other.token)[0], ShareTokenStatus.DEPLOYED)

    def queued(self):
        with use_operator(), connections[OPERATOR_ALIAS].cursor() as cursor:
            cursor.execute("SELECT id, task_name, args FROM procrastinate_jobs ORDER BY id")
            rows = cursor.fetchall()
        return {row[0]: (row[1], row[2] if isinstance(row[2], dict) else json.loads(row[2])) for row in rows}

    def delete_jobs(self, identifiers):
        with use_operator(), connections[OPERATOR_ALIAS].cursor() as cursor:
            for identifier in identifiers:
                cursor.execute("DELETE FROM procrastinate_jobs WHERE id = %s", [identifier])

    def test_start_captures_the_principal_and_reassignment_refuses_the_queued_job(self):
        with use_operator():
            ShareToken.objects.filter(pk=self.owner.token.pk).update(status=ShareTokenStatus.DRAFT)
        with acting_for(self.owner.user.pk):
            token = ShareToken.objects.get(pk=self.owner.token.pk)
            ShareTokenService.start_deployment(token, principal_id=self.owner.user.pk)
        jobs = [row for key, row in self.queued().items() if key not in self.initial_jobs]
        self.assertEqual(
            jobs, [(deploy_share_token_task.name, {"token_uuid": str(token.pk), "principal_id": self.owner.user.pk})]
        )
        with use_operator():
            Company.objects.filter(pk=token.company_id).update(owner=self.other.user)
            before = self.state_of(token)
            result = deploy_share_token_task.func(**jobs[0][1])
        self.assertEqual(result, {"success": False, "error": "Token not found"})
        self.client_factory.assert_not_called()
        self.assertEqual(self.state_of(token), before)
        self.assertTrue(self.run_task(token, self.other.user.pk)["success"])

    def test_retry_keeps_the_principal_and_resolves_the_recorded_hash_without_another_send(self):
        self.chain.send_raw_transaction.side_effect = ConnectionError("synthetic acknowledgement lost")
        with self.assertRaises(TokenDeploymentFailedException):
            self.run_task(self.owner.token, self.owner.user.pk)
        self.assertIn(principal_of(APP_ALIAS), (None, ""))
        with acting_for(self.owner.user.pk):
            token = ShareToken.objects.get(pk=self.owner.token.pk)
            ShareTokenService.retry_deployment(token, principal_id=self.owner.user.pk)
        jobs = [row for key, row in self.queued().items() if key not in self.initial_jobs]
        self.assertEqual(
            jobs, [(deploy_share_token_task.name, {"token_uuid": str(token.pk), "principal_id": self.owner.user.pk})]
        )
        self.factory.functions.getTokenByIdentifier.return_value.call.side_effect = ["0x" + "0" * 40, CREATED]
        with use_operator():
            result = deploy_share_token_task.func(**jobs[0][1])
        self.assertTrue(result["success"])
        self.chain.send_raw_transaction.assert_called_once_with(SIGNED_BYTES)
        self.chain.wait_for_receipt.assert_called_once_with(SIGNED_HASH)
        with use_operator():
            self.assertEqual(BlockchainTransaction.objects.get().status, TransactionStatus.CONFIRMED)
        self.assertEqual(self.state_of(token)[:3], (ShareTokenStatus.DEPLOYED, CREATED, SIGNED_HASH))

    def test_operator_recovery_finishes_a_sent_deployment_after_issuer_access_is_lost(self):
        self.chain.wait_for_receipt.side_effect = TimeoutError("synthetic receipt delayed")
        with self.assertRaises(TokenDeploymentFailedException):
            self.run_task(self.owner.token, self.owner.user.pk)
        with use_operator():
            Company.objects.filter(pk=self.owner.company.pk).update(owner=self.other.user)
            ShareToken.objects.filter(pk=self.owner.token.pk).update(updated_at=timezone.now() - timedelta(minutes=11))
        self.assertEqual(
            self.run_task(self.owner.token, self.owner.user.pk), {"success": False, "error": "Token not found"}
        )
        self.factory.functions.getTokenByIdentifier.return_value.call.side_effect = None
        self.factory.functions.getTokenByIdentifier.return_value.call.return_value = CREATED
        self.chain.get_transaction_receipt.return_value = {**RECEIPT, "status": 1}
        with use_operator():
            self.assertEqual(check_pending_token_deployments.func(), {"checked": 1, "resolved": 1})
            self.assertEqual(BlockchainTransaction.objects.get().status, TransactionStatus.CONFIRMED)
        self.chain.send_raw_transaction.assert_called_once_with(SIGNED_BYTES)
        self.assertEqual(self.state_of(self.owner.token)[0], ShareTokenStatus.DEPLOYED)

    def test_an_explicit_operator_job_restores_the_callers_alias(self):
        result = deploy_share_token_task.func(token_uuid=str(self.other.token.pk), principal_id=None)
        self.assertTrue(result["success"])
        self.assertEqual(self.broadcasts[0][:2], (OPERATOR_ALIAS, settings.RLS_ROLES[OPERATOR_ALIAS]))
        self.assertIn(self.broadcasts[0][2], (None, ""))
        self.assertEqual(current_alias(), APP_ALIAS)

    def test_a_job_without_a_principal_fails_before_chain_access(self):
        with use_operator(), self.assertRaises(TypeError):
            deploy_share_token_task.func(token_uuid=str(self.other.token.pk))
        self.client_factory.assert_not_called()
        self.assertEqual(self.state_of(self.other.token)[0], ShareTokenStatus.DEPLOYING)

    def test_an_unexpected_failure_clears_the_principal_and_restores_the_worker_alias(self):
        self.client_factory.side_effect = RuntimeError("synthetic unavailable client")
        with use_operator():
            with self.assertRaisesRegex(RuntimeError, "synthetic unavailable client"):
                deploy_share_token_task.func(token_uuid=str(self.owner.token.pk), principal_id=self.owner.user.pk)
            self.assertEqual(current_alias(), OPERATOR_ALIAS)
        self.assertIn(principal_of(APP_ALIAS), (None, ""))
        self.assertEqual(self.state_of(self.owner.token)[0], ShareTokenStatus.DEPLOYING)

    def test_the_operator_binding_refuses_another_tokens_journal(self):
        record = create_deployment_record(
            self.other.token, f"{self.other.company.acn}:DRF", SIGNER, "0x" + "f" * 40, self.other.wallet.address
        )
        before = self.state_of(self.owner.token)
        with acting_for(self.owner.user.pk), self.assertRaisesMessage(InvalidTokenStateException, "another token"):
            record_signed_deployment(self.owner.token, record, SIGNED_HASH)
        self.assertEqual(self.state_of(self.owner.token), before)
        with use_operator():
            record.refresh_from_db()
        self.assertFalse(record.tx_hash)
        with acting_for(self.other.user.pk):
            record_signed_deployment(self.other.token, record, SIGNED_HASH)
        self.assertEqual(self.state_of(self.other.token)[2:], (SIGNED_HASH, record.pk))

    def test_the_operator_binding_cannot_escape_an_uncommitted_issuer_transaction(self):
        with acting_for(self.owner.user.pk), atomic():
            with self.assertRaises(TokenDeploymentFailedException):
                deploy_share_token_task.func(token_uuid=str(self.owner.token.pk), principal_id=self.owner.user.pk)
        self.chain.send_raw_transaction.assert_not_called()
        with use_operator():
            record = BlockchainTransaction.objects.get()
        self.assertFalse(record.tx_hash)
        self.assertIsNone(self.state_of(self.owner.token)[2])

    def test_ownership_lost_while_signing_refuses_the_operator_binding_before_broadcast(self):
        def transfer_owner(*args, **kwargs):
            with use_operator():
                Company.objects.filter(pk=self.owner.company.pk).update(owner=self.other.user)
            return SIGNED_BYTES

        self.chain.sign_transaction.side_effect = transfer_owner
        with self.assertRaises((TokenDeploymentFailedException, ShareToken.DoesNotExist, DatabaseError)):
            self.run_task(self.owner.token, self.owner.user.pk)
        self.chain.send_raw_transaction.assert_not_called()
        self.assertIn(principal_of(APP_ALIAS), (None, ""))
        with use_operator():
            record = BlockchainTransaction.objects.get()
        self.assertFalse(record.tx_hash)
        self.assertIsNone(self.state_of(self.owner.token)[2])

    def test_a_token_moved_to_another_company_while_signing_is_not_bound_or_broadcast(self):
        def transfer_token(*args, **kwargs):
            with use_operator():
                ShareToken.objects.filter(pk=self.owner.token.pk).update(company=self.other.company, symbol="MOVED")
            return SIGNED_BYTES

        self.chain.sign_transaction.side_effect = transfer_token
        with self.assertRaises((TokenDeploymentFailedException, ShareToken.DoesNotExist, DatabaseError)):
            self.run_task(self.owner.token, self.owner.user.pk)
        self.chain.send_raw_transaction.assert_not_called()
        self.assertIn(principal_of(APP_ALIAS), (None, ""))
        with use_operator():
            record = BlockchainTransaction.objects.get()
        self.assertFalse(record.tx_hash)
        self.assertIsNone(self.state_of(self.owner.token)[2])
