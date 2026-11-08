from unittest.mock import Mock, patch
from uuid import uuid4

from django.test import TransactionTestCase, override_settings
from eth_account import Account
from rest_framework.exceptions import PermissionDenied
from web3 import Web3

from blockchain.models import (
    OutgoingOperation,
    OutgoingStatus,
    SignedAttempt,
    SigningAccount,
)
from blockchain.services import outgoing
from integrations.base_chain.client import BaseChainClient
from shared.db import use_operator
from tokens.models import TokenDeployment
from tokens.services import deployment


class RegistryExecutionBoundaryTest(TransactionTestCase):
    def test_unsigned_work_is_held_and_signed_receipts_reconcile_without_execution(self):
        account = Account.from_key("0x" + "11" * 32)
        intent = outgoing.transaction_intent(chain_id=84532, sender=account.address, to="0x" + "22" * 20, data="0x1234")
        with use_operator():
            pending = TokenDeployment.objects.create(
                token_id=uuid4(),
                company_id=uuid4(),
                intent=intent
                | {
                    "name": "Synthetic class",
                    "symbol": "ORD",
                    "identifier": "synthetic-boundary",
                    "authorized_shares": "100",
                    "issuer_wallet": str(uuid4()),
                    "decimals": 0,
                },
            )
            before = TokenDeployment.objects.values().get(pk=pending.pk)
            with patch("tokens.services.deployment.get_base_chain_client") as provider:
                self.assertEqual(deployment._process(pending).pk, pending.pk)
                provider.assert_not_called()
            self.assertEqual(TokenDeployment.objects.values().get(pk=pending.pk), before)
            self.assertEqual(OutgoingOperation.objects.count(), 0)

            operation = OutgoingOperation.objects.create(
                operation_key="synthetic-boundary:" + str(uuid4()), intent=intent, claim_id=uuid4()
            )
            self.assertIsNone(outgoing.recovery_claim(operation.pk, intent))
            signer = SigningAccount.objects.create(chain_id=84532, address=account.address.lower(), next_nonce=1)
            raw = bytes(
                account.sign_transaction(
                    {
                        "chainId": 84532,
                        "nonce": 0,
                        "to": Web3.to_checksum_address(intent["to"]),
                        "value": 0,
                        "data": intent["data"],
                        "gas": 50000,
                        "gasPrice": 1,
                    }
                ).raw_transaction
            )
            attempt = SignedAttempt.objects.create(
                operation=operation,
                claim_id=operation.claim_id,
                signer=signer,
                nonce=0,
                tx_hash=Web3.to_hex(Web3.keccak(raw)),
                raw_transaction=raw,
            )
            operation.current_attempt = attempt
            operation.status = OutgoingStatus.SIGNED
            operation.save(update_fields=["current_attempt", "status"])
            claim = outgoing.recovery_claim(operation.pk, intent)
            client = Mock(spec=BaseChainClient, w3=Mock())
            client.assert_expected_chain.return_value = 84532
            client.w3.eth.chain_id = 84532
            client.get_transaction_receipt.return_value = None
            self.assertFalse(outgoing.reconcile_operation(claim, client))
            operation.refresh_from_db()
            self.assertEqual(operation.status, OutgoingStatus.SIGNED)
            client.send_raw_transaction.assert_not_called()

            receipt = {
                "transactionHash": attempt.tx_hash,
                "status": 1,
                "blockNumber": 7,
                "blockHash": "0x" + "33" * 32,
                "gasUsed": 30000,
            }
            client.get_transaction_receipt.return_value = receipt
            client.get_block.return_value = {"number": 7, "hash": receipt["blockHash"]}
            with patch("blockchain.services.outgoing.Account.from_key") as key:
                self.assertTrue(outgoing.reconcile_operation(claim, client))
                key.assert_not_called()
            client.send_raw_transaction.assert_not_called()
            operation.refresh_from_db()
            signer.refresh_from_db()
            self.assertEqual(operation.status, OutgoingStatus.CONFIRMED)
            self.assertEqual(operation.block_hash, receipt["blockHash"])
            self.assertEqual(operation.current_attempt_id, attempt.pk)
            self.assertEqual(signer.next_nonce, 1)
            with self.assertRaises(outgoing.OutgoingTransactionError):
                outgoing.recovery_claim(operation.pk, intent | {"data": "0xabcd"})
            for action in (
                lambda: outgoing.open_operation("new", **intent),
                lambda: outgoing.prepare_operation(claim, client),
                lambda: outgoing.sign_operation(claim, None, None),
                lambda: outgoing.broadcast_operation(claim, client),
            ):
                with self.assertRaises(PermissionDenied):
                    action()
            self.assertEqual(SignedAttempt.objects.count(), 1)

        with override_settings(BLOCKCHAIN_CHAIN_ID=31337):
            client.w3.provider.endpoint_uri = "http://localhost:8545"
            client.w3.eth.chain_id = 31337
            BaseChainClient._require_local_execution(client)
            for endpoint, chain_id in (
                ("https://example.test", 31337),
                ("http://127.0.0.1:8545", 84532),
            ):
                client.w3.provider.endpoint_uri = endpoint
                client.w3.eth.chain_id = chain_id
                with self.assertRaises(PermissionDenied):
                    BaseChainClient._require_local_execution(client)
