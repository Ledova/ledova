from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import timedelta
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError, connections
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient, APITransactionTestCase
from web3 import Web3

from feature_flags.models import FeatureFlag
from shared.db import (
    atomic,
    current_alias,
    reset_principal,
    set_principal,
    use_app,
    use_operator,
)
from shared.db.principal import give_the_role_back, take_the_app_role
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.constants import SWAP_APPROVAL_RECEIPT_WAIT_SECONDS
from tokens.models import SwapApprovalSubmission, SwapOrder, SwapOrderStatus
from tokens.services import approval_submissions, atomic_swap_service
from tokens.services.settlement_context import recorded_settlement_context
from tokens.services.signed_transactions import decode_signed_transaction
from tokens.tasks.approval_submissions import recover_swap_approval_submissions
from tokens.tests.swap_approval_submission_fixtures import approval_bytes, approval_node
from tokens.tests.swap_state_fixtures import (
    BUYER,
    CONFIRMED,
    CONTRACT,
    SELLER,
    TX_HASH,
    make_swap,
    persisted_outcome,
)
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT)
class SwapApprovalSubmissionTest(APITransactionTestCase):
    def setUp(self):
        with use_operator():
            FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
            self.swap = make_swap("approval-journal")
            Wallet.objects.filter(pk__in=[self.swap.seller_wallet_id, self.swap.buyer_wallet_id]).update(
                verification_status=WALLET_VERIFICATION_STATUS_VERIFIED
            )
            self.user = self.swap.sell_order.owner_account.user_profile.user
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.identity = {
            "swap_uuid": str(self.swap.pk),
            "owner_account_uuid": str(self.swap.sell_order.owner_account_id),
            "wallet_uuid": str(self.swap.seller_wallet_id),
            "settlement_digest": self.swap.settlement_digest,
        }
        self.url = f"/api/v1/trading/orders/{self.swap.sell_order_id}/swap"
        self.node = approval_node(self)

    def broadcast(self, raw, client=None):
        return (client or self.client).post(
            self.url + "/approval-broadcast/", {**self.identity, "signed_transaction": raw.hex()}, format="json"
        )

    def rows(self):
        with use_operator():
            return list(SwapApprovalSubmission.objects.order_by("created_at"))

    def row(self):
        rows = self.rows()
        self.assertEqual(len(rows), 1)
        return rows[0]

    def sweep(self):
        return recover_swap_approval_submissions(0)

    @contextmanager
    def clock(self, **advance):
        with patch("django.utils.timezone.now", return_value=timezone.now() + timedelta(**advance)):
            yield

    @contextmanager
    def app_role(self):
        with use_app():
            take_the_app_role()
            set_principal(self.user.pk)
            try:
                yield
            finally:
                give_the_role_back()
                reset_principal()

    def submission_fields(self, raw, **overrides):
        context = recorded_settlement_context(self.swap)
        return {
            "swap": self.swap,
            "participant": "seller",
            "owner_account_id": context["seller"]["owner_account_uuid"],
            "wallet_id": context["seller"]["wallet_uuid"],
            "actor_id": self.user.pk,
            "settlement_digest": self.swap.settlement_digest,
            **approval_submissions.party_terms(context, "seller"),
            "nonce": 9,
            "tx_hash": Web3.keccak(raw).to_0x_hex(),
            "raw_transaction": raw,
            "intent": approval_submissions._intent(decode_signed_transaction(raw)),
            **overrides,
        }

    def test_first_broadcast_records_before_sending_and_confirms_from_the_receipt(self):
        raw = approval_bytes(self.swap)
        expected_hash = Web3.keccak(raw).to_0x_hex()
        response = self.broadcast(raw)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            (response.json()["txHash"], response.json()["blockNumber"], response.json()["gasUsed"]),
            (expected_hash, CONFIRMED["blockNumber"], CONFIRMED["gasUsed"]),
        )
        row = self.row()
        self.assertEqual(
            (row.outcome, row.tx_hash, bytes(row.raw_transaction), row.nonce, row.participant, row.actor_id),
            ("confirmed", expected_hash, raw, 0, "seller", self.user.pk),
        )
        self.assertEqual(
            (row.swap_id, row.owner_account_id, row.wallet_id),
            (self.swap.pk, self.swap.sell_order.owner_account_id, self.swap.seller_wallet_id),
        )
        self.assertEqual(
            (row.chain_id, row.sender_address, row.token_address, row.spender_address, row.settlement_digest),
            (
                int(self.swap.settlement_context["typed_data"]["domain"]["chainId"]),
                SELLER.address.lower(),
                self.swap.settlement_context["share_token"]["address"].lower(),
                CONTRACT.lower(),
                self.swap.settlement_digest,
            ),
        )
        self.assertEqual(
            (row.block_number, row.block_hash, row.gas_used),
            (CONFIRMED["blockNumber"], CONFIRMED["blockHash"], CONFIRMED["gasUsed"]),
        )
        self.assertTrue(row.acknowledged_at and row.confirmed_at and row.last_attempt_at)
        self.assertEqual(row.intent["data"], "0x" + approval_submissions.approve_calldata(CONTRACT).hex())
        self.assertEqual(self.node.broadcasts, [raw])
        self.node.client.receipt_even_if_reverted.assert_called_once_with(
            expected_hash, timeout=SWAP_APPROVAL_RECEIPT_WAIT_SECONDS
        )
        with use_operator():
            self.assertEqual((persisted_outcome(self.swap)[0]["tx_hash"], self.swap.transaction_id), ("", None))

    def test_a_recorded_receipt_answers_a_replay_without_any_rpc(self):
        raw = approval_bytes(self.swap)
        self.assertEqual(self.broadcast(raw).status_code, 200)
        client = self.node.client
        for method in (
            client.send_raw_transaction,
            client.get_transaction_receipt,
            client.receipt_even_if_reverted,
            client.w3.eth.get_transaction_count,
        ):
            method.side_effect = AssertionError("A recorded receipt needs no RPC")
        replay = self.broadcast(raw)
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertEqual(replay.json()["txHash"], Web3.keccak(raw).to_0x_hex())
        self.assertEqual((len(self.rows()), self.node.broadcasts), (1, [raw]))

    def test_uncertain_delivery_records_the_row_and_answers_503_with_the_computed_hash(self):
        def lost(node):
            node.confirm = False
            node.lose_acknowledgement = True

        def foreign(node):
            node.confirm = False
            node.client.send_raw_transaction.side_effect = lambda raw: node.send(raw) and TX_HASH

        def unmined(node):
            node.confirm = False

        def reverted(node):
            node.status = 0

        def misattributed(node):
            node.confirm = False
            node.client.receipt_even_if_reverted.side_effect = lambda tx_hash, timeout: {
                **CONFIRMED,
                "transactionHash": TX_HASH,
            }

        def superseded(node):
            node.confirm = False
            node.mined_nonce = 6

        replayed = "the recorded transaction is replayed until its outcome is known"
        variants = (
            ("lost acknowledgement", lost, ("pending", False, "BaseChainTransactionError"), 1, replayed),
            ("foreign acknowledgement", foreign, ("pending", False, "BaseChainTransactionError"), 1, replayed),
            ("no receipt within the wait", unmined, ("pending", True, "BaseChainTransactionError"), 1, replayed),
            ("reverted receipt", reverted, ("reverted", True, ""), 1, "reverted on chain and took no effect"),
            ("receipt for another hash", misattributed, ("pending", True, ""), 1, replayed),
            ("superseded nonce", superseded, ("superseded", False, ""), 0, "superseded at its nonce"),
        )
        for nonce, (label, arrange, expected, sent, detail) in enumerate(variants):
            with self.subTest(label):
                node = approval_node(self)
                arrange(node)
                raw = approval_bytes(self.swap, nonce=nonce)
                expected_hash = Web3.keccak(raw).to_0x_hex()
                response = self.broadcast(raw)
                self.assertEqual(response.status_code, 503, response.content)
                body = response.json()
                self.assertEqual(
                    (body["code"], body["txHash"], body["swapUuid"], body["settlementDigest"]),
                    ("swap_approval_unconfirmed", expected_hash, str(self.swap.pk), self.swap.settlement_digest),
                )
                self.assertIn(detail, body["detail"])
                self.assertNotIn("Synthetic", response.content.decode())
                self.assertNotIn("blockNumber", body)
                row = self.rows()[-1]
                self.assertEqual(
                    (row.tx_hash, row.outcome, row.acknowledged_at is not None, row.last_error),
                    (expected_hash, *expected),
                )
                self.assertEqual(node.broadcasts, [raw] * sent)
        with use_operator():
            self.assertEqual((persisted_outcome(self.swap)[0]["tx_hash"], self.swap.transaction_id), ("", None))

    def test_an_unmatched_acknowledgement_or_failed_send_still_confirms_from_a_matching_receipt(self):
        def foreign(node):
            node.client.send_raw_transaction.side_effect = lambda raw: node.send(raw) and TX_HASH

        def raising(node):
            node.lose_acknowledgement = True

        for nonce, (label, arrange) in enumerate((("foreign acknowledgement", foreign), ("send raised", raising))):
            with self.subTest(label):
                node = approval_node(self)
                arrange(node)
                raw = approval_bytes(self.swap, nonce=nonce)
                response = self.broadcast(raw)
                self.assertEqual(response.status_code, 200, response.content)
                row = self.rows()[-1]
                self.assertEqual((row.outcome, row.acknowledged_at), ("confirmed", None))
                self.assertEqual(node.broadcasts, [raw])

    def test_different_bytes_at_a_recorded_nonce_are_refused_without_a_send(self):
        first = approval_bytes(self.swap, nonce=3)
        self.node.confirm = False
        self.assertEqual(self.broadcast(first).status_code, 503)
        refused = self.broadcast(approval_bytes(self.swap, nonce=3, gasPrice=2))
        self.assertEqual(refused.status_code, 409, refused.content)
        self.assertEqual(refused.json()["code"], "swap_approval_conflict")
        self.assertEqual(self.node.broadcasts, [first])
        self.assertEqual([row.tx_hash for row in self.rows()], [Web3.keccak(first).to_0x_hex()])

    def test_a_nonce_beyond_the_recorded_bound_is_refused_and_the_bound_itself_is_recorded(self):
        beyond = approval_bytes(self.swap, nonce=approval_submissions.MAX_RECORDED_NONCE + 1)
        refused = self.broadcast(beyond)
        self.assertEqual(refused.status_code, 409, refused.content)
        self.assertEqual(refused.json()["code"], "swap_settlement_context_changed")
        self.assertEqual((self.rows(), self.node.broadcasts), ([], []))
        admitted = self.broadcast(approval_bytes(self.swap, nonce=approval_submissions.MAX_RECORDED_NONCE))
        self.assertEqual(admitted.status_code, 200, admitted.content)
        self.assertEqual(self.row().nonce, approval_submissions.MAX_RECORDED_NONCE)

    def test_approval_data_refuses_while_pending_and_permits_after_each_definite_outcome(self):
        self.enterContext(patch.object(atomic_swap_service, "check_allowance", lambda *_args: 0))
        self.node.client.build_transaction.return_value = {"data": "0x1234", "gas": 50000, "gasPrice": 1, "nonce": 0}

        def confirm(tx_hash):
            self.node.mine(tx_hash)

        def revert(tx_hash):
            self.node.status = 0
            self.node.mine(tx_hash)

        def supersede(tx_hash):
            self.node.mined_nonce = 3

        for nonce, (outcome, resolve) in enumerate(
            (("confirmed", confirm), ("reverted", revert), ("superseded", supersede))
        ):
            with self.subTest(outcome=outcome):
                self.node.confirm = False
                raw = approval_bytes(self.swap, nonce=nonce)
                self.assertEqual(self.broadcast(raw).status_code, 503)
                refused = self.client.get(self.url + "/approval-data/", self.identity)
                self.assertEqual(refused.status_code, 409, refused.content)
                self.assertEqual(refused.json()["code"], "swap_approval_pending")
                self.node.client.build_transaction.assert_not_called()
                resolve(Web3.keccak(raw).to_0x_hex())
                self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {outcome: 1}})
                self.assertEqual(self.rows()[-1].outcome, outcome)
                permitted = self.client.get(self.url + "/approval-data/", self.identity)
                self.assertEqual(permitted.status_code, 200, permitted.content)
                self.assertTrue(permitted.json()["needsApproval"])
                self.node.client.build_transaction.reset_mock()

    def test_a_lost_acknowledgement_is_recovered_by_the_sweep_without_a_resend(self):
        raw = approval_bytes(self.swap)
        self.node.confirm = False
        self.node.lose_acknowledgement = True
        self.assertEqual(self.broadcast(raw).status_code, 503)
        row = self.row()
        self.assertEqual((row.outcome, row.acknowledged_at, self.node.broadcasts), ("pending", None, [raw]))
        self.node.mine(row.tx_hash)
        self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {"confirmed": 1}})
        row = self.row()
        self.assertEqual((row.outcome, row.block_number, self.node.broadcasts), ("confirmed", 7, [raw]))
        self.assertEqual(self.sweep(), {"attempted": 0, "outcomes": {}})

    def test_the_sweep_resends_exact_bytes_only_while_the_swap_is_pending_and_its_deadline_live(self):
        raw = approval_bytes(self.swap)
        self.node.confirm = False
        self.assertEqual(self.broadcast(raw).status_code, 503)
        self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {"observing": 1}})
        self.assertEqual(self.node.broadcasts, [raw])
        with self.clock(minutes=2):
            self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {"acknowledged": 1}})
        self.assertEqual(self.node.broadcasts, [raw, raw])
        with self.clock(hours=1):
            self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {"held": 1}})
            self.assertEqual(len(self.node.broadcasts), 2)
            self.node.mine(Web3.keccak(raw).to_0x_hex())
            self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {"confirmed": 1}})
        self.assertEqual((self.row().outcome, len(self.node.broadcasts)), ("confirmed", 2))

    def test_context_drift_or_a_swap_that_moved_on_stops_resends_but_not_observation(self):
        raw = approval_bytes(self.swap)
        self.node.confirm = False
        self.assertEqual(self.broadcast(raw).status_code, 503)
        with self.clock(minutes=2), override_settings(ATOMIC_SWAP_ADDRESS="0x" + "ab" * 20):
            self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {"held": 1}})
        with use_operator():
            SwapOrder.objects.filter(pk=self.swap.pk).update(status=SwapOrderStatus.EXPIRED)
        with self.clock(minutes=4):
            self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {"held": 1}})
            self.node.mine(Web3.keccak(raw).to_0x_hex())
            self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {"confirmed": 1}})
        self.assertEqual((self.row().outcome, self.node.broadcasts), ("confirmed", [raw]))

    def test_recorded_bytes_that_disagree_with_the_recorded_row_are_never_sent(self):
        context = recorded_settlement_context(self.swap)
        spender = context["typed_data"]["domain"]["verifyingContract"]
        chain = int(context["typed_data"]["domain"]["chainId"])
        elsewhere = Web3.to_checksum_address("0x" + "cd" * 20)
        no_allowance = "0x095ea7b3" + spender[2:].rjust(64, "0") + "0" * 64
        intent = self.submission_fields(approval_bytes(self.swap, nonce=1))["intent"]
        variants = (
            ("sender", approval_bytes(self.swap, key=BUYER, nonce=2), 2),
            ("nonce", approval_bytes(self.swap, nonce=99), 3),
            ("chain", approval_bytes(self.swap, nonce=4, chainId=chain + 1), 4),
            ("target", approval_bytes(self.swap, nonce=5, to=elsewhere), 5),
            ("value", approval_bytes(self.swap, nonce=6, value=1), 6),
            ("calldata", approval_bytes(self.swap, nonce=7, data=no_allowance), 7),
        )
        for label, raw, nonce in variants:
            with self.subTest(label):
                fields = self.submission_fields(raw, nonce=nonce, intent=intent)
                with use_operator():
                    row = SwapApprovalSubmission.objects.create(**fields)
                    outcome = approval_submissions.attempt(row.pk, client=self.node.client)
                self.assertEqual((outcome, self.node.broadcasts), ("identity_unavailable", []))
        self.assertEqual([row.outcome for row in self.rows()], ["pending"] * len(variants))

    def test_an_endpoint_reporting_another_chain_is_neither_read_nor_resent(self):
        raw = approval_bytes(self.swap)
        self.node.confirm = False
        self.assertEqual(self.broadcast(raw).status_code, 503)
        recorded_chain = self.row().chain_id
        self.node.client.w3.eth.chain_id = recorded_chain + 1
        self.node.client.get_transaction_receipt.reset_mock()
        with self.clock(minutes=2):
            self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {"chain_unavailable": 1}})
        self.node.client.get_transaction_receipt.assert_not_called()
        self.assertEqual((self.row().outcome, self.node.broadcasts), ("pending", [raw]))
        self.node.client.w3.eth.chain_id = recorded_chain
        self.node.mine(Web3.keccak(raw).to_0x_hex())
        with self.clock(minutes=4):
            self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {"confirmed": 1}})
        self.assertEqual((self.row().outcome, self.node.broadcasts), ("confirmed", [raw]))

    def test_a_mined_nonce_past_the_recorded_nonce_without_a_receipt_supersedes(self):
        raw = approval_bytes(self.swap, nonce=5)
        self.node.confirm = False
        self.assertEqual(self.broadcast(raw).status_code, 503)
        self.node.mined_nonce = 5
        with self.clock(minutes=2):
            self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {"acknowledged": 1}})
        self.node.mined_nonce = 6
        self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {"superseded": 1}})
        row = self.row()
        self.assertEqual(
            (row.outcome, row.block_number, row.confirmed_at, len(self.node.broadcasts)), ("superseded", None, None, 2)
        )
        other = approval_bytes(self.swap, nonce=7)
        self.assertEqual(self.broadcast(other).status_code, 503)
        self.node.mined_nonce = 9
        self.node.mine(Web3.keccak(other).to_0x_hex())
        self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {"confirmed": 1}})
        self.assertEqual([row.outcome for row in self.rows()], ["superseded", "confirmed"])

    def assert_the_sweep_advances_past_unavailable_evidence(self, failure, outcome):
        first_raw = approval_bytes(self.swap, nonce=99 if failure == "identity" else 0)
        second_raw = approval_bytes(self.swap, nonce=1)
        with use_operator():
            first = SwapApprovalSubmission.objects.create(**self.submission_fields(first_raw, nonce=0))
            second = SwapApprovalSubmission.objects.create(**self.submission_fields(second_raw, nonce=1))
        self.node.mine(second.tx_hash)
        factories = 0

        def node():
            nonlocal factories
            factories += 1
            if factories == 1:
                if failure == "client":
                    raise ConnectionError("Synthetic client unavailable")
                if failure == "chain":
                    return SimpleNamespace(w3=SimpleNamespace(eth=SimpleNamespace(chain_id=first.chain_id + 1)))
            return self.node.client

        def receipt(tx_hash):
            if tx_hash == first.tx_hash:
                if failure == "receipt":
                    raise ConnectionError("Synthetic receipt unavailable")
                if failure == "malformed":
                    return {**CONFIRMED, "transactionHash": TX_HASH}
                raise AssertionError("Unattributed approvals must not reach receipt reads")
            return self.node.receipts.get(tx_hash)

        with (
            patch("tokens.tasks.approval_submissions.SWAP_APPROVAL_RECOVERY_BATCH", 1),
            patch("tokens.services.approval_submissions.get_base_chain_client", side_effect=node),
            patch.object(self.node.client, "get_transaction_receipt", side_effect=receipt),
        ):
            self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {outcome: 1}})
            self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {"confirmed": 1}})
        with use_operator():
            first.refresh_from_db()
            second.refresh_from_db()
        self.assertEqual((first.outcome, second.outcome), ("pending", "confirmed"))
        self.assertEqual((first.last_attempt_at, second.last_attempt_at), (None, None))
        self.assertEqual(bytes(first.raw_transaction), first_raw)
        self.assertEqual(self.node.broadcasts, [])

    def test_receipt_read_failure_does_not_starve_later_approvals(self):
        self.assert_the_sweep_advances_past_unavailable_evidence("receipt", "delivery_unavailable")

    def test_chain_mismatch_does_not_starve_later_approvals(self):
        self.assert_the_sweep_advances_past_unavailable_evidence("chain", "chain_unavailable")

    def test_identity_mismatch_does_not_starve_later_approvals(self):
        self.assert_the_sweep_advances_past_unavailable_evidence("identity", "identity_unavailable")

    def test_malformed_receipt_does_not_starve_later_approvals(self):
        self.assert_the_sweep_advances_past_unavailable_evidence("malformed", "receipt_identity_unavailable")

    def test_client_initialization_failure_does_not_abort_recovery_of_later_approvals(self):
        self.assert_the_sweep_advances_past_unavailable_evidence("client", "delivery_unavailable")

    def test_receipt_failure_does_not_postpone_an_eligible_resend(self):
        raw = approval_bytes(self.swap)
        self.node.confirm = False
        self.assertEqual(self.broadcast(raw).status_code, 503)
        last_send = self.row().last_attempt_at
        with self.clock(minutes=2):
            with patch.object(self.node.client, "get_transaction_receipt", side_effect=ConnectionError("Synthetic")):
                self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {"delivery_unavailable": 1}})
            self.assertEqual(self.row().last_attempt_at, last_send)
            self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {"acknowledged": 1}})
            self.assertEqual(self.sweep(), {"attempted": 1, "outcomes": {"observing": 1}})
        self.assertEqual(self.node.broadcasts, [raw, raw])

    def test_the_sweep_is_bounded_and_attempts_the_least_recently_updated_first(self):
        unattempted = approval_bytes(self.swap, nonce=0)
        with use_operator():
            never = approval_submissions.record(
                self.swap, "seller", unattempted, decode_signed_transaction(unattempted), self.user.pk
            )
        self.node.confirm = False
        self.assertEqual(self.broadcast(approval_bytes(self.swap, nonce=1)).status_code, 503)
        self.assertEqual(self.broadcast(approval_bytes(self.swap, nonce=2)).status_code, 503)
        earliest = self.rows()[1]
        self.assertEqual((never.last_attempt_at, earliest.nonce), (None, 1))
        with (
            patch("tokens.tasks.approval_submissions.SWAP_APPROVAL_RECOVERY_BATCH", 2),
            patch("tokens.tasks.approval_submissions.attempt", return_value="observing") as attempted,
        ):
            self.assertEqual(self.sweep(), {"attempted": 2, "outcomes": {"observing": 2}})
        self.assertEqual([call.args[0] for call in attempted.call_args_list], [never.pk, earliest.pk])

    def test_two_connections_posting_the_same_bytes_share_one_row_and_one_send(self):
        raw = approval_bytes(self.swap)
        self.node.patient = True
        gate = Barrier(2)

        def post():
            try:
                client = APIClient()
                client.force_authenticate(self.user)
                set_principal(self.user.pk, current_alias())
                gate.wait(timeout=10)
                return self.broadcast(raw, client)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            responses = [future.result(timeout=30) for future in (pool.submit(post), pool.submit(post))]
        self.assertEqual([response.status_code for response in responses], [200, 200], [r.content for r in responses])
        self.assertEqual({response.json()["txHash"] for response in responses}, {Web3.keccak(raw).to_0x_hex()})
        self.assertEqual((len(self.rows()), self.node.broadcasts), (1, [raw]))

    def test_database_guards_freeze_identity_write_the_outcome_once_and_admit_only_pending_swaps(self):
        raw = approval_bytes(self.swap)
        self.assertEqual(self.broadcast(raw).status_code, 200)
        confirmed = self.row()
        self.node.confirm = False
        self.assertEqual(self.broadcast(approval_bytes(self.swap, nonce=1)).status_code, 503)
        pending = self.rows()[1]
        table = "tokens_swapapprovalsubmission"
        with use_operator():
            for statement, parameters, message in (
                (f"UPDATE {table} SET raw_transaction = %s WHERE uuid = %s", [b"changed", confirmed.pk], "identity"),
                (f"UPDATE {table} SET nonce = nonce + 1 WHERE uuid = %s", [confirmed.pk], "identity"),
                (f"UPDATE {table} SET outcome = 'reverted' WHERE uuid = %s", [confirmed.pk], "written once"),
                (f"UPDATE {table} SET block_number = block_number + 1 WHERE uuid = %s", [confirmed.pk], "written once"),
                (f"UPDATE {table} SET acknowledged_at = NULL WHERE uuid = %s", [confirmed.pk], "acknowledgement"),
                (
                    f"UPDATE {table} SET last_attempt_at = last_attempt_at - interval '1 minute' WHERE uuid = %s",
                    [confirmed.pk],
                    "rewound",
                ),
                (f"UPDATE {table} SET block_number = 1 WHERE uuid = %s", [pending.pk], "receipt_present"),
                (f"DELETE FROM {table} WHERE uuid = %s", [confirmed.pk], "deleted"),
            ):
                with self.subTest(statement=statement), self.assertRaisesRegex(DatabaseError, message), atomic():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(statement, parameters)
            fresh = approval_bytes(self.swap, nonce=9)
            for changes, message in (
                ({"sender_address": BUYER.address.lower()}, "recorded settlement party"),
                ({"settlement_digest": "0x" + "11" * 32}, "recorded settlement party"),
                ({"spender_address": "0x" + "ab" * 20}, "recorded settlement party"),
                ({"intent": {**self.submission_fields(fresh)["intent"], "value": "1"}}, "recorded settlement party"),
                ({"outcome": "confirmed"}, "recorded settlement party"),
            ):
                with self.subTest(changes=changes), self.assertRaisesRegex(DatabaseError, message), atomic():
                    SwapApprovalSubmission.objects.create(**self.submission_fields(fresh, **changes))
            with self.assertRaisesRegex(DatabaseError, "requires a pending swap"), atomic():
                SwapOrder.objects.filter(pk=self.swap.pk).update(status=SwapOrderStatus.EXPIRED)
                SwapApprovalSubmission.objects.create(**self.submission_fields(fresh))
            SwapApprovalSubmission.objects.create(**self.submission_fields(fresh))
        self.assertEqual([row.outcome for row in self.rows()], ["confirmed", "pending", "pending"])

    def test_the_app_role_cannot_reach_the_journal(self):
        raw = approval_bytes(self.swap)
        self.assertEqual(self.broadcast(raw).status_code, 200)
        with self.app_role(), self.assertRaises(DatabaseError):
            list(SwapApprovalSubmission.objects.all())
        self.assertEqual(self.row().outcome, "confirmed")


class ScopedSwapApprovalSubmissionTest(RunsOnTheScopedConnection, SwapApprovalSubmissionTest):
    def setUp(self):
        super().setUp()
        set_principal(self.user.pk, current_alias())
