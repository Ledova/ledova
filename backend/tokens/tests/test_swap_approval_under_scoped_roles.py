from unittest.mock import patch

from django.conf import settings
from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings

from shared.db import (
    APP_ALIAS,
    OPERATOR_ALIAS,
    acting_for,
    atomic,
    current_alias,
    use_operator,
)
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.exceptions import InvalidTokenStateException
from tokens.models import TokenDeployment
from tokens.services import swap_approval
from tokens.tasks.deployment import deploy_share_token_task, recover_swap_approval
from tokens.tests.deployment_fixtures import CHAIN_ID, FACTORY, KEY, install_deployment
from tokens.tests.swap_approval_fixtures import SWAP, ApprovalNode


@override_settings(
    BLOCKCHAIN_OPERATOR_KEY=KEY,
    BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
    SHARE_TOKEN_FACTORY_ADDRESS=FACTORY,
    ATOMIC_SWAP_ADDRESS=SWAP,
)
class ScopedSwapApprovalTest(RunsOnTheScopedConnection, TransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            install_deployment(self)

    def test_issuer_projection_queues_operator_approval_with_private_prebroadcast_association(self):
        with use_operator():
            result = deploy_share_token_task.func(
                token_uuid=str(self.token.pk),
                deployment_id=str(self.token.deployment_id),
                principal_id=self.tenant.user.pk,
            )
            self.assertTrue(result["success"])
            command = TokenDeployment.objects.get(pk=self.token.deployment_id)
            self.assertEqual(command.approval_outcome, "pending")
            with connections[OPERATOR_ALIAS].cursor() as cursor:
                cursor.execute(
                    "SELECT args FROM procrastinate_jobs WHERE task_name=%s AND args->>'deployment_id'=%s",
                    [recover_swap_approval.name, str(command.pk)],
                )
                self.assertEqual(len(cursor.fetchall()), 1)
        node = ApprovalNode()
        observed = []

        def send(raw):
            connection = connections[current_alias()]
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_user")
                role = cursor.fetchone()[0]
            command = TokenDeployment.objects.get(pk=self.token.deployment_id)
            observed.append(
                (
                    current_alias(),
                    role,
                    connection.get_autocommit(),
                    command.approval_transaction.tx_hash == command.approval_operation.current_attempt.tx_hash,
                )
            )
            return node.send(raw)

        node.client.send_raw_transaction.side_effect = send
        with patch.object(swap_approval, "get_base_chain_client", return_value=node.client), use_operator():
            self.assertEqual(recover_swap_approval.func(deployment_id=str(command.pk)), "confirmed")
        self.assertEqual(observed, [(OPERATOR_ALIAS, settings.RLS_ROLES[OPERATOR_ALIAS], True, True)])
        with acting_for(self.tenant.user.pk):
            with self.assertRaises(DatabaseError), atomic():
                TokenDeployment.objects.get(pk=command.pk)
            with self.assertRaises(DatabaseError), atomic():
                TokenDeployment.objects.filter(pk=command.pk).update(approval_outcome="observed_approved")
            with self.assertRaises(InvalidTokenStateException):
                swap_approval.recover(command.pk)
            self.assertEqual(current_alias(), APP_ALIAS)
