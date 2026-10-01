from datetime import date
from unittest.mock import call, patch

from django.contrib.auth import get_user_model
from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings

from blockchain.models import SignedAttempt
from blockchain.tests.outgoing_fixtures import receipt
from shared.tests.tenants import an_account
from tokens.exceptions import MintRequestConflict
from tokens.models import MintRequest, MintRequestStatus, YieldToken
from tokens.services import mint_service
from tokens.tests.mint_request_fixtures import (
    CHAIN_ID,
    KEY,
    RECIPIENT,
    MintNode,
    admitted_signer,
    mint_request,
)
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet

LOGGER = "tokens.services.mint_service"


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class AnExecutedDepositWritesItsRecipientsHoldingTest(TransactionTestCase):
    def setUp(self):
        self.actor = get_user_model().objects.create_superuser(email="mint-holding@example.test", password="synthetic")
        self.request = mint_request(self.actor)
        self.node = MintNode()
        self.enterContext(patch("tokens.services.mint_service.get_base_chain_client", return_value=self.node.client))
        self.holdings = self.enterContext(patch.object(mint_service, "sync_holding"))
        admitted_signer()
        self.wallet = self.recipient("mint-recipient", "base", WALLET_VERIFICATION_STATUS_VERIFIED)

    def recipient(self, label, chain, status):
        return Wallet.objects.create(
            user_account=an_account(label), address=RECIPIENT, chain=chain, verification_status=status
        )

    def written(self):
        return [call(self.wallet, self.request.settlement_asset, create_empty=False)]

    def test_an_executed_deposit_writes_only_its_recipients_verified_base_holding(self):
        self.recipient("mint-unverified", "base", "PENDING")
        self.recipient("mint-elsewhere", "ethereum", WALLET_VERIFICATION_STATUS_VERIFIED)

        mint_service.execute(self.request, self.actor)

        self.assertEqual(self.request.status, MintRequestStatus.EXECUTED)
        self.assertEqual(self.holdings.call_args_list, self.written())

    def test_a_deposit_whose_receipt_arrives_later_is_written_when_recovery_sees_it_executed(self):
        self.node.confirmed = False
        tx_hash, _ = mint_service.execute(self.request, self.actor)
        self.assertEqual(self.request.status, MintRequestStatus.EXECUTING)
        self.holdings.assert_not_called()

        self.node.receipts[tx_hash] = receipt(SignedAttempt.objects.get())
        self.assertEqual(mint_service.recover(self.request.pk), MintRequestStatus.EXECUTED)

        self.assertEqual(self.holdings.call_args_list, self.written())

    def test_a_reverted_deposit_writes_no_holding(self):
        self.node.receipt_status = 0

        with self.assertRaises(MintRequestConflict):
            mint_service.execute(self.request, self.actor)
        self.assertEqual(mint_service.recover(self.request.pk), MintRequestStatus.FAILED)

        self.holdings.assert_not_called()

    def test_a_holding_that_cannot_be_written_leaves_the_deposit_executed(self):
        self.holdings.side_effect = DatabaseError("lost")

        with self.assertLogs(LOGGER, "WARNING") as logs:
            tx_hash, record = mint_service.execute(self.request, self.actor)

        self.assertEqual((self.request.status, record.tx_hash), (MintRequestStatus.EXECUTED, tx_hash))
        self.assertIn(f"Mint request {self.request.pk} executed", logs.output[-1])
        self.assertIn(f"wallet {self.wallet.pk} was not written (DatabaseError)", logs.output[-1])

    def test_a_yield_token_mint_writes_no_settlement_asset_holding(self):
        token = YieldToken.objects.create(name="Gov Bond", symbol="AUSG", contract_address="0x" + "2" * 40)
        request = MintRequest.objects.create(
            yield_token=token,
            recipient_address=RECIPIENT,
            recipient_name="Alice",
            amount=10000,
            deposit_reference="SYNTHETIC-YIELD-1",
            deposit_date=date(2026, 9, 1),
            requested_by=self.actor,
        )

        mint_service.execute(request, self.actor, permission="tokens.change_yieldtoken")

        request.refresh_from_db()
        self.assertEqual(request.status, MintRequestStatus.EXECUTED)
        self.holdings.assert_not_called()
