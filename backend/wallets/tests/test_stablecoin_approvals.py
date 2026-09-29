from datetime import timedelta
from decimal import Decimal
from unittest import skipUnless
from unittest.mock import Mock, patch

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from rest_framework.test import APITransactionTestCase
from web3 import Web3

from assets.models import Asset, AssetChainDeployment, AssetType
from shared.constants import BLOCKCHAIN_BASE
from shared.db import MIGRATE_ALIAS, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_tenant
from wallets.models import Holding, Transaction, Wallet, WalletSubmission
from wallets.services import transfers
from wallets.services.transaction_confirmation import (
    RECIPIENT_NOT_APPROVED,
    SENDER_NOT_APPROVED,
)
from wallets.services.transfers import INVALID_RECIPIENT
from wallets.tests.test_broadcast_transfer_guard import (
    RECIPIENT,
    WALLET_ADDRESS,
    erc20_transfer_data,
    sign,
)
from whitelist.models import WhitelistApproval, WhitelistEntry, WhitelistStatus
from whitelist.tests.change_fixtures import REGISTRY, change_company

OTHER_TOKEN_CONTRACT = Web3.to_checksum_address("0x" + "6b" * 20)
SINGLE_CONNECTION = settings.RLS_AMBIENT_ALIAS == MIGRATE_ALIAS
NOT_SINGLE_CONNECTION = (
    "this class measures the rule on the ordinary suite's shared connection; under the scoped alias the "
    "class below is the authoritative run, with the recipient's wallet row hidden from the sender"
)
NOT_LIVE = {
    "expired": {"status": WhitelistStatus.ACTIVE, "expires_at_offset": timedelta(seconds=-1)},
    "pending": {"status": WhitelistStatus.PENDING},
    "failed": {"status": WhitelistStatus.FAILED},
    "removed": {"status": WhitelistStatus.REMOVED},
}


class StablecoinApprovalChecks:
    def setUp(self):
        super().setUp()
        cache.clear()
        self.addCleanup(cache.clear)
        with use_operator():
            self.sender = make_tenant("stable-sender")
            recipient = make_tenant("stable-recipient")
            self.company = change_company("stable-approvals")
            self.stablecoin = self.sender.refs.stablecoin
            self.contract = Web3.to_checksum_address(
                AssetChainDeployment.objects.get(asset=self.stablecoin, chain=BLOCKCHAIN_BASE).contract_address
            )
            self.wallet = Wallet.objects.create(
                user_account=self.sender.account,
                address=WALLET_ADDRESS,
                chain=BLOCKCHAIN_BASE,
                verification_status="VERIFIED",
            )
            self.recipient_wallet = Wallet.objects.create(
                user_account=recipient.account,
                address=RECIPIENT,
                chain=BLOCKCHAIN_BASE,
                verification_status="VERIFIED",
            )
            Holding.objects.create(wallet=self.wallet, asset=self.stablecoin, quantity=Decimal("100"))
        self.chain = patch("wallets.services.transfers.get_blockchain_client").start()
        self.addCleanup(patch.stopall)
        prepared = self.chain.return_value
        prepared.estimate_erc20_transfer_gas.return_value = 60000
        prepared.get_gas_price.return_value = 10**9
        prepared.build_erc20_transfer_data.return_value = "0x" + erc20_transfer_data(RECIPIENT, 500).hex()
        prepared.get_nonce.return_value = 0
        prepared.w3.eth.chain_id = settings.BLOCKCHAIN_CHAIN_ID
        patch.object(transfers, "_get_native_balance", return_value=Decimal("1")).start()
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
        self.connect = patch("wallets.services.submissions.get_blockchain_client", return_value=self.provider).start()
        self.schedule = patch.object(transfers, "_schedule_confirmation_checks").start()
        self.client.force_authenticate(self.sender.user)

    def approve(self, wallet, status=WhitelistStatus.ACTIVE, expires_at_offset=None):
        with use_operator():
            entry, _ = WhitelistEntry.objects.get_or_create(wallet=wallet)
            WhitelistApproval.objects.create(
                entry=entry,
                company=self.company,
                registry_address=REGISTRY,
                status=status,
                expires_at=None if expires_at_offset is None else timezone.now() + expires_at_offset,
            )

    def withdraw_approvals(self, wallet):
        with use_operator():
            WhitelistApproval.objects.filter(entry__wallet=wallet).update(status=WhitelistStatus.REMOVED)

    def prepare(self, contract=None, to=RECIPIENT):
        return self.client.post(
            f"/api/wallets/{self.wallet.uuid}/prepare-transfer/",
            {"to_address": to, "amount_token": "5", "token_contract": contract or self.contract},
            format="json",
        )

    def broadcast(self, signed):
        return self.client.post(
            f"/api/wallets/{self.wallet.uuid}/broadcast-transfer/", {"signed_transaction": signed}, format="json"
        )

    def payment(self, contract=None):
        return sign(to=contract or self.contract, data=erc20_transfer_data(RECIPIENT, 500))

    def refused(self, response, message):
        self.assertEqual(
            (response.status_code, response.json()),
            (403, {"detail": message.format(symbol="TUSD"), "code": "stablecoin_approval_required"}),
        )

    def nothing_recorded_or_sent(self):
        self.connect.assert_not_called()
        self.assertEqual(self.provider.mock_calls, [])
        self.schedule.assert_not_called()
        with use_operator():
            self.assertFalse(WalletSubmission.objects.filter(wallet=self.wallet).exists())
            self.assertFalse(Transaction.objects.filter(wallet=self.wallet).exists())

    def other_token(self):
        with use_operator():
            asset = Asset.objects.create(
                symbol="OTK", name="Other token", asset_type=AssetType.ERC20_TOKEN.value, decimals=2, is_verified=True
            )
            AssetChainDeployment.objects.create(
                asset=asset, chain=BLOCKCHAIN_BASE, contract_address=OTHER_TOKEN_CONTRACT, decimals=2
            )
            Holding.objects.create(wallet=self.wallet, asset=asset, quantity=Decimal("100"))

    def test_prepare_is_refused_when_the_sending_wallet_has_no_live_approval(self):
        self.approve(self.recipient_wallet)

        self.refused(self.prepare(), SENDER_NOT_APPROVED)
        self.chain.assert_not_called()

    def test_prepare_is_refused_when_the_recipient_has_no_live_approval(self):
        self.approve(self.wallet)

        self.refused(self.prepare(), RECIPIENT_NOT_APPROVED)
        self.chain.assert_not_called()

    def test_prepare_goes_ahead_when_both_parties_hold_a_live_approval_with_different_accounts(self):
        self.approve(self.wallet)
        self.approve(self.recipient_wallet)

        response = self.prepare()

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual((response.json()["toAddress"], response.json()["tokenSymbol"]), (RECIPIENT, "TUSD"))

    def test_an_approval_that_is_not_live_does_not_count(self):
        self.approve(self.wallet)
        for name, terms in NOT_LIVE.items():
            with self.subTest(approval=name):
                with use_operator():
                    WhitelistApproval.objects.filter(entry__wallet=self.recipient_wallet).delete()
                self.approve(self.recipient_wallet, **terms)

                self.refused(self.prepare(), RECIPIENT_NOT_APPROVED)

    def test_a_payment_signed_without_prepare_to_an_unapproved_recipient_is_refused_before_it_is_recorded(self):
        self.approve(self.wallet)

        self.refused(self.broadcast(self.payment()), RECIPIENT_NOT_APPROVED)
        self.nothing_recorded_or_sent()

    def test_an_approval_withdrawn_between_prepare_and_submission_is_refused_at_submission(self):
        self.approve(self.wallet)
        self.approve(self.recipient_wallet)
        self.assertEqual(self.prepare().status_code, 200)
        self.withdraw_approvals(self.recipient_wallet)

        self.refused(self.broadcast(self.payment()), RECIPIENT_NOT_APPROVED)
        self.nothing_recorded_or_sent()

    def test_a_sender_approval_withdrawn_between_prepare_and_submission_is_refused_at_submission(self):
        self.approve(self.wallet)
        self.approve(self.recipient_wallet)
        self.assertEqual(self.prepare().status_code, 200)
        self.withdraw_approvals(self.wallet)

        self.refused(self.broadcast(self.payment()), SENDER_NOT_APPROVED)
        self.nothing_recorded_or_sent()

    def test_an_approval_withdrawn_while_the_nonce_is_observed_is_refused_inside_the_recording_transaction(self):
        self.approve(self.wallet)
        self.approve(self.recipient_wallet)
        observe = self.provider.get_mined_nonce.side_effect

        def withdraw_then_observe(address):
            self.withdraw_approvals(self.recipient_wallet)
            return observe(address)

        self.provider.get_mined_nonce.side_effect = withdraw_then_observe

        self.refused(self.broadcast(self.payment()), RECIPIENT_NOT_APPROVED)
        self.provider.get_mined_nonce.assert_called_once()
        self.provider.broadcast_transaction.assert_not_called()
        self.schedule.assert_not_called()
        with use_operator():
            self.assertFalse(WalletSubmission.objects.filter(wallet=self.wallet).exists())
            self.assertFalse(Transaction.objects.filter(wallet=self.wallet).exists())

    def test_a_recipient_that_is_not_an_address_on_the_wallet_network_is_invalid_rather_than_refused(self):
        self.approve(self.wallet)
        for name, recipient in (("object", {"address": RECIPIENT}), ("number", 12345), ("malformed", "0x1234")):
            with self.subTest(recipient=name):
                response = self.prepare(to=recipient)

                self.assertEqual((response.status_code, response.json()), (400, {"detail": INVALID_RECIPIENT}))
        self.chain.assert_not_called()

    def test_a_payment_between_approved_parties_is_recorded_and_sent(self):
        self.approve(self.wallet)
        self.approve(self.recipient_wallet)
        signed = self.payment()

        response = self.broadcast(signed)

        self.assertEqual(response.status_code, 200, response.content)
        self.provider.broadcast_transaction.assert_called_once_with(signed)
        with use_operator():
            recorded = Transaction.objects.get(wallet=self.wallet)
        self.assertEqual((recorded.to_address, recorded.amount), (RECIPIENT, Decimal("5")))

    def test_a_recorded_payment_posted_again_after_an_approval_lapses_is_reported_rather_than_refused(self):
        self.approve(self.wallet)
        self.approve(self.recipient_wallet)
        signed = self.payment()
        first = self.broadcast(signed)
        self.assertEqual(first.status_code, 200, first.content)
        self.withdraw_approvals(self.recipient_wallet)

        again = self.broadcast(signed)

        self.assertEqual(again.status_code, 200, again.content)
        self.assertEqual(again.json()["txHash"], first.json()["txHash"])
        with use_operator():
            self.assertEqual(WalletSubmission.objects.filter(wallet=self.wallet).count(), 1)

    def test_native_coins_and_other_tokens_move_without_any_approval(self):
        self.other_token()

        prepared = self.prepare(contract=OTHER_TOKEN_CONTRACT)
        other = self.broadcast(self.payment(contract=OTHER_TOKEN_CONTRACT))
        native = self.broadcast(sign(to=RECIPIENT, value=25 * 10**16, nonce=1))

        self.assertEqual(
            [prepared.status_code, other.status_code, native.status_code],
            [200, 200, 200],
            [prepared.content, other.content, native.content],
        )
        self.assertEqual(self.provider.broadcast_transaction.call_count, 2)


@skipUnless(SINGLE_CONNECTION, NOT_SINGLE_CONNECTION)
class StablecoinApprovalTest(StablecoinApprovalChecks, APITransactionTestCase):
    pass


class ScopedStablecoinApprovalTest(RunsOnTheScopedConnection, StablecoinApprovalChecks, APITransactionTestCase):
    pass
