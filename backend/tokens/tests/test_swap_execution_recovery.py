import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import DatabaseError, connections
from django.test import override_settings
from rest_framework.test import APITransactionTestCase

from blockchain.models import (
    BlockchainTransaction,
    OutgoingOperation,
    SignedAttempt,
    SigningAccount,
)
from blockchain.services import outgoing
from blockchain.tests.outgoing_fixtures import CHAIN_ID, KEY, SENDER, admitted_signer
from blockchain.tests.test_outgoing_processes import finish
from feature_flags.models import FeatureFlag
from shared.db import acting_for, atomic, current_alias, use_operator
from shared.tests.tenants import make_tenant
from tokens.exceptions import SwapNotReadyException
from tokens.models import ShareToken, SwapOrder, TransferOrder
from tokens.services import swap_execution
from tokens.tasks.swap_reconciler import recover_swap_execution, resolve_executing_swaps
from tokens.tests.order_process_fixtures import worker_databases
from tokens.tests.swap_execution_fixtures import (
    ExecutionNode,
    execution_receipt,
    make_execution,
)
from tokens.tests.swap_state_fixtures import BUYER, CONTRACT, SELLER
from users.models import UserAccount, UserProfile
from wallets.models import Wallet


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, ATOMIC_SWAP_ADDRESS=CONTRACT)
class SwapExecutionRecoveryTest(APITransactionTestCase):
    def setUp(self):
        self.enterContext(patch.object(swap_execution, "publish_trading_event"))
        with use_operator():
            FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
            self.fixture = make_execution("recovery")
            self.signer = admitted_signer()
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT coalesce(max(id), 0) FROM procrastinate_jobs")
                self.job_floor = cursor.fetchone()[0]
            self.parents = list(
                TransferOrder.objects.filter(pk__in=[row.pk for row in self.fixture.orders]).order_by("pk").values()
            )
        self.swap = self.fixture.swap

    def post_signature(self, role, *, relayed=None, user=None, changes=None):
        tenant = getattr(self.fixture, role)
        order = self.fixture.orders[role == "buyer"]
        self.client.force_authenticate(user=user or tenant.user)
        signer = relayed or role
        return self.client.post(
            f"/api/v1/trading/orders/{order.pk}/swap/sign/",
            {
                "swap_uuid": str(self.swap.pk),
                "owner_account_uuid": str(tenant.account.pk),
                "wallet_uuid": str(order.wallet_id),
                "settlement_digest": self.swap.settlement_digest,
                "signature": self.fixture.signatures[signer],
                "signer_address": SELLER.address if signer == "seller" else BUYER.address,
                **(changes or {}),
            },
            format="json",
        )

    def admit(self):
        for role in ("seller", "buyer"):
            response = self.post_signature(role)
            self.assertEqual(response.status_code, 200, response.content)
        with use_operator():
            self.swap.refresh_from_db()
            self.record = BlockchainTransaction.objects.get(pk=self.swap.transaction_id)
        self.node = ExecutionNode(self.record.function_args)
        return self.record

    def recover(self):
        with use_operator():
            return swap_execution.recover(self.record.pk, client=self.node.client)

    def attempts(self):
        return SignedAttempt.objects.select_related("operation").filter(
            operation__operation_key=swap_execution.operation_key(self.record)
        )

    def jobs(self):
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT args FROM procrastinate_jobs WHERE task_name=%s AND id>%s ORDER BY id",
                ["tokens.tasks.swap_reconciler.recover_swap_execution", self.job_floor],
            )
            return cursor.fetchall()

    def assert_held(self):
        with use_operator():
            self.swap.refresh_from_db()
            self.assertEqual(self.swap.status, "executing")
            self.assertIsNone(self.swap.completed_at)
            self.assertEqual(
                list(
                    TransferOrder.objects.filter(pk__in=[row.pk for row in self.fixture.orders]).order_by("pk").values()
                ),
                self.parents,
            )

    def external_issuer_swap(self, label):
        with use_operator():
            issuer = make_tenant(f"{label}-issuer", with_swap=False)
            self.fixture = make_execution(label, issuer=issuer)
            self.swap = self.fixture.swap
        swap_execution.publish_trading_event.reset_mock()
        self.assertEqual(len({issuer.user.pk, self.fixture.seller.user.pk, self.fixture.buyer.user.pk}), 3)
        return issuer

    def class_status(self, status):
        with use_operator():
            ShareToken.objects.filter(pk=self.swap.share_token_id).update(status=status)

    def admission_state(self):
        with use_operator():
            return (
                SwapOrder.objects.filter(pk=self.swap.pk).values().get(),
                list(BlockchainTransaction.objects.filter(related_uuid=self.swap.pk).order_by("pk").values()),
                OutgoingOperation.objects.count(),
                SignedAttempt.objects.count(),
                self.jobs(),
                swap_execution.publish_trading_event.call_count,
            )

    def test_foreign_deployed_class_accepts_actual_signers_and_refuses_a_fresh_relay_without_execution(self):
        for actor, signer in (("seller", "seller"), ("buyer", "buyer"), ("buyer", "seller")):
            with self.subTest(actor=actor, signer=signer):
                self.external_issuer_swap(f"admitted-{actor}-{signer}")
                before = self.admission_state()
                with patch.object(swap_execution, "get_base_chain_client", side_effect=AssertionError("Provider")):
                    response = self.post_signature(actor, relayed=signer)
                if actor != signer:
                    self.assertEqual(response.status_code, 400, response.content)
                    self.assertEqual(
                        response.json(), {"detail": "The authenticated participant must be the signing party"}
                    )
                    self.assertEqual(self.admission_state(), before)
                    with patch.object(swap_execution, "get_base_chain_client", side_effect=AssertionError("Provider")):
                        response = self.post_signature(signer)
                self.assertEqual(response.status_code, 200, response.content)
                state, transactions, operations, attempts, jobs, events = self.admission_state()
                self.assertEqual(state[f"{signer}_signature"], self.fixture.signatures[signer])
                self.assertEqual(state["status"], f"{signer}_signed")
                self.assertIsNone(state["transaction_id"])
                self.assertEqual((transactions, operations, attempts, jobs, events), ([], 0, 0, [], 1))

    def test_foreign_paused_class_refuses_new_signatures_and_a_relay_without_effects(self):
        self.external_issuer_swap("paused-new")
        self.class_status("paused")
        before = self.admission_state()
        for actor, signer in (("seller", "seller"), ("buyer", "buyer"), ("buyer", "seller")):
            with self.subTest(actor=actor, signer=signer):
                response = self.post_signature(actor, relayed=signer)
                if actor == signer:
                    self.assertEqual(response.status_code, 409, response.content)
                    self.assertEqual(response.json()["code"], "swap_settlement_context_changed")
                else:
                    self.assertEqual(response.status_code, 400, response.content)
                    self.assertEqual(
                        response.json(), {"detail": "The authenticated participant must be the signing party"}
                    )
                self.assertEqual(self.admission_state(), before)

    def test_non_deployed_classes_refuse_new_admission(self):
        self.external_issuer_swap("nondeployed-new")
        for status in ("draft", "deploying", "failed"):
            with self.subTest(status=status):
                self.class_status(status)
                before = self.admission_state()
                response = self.post_signature("buyer")
                self.assertEqual(response.status_code, 409, response.content)
                self.assertEqual(response.json()["code"], "swap_settlement_context_changed")
                self.assertEqual(self.admission_state(), before)

    def test_pause_preserves_the_first_signature_and_refuses_the_other_side(self):
        for first, second in (("seller", "buyer"), ("buyer", "seller")):
            with self.subTest(first=first):
                self.external_issuer_swap(f"paused-second-{first}")
                response = self.post_signature(first)
                self.assertEqual(response.status_code, 200, response.content)
                self.class_status("paused")
                before = self.admission_state()
                response = self.post_signature(second)
                self.assertEqual(response.status_code, 409, response.content)
                self.assertEqual(response.json()["code"], "swap_settlement_context_changed")
                self.assertEqual(self.admission_state(), before)
                replay = self.post_signature(first)
                self.assertEqual(replay.status_code, 200, replay.content)
                self.assertEqual(self.admission_state(), before)

    def test_paused_exact_signature_replays_keep_terminal_records_without_execution(self):
        for status in ("failed", "expired"):
            with self.subTest(status=status):
                self.external_issuer_swap(f"paused-replay-{status}")
                self.assertEqual(self.post_signature("seller").status_code, 200)
                with use_operator():
                    SwapOrder.objects.filter(pk=self.swap.pk).update(status=status)
                self.class_status("paused")
                before = self.admission_state()
                response = self.post_signature("seller")
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(self.admission_state(), before)

    def test_paused_completed_replay_preserves_the_original_execution(self):
        self.external_issuer_swap("paused-completed")
        self.admit()
        self.assertEqual(self.recover(), "confirmed")
        self.node.advance(head=12)
        with use_operator(), override_settings(
            WALLET_CHAIN_FINALITY_POLICIES={f"evm:{CHAIN_ID}": {"mode": "depth", "depth": 1}}
        ):
            self.assertEqual(swap_execution.settle(self.record.pk, client=self.node.client), "completed")
        self.class_status("paused")
        before = self.admission_state()
        response = self.post_signature("seller")
        self.assertEqual(response.status_code, 200, response.content)
        after = self.admission_state()
        self.assertEqual(after[:4], before[:4])
        self.assertEqual(after[5], before[5])
        self.assertEqual(len(after[4]), len(before[4]) + 1)
        self.assertEqual(after[4][-1], before[4][-1])

    def test_paused_different_valid_signature_refuses_before_the_class_gate(self):
        from eth_keys.constants import SECPK1_N

        from tokens.services import atomic_swap_service

        self.external_issuer_swap("paused-different")
        self.assertEqual(self.post_signature("seller").status_code, 200)
        raw = bytes.fromhex(self.fixture.signatures["seller"][2:])
        different = (
            "0x" + (raw[:32] + (SECPK1_N - int.from_bytes(raw[32:64])).to_bytes(32) + bytes([55 - raw[64]])).hex()
        )
        self.assertNotEqual(different, self.fixture.signatures["seller"])
        self.assertTrue(atomic_swap_service.verify_signature(self.swap, different, SELLER.address))
        self.class_status("paused")
        before = self.admission_state()
        response = self.post_signature("seller", changes={"signature": different})
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("already signed", str(response.data))
        self.assertEqual(self.admission_state(), before)

    def test_paused_ready_replay_admits_only_after_unpause_and_reuses_the_execution(self):
        self.external_issuer_swap("paused-ready")
        with override_settings(BLOCKCHAIN_OPERATOR_KEY=""):
            self.assertEqual(self.post_signature("seller").status_code, 200)
            self.assertEqual(self.post_signature("buyer").status_code, 200)
        self.class_status("paused")
        before = self.admission_state()
        self.assertEqual(before[0]["status"], "ready")
        response = self.post_signature("buyer")
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(self.admission_state(), before)
        self.class_status("deployed")
        response = self.post_signature("buyer")
        self.assertEqual(response.status_code, 200, response.content)
        admitted = self.admission_state()
        self.assertEqual(admitted[0]["status"], "executing")
        self.assertEqual(len(admitted[1]), 1)
        self.assertEqual(len(admitted[4]), 1)
        self.class_status("paused")
        replay = self.post_signature("buyer")
        self.assertEqual(replay.status_code, 200, replay.content)
        recovered = self.admission_state()
        self.assertEqual(recovered[:4], admitted[:4])
        self.assertEqual(recovered[5], admitted[5])
        self.assertEqual(len(recovered[4]), 2)
        self.assertEqual(recovered[4][0], recovered[4][1])

    def test_two_private_participants_admit_their_own_signatures_and_replay_the_original_actor(self):
        seen = []
        from tokens.services import atomic_swap_service

        verify = atomic_swap_service.verify_signature

        def private_read(*args):
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname=current_user")
                seen.append(cursor.fetchone())
            self.assertEqual(TransferOrder.objects.filter(pk=self.fixture.orders[0].pk).count(), 0)
            self.assertEqual(TransferOrder.objects.filter(pk=self.fixture.orders[1].pk).count(), 1)
            return verify(*args)

        before = self.admission_state()
        with patch.object(atomic_swap_service, "verify_signature", private_read):
            response = self.post_signature("buyer", relayed="seller")
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(response.json(), {"detail": "The authenticated participant must be the signing party"})
        self.assertEqual(self.admission_state(), before)
        self.assertEqual(seen, [(settings.RLS_ROLES["app"], False)])
        seen.clear()
        with patch.object(atomic_swap_service, "verify_signature", private_read):
            response = self.post_signature("buyer")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(seen, [(settings.RLS_ROLES["app"], False)])
        before = self.admission_state()
        response = self.post_signature("seller", relayed="buyer")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.admission_state(), before)
        response = self.post_signature("seller")
        self.assertEqual(response.status_code, 200, response.content)
        with use_operator():
            self.swap.refresh_from_db()
            record = BlockchainTransaction.objects.get(pk=self.swap.transaction_id)
            self.assertEqual(
                record.function_args["admission"],
                {"version": 1, "actor_id": str(self.fixture.seller.user.pk), "participant": "seller"},
            )
            self.assertEqual(self.swap.status, "executing")
            self.assertFalse(record.tx_hash)
            self.assertIsNone(record.outgoing_operation_id)
        self.assertEqual(len(self.jobs()), 1)

    def test_other_caller_wrong_wallet_and_changed_digest_refuse_without_signature(self):
        with use_operator():
            outsider = make_tenant("outsider", with_swap=False)
        for changes, user, expected in (
            ({}, outsider.user, 404),
            ({"wallet_uuid": str(self.fixture.orders[1].wallet_id)}, self.fixture.seller.user, 404),
            ({"settlement_digest": "0x" + "00" * 32}, self.fixture.seller.user, 409),
        ):
            with self.subTest(changes=changes):
                response = self.post_signature("seller", user=user, changes=changes)
                self.assertEqual(response.status_code, expected, response.content)
        with use_operator():
            self.swap.refresh_from_db()
            self.assertFalse(self.swap.seller_signature)
            self.assertFalse(BlockchainTransaction.objects.filter(related_uuid=self.swap.pk).exists())
        self.assertEqual(self.jobs(), [])
        self.assertEqual(self.post_signature("seller").status_code, 200)

    def test_job_failure_rolls_back_second_signature_and_transaction(self):
        self.assertEqual(self.post_signature("seller").status_code, 200)
        with acting_for(self.fixture.buyer.user.pk), patch.object(
            recover_swap_execution, "defer", side_effect=DatabaseError("Synthetic job failure")
        ):
            with self.assertRaises(DatabaseError):
                swap_execution.submit_signature(
                    self.swap,
                    self.fixture.signatures["buyer"],
                    BUYER.address,
                    user=self.fixture.buyer.user,
                    participant="buyer",
                )
        with use_operator():
            self.swap.refresh_from_db()
            self.assertEqual(self.swap.status, "seller_signed")
            self.assertFalse(self.swap.buyer_signature)
            self.assertIsNone(self.swap.transaction_id)
            self.assertFalse(BlockchainTransaction.objects.filter(related_uuid=self.swap.pk).exists())
        self.assertEqual(self.jobs(), [])
        self.assertEqual(self.post_signature("buyer").status_code, 200)
        self.assertEqual(len(self.jobs()), 1)

    def test_missing_relayer_retains_ready_and_only_explicit_replay_admits(self):
        with override_settings(BLOCKCHAIN_OPERATOR_KEY=""):
            for role in ("seller", "buyer"):
                self.assertEqual(self.post_signature(role).status_code, 200)
        with use_operator():
            self.swap.refresh_from_db()
            self.assertEqual(self.swap.status, "ready")
            self.assertIsNone(self.swap.transaction_id)
            self.assertEqual(resolve_executing_swaps(), {"checked": 0, "resolved": 0})
        self.assertEqual(self.jobs(), [])
        self.assertEqual(self.post_signature("buyer").status_code, 200)
        with use_operator():
            self.swap.refresh_from_db()
            self.assertEqual(self.swap.status, "executing")
            self.assertIsNotNone(self.swap.transaction_id)
        self.assertEqual(len(self.jobs()), 1)

    def test_admission_commit_acknowledgement_loss_reuses_original_transaction(self):
        self.assertEqual(self.post_signature("seller").status_code, 200)
        with use_operator():
            connection = connections[current_alias()]
            commit = connection.commit

            def commit_then_disconnect():
                commit()
                raise ConnectionError("Synthetic admission acknowledgement loss")

            with (
                acting_for(self.fixture.buyer.user.pk),
                patch.object(connection, "commit", commit_then_disconnect),
                self.assertRaises(ConnectionError),
            ):
                swap_execution.submit_signature(
                    self.swap,
                    self.fixture.signatures["buyer"],
                    BUYER.address,
                    user=self.fixture.buyer.user,
                    participant="buyer",
                )
            self.swap.refresh_from_db()
            original = self.swap.transaction_id
        self.assertIsNotNone(original)
        self.assertEqual(len(self.jobs()), 1)
        self.assertEqual(self.post_signature("buyer").status_code, 200)
        with use_operator():
            self.swap.refresh_from_db()
            self.assertEqual(self.swap.transaction_id, original)
            self.assertEqual(BlockchainTransaction.objects.filter(related_uuid=self.swap.pk).count(), 1)

    def test_original_receipt_retains_projection_without_releasing_holds(self):
        self.admit()
        self.assertEqual(self.recover(), "confirmed")
        with use_operator():
            self.record.refresh_from_db()
            attempt = self.attempts().get()
            self.assertEqual(self.record.status, "confirmed")
            self.assertEqual(self.record.tx_hash, attempt.tx_hash)
            self.assertEqual(self.record.block_hash, self.record.outgoing_operation.block_hash)
            self.assertEqual(SigningAccount.objects.get(pk=self.signer.pk).next_nonce, 8)
        self.assert_held()
        self.assertEqual(self.recover(), "confirmed")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_revert_retains_holds_and_never_restarts_the_original_operation(self):
        self.admit()
        self.node.status = 0
        self.assertEqual(self.recover(), "reverted")
        with use_operator():
            self.record.refresh_from_db()
            original = self.record.outgoing_operation.claim_id
            self.assertEqual(self.record.status, "reverted")
        self.assertEqual(self.recover(), "reverted")
        with use_operator():
            self.record.refresh_from_db()
            self.assertEqual(self.record.outgoing_operation.claim_id, original)
            self.assertEqual(self.attempts().count(), 1)
        self.assert_held()
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_duplicate_recovery_and_lost_send_ack_use_original_raw_bytes_and_nonce(self):
        self.admit()
        self.node.confirmed = False
        self.node.lose_acknowledgement = True
        self.assertEqual(self.recover(), "signed")
        self.assertEqual(self.recover(), "signed")
        with use_operator():
            attempt = self.attempts().get()
            self.assertEqual(self.node.broadcasts, [bytes(attempt.raw_transaction)] * 2)
            self.assertEqual(SigningAccount.objects.get(pk=self.signer.pk).next_nonce, 8)
            self.node.mine(attempt.tx_hash, execution_receipt(attempt, self.record.function_args))
        self.assertEqual(self.recover(), "confirmed")
        self.assertEqual(len(self.node.broadcasts), 2)
        self.assert_held()

    def test_a_consumed_nonce_is_attributed_and_held_without_a_resend(self):
        self.admit()
        self.node.confirmed = False
        self.assertEqual(self.recover(), "signed")
        with use_operator():
            attempt = self.attempts().get()
        consuming = self.node.replace(attempt, gasPrice=10**9 + 1)
        self.node.advance(head=20)
        with self.assertLogs("tokens.services.swap_execution", "WARNING") as logs:
            self.assertEqual(self.recover(), "signed")
        self.assertEqual(len(logs.output), 1)
        self.assertIn(
            f"Swap execution {self.record.pk} nonce {attempt.nonce} consumed by {consuming} (fee_bump)"
            "; held for operator attribution",
            logs.output[0],
        )
        self.assertEqual(len(self.node.broadcasts), 1)
        with use_operator():
            self.assertEqual(OutgoingOperation.objects.get(pk=attempt.operation_id).status, "signed")
            self.assertEqual(self.attempts().count(), 1)
            self.assertEqual(SigningAccount.objects.get(pk=self.signer.pk).next_nonce, 8)
            self.record.refresh_from_db()
        self.assertEqual((self.record.status, self.record.tx_hash), ("submitted", attempt.tx_hash))
        self.assert_held()

    def test_a_cancelling_self_call_is_attributed_by_its_kind_and_held(self):
        self.admit()
        self.node.confirmed = False
        self.assertEqual(self.recover(), "signed")
        with use_operator():
            attempt = self.attempts().get()
        consuming = self.node.replace(attempt, to=SENDER, data=b"")
        self.node.advance(head=20)
        with self.assertLogs("tokens.services.swap_execution", "WARNING") as logs:
            self.assertEqual(self.recover(), "signed")
        self.assertEqual(len(logs.output), 1)
        self.assertIn(
            f"Swap execution {self.record.pk} nonce {attempt.nonce} consumed by {consuming} (zero_value_self_call)"
            "; held for operator attribution",
            logs.output[0],
        )
        self.assertEqual(len(self.node.broadcasts), 1)
        self.assert_held()

    def test_an_unreadable_spend_is_held_as_an_unattributed_transaction(self):
        self.admit()
        self.node.confirmed = False
        self.assertEqual(self.recover(), "signed")
        with use_operator():
            attempt = self.attempts().get()
        self.node.replace(attempt, gasPrice=10**9 + 1)
        with self.assertLogs("tokens.services.swap_execution", "WARNING") as logs:
            self.assertEqual(self.recover(), "signed")
        self.assertEqual(len(logs.output), 1)
        self.assertIn(
            f"Swap execution {self.record.pk} nonce {attempt.nonce} consumed by an unattributed transaction"
            " (provider_evidence_unavailable); held for operator attribution",
            logs.output[0],
        )
        self.assertEqual(len(self.node.broadcasts), 1)
        self.assert_held()

    def test_changed_authority_stops_resend_but_original_receipt_is_still_observed(self):
        self.admit()
        self.node.confirmed = False
        self.assertEqual(self.recover(), "signed")
        with use_operator():
            Wallet.objects.filter(pk=self.swap.buyer_wallet_id).update(verification_status="PENDING")
            attempt = self.attempts().get()
        self.assertEqual(self.recover(), "signed")
        self.assertEqual(len(self.node.broadcasts), 1)
        self.assert_held()
        self.node.mine(attempt.tx_hash, execution_receipt(attempt, self.record.function_args))
        self.assertEqual(self.recover(), "confirmed")
        self.assert_held()

    def test_changed_domain_and_expiry_stop_resend_but_original_receipt_survives(self):
        self.admit()
        self.node.confirmed = False
        self.assertEqual(self.recover(), "signed")
        with override_settings(ATOMIC_SWAP_ADDRESS="0x" + "be" * 20):
            self.assertEqual(self.recover(), "signed")
        with patch("django.utils.timezone.now", return_value=self.swap.expires_at + timedelta(seconds=1)):
            self.assertEqual(self.recover(), "signed")
        self.assertEqual(len(self.node.broadcasts), 1)
        with use_operator():
            attempt = self.attempts().get()
            outgoing.close_signer_admission(chain_id=CHAIN_ID, sender=self.record.from_address)
        with self.assertRaises(outgoing.OutgoingTransactionError):
            self.recover()
        self.assertEqual(len(self.node.broadcasts), 1)
        self.assert_held()
        self.node.mine(attempt.tx_hash, execution_receipt(attempt, self.record.function_args))
        with override_settings(ATOMIC_SWAP_ADDRESS="0x" + "be" * 20, BLOCKCHAIN_OPERATOR_KEY=""):
            self.assertEqual(self.recover(), "confirmed")
        self.assert_held()

    def test_malformed_envelope_and_wrong_or_duplicate_events_keep_original_unresolved(self):
        self.admit()
        self.node.confirmed = False
        self.assertEqual(self.recover(), "signed")
        with use_operator():
            attempt = self.attempts().get()
        original = execution_receipt(attempt, self.record.function_args)
        bad = [
            {**original, "transactionHash": "0x" + "00" * 32},
            {**original, "from": BUYER.address},
            {**original, "to": SELLER.address},
            {**original, "logs": [{**original["logs"][0], "transactionHash": "0x" + "01" * 32}]},
            {**original, "logs": [{**original["logs"][0], "blockHash": "0x" + "02" * 32}]},
            {**original, "logs": [{**original["logs"][0], "blockNumber": 13}]},
            {**original, "logs": [{**original["logs"][0], "removed": True}]},
            {**original, "logs": []},
            {**original, "logs": original["logs"] * 2},
            execution_receipt(attempt, self.record.function_args, changes={"paymentAmount": 1501}),
            execution_receipt(attempt, self.record.function_args, changes={"orderHash": "0x" + "00" * 32}),
        ]
        for mined in bad:
            with self.subTest(receipt=mined):
                self.node.receipts[attempt.tx_hash] = mined
                self.assertIsNone(self.recover())
                with use_operator():
                    self.assertEqual(OutgoingOperation.objects.get(pk=attempt.operation_id).status, "signed")
                self.assert_held()
        self.assertEqual(len(self.node.broadcasts), 1)
        self.node.mine(attempt.tx_hash, original)
        self.assertEqual(self.recover(), "confirmed")

    def test_receipt_projection_gap_recovers_without_rpc_or_financial_release(self):
        self.admit()
        with patch.object(swap_execution, "_project", side_effect=SystemExit), self.assertRaises(SystemExit):
            self.recover()
        with use_operator():
            self.record.refresh_from_db()
            self.assertEqual(self.record.status, "submitted")
            self.assertEqual(self.record.outgoing_operation.status, "confirmed")
        self.node.probe = lambda label: self.fail(f"Retained receipt performed RPC: {label}")
        self.assertEqual(self.recover(), "confirmed")
        self.assert_held()

    def test_signed_commit_acknowledgement_loss_does_not_fail_or_sign_again(self):
        self.admit()
        sign = outgoing.sign_operation

        def signed_then_disconnect(*args, **kwargs):
            sign(*args, **kwargs)
            raise ConnectionError("Synthetic signed acknowledgement loss")

        with patch.object(outgoing, "sign_operation", signed_then_disconnect):
            self.assertEqual(self.recover(), "confirmed")
        with use_operator():
            self.assertEqual(self.attempts().count(), 1)
            self.assertEqual(SigningAccount.objects.get(pk=self.signer.pk).next_nonce, 8)
        self.assert_held()

    def test_signed_callback_failure_rolls_back_attempt_nonce_and_hash_projection(self):
        self.admit()
        with patch.object(swap_execution, "_signed", side_effect=DatabaseError("Synthetic association failure")):
            self.assertEqual(self.recover(), "failed")
        with use_operator():
            self.assertFalse(self.attempts().exists())
            self.assertEqual(SigningAccount.objects.get(pk=self.signer.pk).next_nonce, 0)
            self.record.refresh_from_db()
            self.swap.refresh_from_db()
            self.assertFalse(self.record.tx_hash)
            self.assertFalse(self.swap.tx_hash)
            self.assertEqual(self.record.status, "failed")
            self.assertEqual(self.swap.status, "failed")
        self.assertEqual(self.node.broadcasts, [])
        self.assertEqual(self.recover(), "failed")

    def test_authority_is_rechecked_after_the_broadcast_endpoint_call(self):
        self.admit()
        self.node.confirmed = False
        self.assertEqual(self.recover(), "signed")

        def retire_wallet():
            Wallet.objects.filter(pk=self.swap.buyer_wallet_id).update(verification_status="PENDING")
            return CHAIN_ID

        self.node.client.assert_expected_chain.side_effect = retire_wallet
        self.assertEqual(self.recover(), "signed")
        self.assertEqual(len(self.node.broadcasts), 1)
        self.assert_held()

    def assert_locks_available(self):
        observer = connections[current_alias()].copy(alias="swap-execution-observer")
        try:
            with observer.cursor() as cursor:
                for model in (
                    OutgoingOperation,
                    SigningAccount,
                    Wallet,
                    UserAccount,
                    UserProfile,
                    get_user_model(),
                    TransferOrder,
                    SwapOrder,
                    BlockchainTransaction,
                ):
                    cursor.execute(f"SELECT {model._meta.pk.column} FROM {model._meta.db_table} FOR UPDATE NOWAIT")
                    cursor.fetchall()
        finally:
            observer.close()

    def test_rpc_boundaries_release_every_operation_authority_and_order_lock(self):
        self.admit()
        calls = []

        def probe(label):
            self.assertTrue(connections[current_alias()].get_autocommit())
            self.assert_locks_available()
            calls.append(label)

        self.node.probe = probe
        self.assertEqual(self.recover(), "confirmed")
        self.assertTrue({"chain_id", "expected_chain", "nonce", "estimate", "receipt", "send"} <= set(calls))

    def test_lock_probe_refuses_a_real_lock_and_recovery_refuses_nested_transactions(self):
        self.admit()
        with use_operator(), atomic():
            SwapOrder.objects.select_for_update().get(pk=self.swap.pk)
            with self.assertRaises(DatabaseError):
                self.assert_locks_available()
            with self.assertRaises(SwapNotReadyException):
                swap_execution.recover(self.record.pk, client=self.node.client)
        with use_operator():
            self.assert_locks_available()
            self.assertFalse(self.attempts().exists())
        self.assertEqual(self.recover(), "confirmed")

    def test_periodic_recovery_picks_up_an_admitted_hashless_command(self):
        self.admit()
        with use_operator():
            BlockchainTransaction.objects.filter(pk=self.record.pk).update(
                updated_at=self.record.updated_at - timedelta(hours=1)
            )
        with patch.object(swap_execution, "get_base_chain_client", return_value=self.node.client):
            self.assertEqual(resolve_executing_swaps(), {"checked": 1, "resolved": 1})
        self.assert_held()


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, ATOMIC_SWAP_ADDRESS=CONTRACT)
class SwapExecutionProcessTest(APITransactionTestCase):
    def setUp(self):
        self.enterContext(patch.object(swap_execution, "publish_trading_event"))
        self.fixture = make_execution("process")
        self.signer = admitted_signer()
        self.swap = self.fixture.swap
        self.seller_actor = self.fixture.seller.user
        self.buyer_actor = self.fixture.buyer.user
        with acting_for(self.seller_actor.pk):
            swap_execution.submit_signature(
                self.swap,
                self.fixture.signatures["seller"],
                SELLER.address,
                user=self.seller_actor,
                participant="seller",
            )
        with acting_for(self.buyer_actor.pk):
            swap_execution.submit_signature(
                self.swap,
                self.fixture.signatures["buyer"],
                BUYER.address,
                user=self.buyer_actor,
                participant="buyer",
            )
        self.swap.refresh_from_db()
        self.record = self.swap.transaction
        self.parents = list(
            TransferOrder.objects.filter(pk__in=[row.pk for row in self.fixture.orders]).order_by("pk").values()
        )

    def worker(self, directory, phase, admission=None):
        env = os.environ.copy()
        env["SWAP_EXECUTION_TEST_DATABASES"] = json.dumps(worker_databases(), default=str)
        env["SWAP_EXECUTION_TEST_PRIVATE_MEDIA_ROOT"] = str(settings.PRIVATE_MEDIA_ROOT)
        if admission is not None:
            env["SWAP_EXECUTION_TEST_ADMISSION"] = json.dumps(admission)
        return subprocess.Popen(
            [sys.executable, "-m", "tokens.tests.swap_execution_worker", str(directory), phase, str(self.record.pk)],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def recover_killed(self, phase, signed):
        with tempfile.TemporaryDirectory(prefix="swap-execution-crash-") as temporary:
            directory = Path(temporary)
            code, out, err = finish(self.worker(directory, phase))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            original = SignedAttempt.objects.filter(
                operation__operation_key=swap_execution.operation_key(self.record)
            ).first()
            self.assertEqual(original is not None, signed)
            code, out, err = finish(self.worker(directory, "recover"))
            self.assertEqual(code, 0, out + err)
            result = json.loads(out)
            self.assertEqual(result["status"], "confirmed")
            self.assertEqual(result["private_media_root"], str(settings.PRIVATE_MEDIA_ROOT))
            self.record.refresh_from_db()
            self.swap.refresh_from_db()
            attempt = SignedAttempt.objects.get(operation_id=self.record.outgoing_operation_id)
            if original:
                self.assertEqual(
                    (attempt.tx_hash, bytes(attempt.raw_transaction), attempt.nonce),
                    (original.tx_hash, bytes(original.raw_transaction), original.nonce),
                )
            self.assertEqual(self.swap.tx_hash, attempt.tx_hash)
            self.assertEqual(self.record.tx_hash, attempt.tx_hash)
            self.assertEqual(self.swap.status, "executing")
            self.assertEqual(SigningAccount.objects.get(pk=self.signer.pk).next_nonce, 8)
            self.assertEqual(
                list(
                    TransferOrder.objects.filter(pk__in=[row.pk for row in self.fixture.orders]).order_by("pk").values()
                ),
                self.parents,
            )
            ledger = json.loads((directory / "node.json").read_text())
            self.assertEqual(ledger["hashes"], [attempt.tx_hash])
            self.assertEqual(len(ledger["broadcasts"]), 1)

    def test_kill_after_open_before_binding_recovers_original_operation(self):
        self.recover_killed("opened", False)

    def test_kill_before_signed_commit_rolls_back_bytes_nonce_and_hashes(self):
        self.recover_killed("before_commit", False)

    def test_kill_after_signed_commit_recovers_original_bytes(self):
        self.recover_killed("signed", True)

    def test_kill_after_provider_acceptance_observes_original_receipt(self):
        self.recover_killed("accepted", True)

    def test_kill_after_receipt_retention_projects_without_sending_again(self):
        self.recover_killed("receipt", True)

    def test_kill_after_admission_preserves_both_signature_and_durable_job(self):
        fixture = make_execution("admission-process")
        seller_actor = fixture.seller.user
        buyer_actor = fixture.buyer.user
        with acting_for(seller_actor.pk):
            swap_execution.submit_signature(
                fixture.swap, fixture.signatures["seller"], SELLER.address, user=seller_actor, participant="seller"
            )
        admission = {
            "swap_uuid": str(fixture.swap.pk),
            "actor_id": buyer_actor.pk,
            "signature": fixture.signatures["buyer"],
        }
        with tempfile.TemporaryDirectory(prefix="swap-execution-admission-") as temporary:
            code, out, err = finish(self.worker(Path(temporary), "admission", admission))
        self.assertEqual(code, -signal.SIGKILL, out + err)
        observed = json.loads(out)
        self.assertEqual(observed["private_media_root"], str(settings.PRIVATE_MEDIA_ROOT))
        self.assertEqual(observed["database"], connections["default"].settings_dict["NAME"])
        self.assertEqual(observed["role"], settings.RLS_ROLES["app"])
        self.assertEqual(observed["principal"], str(buyer_actor.pk))
        fixture.swap.refresh_from_db()
        self.assertEqual(fixture.swap.status, "executing")
        self.assertEqual(fixture.swap.buyer_signature, fixture.signatures["buyer"])
        original = fixture.swap.transaction_id
        self.assertIsNotNone(original)
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT count(*) FROM procrastinate_jobs WHERE task_name=%s AND args->>'transaction_id'=%s",
                ["tokens.tasks.swap_reconciler.recover_swap_execution", str(original)],
            )
            self.assertEqual(cursor.fetchone()[0], 1)
        node = ExecutionNode(fixture.swap.transaction.function_args)
        self.assertEqual(swap_execution.recover(original, client=node.client), "confirmed")
        fixture.swap.refresh_from_db()
        self.assertEqual(fixture.swap.transaction_id, original)
        self.assertEqual(fixture.swap.status, "executing")

    def test_delayed_open_after_peer_confirmation_reuses_its_attempt_and_nonce(self):
        with tempfile.TemporaryDirectory(prefix="swap-execution-open-race-") as temporary:
            directory = Path(temporary)
            workers = [self.worker(directory, phase) for phase in ("race-winner", "race-delayed")]
            try:
                until = time.monotonic() + 20
                while len(list(directory.glob("ready-*"))) != 2 and time.monotonic() < until:
                    time.sleep(0.01)
                self.assertEqual(len(list(directory.glob("ready-*"))), 2)
                (directory / "go").touch()
                for worker in workers:
                    code, out, err = finish(worker)
                    self.assertEqual(code, 0, out + err)
                    result = json.loads(out)
                    self.assertEqual(result["status"], "confirmed")
                    self.assertEqual(result["private_media_root"], str(settings.PRIVATE_MEDIA_ROOT))
                self.record.refresh_from_db()
                attempt = SignedAttempt.objects.get(operation_id=self.record.outgoing_operation_id)
                self.assertEqual(SigningAccount.objects.get(pk=self.signer.pk).next_nonce, 8)
                ledger = json.loads((directory / "node.json").read_text())
                self.assertEqual(ledger["hashes"], [attempt.tx_hash])
                self.assertEqual(len(ledger["broadcasts"]), 1)
            finally:
                for worker in workers:
                    if worker.poll() is None:
                        worker.kill()
                        worker.communicate()
