from unittest.mock import patch

from django.test import TransactionTestCase, override_settings

from blockchain.models import SignedAttempt
from companies.models import Company
from shared.db import use_operator
from shared.tests.row_contention import RealRowContention
from tokens.models import ShareToken, TokenDeployment
from tokens.services import deployment
from tokens.tests.deployment_fixtures import (
    CHAIN_ID,
    CREATED,
    FACTORY,
    KEY,
    admit_deployment,
    install_deployment,
)


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class DeploymentLockOrderTest(RealRowContention, TransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            install_deployment(self)
        self.defer = self.enterContext(patch("tokens.services.register_deployments.queue_deployment"))

    def draft(self):
        with use_operator():
            return ShareToken.objects.create(
                company=self.tenant.company, name="Lock ordered draft", symbol="LCK", total_supply="123"
            )

    def start(self, token):
        current = ShareToken.objects.get(pk=token.pk)
        admit_deployment(current, self.tenant.user)
        return current.deployment_id

    def projection(self):
        with use_operator(), patch.object(deployment, "_project", return_value=""):
            deployment.deploy_token(self.token)
            record = TokenDeployment.objects.get(pk=self.token.deployment_id)
        self.assertEqual(record.contract_address, CREATED)
        self.assertIsNone(record.projected_at)
        return record

    def test_start_waits_on_company_before_token(self):
        token = self.draft()
        admitted = self.while_row_is_held(lambda: self.start(token), self.tenant.company, free=(token,))
        with use_operator():
            current = ShareToken.objects.get(pk=token.pk)
        self.assertEqual((current.status, current.deployment_id), ("deploying", admitted))
        self.assertEqual(self.defer.call_count, 1)

    def test_start_holds_company_before_waiting_on_token(self):
        token = self.draft()
        self.while_row_is_held(lambda: self.start(token), token, held=(self.tenant.company,))

    def test_projection_waits_on_company_before_token(self):
        record = self.projection()
        original = record.transaction_id
        self.assertEqual(
            self.while_row_is_held(lambda: deployment._project(record), self.tenant.company, free=(self.token,)),
            CREATED,
        )
        with use_operator():
            record.refresh_from_db()
            self.token.refresh_from_db()
            self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual((self.token.contract_address, record.transaction_id), (CREATED, original))
        self.assertIsNotNone(record.projected_at)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_projection_holds_company_before_waiting_on_token(self):
        record = self.projection()
        self.assertEqual(
            self.while_row_is_held(lambda: deployment._project(record), self.token, held=(self.tenant.company,)),
            CREATED,
        )

    def test_confirmed_projection_recovers_after_company_standing_changes(self):
        record = self.projection()

        def suspend():
            Company.objects.filter(pk=self.tenant.company.pk).update(status="suspended")

        self.assertEqual(
            self.while_row_is_held(lambda: deployment._project(record), self.tenant.company, after_wait=suspend),
            CREATED,
        )
        self.assertEqual(len(self.node.broadcasts), 1)
