from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from psycopg import connect
from psycopg.errors import LockNotAvailable

from assets.models import Asset
from blockchain.models import OutgoingOperation, SignedAttempt, SigningAccount
from blockchain.services import outgoing
from blockchain.tests.outgoing_fixtures import CHAIN_ID, KEY
from shared.db import atomic, current_alias
from tokens.exceptions import NAVUpdateConflict
from tokens.models import NAVUpdate, YieldToken
from tokens.services import nav, nav_recovery
from tokens.tasks.nav import check_pending_nav_updates
from tokens.tests.nav_fixtures import install_nav


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class NAVRecoveryTest(TransactionTestCase):
    def setUp(self):
        install_nav(self)

    def recover(self, update=None):
        return nav_recovery.recover((update or self.update).pk)

    def submit(self, value="1.75", *, chain=True):
        self.token.refresh_from_db()
        return nav.submit(self.token, self.tenant.user, uuid4(), value, "700", update_on_chain=chain)

    def test_verified_original_event_projects_token_asset_and_audit_once_despite_old_local_nav_differing(self):
        update = self.recover()
        self.assertEqual((update.status, update.event["oldNav"]), ("confirmed", "990000"))
        self.assertEqual(update.old_nav_per_token, Decimal("1.02"))
        self.token.refresh_from_db()
        self.asset.refresh_from_db()
        snapshot = self.asset.snapshots.get()
        self.assertEqual((self.token.nav_per_token, self.asset.current_price, snapshot.price), (Decimal("1.25"),) * 3)
        self.assertEqual(self.token.last_nav_update, update.completed_at)
        self.assertEqual(snapshot.data_source, "nav_update")
        self.assertEqual(self.recover().completed_at, update.completed_at)
        self.assertEqual(self.asset.snapshots.get().pk, snapshot.pk)
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(len(self.node.broadcasts), 1)
        self.assertIsNone(update.transaction_id)
        self.node.client.send_transaction.assert_not_called()

    def test_uncertainty_blocks_chain_and_local_changes_and_matching_current_values_are_not_evidence(self):
        self.node.confirmed = False
        self.assertIsNone(self.recover().completed_at)
        attempt = SignedAttempt.objects.get()
        self.node.contract.functions.navPerToken.return_value.call.return_value = 1250000
        self.node.contract.functions.totalReserveValue.return_value.call.return_value = 500000000
        self.assertIsNone(self.recover().completed_at)
        refusals = [self.submit(chain=chain) for chain in (True, False)]
        self.assertEqual(
            [(row.status, row.completed_at is not None, row.operation_id) for row in refusals],
            [("failed", True, None)] * 2,
        )
        self.token.refresh_from_db()
        self.assertEqual(self.token.nav_per_token, Decimal("1.02"))
        self.node.receipts[attempt.tx_hash] = self.node.receipt(attempt)
        self.assertIsNotNone(self.recover().completed_at)
        for row in refusals:
            replay = nav.submit(
                self.token, self.tenant.user, row.pk, "1.75", "700", update_on_chain=row.mode == "chain"
            )
            self.assertEqual((replay.status, replay.completed_at), ("failed", row.completed_at))
        self.assertEqual(self.submit(chain=False).status, "applied")
        self.recover()
        self.token.refresh_from_db()
        self.assertEqual(self.token.nav_per_token, Decimal("1.75"))
        self.assertEqual(self.node.broadcasts, [bytes(attempt.raw_transaction)] * 2)
        self.node.contract.functions.navPerToken.return_value.call.assert_not_called()
        self.assertEqual(SigningAccount.objects.get().next_nonce, attempt.nonce + 1)

    def test_equal_values_still_require_the_original_transaction_event(self):
        self.recover()
        self.assertEqual(self.recover(self.submit("1.25")).status, "confirmed")
        self.assertEqual(SignedAttempt.objects.count(), 2)

    def test_lost_send_response_retains_original_transaction(self):
        self.node.lose_acknowledgement = True
        self.assertEqual(self.recover().status, "confirmed")
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_open_operation_commit_loss_reuses_unbound_operation(self):
        original = outgoing.open_operation

        def commit_then_stop(*args, **kwargs):
            original(*args, **kwargs)
            raise SystemExit

        with patch.object(outgoing, "open_operation", side_effect=commit_then_stop), self.assertRaises(SystemExit):
            self.recover()
        operation = OutgoingOperation.objects.get()
        self.update.refresh_from_db()
        self.assertIsNone(self.update.operation_id)
        self.assertEqual(self.recover().operation_id, operation.pk)
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_signed_commit_loss_recovers_without_a_second_nonce(self):
        original = outgoing.sign_operation

        def commit_then_stop(*args, **kwargs):
            original(*args, **kwargs)
            raise SystemExit

        with patch.object(outgoing, "sign_operation", side_effect=commit_then_stop), self.assertRaises(SystemExit):
            self.recover()
        attempt = SignedAttempt.objects.get()
        self.assertEqual(self.node.broadcasts, [])
        self.assertEqual(self.recover().status, "confirmed")
        self.assertEqual(self.node.broadcasts, [bytes(attempt.raw_transaction)])

    def test_lost_signing_commit_acknowledgement_follows_committed_attempt(self):
        original = outgoing.sign_operation

        def commit_then_disconnect(*args, **kwargs):
            original(*args, **kwargs)
            raise DatabaseError("Synthetic lost signing commit acknowledgement")

        with patch.object(outgoing, "sign_operation", side_effect=commit_then_disconnect):
            self.assertEqual(self.recover().status, "confirmed")
        attempt = SignedAttempt.objects.get()
        self.assertEqual(SigningAccount.objects.get().next_nonce, attempt.nonce + 1)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_failed_signing_guard_rolls_back_nonce_bytes_and_broadcast(self):
        before = SigningAccount.objects.get().next_nonce
        with patch.object(nav_recovery, "_record_signed", side_effect=DatabaseError("Synthetic guard failure")):
            self.assertEqual(self.recover().status, "failed")
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertEqual(SigningAccount.objects.get().next_nonce, before)
        self.assertEqual(self.node.broadcasts, [])

    def test_revert_is_permanent_and_new_deliberate_attempt_requires_a_new_uuid(self):
        self.node.receipt_status = 0
        failed = self.recover()
        self.assertEqual(failed.status, "failed")
        self.assertIsNotNone(failed.completed_at)
        self.node.receipt_status = 1
        self.assertEqual(self.recover(self.submit()).status, "confirmed")
        self.recover()
        self.token.refresh_from_db()
        self.assertEqual(self.token.nav_per_token, Decimal("1.75"))
        self.assertEqual(SignedAttempt.objects.count(), 2)

    def test_failed_outcome_recovers_without_a_provider(self):
        self.node.receipt_status = 0
        with patch.object(nav_recovery, "_record_outcome", side_effect=SystemExit), self.assertRaises(SystemExit):
            self.recover()
        with patch.object(nav_recovery, "get_base_chain_client", side_effect=AssertionError("No RPC for failure")):
            self.assertEqual(self.recover().status, "failed")

    def test_confirmed_unprojected_outcome_reserves_target_and_recovers_without_provider(self):
        with patch.object(nav, "project", side_effect=SystemExit), self.assertRaises(SystemExit):
            self.recover()
        self.update.refresh_from_db()
        self.assertEqual((self.update.status, self.update.completed_at), ("confirmed", None))
        self.assertEqual(self.submit(chain=False).status, "failed")
        with patch.object(nav_recovery, "get_base_chain_client", side_effect=AssertionError("Retained event")):
            self.assertIsNotNone(self.recover().completed_at)

    def test_projection_failure_rolls_back_token_asset_snapshot_and_completion_together(self):
        original = NAVUpdate.save

        def refuse_completion(row, *args, **kwargs):
            if "completed_at" in kwargs.get("update_fields", ()):
                raise DatabaseError("Synthetic completion failure")
            return original(row, *args, **kwargs)

        with patch.object(NAVUpdate, "save", new=refuse_completion), self.assertRaises(DatabaseError):
            self.recover()
        self.token.refresh_from_db()
        self.asset.refresh_from_db()
        self.update.refresh_from_db()
        self.assertEqual(
            (self.token.nav_per_token, self.asset.current_price, self.update.status, self.update.completed_at),
            (Decimal("1.02"), None, "confirmed", None),
        )
        self.assertFalse(self.asset.snapshots.exists())
        self.assertIsNotNone(self.recover().completed_at)
        self.assertEqual(self.asset.snapshots.count(), 1)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_completion_commit_response_loss_does_not_reproject_or_overwrite_a_later_update(self):
        original = nav.project

        def commit_then_stop(*args):
            original(*args)
            raise SystemExit

        with patch.object(nav, "project", side_effect=commit_then_stop), self.assertRaises(SystemExit):
            self.recover()
        self.submit(chain=False)
        self.recover()
        self.token.refresh_from_db()
        self.assertEqual(self.token.nav_per_token, Decimal("1.75"))
        self.assertEqual(self.asset.snapshots.count(), 1)

    def test_missing_or_duplicate_or_wrong_event_cannot_finish_original_transaction(self):
        for count, changes in ((0, {}), (2, {}), (1, {"newNav": 1}), (1, {"reserveValue": 1})):
            with self.subTest(count=count, changes=changes):
                self.node.event_count = count
                self.node.event_changes = changes
                with self.assertRaises(NAVUpdateConflict):
                    self.recover()
                self.update.refresh_from_db()
                self.assertEqual((self.update.status, self.update.completed_at), ("executing", None))
        self.node.event_count, self.node.event_changes = 1, {}
        self.assertIsNotNone(self.recover().completed_at)
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_receipt_identity_mismatch_stays_pending_until_original_evidence_returns(self):
        self.node.confirmed = False
        self.recover()
        attempt = SignedAttempt.objects.get()
        correct = self.node.receipt(attempt)
        self.node.receipts[attempt.tx_hash] = correct | {"to": "0x" + "e" * 40}
        with self.assertRaises(NAVUpdateConflict):
            self.recover()
        self.assertIsNone(NAVUpdate.objects.get(pk=self.update.pk).completed_at)
        self.node.receipts[attempt.tx_hash] = correct
        self.assertIsNotNone(self.recover().completed_at)

    def test_permission_loss_before_decision_refuses_unsigned_without_provider(self):
        get_user_model().objects.filter(pk=self.tenant.user.pk).update(is_staff=False)
        with patch.object(nav_recovery, "get_base_chain_client", side_effect=AssertionError("No provider")):
            self.assertEqual(self.recover().status, "failed")
        self.assertFalse(OutgoingOperation.objects.exists())

    def test_permission_loss_during_estimation_refuses_before_signing(self):
        def estimate(*args, **kwargs):
            get_user_model().objects.filter(pk=self.tenant.user.pk).update(is_staff=False)
            return 60000

        self.node.client.estimate_gas.side_effect = estimate
        self.assertEqual(self.recover().status, "failed")
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertEqual(self.node.broadcasts, [])

    def test_permission_loss_after_signing_preserves_operator_recovery(self):
        self.node.confirmed = False
        self.recover()
        attempt = SignedAttempt.objects.get()
        get_user_model().objects.filter(pk=self.tenant.user.pk).update(is_active=False, is_staff=False)
        self.node.receipts[attempt.tx_hash] = self.node.receipt(attempt)
        self.assertIsNotNone(self.recover().completed_at)
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_deactivated_token_refuses_unsigned_but_signed_outcome_can_still_project(self):
        YieldToken.objects.filter(pk=self.token.pk).update(is_active=False)
        self.assertEqual(self.recover().status, "failed")
        YieldToken.objects.filter(pk=self.token.pk).update(is_active=True)
        update = self.submit()
        self.node.confirmed = False
        self.recover(update)
        attempt = SignedAttempt.objects.get()
        YieldToken.objects.filter(pk=self.token.pk).update(is_active=False)
        self.node.receipts[attempt.tx_hash] = self.node.receipt(attempt)
        self.assertIsNotNone(self.recover(update).completed_at)

    def test_signer_configuration_change_refuses_unsigned_original_intent(self):
        with override_settings(BLOCKCHAIN_OPERATOR_KEY="0x" + "22" * 32):
            self.assertEqual(self.recover().status, "failed")
        self.assertFalse(SignedAttempt.objects.exists())

    def test_provider_role_refusal_leaves_no_nonce_or_broadcast(self):
        self.node.contract.functions.navUpdaters.return_value.call.return_value = False
        self.assertEqual(self.recover().status, "failed")
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertEqual(self.node.broadcasts, [])

    def test_removed_admitted_asset_cannot_be_replaced_by_same_symbol_during_projection(self):
        Asset.objects.filter(pk=self.asset.pk).update(symbol="OLD-NAV")
        replacement = Asset.objects.create(symbol="AUSG", name="Replacement", asset_type="erc20_token")
        with self.assertRaises(NAVUpdateConflict):
            self.recover()
        self.assertIsNone(NAVUpdate.objects.get(pk=self.update.pk).completed_at)
        replacement.refresh_from_db()
        self.assertIsNone(replacement.current_price)
        replacement.delete()
        Asset.objects.filter(pk=self.asset.pk).update(symbol="AUSG")
        self.assertIsNotNone(self.recover().completed_at)

    def test_sweep_bounds_work_and_moves_past_a_failed_provider_without_touching_fresh_or_completed(self):
        older = timezone.now() - timedelta(hours=1)
        NAVUpdate.objects.filter(pk=self.update.pk).update(updated_at=older)
        token = YieldToken.objects.create(name="Sweep NAV", symbol="NAV2", contract_address="0x" + "e" * 40)
        later = nav.submit(token, self.tenant.user, uuid4(), "1", "2", update_on_chain=True)
        NAVUpdate.objects.filter(pk=later.pk).update(updated_at=older + timedelta(minutes=1))
        with patch("tokens.tasks.nav.NAV_RECOVERY_BATCH", 1), patch.object(
            nav_recovery, "get_base_chain_client", side_effect=ConnectionError
        ):
            self.assertEqual(check_pending_nav_updates(), {"checked": 1, "completed": 0})
        with patch("tokens.tasks.nav.NAV_RECOVERY_BATCH", 1), patch.object(
            nav_recovery, "recover", wraps=nav_recovery.recover
        ) as recover:
            check_pending_nav_updates()
            recover.assert_called_once_with(later.pk)
        self.assertEqual(check_pending_nav_updates(), {"checked": 0, "completed": 0})

    def test_original_contract_units_must_match_configuration_before_signing(self):
        self.recover()
        YieldToken.objects.filter(pk=self.token.pk).update(decimals=2)
        second = self.submit("1.25")
        self.assertEqual(self.recover(second).status, "failed")
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_matching_event_plus_conflicting_event_from_original_contract_remains_unresolved(self):
        def conflicting(receipt, **kwargs):
            event = self.node.events(receipt)[0]
            return [event, event | {"args": event["args"] | {"newNav": 1}}]

        self.node.contract.events.NAVUpdated.return_value.process_receipt.side_effect = conflicting
        with self.assertRaises(NAVUpdateConflict):
            self.recover()
        self.assertIsNone(NAVUpdate.objects.get(pk=self.update.pk).completed_at)
        self.node.contract.events.NAVUpdated.return_value.process_receipt.side_effect = self.node.events
        self.assertIsNotNone(self.recover().completed_at)

    def lock_targets(self):
        return (
            ("tokens_navupdate", self.update.pk),
            ("tokens_yieldtoken", self.token.pk),
            ("assets_asset", self.asset.pk),
            ("blockchain_outgoingoperation", OutgoingOperation.objects.get().pk),
            ("blockchain_signingaccount", SigningAccount.objects.get().pk),
        )

    def probe_unlocked_rows(self):
        database = connections[current_alias()].settings_dict
        options = {
            "dbname": database["NAME"],
            "user": database["USER"],
            "password": database["PASSWORD"],
            "host": database["HOST"],
            "port": database["PORT"],
        }
        with connect(**options) as observer:
            with observer.cursor() as cursor:
                for table, row_id in self.lock_targets():
                    cursor.execute(f"SELECT uuid FROM {table} WHERE uuid=%s FOR UPDATE NOWAIT", [row_id])
                    self.assertEqual(len(cursor.fetchall()), 1, table)

    def test_provider_preflight_estimate_send_and_receipt_hold_no_journal_target_asset_or_signer_lock(self):
        observed = set()

        def checked(label, value):
            def call(*args, **kwargs):
                self.probe_unlocked_rows()
                observed.add(label)
                return value(*args, **kwargs) if callable(value) else value

            return call

        self.node.client.assert_expected_chain.side_effect = checked("chain", CHAIN_ID)
        self.node.contract.functions.decimals.return_value.call.side_effect = checked("decimals", 6)
        self.node.contract.functions.navUpdaters.return_value.call.side_effect = checked("authority", True)
        self.node.client.get_nonce.side_effect = checked("nonce", 7)
        self.node.client.estimate_gas.side_effect = checked("estimate", 60000)
        self.node.client.send_raw_transaction.side_effect = checked("send", self.node.send)
        self.node.client.get_transaction_receipt.side_effect = checked("receipt", self.node.receipts.get)
        self.assertIsNotNone(self.recover().completed_at)
        self.assertEqual(observed, {"chain", "decimals", "authority", "nonce", "estimate", "send", "receipt"})

    def test_same_rpc_lock_observer_detects_each_deliberately_held_row_then_recovers(self):
        self.recover()
        self.probe_unlocked_rows()
        for table, row_id in self.lock_targets():
            with self.subTest(table=table):
                with atomic():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(f"SELECT uuid FROM {table} WHERE uuid=%s FOR UPDATE", [row_id])
                        self.assertEqual(len(cursor.fetchall()), 1)
                    with self.assertRaises(LockNotAvailable):
                        self.probe_unlocked_rows()
                self.probe_unlocked_rows()
