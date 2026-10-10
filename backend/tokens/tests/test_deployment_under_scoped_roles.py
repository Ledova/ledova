import json
from contextlib import ExitStack
from unittest.mock import patch

from django.conf import settings
from django.db import connections
from django.test import TransactionTestCase, override_settings

from assets.models import AssetChainDeployment
from blockchain.models import BlockchainTransaction, SignedAttempt
from blockchain.tests.outgoing_fixtures import receipt
from companies.models import Company
from companies.services.team import revoke_company_appointment
from shared.db import (
    APP_ALIAS,
    OPERATOR_ALIAS,
    acting_for,
    current_alias,
    principal_of,
    use_migrate,
    use_operator,
)
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.exceptions import TokenDeploymentFailedException
from tokens.models import RegisterDeployment, ShareToken, TokenDeployment
from tokens.services import deployment
from tokens.tasks import deploy_share_token_task
from tokens.tests.deployment_fixtures import (
    CHAIN_ID,
    CREATED,
    FACTORY,
    KEY,
    deployment_token,
    install_deployment,
)


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class ScopedTokenDeploymentTest(RunsOnTheScopedConnection, TransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            install_deployment(self)
            self.other = deployment_token("other-deployment")
        self.initial_jobs = set(self.queued())
        self.addCleanup(self.delete_new_jobs)

    def run_task(self, token=None, principal=None):
        token = token or self.token
        with use_operator():
            result = deploy_share_token_task.func(
                token_uuid=str(token.pk),
                deployment_id=str(token.deployment_id),
                principal_id=self.tenant.user.pk if principal is None else principal,
            )
            self.assertEqual(current_alias(), OPERATOR_ALIAS)
        self.assertIn(principal_of(APP_ALIAS), (None, ""))
        return result

    def queued(self):
        with use_operator(), connections[OPERATOR_ALIAS].cursor() as cursor:
            cursor.execute("SELECT id, task_name, args FROM procrastinate_jobs ORDER BY id")
            return {
                row[0]: (row[1], row[2] if isinstance(row[2], dict) else json.loads(row[2]))
                for row in cursor.fetchall()
            }

    def delete_new_jobs(self):
        with use_operator(), connections[OPERATOR_ALIAS].cursor() as cursor:
            for identifier in set(self.queued()) - self.initial_jobs:
                cursor.execute("DELETE FROM procrastinate_jobs WHERE id=%s", [identifier])

    def test_private_signing_boundary_preserves_issuer_lifecycle_and_asset_writes(self):
        tables = [
            model._meta.db_table
            for model in (ShareToken, TokenDeployment, BlockchainTransaction, SignedAttempt, AssetChainDeployment)
        ]
        statements = []
        broadcasts = []
        send = self.node.send

        def record_sql(execute, sql, params, many, context):
            for table in tables:
                if f'"{table}"' in sql:
                    statements.append((context["connection"].alias, sql.split()[0], table))
            return execute(sql, params, many, context)

        def observe(raw):
            connection = connections[current_alias()]
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_user")
                role = cursor.fetchone()[0]
            command = TokenDeployment.objects.get(pk=self.token.deployment_id)
            token = ShareToken.objects.get(pk=self.token.pk)
            broadcasts.append(
                (
                    current_alias(),
                    role,
                    connection.get_autocommit(),
                    token.deployment_tx_hash == command.operation.current_attempt.tx_hash,
                )
            )
            return send(raw)

        self.node.client.send_raw_transaction.side_effect = observe
        with ExitStack() as stack:
            for alias in (APP_ALIAS, OPERATOR_ALIAS):
                stack.enter_context(connections[alias].execute_wrapper(record_sql))
            result = self.run_task()
        self.assertTrue(result["success"])
        self.assertEqual(broadcasts, [(OPERATOR_ALIAS, settings.RLS_ROLES[OPERATOR_ALIAS], True, True)])
        private_tables = {
            TokenDeployment._meta.db_table,
            BlockchainTransaction._meta.db_table,
            SignedAttempt._meta.db_table,
        }
        self.assertEqual({alias for alias, _, table in statements if table in private_tables}, {OPERATOR_ALIAS})
        self.assertEqual({alias for alias, _, _ in statements}, {OPERATOR_ALIAS})
        self.assertIn((OPERATOR_ALIAS, "UPDATE", ShareToken._meta.db_table), statements)
        self.assertIn((OPERATOR_ALIAS, "INSERT", AssetChainDeployment._meta.db_table), statements)
        with use_operator():
            self.other.token.refresh_from_db()
            self.assertIsNone(self.other.token.deployment_tx_hash)

    def test_foreign_token_is_refused_before_chain_access_and_owner_can_deploy(self):
        result = self.run_task(self.other.token)
        self.assertEqual(result, {"success": False, "error": "Token not found"})
        self.node.client.assert_expected_chain.assert_not_called()
        self.assertTrue(self.run_task(self.other.token, self.other.user.pk)["success"])

    def test_operator_recovery_finishes_signed_work_after_issuer_access_is_lost(self):
        self.node.confirmed = False
        self.run_task()
        with use_operator():
            with use_migrate():
                Company.objects.filter(pk=self.token.company_id).update(owner=self.other.user)
            attempt = SignedAttempt.objects.get()
        self.assertFalse(self.run_task()["success"])
        self.node.receipts[attempt.tx_hash] = receipt(attempt)
        self.node.existing_address = CREATED
        with use_operator():
            self.assertEqual(deployment.recover(self.token.deployment_id), CREATED)
        self.assertEqual(self.node.broadcasts, [bytes(attempt.raw_transaction)] * 2)
        with use_operator():
            self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_operator_recovery_does_not_sign_unsigned_issuer_intent_after_revocation(self):
        with acting_for(self.tenant.user.pk):
            command = deployment._admit(self.token)
        with use_operator():
            source = RegisterDeployment.objects.get(deployment_id=command.pk)
            appointment = source.approval_decision.appointment_id
        revoke_company_appointment(requester=self.tenant.user, appointment_id=appointment)
        with use_operator():
            self.assertIsNone(deployment.recover(command.pk))
            self.assertFalse(SignedAttempt.objects.exists())
        self.assertEqual(self.node.broadcasts, [])

    def test_explicit_operator_job_restores_ambient_connection(self):
        result = deploy_share_token_task.func(
            token_uuid=str(self.token.pk), deployment_id=str(self.token.deployment_id), principal_id=None
        )
        self.assertTrue(result["success"])
        self.assertEqual(current_alias(), APP_ALIAS)

    def test_unexpected_failure_clears_principal_and_restores_worker_alias(self):
        with patch("tokens.services.deployment.get_base_chain_client", side_effect=RuntimeError("Synthetic failure")):
            with self.assertRaises(TokenDeploymentFailedException):
                self.run_task()
        self.assertIn(principal_of(APP_ALIAS), (None, ""))
        self.assertEqual(current_alias(), APP_ALIAS)
