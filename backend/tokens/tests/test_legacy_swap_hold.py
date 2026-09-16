from datetime import timedelta
from unittest.mock import patch

from django.db import DatabaseError, IntegrityError, connections
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from eth_account.messages import encode_typed_data
from rest_framework.test import APITransactionTestCase

from blockchain.models import BlockchainTransaction, TransactionStatus
from blockchain.services.transaction import check_pending_transactions
from blockchain.tests.outgoing_fixtures import CHAIN_ID, KEY, admitted_signer
from feature_flags.models import FeatureFlag
from shared.db import atomic, current_alias, use_operator
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_tenant
from tokens.exceptions import LegacySwapHeld, SwapNotReadyException
from tokens.models import SwapOrder, SwapOrderStatus, TransferOrder
from tokens.services import atomic_swap_service, swap_execution
from tokens.services.settlement_context import settlement_execution_arguments
from tokens.services.swap_expiry import expire_unclaimed_swap, expire_unclaimed_swaps
from tokens.tasks.swap_reconciler import resolve_executing_swaps
from tokens.tests.swap_execution_fixtures import ExecutionNode, make_execution
from tokens.tests.swap_state_fixtures import (
    BUYER,
    CONTRACT,
    SELLER,
    make_swap,
    persisted_outcome,
    swap_service,
)
from tokens.tests.test_swap_expiry import ExpiryFixtures
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet

BEFORE_CONTEXT = [("tokens", "0038_order_action_submissions")]


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT)
class LegacySwapHoldTest(APITransactionTestCase):
    def setUp(self):
        self.addCleanup(restore_every_migration)
        self.enterContext(patch("tokens.services.swap_execution.publish_trading_event"))
        with use_operator():
            FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
            self.swap = make_swap("legacy-hold")
            self.user = self.swap.sell_order.owner_account.user_profile.user
            Wallet.objects.filter(pk__in=[self.swap.seller_wallet_id, self.swap.buyer_wallet_id]).update(
                verification_status=WALLET_VERIFICATION_STATUS_VERIFIED
            )
            typed = atomic_swap_service.get_typed_data(self.swap)
            self.owner_account_id = self.swap.sell_order.owner_account_id
            self.original_digest = self.swap.settlement_digest
            self.signature = "0x" + SELLER.sign_message(encode_typed_data(full_message=typed)).signature.hex()
        migrate_to(BEFORE_CONTEXT)
        restore_every_migration()
        with use_operator():
            self.swap.refresh_from_db()
            self.before = persisted_outcome(self.swap)
        self.assertEqual(self.swap.settlement_protocol_version, 0)
        self.client.force_authenticate(self.user)
        self.service = swap_service(self)
        self.provider = self.service.get_base_chain_client()
        self.provider.call_contract_function.return_value = 10**30
        self.url = f"/api/v1/trading/orders/{self.swap.sell_order_id}/swap"
        self.identity = {
            "swap_uuid": str(self.swap.pk),
            "owner_account_uuid": str(self.owner_account_id),
            "wallet_uuid": str(self.swap.seller_wallet_id),
            "settlement_digest": self.original_digest,
        }

    def test_old_client_signing_and_approval_requests_refuse_before_provider_access(self):
        with patch("tokens.services.atomic_swap_service.get_base_chain_client", return_value=self.provider) as provider:
            for suffix in ("/", "/approval-status/", "/approval-data/"):
                with self.subTest(action=suffix):
                    response = self.client.get(self.url + suffix, {"wallet_address": SELLER.address})
                    self.assertEqual(response.status_code, 400, response.content)
                    self.assertTrue({"swapUuid", "ownerAccountUuid", "walletUuid"} <= response.json().keys())
            response = self.client.post(
                self.url + "/sign/", {"signature": self.signature, "signer_address": SELLER.address}, format="json"
            )
            self.assertEqual(response.status_code, 400, response.content)
            self.assertTrue(
                {"swapUuid", "ownerAccountUuid", "walletUuid", "settlementDigest"} <= response.json().keys()
            )
        provider.assert_not_called()
        with use_operator():
            self.assertEqual(persisted_outcome(self.swap), self.before)

    def test_exact_identity_cannot_enable_legacy_actions_or_approval_broadcast(self):
        with patch("tokens.services.atomic_swap_service.get_base_chain_client") as provider:
            for suffix in ("/", "/approval-status/", "/approval-data/"):
                with self.subTest(action=suffix):
                    response = self.client.get(self.url + suffix, self.identity)
                    self.assertEqual(response.status_code, 409, response.content)
                    self.assertEqual(response.json()["code"], "legacy_swap_held")
            for suffix, payload in (
                ("/sign/", {"signature": self.signature, "signer_address": SELLER.address}),
                ("/approval-broadcast/", {"signed_transaction": "0x01"}),
            ):
                with self.subTest(action=suffix):
                    response = self.client.post(self.url + suffix, {**self.identity, **payload}, format="json")
                    self.assertEqual(response.status_code, 409, response.content)
                    self.assertEqual(response.json()["code"], "legacy_swap_held")
        provider.assert_not_called()
        with use_operator():
            self.assertEqual(persisted_outcome(self.swap), self.before)

    def test_another_account_cannot_resolve_the_held_swap(self):
        with use_operator():
            stranger = make_tenant("legacy-stranger", with_swap=False)
        self.client.force_authenticate(stranger.user)
        with patch("tokens.services.atomic_swap_service.get_base_chain_client") as provider:
            response = self.client.get(self.url + "/", self.identity)
        self.assertEqual(response.status_code, 404, response.content)
        provider.assert_not_called()
        with use_operator():
            self.assertEqual(persisted_outcome(self.swap), self.before)

    def test_a_current_swap_still_returns_its_original_context_and_accepts_a_signature(self):
        with use_operator():
            current = make_swap("legacy-hold-current")
            user = current.sell_order.owner_account.user_profile.user
            Wallet.objects.filter(pk=current.seller_wallet_id).update(
                verification_status=WALLET_VERIFICATION_STATUS_VERIFIED
            )
            typed = atomic_swap_service.get_typed_data(current)
            signature = "0x" + SELLER.sign_message(encode_typed_data(full_message=typed)).signature.hex()
        identity = {
            "swap_uuid": str(current.pk),
            "owner_account_uuid": str(current.sell_order.owner_account_id),
            "wallet_uuid": str(current.seller_wallet_id),
            "settlement_digest": current.settlement_digest,
        }
        url = f"/api/v1/trading/orders/{current.sell_order_id}/swap/"
        self.client.force_authenticate(user)
        with patch("tokens.services.atomic_swap_service.get_base_chain_client") as provider:
            read = self.client.get(url, identity)
            self.assertEqual(read.status_code, 200, read.content)
            self.assertEqual(read.json()["settlementDigest"], current.settlement_digest)
            signed = self.client.post(
                url + "sign/", {**identity, "signature": signature, "signer_address": SELLER.address}, format="json"
            )
        self.assertEqual(signed.status_code, 200, signed.content)
        provider.assert_not_called()
        with use_operator():
            current.refresh_from_db()
            self.assertEqual(current.seller_signature, signature)
            self.assertEqual(current.status, "seller_signed")
            self.assertEqual(persisted_outcome(self.swap), self.before)

    def test_operator_cannot_mutate_or_delete_retained_history(self):
        with use_operator():
            for field, value in (
                ("seller_signature", self.signature),
                ("status", "executing"),
                ("tx_hash", "0x" + "a1" * 32),
                ("payment_amount", self.swap.payment_amount + 1),
                ("expires_at", self.swap.expires_at + timedelta(days=1)),
                ("updated_at", timezone.now()),
                ("expiry_release_eligible", True),
            ):
                with self.subTest(field=field), self.assertRaises(IntegrityError), atomic():
                    SwapOrder.objects.filter(pk=self.swap.pk).update(**{field: value})
                self.assertEqual(persisted_outcome(self.swap), self.before)
            with self.assertRaises(IntegrityError), atomic():
                self.swap.delete()
            with self.assertRaises(IntegrityError), atomic():
                self.swap.sell_order.delete()
            self.assertEqual(persisted_outcome(self.swap), self.before)

    def test_reversal_cannot_remove_a_hold_on_existing_history(self):
        with self.assertRaises(DatabaseError):
            migrate_to([("tokens", "0055_order_submission_settlement_refusal")])
        restore_every_migration()
        with use_operator():
            self.assertEqual(persisted_outcome(self.swap), self.before)
            with self.assertRaises(IntegrityError), atomic():
                SwapOrder.objects.filter(pk=self.swap.pk).update(seller_signature=self.signature)


class ScopedLegacySwapHoldTest(RunsOnTheScopedConnection, LegacySwapHoldTest):
    pass


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT, BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class LegacySwapRecoveryHoldTest(TransactionTestCase):
    def setUp(self):
        self.addCleanup(restore_every_migration)
        self.enterContext(patch("tokens.services.swap_execution.publish_trading_event"))
        self.swaps = []
        self.transactions = {}
        self.service = swap_service(self)
        self.counter = 0
        for status in SwapOrderStatus.values:
            self.swaps.append(ExpiryFixtures.matched_swap(self, signed="both"))
        hashless = ExpiryFixtures.matched_swap(self, signed="both")
        self.swaps.append(hashless)
        arguments = {swap.pk: settlement_execution_arguments(swap) for swap in self.swaps}
        old_apps = migrate_to(BEFORE_CONTEXT)
        old_swaps = old_apps.get_model("tokens", "SwapOrder").objects
        for index, (swap, status) in enumerate(
            zip(self.swaps, [*SwapOrderStatus.values, SwapOrderStatus.EXECUTING], strict=True)
        ):
            fields = {}
            if status in (SwapOrderStatus.EXECUTING, SwapOrderStatus.COMPLETED, SwapOrderStatus.FAILED):
                tx_hash = None if swap.pk == hashless.pk else "0x" + f"{index + 200:064x}"
                journal = old_apps.get_model("blockchain", "BlockchainTransaction").objects.create(
                    tx_type="atomic_swap",
                    status="submitted" if tx_hash else "pending",
                    tx_hash=tx_hash,
                    from_address=SELLER.address,
                    to_address=CONTRACT,
                    function_name="executeSwap",
                    function_args=arguments[swap.pk],
                    related_model="tokens.SwapOrder",
                    related_uuid=swap.pk,
                )
                self.transactions[swap.pk] = journal.pk
                fields = {"transaction_id": journal.pk, "tx_hash": tx_hash or ""}
            old_swaps.filter(pk=swap.pk).update(
                **fields,
                status=status,
                seller_signature=swap.seller_signature if status != SwapOrderStatus.CREATED else "",
                buyer_signature=(
                    swap.buyer_signature
                    if status not in (SwapOrderStatus.CREATED, SwapOrderStatus.SELLER_SIGNED)
                    else ""
                ),
                updated_at=timezone.now() - timedelta(hours=1),
            )
            if status == SwapOrderStatus.BUYER_SIGNED:
                old_swaps.filter(pk=swap.pk).update(seller_signature="")
            TransferOrder.objects.filter(pk=swap.sell_order_id).update(matched_order_id=swap.buy_order_id)
            TransferOrder.objects.filter(pk=swap.buy_order_id).update(matched_order_id=swap.sell_order_id)
        self.before_rows = list(old_swaps.order_by("pk").values())
        restore_every_migration()
        self.transactions = {
            swap_id: BlockchainTransaction.objects.get(pk=journal_id)
            for swap_id, journal_id in self.transactions.items()
        }
        self.before = {}
        for swap in self.swaps:
            swap.refresh_from_db()
            self.assertEqual(swap.settlement_protocol_version, 0)
            self.before[swap.pk] = persisted_outcome(swap)
        self.service = swap_service(self)

    def assert_history_unchanged(self):
        for swap in self.swaps:
            self.assertEqual(persisted_outcome(swap), self.before[swap.pk])

    def test_migration_preserves_every_original_field_and_raw_sql_cannot_rewrite_it(self):
        for before in self.before_rows:
            after = SwapOrder.objects.filter(pk=before["uuid"]).values().get()
            for key, value in before.items():
                self.assertEqual(after[key], value, key)
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT prosecdef FROM pg_proc WHERE proname = 'hold_legacy_swap'")
            self.assertEqual(cursor.fetchall(), [(False,)])
        for swap in self.swaps:
            with self.assertRaises(IntegrityError), atomic(), connections[current_alias()].cursor() as cursor:
                cursor.execute("UPDATE tokens_swaporder SET status = status WHERE uuid = %s", [swap.pk])
            with self.assertRaises(IntegrityError), atomic(), connections[current_alias()].cursor() as cursor:
                cursor.execute("DELETE FROM tokens_swaporder WHERE uuid = %s", [swap.pk])
        self.assert_history_unchanged()

    def test_current_actions_and_recovery_refuse_every_legacy_state_before_provider_access(self):
        with patch("tokens.services.atomic_swap_service.get_base_chain_client") as approval_provider, patch(
            "tokens.services.swap_execution.get_base_chain_client"
        ) as recovery_provider, patch("tokens.services.atomic_swap_service.configured_relayer_key") as key, patch(
            "tokens.services.swap_execution.publish_trading_event"
        ) as event:
            for swap in self.swaps:
                for action, args in (
                    (self.service.payment_address, (swap,)),
                    (self.service.get_typed_data, (swap,)),
                    (self.service.check_swap_allowances, (swap,)),
                    (self.service.get_approval_transaction_data, (swap, "seller")),
                ):
                    with self.subTest(status=swap.status, action=action.__name__), self.assertRaises(LegacySwapHeld):
                        action(*args)
                with self.subTest(status=swap.status, action="signature"), self.assertRaises(LegacySwapHeld):
                    swap_execution.submit_signature(
                        swap,
                        swap.seller_signature,
                        SELLER.address,
                        user=swap.sell_order.owner_account.user_profile.user,
                        participant="seller",
                    )
                transaction = self.transactions.get(swap.pk)
                if transaction is not None:
                    with self.assertRaises(SwapNotReadyException):
                        swap_execution.recover(transaction.pk)
            approval_provider.assert_not_called()
            recovery_provider.assert_not_called()
            key.assert_not_called()
            event.assert_not_called()
        self.assert_history_unchanged()

    def test_sweeps_hold_legacy_history_and_current_receipt_keeps_financial_reservations(self):
        cutoff = max(swap.expires_at for swap in self.swaps) + timedelta(days=1)
        with patch("tokens.services.swap_execution.get_base_chain_client") as provider, patch(
            "tokens.services.swap_expiry.publish_trading_event"
        ) as expiry_event:
            for swap in self.swaps:
                self.assertFalse(expire_unclaimed_swap(swap, cutoff))
            self.assertEqual(resolve_executing_swaps.func(), {"checked": 0, "resolved": 0})
            self.assertEqual(expire_unclaimed_swaps(cutoff), {"checked": 0, "expired": 0, "retained": 0})
            provider.assert_not_called()
            expiry_event.assert_not_called()
        self.assert_history_unchanged()
        fixture = make_execution("legacy-current-recovery")
        current = fixture.swap
        for party, signer in (("seller", SELLER), ("buyer", BUYER)):
            current = swap_execution.submit_signature(
                current,
                fixture.signatures[party],
                signer.address,
                user=getattr(fixture, party).user,
                participant=party,
            )
        transaction = current.transaction
        BlockchainTransaction.objects.filter(pk=transaction.pk).update(updated_at=timezone.now() - timedelta(hours=1))
        admitted_signer()
        node = ExecutionNode(transaction.function_args)
        parent_rows = list(
            TransferOrder.objects.filter(pk__in=[current.sell_order_id, current.buy_order_id])
            .order_by("pk")
            .values("status", "filled_quantity")
        )
        self.assertEqual(check_pending_transactions(node.client), {"checked": 0, "confirmed": 0, "failed": 0})
        node.client.get_transaction_receipt.assert_not_called()
        with patch("tokens.services.swap_execution.get_base_chain_client", return_value=node.client), patch(
            "tokens.services.swap_execution.publish_trading_event"
        ) as event:
            self.assertEqual(resolve_executing_swaps.func(), {"checked": 1, "resolved": 1})
        current.refresh_from_db()
        transaction.refresh_from_db()
        self.assertEqual(current.status, SwapOrderStatus.EXECUTING)
        self.assertEqual(transaction.status, TransactionStatus.CONFIRMED)
        self.assertEqual(current.tx_hash, transaction.outgoing_operation.current_attempt.tx_hash)
        self.assertEqual(
            list(
                TransferOrder.objects.filter(pk__in=[current.sell_order_id, current.buy_order_id])
                .order_by("pk")
                .values("status", "filled_quantity")
            ),
            parent_rows,
        )
        event.assert_not_called()
        self.assert_history_unchanged()


class EmptyLegacyHoldMigrationTest(TransactionTestCase):
    def test_reverse_and_reapply_are_available_without_legacy_history(self):
        self.addCleanup(restore_every_migration)
        self.enterContext(patch("tokens.services.swap_execution.publish_trading_event"))
        migrate_to([("tokens", "0055_order_submission_settlement_refusal")])
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT count(*) FROM pg_trigger WHERE tgname = 'hold_legacy_swap'")
            self.assertEqual(cursor.fetchone(), (0,))
        restore_every_migration()
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT count(*) FROM pg_trigger WHERE tgname = 'hold_legacy_swap'")
            self.assertEqual(cursor.fetchone(), (1,))
