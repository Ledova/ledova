from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from eth_abi import encode
from eth_account import Account
from hexbytes import HexBytes
from web3 import Web3

from blockchain.models import OutgoingOperation, SignedAttempt, SigningAccount
from blockchain.tests.outgoing_fixtures import chain_client
from shared.tests.tenants import make_tenant
from tokens.exceptions import (
    InvalidTokenStateException,
    IssuanceExecutionConflict,
    IssuanceExecutionUnresolved,
)
from tokens.models import ShareIssuance, ShareIssuanceRequest
from tokens.services import legacy_issuance
from tokens.tests.issuance_fixtures import CHAIN_ID, KEY


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class LegacyIssuanceRecoveryTest(TransactionTestCase):
    def setUp(self):
        self.tenant = make_tenant("historical-issuance")
        self.request = ShareIssuanceRequest.objects.create(
            token=self.tenant.deployed_token,
            dispatch_id=None,
            recipient_address=self.tenant.wallet.address,
            amount=10,
            reason="Historical allotment",
            status="executing",
        )
        ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(updated_at=timezone.now() - timedelta(hours=1))
        self.request.refresh_from_db()
        self.issuance = ShareIssuance.objects.create(
            token=self.request.token,
            recipient_address=self.request.recipient_address,
            amount="10",
            status="processing",
            idempotency_key=f"issuance-request:{self.request.pk}",
        )
        ShareIssuance.objects.filter(pk=self.issuance.pk).update(processed_at=timezone.now() - timedelta(hours=1))
        self.issuance.refresh_from_db()
        self.data = Web3.keccak(text="mint(address,uint256)")[:4] + encode(
            ["address", "uint256"], [self.request.recipient_address, 10]
        )
        signed = Account.sign_transaction(
            {
                "chainId": CHAIN_ID,
                "nonce": 7,
                "gasPrice": 10**9,
                "gas": 100000,
                "to": Web3.to_checksum_address(self.request.token.contract_address),
                "value": 0,
                "data": self.data,
            },
            KEY,
        )
        self.raw = bytes(signed.raw_transaction)
        self.tx_hash = Web3.to_hex(signed.hash)
        self.transaction = {
            "hash": self.tx_hash,
            "to": self.request.token.contract_address,
            "from": Account.from_key(KEY).address,
            "value": 0,
            "input": HexBytes(self.data),
        }
        self.receipt = self.transaction | {
            "transactionHash": self.tx_hash,
            "status": 1,
            "blockNumber": 9,
            "blockHash": HexBytes("0x" + "ab" * 32),
            "gasUsed": 85000,
        }
        self.client = chain_client()
        self.client.assert_expected_chain.return_value = CHAIN_ID
        self.client.get_transaction.return_value = self.transaction
        self.client.get_transaction_receipt.return_value = self.receipt
        self.client.send_raw_transaction.return_value = self.tx_hash
        self.client.load_contract.return_value.events.Transfer.return_value.process_receipt.return_value = [
            {
                "address": self.request.token.contract_address,
                "args": {"from": "0x" + "00" * 20, "to": self.request.recipient_address, "value": 10},
            }
        ]
        self.enterContext(patch("tokens.services.legacy_issuance.get_base_chain_client", return_value=self.client))
        self.enterContext(patch("tokens.services.share_token_service.seed_recipient_holding"))

    def signed_history(self):
        self.issuance.tx_hash = self.tx_hash
        self.issuance.mint_journal = [
            {
                "id": str(uuid4()),
                "tx_hash": self.tx_hash,
                "raw_transaction": Web3.to_hex(self.raw),
                "signed_at": timezone.now().isoformat(),
            }
        ]
        self.issuance.save(update_fields=["tx_hash", "mint_journal"])

    def assert_no_new_signing(self):
        self.client.send_transaction.assert_not_called()
        self.assertFalse(OutgoingOperation.objects.exists())
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertFalse(SigningAccount.objects.exists())

    def test_hashless_legacy_remains_held_without_reading_or_signing(self):
        self.assertIsNone(legacy_issuance.resolve_executing_issuance(self.request))
        self.assertEqual(legacy_issuance.unnamed_mint(self.request), self.issuance)
        self.client.assert_expected_chain.assert_not_called()
        self.assert_no_new_signing()

    def test_missing_historical_row_never_authorizes_a_fresh_mint(self):
        self.issuance.delete()
        self.assertIsNone(legacy_issuance.resolve_executing_issuance(self.request))
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "executing")
        self.assert_no_new_signing()

    def test_signed_receipt_completes_original_and_terminal_replay_touches_no_provider(self):
        self.signed_history()
        original = list(self.issuance.mint_journal)
        self.assertEqual(legacy_issuance.resolve_executing_issuance(self.request), "executed")
        self.client.reset_mock()
        self.assertEqual(legacy_issuance.resolve_executing_issuance(self.request), "executed")
        self.client.assert_expected_chain.assert_not_called()
        self.issuance.refresh_from_db()
        self.assertEqual(self.issuance.mint_journal, original)
        self.assert_no_new_signing()

    def test_missing_signed_receipt_replays_identical_bytes_even_when_node_forgot_transaction(self):
        self.signed_history()
        self.client.get_transaction.side_effect = AssertionError("Signed bytes identify the original mint")
        self.client.get_transaction_receipt.side_effect = [None, self.receipt]
        self.assertEqual(legacy_issuance.resolve_executing_issuance(self.request), "executed")
        self.client.send_raw_transaction.assert_called_once_with(self.raw)
        self.assert_no_new_signing()

    def test_original_revert_retains_history_without_another_mint(self):
        self.signed_history()
        self.receipt["status"] = 0
        self.assertEqual(legacy_issuance.resolve_executing_issuance(self.request), "reverted")
        self.issuance.refresh_from_db()
        self.assertIsNone(self.issuance.tx_hash)
        self.assertEqual(self.issuance.mint_journal[-1]["tx_hash"], self.tx_hash)
        self.assertTrue(self.issuance.mint_journal[-1]["reverted"])
        self.assertIsNone(legacy_issuance.resolve_executing_issuance(self.request))
        self.assert_no_new_signing()

    def test_hash_only_receipt_is_observed_without_raw_replay(self):
        self.issuance.tx_hash = self.tx_hash
        self.issuance.save(update_fields=["tx_hash"])
        self.client.get_transaction_receipt.return_value = None
        self.assertIsNone(legacy_issuance.resolve_executing_issuance(self.request))
        self.client.send_raw_transaction.assert_not_called()
        self.client.get_transaction_receipt.return_value = self.receipt
        self.assertEqual(legacy_issuance.resolve_executing_issuance(self.request), "executed")
        self.assert_no_new_signing()

    def test_unsigned_attempt_is_abandoned_once_and_never_replaced(self):
        attempt = str(uuid4())
        self.issuance.mint_journal = [{"id": attempt}]
        self.issuance.save(update_fields=["mint_journal"])
        self.assertEqual(legacy_issuance.resolve_executing_issuance(self.request), "released")
        self.assertIsNone(legacy_issuance.resolve_executing_issuance(self.request))
        self.issuance.refresh_from_db()
        self.assertEqual(self.issuance.mint_journal, [{"id": attempt, "abandoned": True}])
        self.assert_no_new_signing()

    def test_malformed_unsigned_and_duplicate_attempts_remain_held(self):
        attempt = str(uuid4())
        for journal in ([], [{"id": "bad"}], [{"id": attempt}, {"id": attempt}], [{"id": attempt, "other": True}]):
            self.issuance.mint_journal = journal
            self.issuance.save(update_fields=["mint_journal"])
            self.assertIsNone(legacy_issuance.resolve_executing_issuance(self.request))
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "executing")
        self.assert_no_new_signing()

    def test_corrupt_signed_bytes_never_broadcast_or_complete(self):
        self.signed_history()
        self.issuance.mint_journal[-1]["raw_transaction"] = "0xabcd"
        self.issuance.save(update_fields=["mint_journal"])
        with self.assertRaises(IssuanceExecutionConflict):
            legacy_issuance.resolve_executing_issuance(self.request)
        self.client.send_raw_transaction.assert_not_called()
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "executing")

    def test_naming_validates_exact_transaction_and_cannot_replace_association(self):
        legacy_issuance.name_the_mint(self.request, self.tx_hash)
        self.assertEqual(legacy_issuance.name_the_mint(self.request, self.tx_hash).pk, self.issuance.pk)
        with self.assertRaises(InvalidTokenStateException):
            legacy_issuance.name_the_mint(self.request, "0x" + "cd" * 32)
        self.issuance.refresh_from_db()
        self.assertEqual(self.issuance.tx_hash, self.tx_hash)
        self.assertEqual(legacy_issuance.resolve_executing_issuance(self.request), "executed")
        self.assert_no_new_signing()

    def test_unrelated_success_or_revert_cannot_be_named(self):
        for changes in ({"to": self.tenant.wallet.address}, {"input": "0x"}, {"value": 1}):
            self.client.get_transaction.return_value = self.transaction | changes
            with self.assertRaises(IssuanceExecutionConflict):
                legacy_issuance.name_the_mint(self.request, self.tx_hash)
            self.issuance.refresh_from_db()
            self.assertIsNone(self.issuance.tx_hash)
        self.assert_no_new_signing()

    def test_matching_transaction_without_mint_event_keeps_legacy_hold(self):
        self.signed_history()
        self.client.load_contract.return_value.events.Transfer.return_value.process_receipt.return_value = []
        with self.assertRaises(IssuanceExecutionUnresolved):
            legacy_issuance.resolve_executing_issuance(self.request)
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "executing")
        self.assert_no_new_signing()

    def test_idless_revert_before_signed_attempt_preserves_both_records(self):
        self.signed_history()
        journal = [{"tx_hash": "0x" + "bb" * 32, "reverted": True}, *self.issuance.mint_journal]
        self.issuance.mint_journal = journal
        self.issuance.save(update_fields=["mint_journal"])
        self.assertEqual(legacy_issuance.resolve_executing_issuance(self.request), "executed")
        self.issuance.refresh_from_db()
        self.assertEqual(self.issuance.mint_journal, journal)
        self.assert_no_new_signing()

    def test_changed_token_identity_during_receipt_cannot_project(self):
        self.signed_history()
        original = self.request.token.contract_address

        def changed_token(tx_hash):
            type(self.request.token).objects.filter(pk=self.request.token_id).update(
                contract_address=self.tenant.wallet.address
            )
            return self.receipt

        self.client.get_transaction_receipt.side_effect = changed_token
        with self.assertRaises(IssuanceExecutionConflict):
            legacy_issuance.resolve_executing_issuance(self.request)
        self.issuance.refresh_from_db()
        self.assertEqual(self.issuance.status, "processing")
        type(self.request.token).objects.filter(pk=self.request.token_id).update(contract_address=original)
        self.client.get_transaction_receipt.side_effect = None
        self.client.get_transaction_receipt.return_value = self.receipt
        self.assertEqual(legacy_issuance.resolve_executing_issuance(self.request), "executed")

    def test_changed_token_identity_during_naming_cannot_attach(self):
        def changed_token(tx_hash):
            type(self.request.token).objects.filter(pk=self.request.token_id).update(
                contract_address=self.tenant.wallet.address
            )
            return self.transaction

        self.client.get_transaction.side_effect = changed_token
        with self.assertRaises(IssuanceExecutionConflict):
            legacy_issuance.name_the_mint(self.request, self.tx_hash)
        self.issuance.refresh_from_db()
        self.assertIsNone(self.issuance.tx_hash)

    def test_delayed_revert_or_success_never_rewrites_a_completed_winner(self):
        self.signed_history()
        completed_times = []

        def completed_peer(tx_hash):
            self.client.get_transaction_receipt.side_effect = None
            self.client.get_transaction_receipt.return_value = self.receipt
            self.assertEqual(legacy_issuance.resolve_executing_issuance(self.request), "executed")
            self.issuance.refresh_from_db()
            self.request.refresh_from_db()
            completed_times.append((self.issuance.completed_at, self.request.executed_at))
            return self.receipt | {"status": 0}

        self.client.get_transaction_receipt.side_effect = completed_peer
        self.assertEqual(legacy_issuance.resolve_executing_issuance(self.request), "executed")
        self.assertEqual(legacy_issuance.resolve_executing_issuance(self.request), "executed")
        self.issuance.refresh_from_db()
        self.request.refresh_from_db()
        self.assertEqual(self.issuance.status, "completed")
        self.assertEqual((self.issuance.completed_at, self.request.executed_at), completed_times[0])
        self.assertNotIn("reverted", self.issuance.mint_journal[-1])

    def test_changed_journal_during_receipt_remains_unresolved(self):
        self.signed_history()

        def changed_journal(tx_hash):
            self.issuance.mint_journal[-1]["id"] = str(uuid4())
            self.issuance.save(update_fields=["mint_journal"])
            return self.receipt

        self.client.get_transaction_receipt.side_effect = changed_journal
        with self.assertRaises(IssuanceExecutionConflict):
            legacy_issuance.resolve_executing_issuance(self.request)
        self.issuance.refresh_from_db()
        self.assertEqual(self.issuance.status, "processing")

    def test_completed_hashless_record_cannot_be_abandoned(self):
        self.issuance.status = "completed"
        self.issuance.mint_journal = [{"id": str(uuid4())}]
        self.issuance.save(update_fields=["status", "mint_journal"])
        self.assertFalse(legacy_issuance.release_unsigned_mint(self.request))
        with self.assertRaises(IssuanceExecutionConflict):
            legacy_issuance.resolve_executing_issuance(self.request)
        self.issuance.refresh_from_db()
        self.assertEqual(self.issuance.status, "completed")

    def test_rejected_request_cannot_be_repaired_from_a_completed_mint(self):
        self.signed_history()
        self.issuance.mark_completed(tx_hash=self.tx_hash)
        ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(status="rejected")
        with self.assertRaises(IssuanceExecutionConflict):
            legacy_issuance.resolve_executing_issuance(self.request)
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "rejected")
        self.assertIsNone(self.request.executed_issuance_id)

    def test_another_issuances_retained_revert_cannot_be_named(self):
        ShareIssuance.objects.create(
            token=self.request.token,
            recipient_address=self.request.recipient_address,
            amount="10",
            status="failed",
            mint_journal=[{"tx_hash": self.tx_hash.upper(), "reverted": True}],
        )
        with self.assertRaises(IssuanceExecutionConflict):
            legacy_issuance.name_the_mint(self.request, self.tx_hash)
        self.issuance.refresh_from_db()
        self.assertIsNone(self.issuance.tx_hash)

    def test_failed_hashless_malformed_or_unresolved_history_blocks_refund(self):
        from decimal import Decimal

        from offerings.exceptions import SubscriptionRefusedException
        from offerings.services.subscription import record_refund
        from offerings.tests.factories import (
            eligible_subscriber,
            open_offering,
            paid_subscription,
        )

        open_offering(self.tenant)
        eligible_subscriber(self.tenant)
        subscription = paid_subscription(self.tenant, quantity=10)
        subscription.issuance_request = self.request
        subscription.save(update_fields=["issuance_request"])
        self.request.mark_failed("Synthetic historical failure")
        attempt = str(uuid4())
        for journal in (
            None,
            [],
            [{"id": "bad"}],
            [{"id": attempt}, {"id": attempt}],
            [{"tx_hash": self.tx_hash}, {"id": attempt}],
        ):
            self.issuance.mint_journal = journal
            self.issuance.save(update_fields=["mint_journal"])
            with self.assertRaises(SubscriptionRefusedException):
                record_refund(subscription, Decimal("1.00"))
            subscription.refresh_from_db()
            self.assertIsNone(subscription.refunded_at)
        self.issuance.mint_journal = [{"tx_hash": self.tx_hash, "reverted": True}, {"id": attempt}]
        self.issuance.save(update_fields=["mint_journal"])
        record_refund(subscription, Decimal("1.00"))
        subscription.refresh_from_db()
        self.request.refresh_from_db()
        self.assertIsNotNone(subscription.refunded_at)
        self.assertEqual(self.request.status, "rejected")

    def test_completed_allotment_replay_preserves_a_paid_residual_refund(self):
        from decimal import Decimal

        from offerings.models import Subscription
        from offerings.services.subscription import record_refund
        from offerings.tests.factories import (
            eligible_subscriber,
            open_offering,
            paid_subscription,
        )

        open_offering(self.tenant)
        eligible_subscriber(self.tenant)
        subscription = paid_subscription(self.tenant, quantity=10)
        Subscription.objects.filter(pk=subscription.pk).update(
            issuance_request=self.request, amount_received=Decimal("30.00"), refund_amount=Decimal("5.00")
        )
        self.signed_history()
        self.assertEqual(legacy_issuance.resolve_executing_issuance(self.request), "executed")
        record_refund(subscription, Decimal("5.00"))
        before_request = ShareIssuanceRequest.objects.values().get(pk=self.request.pk)
        before_issuance = ShareIssuance.objects.values().get(pk=self.issuance.pk)
        before_subscription = Subscription.objects.values().get(pk=subscription.pk)
        self.client.reset_mock()
        self.assertEqual(legacy_issuance.resolve_executing_issuance(self.request), "executed")
        self.client.assert_expected_chain.assert_not_called()
        self.assertEqual(ShareIssuanceRequest.objects.values().get(pk=self.request.pk), before_request)
        self.assertEqual(ShareIssuance.objects.values().get(pk=self.issuance.pk), before_issuance)
        self.assertEqual(Subscription.objects.values().get(pk=subscription.pk), before_subscription)

    def test_bounded_sweep_rotates_a_held_legacy_row_without_restarting_its_grace(self):
        from tokens.tasks import check_executing_issuance_requests

        later = ShareIssuanceRequest.objects.create(
            token=self.request.token,
            recipient_address=self.request.recipient_address,
            amount=10,
            dispatch_id=None,
            status="executing",
        )
        ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(updated_at=timezone.now() - timedelta(hours=2))
        ShareIssuanceRequest.objects.filter(pk=later.pk).update(updated_at=timezone.now() - timedelta(hours=1))
        with patch("tokens.tasks.review_request.ISSUANCE_RECOVERY_BATCH", 1), patch.object(
            legacy_issuance, "resolve_executing_issuance", return_value=None
        ) as recover:
            self.assertEqual(check_executing_issuance_requests(), {"checked": 1, "resolved": 0})
            self.assertEqual(check_executing_issuance_requests(), {"checked": 1, "resolved": 0})
        self.assertEqual([call.args[0].pk for call in recover.call_args_list], [self.request.pk, later.pk])
        self.request.refresh_from_db()
        self.assertEqual(self.request.status, "executing")
        self.assertEqual(legacy_issuance.unnamed_mint(self.request), self.issuance)

    def test_recent_processing_start_keeps_the_naming_grace_despite_an_old_request(self):
        ShareIssuance.objects.filter(pk=self.issuance.pk).update(processed_at=timezone.now())
        self.assertIsNone(legacy_issuance.unnamed_mint(self.request))
        with self.assertRaises(InvalidTokenStateException):
            legacy_issuance.name_the_mint(self.request, self.tx_hash)
        self.client.get_transaction.assert_not_called()

    def test_new_processing_start_during_lookup_cannot_inherit_old_naming_grace(self):
        def restarted_processing(tx_hash):
            ShareIssuance.objects.filter(pk=self.issuance.pk).update(processed_at=timezone.now())
            return self.transaction

        self.client.get_transaction.side_effect = restarted_processing
        with self.assertRaises(IssuanceExecutionConflict):
            legacy_issuance.name_the_mint(self.request, self.tx_hash)
        self.issuance.refresh_from_db()
        self.assertIsNone(self.issuance.tx_hash)

    def test_legacy_completion_and_duplicate_allotment_share_token_first_lock_order(self):
        import threading

        from django.db import connections

        from offerings.exceptions import SubscriptionRefusedException
        from offerings.services import subscription as subscriptions
        from offerings.tests.factories import (
            eligible_subscriber,
            open_offering,
            paid_subscription,
        )

        open_offering(self.tenant)
        eligible_subscriber(self.tenant)
        subscription = paid_subscription(self.tenant, quantity=10)
        subscription.issuance_request = self.request
        subscription.save(update_fields=["issuance_request"])
        actor = make_tenant("historical-racing-staff", staff=True).user
        actor.is_superuser = True
        actor.save(update_fields=["is_superuser"])
        self.signed_history()
        allot_holds_token = threading.Event()
        legacy_wants_token = threading.Event()
        outcomes = {}
        original_lock = subscriptions._locked

        def allotment_lock(row):
            allot_holds_token.set()
            if not legacy_wants_token.wait(10):
                raise AssertionError("Legacy recovery never attempted its token lock")
            return original_lock(row)

        def record_legacy_lock(execute, sql, params, many, context):
            if '"tokens_sharetoken"' in sql and "FOR UPDATE" in sql:
                legacy_wants_token.set()
            return execute(sql, params, many, context)

        def alloter():
            try:
                subscriptions.allot(subscription, actor, headroom=(1000, 1000))
            except SubscriptionRefusedException:
                outcomes["allot"] = "already admitted"
            except BaseException as exc:
                outcomes["allot"] = exc
            finally:
                connections.close_all()

        def recovery():
            try:
                if not allot_holds_token.wait(10):
                    raise AssertionError("Allotment never obtained its token lock")
                with connections["default"].execute_wrapper(record_legacy_lock):
                    outcomes["recovery"] = legacy_issuance.resolve_executing_issuance(self.request)
            except BaseException as exc:
                outcomes["recovery"] = exc
            finally:
                connections.close_all()

        with patch.object(subscriptions, "_locked", side_effect=allotment_lock):
            threads = [threading.Thread(target=worker, daemon=True) for worker in (alloter, recovery)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(20)
        self.assertFalse(any(thread.is_alive() for thread in threads), outcomes)
        self.assertEqual(outcomes, {"allot": "already admitted", "recovery": "executed"})
        self.issuance.refresh_from_db()
        self.assertEqual(self.issuance.status, "completed")

    def test_legacy_holding_seed_retains_contract_observed_before_projection(self):
        original_resolve = legacy_issuance._resolve
        contract = self.request.token.contract_address
        self.signed_history()

        def project_then_change(request):
            result = original_resolve(request)
            type(request.token).objects.filter(pk=request.token_id).update(contract_address=self.tenant.wallet.address)
            return result

        with patch.object(legacy_issuance, "_resolve", side_effect=project_then_change), patch(
            "tokens.services.share_token_service.seed_recipient_holding"
        ) as seed:
            self.assertEqual(legacy_issuance.resolve_executing_issuance(self.request), "executed")
        seed.assert_called_once_with(contract, self.request.recipient_address)
