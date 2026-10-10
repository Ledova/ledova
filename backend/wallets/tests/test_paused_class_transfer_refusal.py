from decimal import Decimal
from unittest import skipUnless
from unittest.mock import Mock, patch

from django.conf import settings
from django.core.cache import cache
from rest_framework.test import APITransactionTestCase
from web3 import Web3

from assets.models import Asset, AssetChainDeployment, AssetType
from shared.constants import BLOCKCHAIN_BASE
from shared.db import MIGRATE_ALIAS, acting_for, use_operator
from shared.db.principal import give_the_role_back, take_the_app_role
from shared.tests.tenants import make_tenant
from tokens.models import ShareToken, ShareTokenStatus
from wallets.models import Holding, Transaction, Wallet
from wallets.services import transfers
from wallets.services.transaction_confirmation import NOT_TRANSFERABLE
from wallets.tests.test_broadcast_transfer_guard import (
    RECIPIENT,
    WALLET_ADDRESS,
    erc20_transfer_data,
    sign,
)

CLASS_CONTRACT = Web3.to_checksum_address("0x" + "7a" * 20)
CLASS_SYMBOL = "PCO"
SINGLE_CONNECTION = settings.RLS_AMBIENT_ALIAS == MIGRATE_ALIAS
NOT_SINGLE_CONNECTION = (
    "this class measures the refusal on the ordinary suite's shared connection; under the scoped alias "
    "the class below is the authoritative run and this one cannot reach the connections it sets up with"
)


def a_deployed_class(company):
    token = ShareToken.objects.create(
        company=company,
        name="Paused class ordinary",
        symbol=CLASS_SYMBOL,
        total_supply="1000",
        status=ShareTokenStatus.DEPLOYED,
        contract_address=CLASS_CONTRACT,
        chain=BLOCKCHAIN_BASE,
        deployment_tx_hash="0x" + "7a" * 32,
    )
    asset = Asset.objects.create(
        symbol=CLASS_SYMBOL,
        name=f"{company.name} {token.name}",
        asset_type=AssetType.TOKENIZED_SECURITY.value,
        decimals=token.decimals,
        is_verified=True,
    )
    AssetChainDeployment.objects.create(
        asset=asset, chain=BLOCKCHAIN_BASE, contract_address=CLASS_CONTRACT, decimals=token.decimals
    )
    return token, asset


class PausedClassTransferRefusalChecks:
    def setUp(self):
        super().setUp()
        cache.clear()
        self.addCleanup(cache.clear)
        with use_operator():
            self.issuer = make_tenant("pause-issuer")
            self.investor = make_tenant("pause-investor")
            self.bystander = make_tenant("pause-bystander")
            self.token, self.asset = a_deployed_class(self.issuer.company)
            self.wallet = Wallet.objects.create(
                user_account=self.investor.account,
                address=WALLET_ADDRESS,
                chain=BLOCKCHAIN_BASE,
                verification_status="VERIFIED",
            )
            Holding.objects.create(wallet=self.wallet, asset=self.asset, quantity=Decimal("10"))
        self.provider = Mock(
            spec=["assert_expected_chain", "get_mined_nonce", "get_transaction_receipt", "broadcast_transaction"]
        )
        self.provider.assert_expected_chain.return_value = settings.BLOCKCHAIN_CHAIN_ID
        self.provider.get_transaction_receipt.return_value = None
        self.provider.get_mined_nonce.side_effect = lambda address: {
            "chain_id": settings.BLOCKCHAIN_CHAIN_ID,
            "nonce": 0,
            "balance_wei": str(10**32),
            "block_number": 100,
            "block_hash": "0x" + "ab" * 32,
        }
        self.provider.broadcast_transaction.side_effect = lambda raw: Web3.keccak(hexstr=raw).to_0x_hex()
        connect = patch("wallets.services.submissions.get_blockchain_client", return_value=self.provider)
        connect.start()
        self.addCleanup(connect.stop)
        schedule = patch.object(transfers, "_schedule_confirmation_checks")
        self.schedule = schedule.start()
        self.addCleanup(schedule.stop)
        self.client.force_authenticate(self.investor.user)

    def pause_the_class(self):
        with use_operator():
            self.token.status = ShareTokenStatus.PAUSED
            self.token.save(update_fields=["status", "updated_at"])

    def broadcast(self, **payload):
        return self.client.post(f"/api/wallets/{self.wallet.uuid}/broadcast-transfer/", payload, format="json")

    def erc20_transfer_to_the_class(self, **payload):
        return self.broadcast(
            signed_transaction=sign(to=CLASS_CONTRACT, data=erc20_transfer_data(RECIPIENT, 1)),
            to_address=RECIPIENT,
            amount="1",
            **payload,
        )

    def value_only_transaction_to_the_class(self):
        return self.broadcast(
            signed_transaction=sign(to=CLASS_CONTRACT, value=10**15), to_address=CLASS_CONTRACT, amount="0.001"
        )

    def refused_as_not_transferable(self, response):
        self.assertEqual(
            (response.status_code, response.json()),
            (400, {"detail": NOT_TRANSFERABLE.format(symbol=CLASS_SYMBOL)}),
        )
        self.provider.broadcast_transaction.assert_not_called()
        self.schedule.assert_not_called()
        with use_operator():
            self.assertFalse(Transaction.objects.filter(wallet=self.wallet).exists())

    def the_class_is_visible_to(self, tenant):
        take_the_app_role()
        try:
            with acting_for(tenant.user.pk):
                return ShareToken.objects.filter(pk=self.token.pk).exists()
        finally:
            give_the_role_back()

    def test_an_erc20_transfer_to_the_paused_class_is_refused_when_the_contract_field_is_omitted(self):
        self.pause_the_class()

        self.refused_as_not_transferable(self.erc20_transfer_to_the_class())

    def test_an_erc20_transfer_to_the_paused_class_is_refused_when_the_contract_field_is_declared(self):
        self.pause_the_class()

        self.refused_as_not_transferable(self.erc20_transfer_to_the_class(token_contract=CLASS_CONTRACT))

    def test_a_value_only_transaction_to_the_paused_class_is_refused(self):
        self.pause_the_class()

        self.refused_as_not_transferable(self.value_only_transaction_to_the_class())

    def test_an_erc20_transfer_to_the_deployed_class_is_refused_when_the_contract_field_is_omitted(self):
        self.refused_as_not_transferable(self.erc20_transfer_to_the_class())

    def test_an_erc20_transfer_to_the_deployed_class_is_refused_when_the_contract_field_is_declared(self):
        self.refused_as_not_transferable(self.erc20_transfer_to_the_class(token_contract=CLASS_CONTRACT))

    def test_a_value_only_transaction_to_the_deployed_class_is_refused(self):
        self.refused_as_not_transferable(self.value_only_transaction_to_the_class())

    def test_the_paused_class_is_visible_to_its_issuer_and_hidden_from_the_investor_and_the_bystander(self):
        actors = (self.issuer, self.investor, self.bystander)
        self.assertEqual([self.the_class_is_visible_to(actor) for actor in actors], [True, True, True])

        self.pause_the_class()

        self.assertEqual([self.the_class_is_visible_to(actor) for actor in actors], [True, False, False])

    def test_an_ordinary_native_send_from_the_investor_wallet_still_broadcasts(self):
        self.pause_the_class()
        signed = sign(to=RECIPIENT, value=25 * 10**16)

        response = self.broadcast(signed_transaction=signed, to_address=RECIPIENT, amount="0.25")

        self.assertEqual(response.status_code, 200, response.content)
        self.provider.broadcast_transaction.assert_called_once_with(signed)
        self.schedule.assert_called_once()
        with use_operator():
            recorded = Transaction.objects.get(wallet=self.wallet)
        self.assertEqual((recorded.to_address, recorded.amount), (RECIPIENT, Decimal("0.25")))


@skipUnless(SINGLE_CONNECTION, NOT_SINGLE_CONNECTION)
class PausedClassTransferRefusalTest(PausedClassTransferRefusalChecks, APITransactionTestCase):
    pass
