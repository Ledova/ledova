from contextlib import ExitStack
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings

from shared.db import atomic, current_alias, principal_of, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.models import RegisterDeployment, RegisterDeploymentDecision, ShareToken
from tokens.services import deployment, pause_changes
from tokens.tasks.pause import recover_pause_change
from tokens.tests.deployment_fixtures import (
    CHAIN_ID,
    CREATED,
    FACTORY,
    KEY,
    install_deployment,
)
from tokens.tests.pause_fixtures import PauseNode


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class CompanyDeploymentPauseProjectionTest(TransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            install_deployment(self)
            self.assertEqual(deployment.deploy_token(self.token)["contract_address"], CREATED)
            self.token.refresh_from_db()
            self.assertEqual(self.token.status, "deployed")
            self.source = RegisterDeployment.objects.get(deployment_id=self.token.deployment_id)
            self.original = (
                self.token.deployment_id,
                self.token.deployment_transaction_id,
                self.token.deployment_tx_hash,
                self.token.contract_address,
                self.token.deployed_at,
            )
        self.pause_node = PauseNode(self.token.contract_address)
        self.enterContext(
            patch("tokens.services.pause_recovery.get_base_chain_client", return_value=self.pause_node.client)
        )

    def test_company_deployment_pause_and_unpause_project_as_issuer_without_private_source_reads(self):
        writes = []

        def record(execute, sql, params, many, context):
            if sql.startswith("UPDATE") and '"tokens_sharetoken"' in sql:
                active_connection = context["connection"]
                with active_connection.cursor() as cursor:
                    cursor.execute("SELECT current_user")
                    role = cursor.fetchone()[0]
                writes.append((role, principal_of(active_connection.alias)))
            return execute(sql, params, many, context)

        with ExitStack() as stack:
            active_connection = connections[current_alias()]
            with active_connection.cursor() as cursor:
                cursor.execute("SELECT current_setting('plan_cache_mode')")
                original_plan = cursor.fetchone()[0]
                cursor.execute("SELECT set_config('plan_cache_mode', 'force_generic_plan', false)")

            def restore_plan():
                with active_connection.cursor() as cursor:
                    cursor.execute("SELECT set_config('plan_cache_mode', %s, false)", [original_plan])

            stack.callback(restore_plan)
            for alias in self.databases:
                stack.enter_context(connections[alias].execute_wrapper(record))
            for paused, status in ((True, "paused"), (False, "deployed")):
                with use_operator():
                    change = pause_changes.submit(self.token, self.tenant.user, uuid4(), paused)
                self.assertTrue(recover_pause_change.func(str(change.pk))["completed"])
                with use_operator():
                    self.token.refresh_from_db()
                    change.refresh_from_db()
                    self.assertEqual((self.token.status, change.status), (status, "confirmed"))
                    self.assertEqual(
                        (
                            self.token.deployment_id,
                            self.token.deployment_transaction_id,
                            self.token.deployment_tx_hash,
                            self.token.contract_address,
                            self.token.deployed_at,
                        ),
                        self.original,
                    )
        self.assertEqual(writes, [(settings.RLS_ROLES["app"], str(self.tenant.user.pk))] * 2)
        self.assertIn(principal_of(), (None, ""))

    def test_private_sources_and_unbound_new_deployment_admission_remain_refused(self):
        for model in (RegisterDeployment, RegisterDeploymentDecision):
            with self.subTest(model=model.__name__):
                with self.assertRaises(DatabaseError) as error, pause_changes._projection_role(
                    self.tenant.user.pk
                ), atomic():
                    model.objects.exists()
                self.assertEqual(error.exception.__cause__.sqlstate, "42501")
        with use_operator():
            unbound = ShareToken.objects.create(
                company=self.token.company, name="Unbound deployment", symbol="UNBOUND", total_supply="100"
            )
        with self.assertRaisesMessage(
            DatabaseError, "New deployment admission requires its exact company decision"
        ) as error:
            with use_operator(), atomic():
                ShareToken.objects.filter(pk=unbound.pk).update(status="deploying", deployment_id=uuid4())
        self.assertEqual(error.exception.__cause__.sqlstate, "23514")
        with use_operator():
            unbound.refresh_from_db()
            self.assertEqual((unbound.status, unbound.deployment_id), ("draft", None))
            self.assertEqual(RegisterDeployment.objects.get(pk=self.source.pk).status, "applied")
            self.assertEqual(RegisterDeploymentDecision.objects.filter(register_deployment=self.source).count(), 2)


class ScopedCompanyDeploymentPauseProjectionTest(RunsOnTheScopedConnection, CompanyDeploymentPauseProjectionTest):
    pass
