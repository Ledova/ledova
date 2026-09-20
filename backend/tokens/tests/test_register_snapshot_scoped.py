from django.test import TransactionTestCase, override_settings
from rest_framework.exceptions import PermissionDenied

from shared.db import OPERATOR_ALIAS, current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.models import RegisterEntry, ShareRegister
from tokens.services.register_snapshot import capture_snapshot
from tokens.tests.test_register_snapshot import (
    CHAIN_ID,
    FACTORY,
    KEY,
    POLICIES,
    snapshot_fixture,
)


@override_settings(
    BLOCKCHAIN_OPERATOR_KEY=KEY,
    BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
    SHARE_TOKEN_FACTORY_ADDRESS=FACTORY,
    WALLET_CHAIN_FINALITY_POLICIES=POLICIES,
)
class ScopedRegisterSnapshotTest(RunsOnTheScopedConnection, TransactionTestCase):
    def setUp(self):
        with use_operator():
            self.tenant, self.target, self.node = snapshot_fixture()

    def test_app_capture_refuses_before_provider_io_even_for_the_company_owner(self):
        self.the_principal_the_middleware_would_set(self.tenant.user)
        with self.assertRaises(PermissionDenied):
            capture_snapshot(self.tenant.token.pk, client=self.node.client)
        self.node.client.assert_expected_chain.assert_not_called()

    def test_operator_capture_has_real_authority_and_creates_no_register_rows(self):
        def read(identifier):
            self.assertEqual(current_alias(), OPERATOR_ALIAS)
            return self.node.block(identifier)

        self.node.client.w3.eth.get_block.side_effect = read
        with use_operator():
            result = capture_snapshot(self.tenant.token.pk, client=self.node.client)
            self.assertEqual(result["token"], str(self.tenant.token.pk))
            self.assertFalse(ShareRegister.objects.exists())
            self.assertFalse(RegisterEntry.objects.exists())
