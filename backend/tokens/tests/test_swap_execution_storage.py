import json
from contextlib import contextmanager
from copy import deepcopy
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from eth_account import Account
from eth_account.messages import encode_typed_data
from web3 import Web3

from blockchain.models import BlockchainTransaction, OutgoingOperation, SignedAttempt
from blockchain.services import outgoing
from blockchain.tests.outgoing_fixtures import (
    CHAIN_ID,
    KEY,
    SENDER,
    admitted_signer,
    chain_client,
    receipt,
)
from shared.db import (
    atomic,
    current_alias,
    reset_principal,
    set_principal,
    use_app,
    use_operator,
)
from shared.db.principal import give_the_role_back, take_the_app_role
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.scoped import RunsOnTheScopedConnection, aliases_this_deployment_has
from shared.tests.settlement import save_swap_with_context
from shared.tests.tenants import make_tenant
from tokens.models import SwapOrder, TransferOrder
from tokens.services import atomic_swap_service
from tokens.services.settlement_context import settlement_execution_arguments
from wallets.models import Wallet


class SwapExecutionStorageFixtures:
    databases = aliases_this_deployment_has()

    def setUp(self):
        super().setUp()
        self.enterContext(use_operator())
        self.enterContext(override_settings(ATOMIC_SWAP_ADDRESS="0x" + "9d" * 20))
        self.seller = make_tenant("execution-seller", with_swap=False)
        self.buyer = make_tenant("execution-buyer", with_swap=False)
        self.seller_key = Account.from_key("0x" + "41" * 32)
        self.buyer_key = Account.from_key("0x" + "42" * 32)
        for tenant, key in ((self.seller, self.seller_key), (self.buyer, self.buyer_key)):
            tenant.wallet = Wallet.objects.create(
                user_account=tenant.account, address=key.address, chain="base", verification_status="VERIFIED"
            )
        self.swap = self.make_swap()
        self.sign_swap(self.swap)

    def make_swap(self):
        sell = TransferOrder.objects.create(
            token=self.seller.deployed_token,
            payment_asset=self.seller.refs.stablecoin,
            wallet=self.seller.wallet,
            owner_account=self.seller.account,
            wallet_address=self.seller.wallet.address,
            order_type="sell",
            quantity=20,
            filled_quantity=10,
            price_per_share="1.50",
            status="pending_signature",
        )
        buy = TransferOrder.objects.create(
            token=self.seller.deployed_token,
            payment_asset=self.seller.refs.stablecoin,
            wallet=self.buyer.wallet,
            owner_account=self.buyer.account,
            wallet_address=self.buyer.wallet.address,
            order_type="buy",
            quantity=20,
            filled_quantity=10,
            price_per_share="1.50",
            status="pending_signature",
        )
        return atomic_swap_service.create_swap_order(sell, buy, share_amount=10)

    def sign_swap(self, swap):
        message = encode_typed_data(full_message=swap.settlement_context["typed_data"])
        swap.seller_signature = self.seller_key.sign_message(message).signature.hex()
        swap.buyer_signature = self.buyer_key.sign_message(message).signature.hex()
        swap.status = "ready"
        swap.save(update_fields=["seller_signature", "buyer_signature", "status"])

    def fields(self, swap=None, **changes):
        swap = swap or self.swap
        arguments = settlement_execution_arguments(swap)
        arguments["admission"] = {"version": 1, "actor_id": str(self.seller.user.pk), "participant": "seller"}
        return {
            "tx_type": "atomic_swap",
            "from_address": SENDER,
            "to_address": arguments["settlement"]["domain"]["verifyingContract"],
            "function_name": "executeSwap",
            "function_args": arguments,
            "related_model": "tokens.SwapOrder",
            "related_uuid": swap.pk,
        } | changes

    def admit(self, **changes):
        with atomic():
            journal = BlockchainTransaction.objects.create(**self.fields(**changes))
            self.swap.mark_executing(transaction=journal)
        return journal

    def abi_intent(self, journal):
        artifact = json.loads((settings.BASE_DIR / "contracts" / "AtomicSwap.json").read_text())
        contract = Web3().eth.contract(abi=artifact["abi"])
        args = journal.function_args
        data = contract.encode_abi(
            "executeSwap",
            args=[
                *(Web3.to_checksum_address(args[field]) for field in ("seller", "buyer", "shareToken", "paymentToken")),
                *(int(args[field]) for field in ("shareAmount", "paymentAmount", "nonce", "deadline")),
                *(bytes.fromhex(args[field].removeprefix("0x")) for field in ("sellerSignature", "buyerSignature")),
            ],
        )
        return outgoing.transaction_intent(
            chain_id=int(args["settlement"]["domain"]["chainId"]),
            sender=journal.from_address,
            to=journal.to_address,
            value=0,
            data=data,
        )

    def open(self, journal):
        claim = outgoing.open_operation(f"swap-execution:{journal.pk}", **(self.abi_intent(journal) | {"value": 0}))
        journal.outgoing_operation_id = claim.operation_id
        journal.save(update_fields=["outgoing_operation", "updated_at"])
        return claim

    def sign(self, journal, claim):
        admitted_signer()

        def retain(attempt):
            journal.mark_submitted(attempt.tx_hash)
            self.swap.mark_executing(attempt.tx_hash, journal)

        return outgoing.sign_operation(claim, outgoing.prepare_operation(claim, chain_client()), KEY, on_signed=retain)

    @contextmanager
    def app(self):
        with use_app():
            set_principal(self.seller.user.pk)
            take_the_app_role()
            try:
                yield
            finally:
                give_the_role_back()
                reset_principal()


@override_settings(BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class SwapExecutionStorageTest(SwapExecutionStorageFixtures, TransactionTestCase):
    def test_real_creation_and_admission_preserve_original_expiry_eligibility(self):
        self.assertTrue(self.swap.expiry_release_eligible)
        journal = self.admit()
        claim = self.open(journal)
        attempt = self.sign(journal, claim)
        outgoing.record_receipt(claim, attempt.tx_hash, receipt(attempt))
        journal.mark_confirmed(12, receipt(attempt)["blockHash"], 21000)
        retained = SwapOrder.objects.get(pk=self.swap.pk)
        self.assertTrue(retained.expiry_release_eligible)
        self.assertEqual(retained.status, "executing")
        with self.assertRaisesMessage(DatabaseError, "fixed at creation"), atomic():
            SwapOrder.objects.filter(pk=self.swap.pk).update(expiry_release_eligible=False)

    def test_exact_abi_bytes_agree_for_optional_prefix_case_and_integer_boundaries(self):
        for seller_prefix, buyer_prefix in (("", "0x"), ("0x", "")):
            with self.subTest(seller=seller_prefix, buyer=buyer_prefix):
                swap = self.make_swap()
                self.sign_swap(swap)
                swap.seller_signature = seller_prefix + swap.seller_signature.upper()
                swap.buyer_signature = buyer_prefix + swap.buyer_signature.upper()
                swap.save(update_fields=["seller_signature", "buyer_signature"])
                journal = BlockchainTransaction.objects.create(**self.fields(swap))
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute(
                        "SELECT tokens_swap_execution_intent(journal) FROM blockchain_blockchaintransaction journal "
                        "WHERE uuid = %s",
                        [journal.pk],
                    )
                    actual = cursor.fetchone()[0]
                if isinstance(actual, str):
                    actual = json.loads(actual)
                self.assertEqual(actual, self.abi_intent(journal))
                self.assertEqual(len(bytes.fromhex(actual["data"][2:])), 580)
        for value in (0, 1, 2**63 - 1):
            journal.function_args = deepcopy(journal.function_args)
            journal.function_args.update(
                dict.fromkeys(("shareAmount", "paymentAmount", "nonce", "deadline"), str(value))
            )
            with connections[current_alias()].cursor() as cursor:
                cursor.execute(
                    "SELECT tokens_swap_execution_intent(jsonb_populate_record("
                    "NULL::blockchain_blockchaintransaction, %s::jsonb))",
                    [
                        json.dumps(
                            {
                                "function_args": journal.function_args,
                                "from_address": SENDER,
                                "to_address": journal.to_address,
                            }
                        )
                    ],
                )
                actual = cursor.fetchone()[0]
            if isinstance(actual, str):
                actual = json.loads(actual)
            self.assertEqual(actual, self.abi_intent(journal))

    def test_every_calldata_word_and_dynamic_region_is_checked_against_the_abi(self):
        journal = self.admit()
        intent = self.abi_intent(journal)
        offsets = [0, *(4 + 32 * word for word in range(10)), 324, 356, 421, 452, 484, 549, 579]
        for offset in offsets:
            changed = bytearray.fromhex(intent["data"][2:])
            changed[offset] ^= 1
            invalid = intent | {"data": "0x" + changed.hex()}
            with self.subTest(offset=offset), self.assertRaisesMessage(DatabaseError, "full intent"), atomic():
                OutgoingOperation.objects.create(
                    operation_key=f"swap-execution:{journal.pk}", intent=invalid, claim_id=uuid4()
                )
        claim = self.open(journal)
        self.assertEqual(OutgoingOperation.objects.get(pk=claim.operation_id).intent, intent)

    def test_operation_chain_uses_the_canonical_integer_representation(self):
        journal = self.admit()
        intent = self.abi_intent(journal)
        with self.assertRaisesMessage(DatabaseError, "full intent"), atomic():
            OutgoingOperation.objects.create(
                operation_key=f"swap-execution:{journal.pk}",
                intent=intent | {"chain_id": float(intent["chain_id"])},
                claim_id=uuid4(),
            )
        claim = self.open(journal)
        self.assertEqual(OutgoingOperation.objects.get(pk=claim.operation_id).intent, intent)
        with self.assertRaisesMessage(DatabaseError, "full intent"), atomic():
            OutgoingOperation.objects.filter(pk=claim.operation_id).update(
                intent=intent | {"chain_id": float(intent["chain_id"])}
            )

    def test_every_noncalldata_intent_term_is_original_and_canonical(self):
        journal = self.admit()
        intent = self.abi_intent(journal)
        for changes in (
            {"chain_id": intent["chain_id"] + 1},
            {"sender": "0x" + "e" * 40},
            {"to": "0x" + "f" * 40},
            {"value": "1"},
            {"value": 0},
            {"extra": "field"},
        ):
            with self.subTest(changes=changes), self.assertRaisesMessage(DatabaseError, "full intent"), atomic():
                OutgoingOperation.objects.create(
                    operation_key=f"swap-execution:{journal.pk}", intent=intent | changes, claim_id=uuid4()
                )
        self.assertIsNotNone(self.open(journal).operation_id)

    def test_admission_rejects_missing_malformed_and_foreign_authority(self):
        valid = self.fields()
        for admission in (
            None,
            {},
            {"version": 2, "actor_id": str(self.seller.user.pk), "participant": "seller"},
            {"version": 1.0, "actor_id": str(self.seller.user.pk), "participant": "seller"},
            {"version": 1, "actor_id": self.seller.user.pk, "participant": "seller"},
            {"version": 1, "actor_id": "0" + str(self.seller.user.pk), "participant": "seller"},
            {"version": 1, "actor_id": str(self.buyer.user.pk), "participant": "seller"},
            {"version": 1, "actor_id": str(self.seller.user.pk), "participant": "buyer"},
            valid["function_args"]["admission"] | {"data": "0x"},
        ):
            arguments = valid["function_args"] | {"admission": admission}
            with self.subTest(admission=admission), self.assertRaises(DatabaseError), atomic():
                BlockchainTransaction.objects.create(**(valid | {"function_args": arguments}))
        with self.assertRaises(DatabaseError), atomic():
            BlockchainTransaction.objects.create(
                **(valid | {"function_args": settlement_execution_arguments(self.swap)})
            )
        self.assertIsNotNone(self.admit().pk)

    def test_argument_shape_signature_domain_and_relation_substitutions_refuse(self):
        valid = self.fields()
        for key, value in {
            "sellerSignature": "ab" * 65,
            "buyerSignature": "cd" * 65,
            "paymentAmount": "1501",
            "shareAmount": "11",
            "nonce": "0",
            "extra": 1,
            "settlement": valid["function_args"]["settlement"] | {"digest": "0x" + "11" * 32},
        }.items():
            with self.subTest(field=key), self.assertRaises(DatabaseError), atomic():
                BlockchainTransaction.objects.create(
                    **(valid | {"function_args": valid["function_args"] | {key: value}})
                )
        for changes in (
            {"to_address": "0x" + "a" * 40},
            {"related_uuid": uuid4()},
            {"function_name": "other"},
            {"related_model": "other"},
            {"tx_type": "other"},
            {"value": 1},
            {"tx_hash": "0x" + "a" * 64},
            {"status": "submitted"},
        ):
            with self.subTest(changes=changes), self.assertRaises(DatabaseError), atomic():
                BlockchainTransaction.objects.create(**(valid | changes))
        self.assertIsNotNone(self.admit().pk)

    def test_duplicate_admission_and_every_original_identity_field_are_guarded(self):
        journal = self.admit()
        with self.assertRaises(DatabaseError), atomic():
            BlockchainTransaction.objects.create(**self.fields())
        for field, value in {
            "uuid": uuid4(),
            "created_at": timezone.now(),
            "tx_type": "other",
            "from_address": "0x" + "f" * 40,
            "to_address": "0x" + "e" * 40,
            "value": 1,
            "function_name": "other",
            "function_args": journal.function_args | {"admission": None},
            "related_uuid": uuid4(),
            "related_model": "other",
            "retry_count": 1,
        }.items():
            with self.subTest(field=field), self.assertRaises(DatabaseError), atomic():
                BlockchainTransaction.objects.filter(pk=journal.pk).update(**{field: value})
        with self.assertRaisesMessage(DatabaseError, "cannot be deleted"), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("DELETE FROM blockchain_blockchaintransaction WHERE uuid = %s", [journal.pk])
        BlockchainTransaction.objects.filter(pk=journal.pk).update(updated_at=timezone.now(), error_message="pending")
        self.assertEqual(BlockchainTransaction.objects.get(pk=journal.pk).error_message, "pending")

    def test_open_before_binding_is_recoverable_but_cannot_sign_or_bind_an_unrelated_operation(self):
        journal = self.admit()
        intent = self.abi_intent(journal) | {"value": 0}
        claim = outgoing.open_operation(f"swap-execution:{journal.pk}", **intent)
        journal.refresh_from_db()
        self.assertIsNone(journal.outgoing_operation_id)
        self.assertEqual(outgoing.open_operation(f"swap-execution:{journal.pk}", **intent), claim)
        admitted_signer()
        with self.assertRaises(outgoing.OutgoingTransactionError):
            outgoing.sign_operation(claim, outgoing.prepare_operation(claim, chain_client()), KEY)
        self.assertFalse(SignedAttempt.objects.exists())
        unrelated = outgoing.open_operation("synthetic:unrelated-swap", **intent)
        with self.assertRaisesMessage(DatabaseError, "bind only"), atomic():
            BlockchainTransaction.objects.filter(pk=journal.pk).update(outgoing_operation_id=unrelated.operation_id)
        journal.outgoing_operation_id = claim.operation_id
        journal.save(update_fields=["outgoing_operation"])
        with self.assertRaises(DatabaseError), atomic():
            BlockchainTransaction.objects.filter(pk=journal.pk).update(outgoing_operation_id=None)

    def test_only_bound_unsigned_failure_can_release_and_it_cannot_reopen(self):
        journal = self.admit()
        with self.assertRaisesMessage(DatabaseError, "failure require"), atomic():
            journal.mark_failed("unsigned")
        journal.refresh_from_db()
        claim = self.open(journal)
        with self.assertRaisesMessage(DatabaseError, "proof"), atomic():
            journal.mark_failed("unsigned")
        journal.refresh_from_db()
        outgoing.fail_preparing(claim)
        journal.mark_failed("unsigned")
        self.swap.mark_failed("unsigned")
        with self.assertRaisesMessage(DatabaseError, "cannot restart"):
            outgoing.open_operation(f"swap-execution:{journal.pk}", **(self.abi_intent(journal) | {"value": 0}))
        self.assertEqual(SwapOrder.objects.get(pk=self.swap.pk).status, "failed")
        self.assertFalse(SignedAttempt.objects.exists())

    def test_sign_callback_retains_one_attempt_and_receipt_summary_without_public_completion(self):
        journal = self.admit()
        claim = self.open(journal)
        attempt = self.sign(journal, claim)
        journal.refresh_from_db()
        self.assertIsNone(journal.nonce)
        self.assertEqual(journal.tx_hash, attempt.tx_hash)
        self.assertEqual(SwapOrder.objects.get(pk=self.swap.pk).tx_hash, attempt.tx_hash)
        with self.assertRaises(DatabaseError), atomic():
            journal.mark_failed("not unsigned")
        journal.refresh_from_db()
        outgoing.record_receipt(claim, attempt.tx_hash, receipt(attempt))
        journal.refresh_from_db()
        self.assertEqual(journal.status, "submitted")
        with self.assertRaisesMessage(DatabaseError, "confirmed original receipt"), atomic():
            SwapOrder.objects.filter(pk=self.swap.pk).update(status="completed", completed_at=timezone.now())
        journal.mark_confirmed(12, receipt(attempt)["blockHash"], 21000)
        for model, pk, changes in (
            (BlockchainTransaction, journal.pk, {"block_number": 13}),
            (BlockchainTransaction, journal.pk, {"tx_hash": "0x" + "f" * 64}),
            (OutgoingOperation, claim.operation_id, {"block_number": 13}),
            (OutgoingOperation, claim.operation_id, {"block_hash": "0x" + "e" * 64}),
            (OutgoingOperation, claim.operation_id, {"gas_used": 21001}),
            (SwapOrder, self.swap.pk, {"status": "completed"}),
            (SwapOrder, self.swap.pk, {"completed_at": timezone.now()}),
            (SwapOrder, self.swap.pk, {"status": "failed"}),
            (SwapOrder, self.swap.pk, {"transaction_id": None}),
            (SwapOrder, self.swap.pk, {"seller_signature": "ff" * 65}),
        ):
            with self.subTest(model=model.__name__, changes=changes), self.assertRaises(DatabaseError), atomic():
                model.objects.filter(pk=pk).update(**changes)
        self.assertEqual(SwapOrder.objects.get(pk=self.swap.pk).status, "executing")
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_original_receipt_projection_survives_later_actor_wallet_and_configuration_loss(self):
        journal = self.admit()
        claim = self.open(journal)
        attempt = self.sign(journal, claim)
        self.seller.user.is_active = False
        self.seller.user.save(update_fields=["is_active"])
        self.seller.wallet.verification_status = "PENDING"
        self.seller.wallet.save(update_fields=["verification_status"])
        with override_settings(ATOMIC_SWAP_ADDRESS="0x" + "e" * 40, BLOCKCHAIN_CHAIN_ID=1):
            outgoing.record_receipt(claim, attempt.tx_hash, receipt(attempt))
            journal.mark_confirmed(12, receipt(attempt)["blockHash"], 21000)
        self.assertEqual(BlockchainTransaction.objects.get(pk=journal.pk).status, "confirmed")
        self.assertEqual(SwapOrder.objects.get(pk=self.swap.pk).status, "executing")

    def test_reverted_claim_retains_its_original_summary_and_cannot_restart(self):
        journal = self.admit()
        claim = self.open(journal)
        attempt = self.sign(journal, claim)
        outgoing.record_receipt(claim, attempt.tx_hash, receipt(attempt, 0))
        journal.status = "reverted"
        journal.block_number = 12
        journal.block_hash = receipt(attempt)["blockHash"]
        journal.gas_used = 21000
        journal.confirmed_at = timezone.now()
        journal.save(update_fields=["status", "block_number", "block_hash", "gas_used", "confirmed_at"])
        with self.assertRaisesMessage(DatabaseError, "cannot restart"):
            outgoing.open_operation(f"swap-execution:{journal.pk}", **(self.abi_intent(journal) | {"value": 0}))
        self.assertEqual(SwapOrder.objects.get(pk=self.swap.pk).status, "executing")

    def test_delayed_duplicate_insert_reaches_unique_conflict_after_the_peer_has_terminalized(self):
        journal = self.admit()
        claim = self.open(journal)
        attempt = self.sign(journal, claim)
        outgoing.record_receipt(claim, attempt.tx_hash, receipt(attempt, 0))
        with self.assertRaises(DatabaseError) as caught, atomic():
            OutgoingOperation.objects.create(
                operation_key=f"swap-execution:{journal.pk}", intent=self.abi_intent(journal), claim_id=uuid4()
            )
        self.assertEqual(caught.exception.__cause__.diag.sqlstate, "23505")
        self.assertEqual(OutgoingOperation.objects.get(pk=claim.operation_id).status, "reverted")
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_unrelated_transaction_and_outgoing_writer_are_unchanged(self):
        transaction = BlockchainTransaction.objects.create(
            tx_type="other", from_address=SENDER, function_name="executeSwap", function_args={"admission": "unrelated"}
        )
        transaction.mark_failed("other protocol")
        transaction.delete()
        claim = outgoing.open_operation(
            "other:protocol", chain_id=CHAIN_ID, sender=SENDER, to=SENDER, value=0, data="0x"
        )
        outgoing.fail_preparing(claim)
        replacement = outgoing.open_operation(
            "other:protocol", chain_id=CHAIN_ID, sender=SENDER, to=SENDER, value=0, data="0x"
        )
        self.assertNotEqual(claim.claim_id, replacement.claim_id)


class SwapExecutionAppChecks(SwapExecutionStorageFixtures):
    def test_the_app_cannot_insert_swaps_or_read_the_private_journal(self):
        fresh = self.make_swap()
        values = {field.attname: getattr(fresh, field.attname) for field in SwapOrder._meta.concrete_fields}
        values.pop("uuid")
        values.pop("created_at")
        values.pop("updated_at")
        app_buy = TransferOrder.objects.create(
            token=self.seller.deployed_token,
            payment_asset=self.seller.refs.stablecoin,
            wallet=self.seller.wallet,
            owner_account=self.seller.account,
            wallet_address=self.seller.wallet.address,
            order_type="buy",
            quantity=20,
            price_per_share="1.50",
        )
        values.update(
            buy_order_id=app_buy.pk, buyer_wallet_id=self.seller.wallet.pk, buyer_address=self.seller.wallet.address
        )
        for changes in (
            {"status": "executing"},
            {"status": "ready"},
            {"tx_hash": "0x" + "f" * 64},
            {"seller_signature": "ff" * 65},
        ):
            candidate = SwapOrder(**(values | changes))
            with self.app(), self.subTest(changes=changes), self.assertRaisesMessage(
                DatabaseError, "Fresh swaps"
            ), atomic():
                save_swap_with_context(candidate)
        with self.app(), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname = current_user")
                self.assertEqual(cursor.fetchone(), (settings.RLS_ROLES["app"], False))
                cursor.execute("SELECT has_table_privilege(current_user, 'blockchain_blockchaintransaction', 'SELECT')")
                self.assertEqual(cursor.fetchone(), (False,))
            candidate = SwapOrder(**(values | {"nonce": fresh.nonce + 1}))
            with self.assertRaisesMessage(DatabaseError, "row-level security"), atomic():
                save_swap_with_context(candidate)
        self.assertFalse(SwapOrder.objects.filter(pk=candidate.pk).exists())


@override_settings(BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class SwapExecutionAppStorageTest(SwapExecutionAppChecks, TransactionTestCase):
    pass


@override_settings(BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class ScopedSwapExecutionAppStorageTest(RunsOnTheScopedConnection, SwapExecutionAppChecks, TransactionTestCase):
    pass


@override_settings(BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class SwapExecutionMigrationTest(SwapExecutionStorageFixtures, TransactionTestCase):
    def historical(self):
        self.addCleanup(restore_every_migration)
        previous = migrate_to([("tokens", "0056_hold_legacy_swaps")])
        fields = self.fields()
        fields["function_args"].pop("admission")
        journal = previous.get_model("blockchain", "BlockchainTransaction").objects.create(
            **fields, tx_hash="0x" + "ab" * 32, status="submitted", submitted_at=timezone.now()
        )
        old_swap = previous.get_model("tokens", "SwapOrder").objects
        old_swap.filter(pk=self.swap.pk).update(transaction_id=journal.pk, status="executing", tx_hash=journal.tx_hash)
        before = (
            previous.get_model("blockchain", "BlockchainTransaction").objects.filter(pk=journal.pk).values().get()
            | {"outgoing_operation_id": None},
            old_swap.filter(pk=self.swap.pk).values().get(),
        )
        restore_every_migration()
        return journal.pk, before

    def test_upgrade_preserves_unmarked_history_and_refuses_annotation_binding_or_restart(self):
        journal_id, before = self.historical()
        self.assertEqual(BlockchainTransaction.objects.filter(pk=journal_id).values().get(), before[0])
        self.assertEqual(SwapOrder.objects.filter(pk=self.swap.pk).values().get(), before[1])
        journal = BlockchainTransaction.objects.get(pk=journal_id)
        for changes in (
            {"function_args": self.fields()["function_args"]},
            {"tx_hash": "0x" + "cd" * 32},
            {"status": "pending"},
        ):
            with self.subTest(changes=changes), self.assertRaises(DatabaseError), atomic():
                BlockchainTransaction.objects.filter(pk=journal_id).update(**changes)
        with self.assertRaises(DatabaseError):
            outgoing.open_operation(f"swap-execution:{journal_id}", **(self.abi_intent(journal) | {"value": 0}))
        unrelated = outgoing.open_operation("synthetic:history", **(self.abi_intent(journal) | {"value": 0}))
        with self.assertRaises(DatabaseError), atomic():
            BlockchainTransaction.objects.filter(pk=journal_id).update(outgoing_operation_id=unrelated.operation_id)
        with self.assertRaises(DatabaseError), atomic():
            SwapOrder.objects.filter(pk=self.swap.pk).update(status="completed", completed_at=timezone.now())
        self.assertEqual(BlockchainTransaction.objects.filter(pk=journal_id).values().get(), before[0])

    def test_reverse_refuses_admitted_and_open_before_bind_history(self):
        journal = self.admit()
        claim = outgoing.open_operation(f"swap-execution:{journal.pk}", **(self.abi_intent(journal) | {"value": 0}))
        self.addCleanup(restore_every_migration)
        with self.assertRaisesMessage(DatabaseError, "Cannot remove admitted"):
            migrate_to([("blockchain", "0006_signer_admission")])
        restore_every_migration()
        self.assertEqual(OutgoingOperation.objects.get(pk=claim.operation_id).status, "preparing")
        self.assertIsNone(BlockchainTransaction.objects.get(pk=journal.pk).outgoing_operation_id)

    def test_empty_reverse_removes_the_column_and_restores_cleanly(self):
        self.addCleanup(restore_every_migration)
        migrate_to([("blockchain", "0006_signer_admission")])
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT count(*) FROM information_schema.columns WHERE table_name = 'blockchain_blockchaintransaction' "
                "AND column_name = 'outgoing_operation_id'"
            )
            self.assertEqual(cursor.fetchone(), (0,))
        restore_every_migration()
        self.assertIsNotNone(self.admit().pk)

    def test_forward_refuses_preexisting_reserved_admission_metadata(self):
        self.addCleanup(restore_every_migration)
        previous = migrate_to([("tokens", "0056_hold_legacy_swaps")])
        manager = previous.get_model("blockchain", "BlockchainTransaction").objects
        journal = manager.create(**self.fields())
        try:
            with self.assertRaisesMessage(DatabaseError, "cannot be adopted"):
                restore_every_migration()
        finally:
            manager.filter(pk=journal.pk).delete()
            restore_every_migration()

    def test_forward_refuses_preexisting_operation_prefix(self):
        self.addCleanup(restore_every_migration)
        previous = migrate_to([("tokens", "0056_hold_legacy_swaps")])
        manager = previous.get_model("blockchain", "OutgoingOperation").objects
        operation = manager.create(operation_key=f"swap-execution:{uuid4()}", intent={}, claim_id=uuid4())
        try:
            with self.assertRaisesMessage(DatabaseError, "cannot be adopted"):
                restore_every_migration()
        finally:
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("TRUNCATE blockchain_outgoingoperation CASCADE")
            restore_every_migration()
        self.assertFalse(OutgoingOperation.objects.filter(pk=operation.pk).exists())
