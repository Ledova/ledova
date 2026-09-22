from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.test import TestCase

from assets.models import Asset, AssetChainDeployment
from shared.tests.tenants import make_tenant
from tokens.models import RegisterMemberWallet
from tokens.services import share_token_service
from tokens.services.register import stored_register
from tokens.services.register_events import create_member, open_register
from tokens.tests.test_register_events import DAY
from wallets.models import Holding
from wallets.services.sync import _sync_holdings_from_blockchain, sync_wallet

CACHED = Decimal("12000")
ON_CHAIN = 11000


class TheCacheAndTheRegisterReadOneChainTest(TestCase):
    def setUp(self):
        self.tenant = make_tenant("onereader")
        self.wallet = self.tenant.wallet
        self.token = self.tenant.deployed_token
        self.asset = Asset.objects.create(
            symbol="ORD", name="Acme Ordinary", asset_type="tokenized_security", decimals=0, is_verified=True
        )
        AssetChainDeployment.objects.create(
            asset=self.asset, chain=self.wallet.chain, contract_address=self.token.contract_address, decimals=0
        )
        self.holding = Holding.objects.create(wallet=self.wallet, asset=self.asset, quantity=CACHED)

    def _chain(self, balance=ON_CHAIN):
        self.addCleanup(patch.stopall)
        patch("tokens.services.share_token_service.get_base_chain_client").start()
        return patch.object(share_token_service, "get_token_balance", return_value=balance).start()

    def test_a_transfer_the_platform_did_not_make_is_closed_by_the_next_sync(self):
        self._chain()

        _sync_holdings_from_blockchain(self.wallet)

        self.holding.refresh_from_db()
        self.assertEqual(self.holding.quantity, Decimal(ON_CHAIN))

    def test_a_decimals_column_the_contract_never_agreed_to_no_longer_divides_the_holding(self):
        AssetChainDeployment.objects.filter(asset=self.asset).update(decimals=2)
        self._chain()

        _sync_holdings_from_blockchain(self.wallet)

        self.holding.refresh_from_db()
        self.assertEqual(self.holding.quantity, Decimal(ON_CHAIN))

    def test_reading_the_register_leaves_the_cache_and_the_chain_alone(self):
        member = create_member(company_id=self.token.company_id, member_id=uuid4())
        RegisterMemberWallet.objects.create(
            company_id=self.token.company_id, member=member, address=self.wallet.address
        )
        open_register(
            token_id=self.token.pk,
            operation_id=uuid4(),
            changes=[{"member": str(member.pk), "shares": str(ON_CHAIN)}],
            effective_on=DAY,
            recorded_by=self.tenant.user,
        )
        reader = self._chain()

        register = stored_register(self.token)

        self.assertEqual([row["balance"] for row in register["rows"]], [str(ON_CHAIN)])
        self.holding.refresh_from_db()
        self.assertEqual((self.holding.quantity, self.holding.last_synced_at), (CACHED, None))
        reader.assert_not_called()


class TheWalletDoesNotClaimAFreshnessItDoesNotHaveTest(TestCase):
    def setUp(self):
        self.tenant = make_tenant("freshness")
        self.wallet = self.tenant.wallet
        self.token = self.tenant.deployed_token
        self.asset = Asset.objects.create(
            symbol="ORD", name="Acme Ordinary", asset_type="tokenized_security", decimals=0, is_verified=True
        )
        AssetChainDeployment.objects.create(
            asset=self.asset, chain=self.wallet.chain, contract_address=self.token.contract_address, decimals=0
        )
        Holding.objects.create(wallet=self.wallet, asset=self.asset, quantity=CACHED)
        self.addCleanup(patch.stopall)
        patch("tokens.services.share_token_service.get_base_chain_client").start()
        client = patch("wallets.services.sync.get_blockchain_client").start()
        client.return_value.get_transaction_history.return_value = []
        patch("wallets.services.chain.get_blockchain_client").start().return_value.get_token_balance.return_value = None

    def test_a_holding_the_chain_would_not_answer_leaves_the_stamp_where_it_was(self):
        patch.object(share_token_service, "get_token_balance", side_effect=RuntimeError("rpc down")).start()

        with self.assertLogs("wallets.services.sync", level="WARNING") as logs:
            sync_wallet(self.wallet)

        self.wallet.refresh_from_db()
        self.assertIsNone(self.wallet.last_synced_at)
        self.assertIn("last_synced_at stays where it was", "\n".join(logs.output))

    def test_a_sync_that_read_every_holding_does_stamp_it(self):
        patch.object(share_token_service, "get_token_balance", return_value=ON_CHAIN).start()
        Holding.objects.filter(wallet=self.wallet).exclude(asset=self.asset).delete()

        sync_wallet(self.wallet)

        self.wallet.refresh_from_db()
        self.assertIsNotNone(self.wallet.last_synced_at)
