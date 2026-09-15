from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings
from django.utils import timezone

from shared.db import atomic
from shared.tests.schema import migrate_to, restore_every_migration
from tokens.models import TokenDeployment
from tokens.services import deployment, swap_approval
from tokens.tests.deployment_fixtures import CHAIN_ID, FACTORY, KEY, install_deployment
from tokens.tests.swap_approval_fixtures import SWAP


@override_settings(
    BLOCKCHAIN_OPERATOR_KEY=KEY,
    BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
    SHARE_TOKEN_FACTORY_ADDRESS=FACTORY,
    ATOMIC_SWAP_ADDRESS=SWAP,
)
class SwapApprovalMigrationTest(TransactionTestCase):
    def setUp(self):
        install_deployment(self)
        self.addCleanup(restore_every_migration)

    def test_historical_projection_keeps_all_terms_without_acquiring_approval_authority(self):
        command = deployment._process(deployment._admit(self.token, None), None)
        before = migrate_to([("tokens", "0048_issuance_execution_guards")])
        old_deployments = before.get_model("tokens", "TokenDeployment").objects
        old_deployments.filter(pk=command.pk).update(projected_at=timezone.now())
        original = old_deployments.filter(pk=command.pk).values().get()
        restore_every_migration()
        current = TokenDeployment.objects.filter(pk=command.pk).values().get()
        for field in tuple(current):
            if field.startswith("approval_"):
                self.assertEqual(current.pop(field), "" if field == "approval_outcome" else None)
        self.assertEqual(current, original)
        self.assertEqual(swap_approval.recover(command.pk), "")
        with self.assertRaisesMessage(DatabaseError, "Historical deployments"), atomic():
            TokenDeployment.objects.filter(pk=command.pk).update(
                approval_outcome="pending", approval_intent=swap_approval.approval_intent(command)
            )

    def test_old_binary_cannot_complete_projection_without_the_approval_handoff(self):
        command = deployment._process(deployment._admit(self.token, None), None)
        before = migrate_to([("tokens", "0048_issuance_execution_guards")])
        old_deployments = before.get_model("tokens", "TokenDeployment").objects
        restore_every_migration()
        with self.assertRaisesMessage(DatabaseError, "approval disposition"), atomic():
            old_deployments.filter(pk=command.pk).update(projected_at=timezone.now())
        self.assertIsNone(TokenDeployment.objects.get(pk=command.pk).projected_at)

    def test_reverse_refuses_to_remove_admitted_approval_history(self):
        deployment.deploy_token(self.token)
        original = TokenDeployment.objects.get(pk=self.token.deployment_id).approval_intent
        with self.assertRaisesMessage(DatabaseError, "Cannot remove admitted swap approval history"):
            migrate_to([("tokens", "0048_issuance_execution_guards")])
        restore_every_migration()
        self.assertEqual(TokenDeployment.objects.get(pk=self.token.deployment_id).approval_intent, original)
