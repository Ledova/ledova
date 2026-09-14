from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings
from rest_framework.exceptions import PermissionDenied

from blockchain.models import (
    BlockchainTransaction,
    OutgoingOperation,
    SignedAttempt,
    SigningAccount,
    TransactionType,
)
from blockchain.services import outgoing
from blockchain.tests.outgoing_fixtures import receipt
from shared.db import atomic, current_alias
from whitelist.exceptions import (
    WalletNotRegisteredException,
    WhitelistChangeConflict,
    WhitelistChangeUnresolved,
)
from whitelist.models import (
    WhitelistAction,
    WhitelistAuthority,
    WhitelistChange,
    WhitelistChangeStatus,
    WhitelistEntry,
)
from whitelist.services import changes, whitelist
from whitelist.tests.change_fixtures import (
    ADDRESS,
    CHAIN_ID,
    KEY,
    REGISTRY,
    SENDER,
    WhitelistNode,
    admitted_signer,
    change_actor,
    change_entry,
)


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, WHITELIST_CONTRACT_ADDRESS=REGISTRY)
class WhitelistChangeRecoveryTest(TransactionTestCase):
    def setUp(self):
        self.actor = change_actor()
        self.entry = change_entry()
        self.node = WhitelistNode()
        self.submission_id = uuid4()
        admitted_signer()
        for module in (changes, whitelist):
            patcher = patch.object(module, "get_base_chain_client", return_value=self.node.client)
            patcher.start()
            self.addCleanup(patcher.stop)

    def submit(self, action=WhitelistAction.ADD, submission_id=None, **options):
        return changes.submit(submission_id or self.submission_id, action, ADDRESS, self.actor, **options)

    def test_repeated_submission_has_one_original_attempt_and_projection(self):
        first = self.submit()
        second = self.submit()
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(second.status, WhitelistChangeStatus.CONFIRMED)
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(BlockchainTransaction.objects.count(), 1)
        self.assertEqual(SigningAccount.objects.get().next_nonce, 8)
        self.assertEqual(len(self.node.broadcasts), 1)
        self.node.client.send_transaction.assert_not_called()

    def test_old_add_replay_cannot_undo_later_removal(self):
        first = self.submit()
        removed = self.submit(WhitelistAction.REMOVE, uuid4())
        replay = self.submit()
        self.entry.refresh_from_db()
        self.assertEqual((removed.status, replay.status), ("confirmed", "confirmed"))
        self.assertEqual(replay.transaction_id, first.transaction_id)
        self.assertFalse(self.entry.is_whitelisted)
        self.assertEqual(self.entry.remove_tx_hash, removed.transaction.tx_hash)
        self.assertEqual(len(self.node.broadcasts), 2)
        third = self.submit(submission_id=uuid4())
        self.assertEqual(third.status, "confirmed")
        self.assertEqual(len(self.node.broadcasts), 3)
        self.assertEqual(len({attempt.nonce for attempt in SignedAttempt.objects.all()}), 3)

    def test_unknown_send_replays_exact_bytes_and_blocks_opposite_change(self):
        self.node.confirmed = False
        self.node.lose_acknowledgement = True
        first = self.submit()
        self.assertEqual(first.status, "executing")
        for action in (WhitelistAction.REMOVE, WhitelistAction.ADD):
            with self.subTest(action=action), self.assertRaises(WhitelistChangeConflict):
                self.submit(action, uuid4())
        recovered = changes.recover(first.pk)
        self.assertEqual(recovered.status, "executing")
        self.assertEqual(self.node.broadcasts[0], self.node.broadcasts[1])
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.node.receipts[first.transaction.tx_hash] = receipt(SignedAttempt.objects.get())
        self.assertEqual(changes.recover(first.pk).status, "confirmed")
        self.assertEqual(len(self.node.broadcasts), 2)

    def test_removal_without_a_local_entry_is_durable_and_blocks_an_add(self):
        self.entry.delete()
        self.node.members.add(ADDRESS)
        self.node.confirmed = False
        change = self.submit(WhitelistAction.REMOVE)
        self.assertIsNone(change.entry_id)
        self.assertEqual(change.status, "executing")
        with self.assertRaises(WhitelistChangeConflict):
            self.submit(submission_id=uuid4())
        self.assertFalse(WhitelistEntry.objects.exists())
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_recorded_revert_never_reopens_from_an_old_submission(self):
        self.node.receipt_status = 0
        first = self.submit()
        self.assertEqual(first.status, "failed")
        self.node.receipt_status = 1
        self.assertEqual(self.submit().status, "failed")
        self.assertEqual(changes.recover(first.pk).status, "failed")
        self.assertEqual(len(self.node.broadcasts), 1)
        fresh = self.submit(submission_id=uuid4())
        self.assertEqual(fresh.status, "confirmed")
        self.assertEqual(len(self.node.broadcasts), 2)

    def test_matching_current_membership_does_not_confirm_signed_work(self):
        self.node.confirmed = False
        change = self.submit()
        self.node.members.add(ADDRESS)
        entry = whitelist.sync_entry(ADDRESS)
        self.assertTrue(entry.is_whitelisted)
        self.assertEqual(entry.status, "pending")
        self.assertEqual(changes.recover(change.pk).status, "executing")
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_unchanged_submission_is_remembered_after_later_membership_changes(self):
        self.node.members.add(ADDRESS)
        first = self.submit()
        self.assertEqual(first.status, "unchanged")
        self.assertFalse(OutgoingOperation.objects.exists())
        self.submit(WhitelistAction.REMOVE, uuid4())
        self.assertEqual(self.submit().status, "unchanged")
        self.assertEqual(len(self.node.broadcasts), 1)
        self.entry.refresh_from_db()
        self.assertFalse(self.entry.is_whitelisted)

    def test_changed_action_or_actor_cannot_reuse_submission(self):
        self.submit()
        with self.assertRaises(WhitelistChangeConflict):
            self.submit(WhitelistAction.REMOVE)
        other = get_user_model().objects.create_superuser(email="other-operator@example.test", password="synthetic")
        with self.assertRaises(WhitelistChangeConflict):
            changes.submit(self.submission_id, WhitelistAction.ADD, ADDRESS, other)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_staff_revocation_prevents_admission_but_does_not_cancel_accepted_recovery(self):
        change = changes._admit(
            self.submission_id, WhitelistAction.ADD, ADDRESS, self.actor, WhitelistAuthority.OPERATOR_API, None
        )
        get_user_model().objects.filter(pk=self.actor.pk).update(is_staff=False)
        with self.assertRaises(PermissionDenied):
            self.submit()
        self.assertEqual(changes.recover(change.pk).status, "confirmed")
        self.assertEqual(WhitelistChange.objects.get().initiated_by_id, self.actor.pk)

    def test_whitelist_and_subscription_permissions_are_separate(self):
        from django.contrib.auth.models import Permission

        staff = get_user_model().objects.create_user(
            email="subscription-admin@example.test", password="synthetic", is_staff=True, is_active=True
        )
        staff.user_permissions.add(
            Permission.objects.get(content_type__app_label="offerings", codename="change_subscription")
        )
        with self.assertRaises(PermissionDenied):
            changes.submit(uuid4(), WhitelistAction.ADD, ADDRESS, staff, authority=WhitelistAuthority.WHITELIST_ADMIN)
        change = changes.submit(
            uuid4(), WhitelistAction.ADD, ADDRESS, staff, authority=WhitelistAuthority.SUBSCRIPTION_ADMIN
        )
        self.assertEqual(change.status, "confirmed")

    def test_provider_calls_see_committed_command_and_signed_projection_without_locks(self):
        send = self.node.send

        def observe(raw):
            self.assertTrue(connections[current_alias()].get_autocommit())
            current = WhitelistChange.objects.get()
            self.assertEqual(current.operation.status, "signed")
            self.assertEqual(current.transaction.tx_hash, SignedAttempt.objects.get().tx_hash)
            return send(raw)

        self.node.client.send_raw_transaction.side_effect = observe
        self.assertEqual(self.submit().status, "confirmed")

    def test_enclosing_transaction_is_refused_before_any_provider_work(self):
        with atomic(), self.assertRaises(WhitelistChangeConflict):
            self.submit()
        self.assertFalse(WhitelistChange.objects.exists())
        self.node.client.load_contract.assert_not_called()

    def test_closed_signer_never_uses_legacy_send_and_signed_receipts_can_still_reconcile(self):
        outgoing.close_signer_admission(chain_id=CHAIN_ID, sender=SENDER)
        self.assertEqual(self.submit().status, "failed")
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertEqual(self.node.broadcasts, [])
        self.node.client.send_transaction.assert_not_called()

    def test_signed_receipt_reconciles_after_signer_closure_and_config_change(self):
        self.node.confirmed = False
        change = self.submit()
        outgoing.close_signer_admission(chain_id=CHAIN_ID, sender=SENDER)
        self.node.receipts[change.transaction.tx_hash] = receipt(SignedAttempt.objects.get())
        with override_settings(WHITELIST_CONTRACT_ADDRESS="0x" + "e" * 40, BLOCKCHAIN_OPERATOR_KEY=""):
            self.assertEqual(changes.recover(change.pk).status, "confirmed")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_registry_change_during_preparation_refuses_to_sign_old_configuration(self):
        prepare = outgoing.prepare_operation
        changed = override_settings(WHITELIST_CONTRACT_ADDRESS="0x" + "e" * 40)

        def prepare_then_change(*args):
            prepared = prepare(*args)
            changed.enable()
            self.addCleanup(changed.disable)
            return prepared

        with patch.object(outgoing, "prepare_operation", side_effect=prepare_then_change):
            change = self.submit()
        self.assertEqual(change.status, "failed")
        self.assertFalse(SignedAttempt.objects.exists())
        self.assertEqual(self.node.broadcasts, [])

    def test_admin_actions_expose_unresolved_work_and_correct_membership_direction(self):
        from django.contrib.admin import site
        from django.urls import reverse

        model_admin = site._registry[WhitelistEntry]
        self.node.confirmed = False
        change = self.submit()
        self.entry.refresh_from_db()
        self.assertIn("unresolved", model_admin.status_actions(self.entry))
        self.node.receipts[change.transaction.tx_hash] = receipt(SignedAttempt.objects.get())
        changes.recover(change.pk)
        self.entry.refresh_from_db()
        remove_url = reverse("admin:whitelist_whitelistentry_remove_from_blockchain", args=[self.entry.pk])
        self.assertIn(remove_url, model_admin.status_actions(self.entry))
        self.node.members.add(ADDRESS)
        self.node.confirmed = True
        self.node.receipt_status = 0
        self.submit(WhitelistAction.REMOVE, uuid4())
        self.entry.refresh_from_db()
        self.assertIn(remove_url, model_admin.status_actions(self.entry))

    def test_unknown_membership_keeps_admitted_command_for_later_recovery(self):
        self.node.contract.functions.isWhitelisted.return_value.call.side_effect = ConnectionError(
            "private provider message"
        )
        with self.assertRaises(WhitelistChangeUnresolved) as error:
            self.submit()
        self.assertNotIn("private provider", str(error.exception))
        self.assertEqual(WhitelistChange.objects.get().status, "pending")
        with self.assertRaises(WhitelistChangeConflict):
            self.submit(WhitelistAction.REMOVE, uuid4())
        self.node.contract.functions.isWhitelisted.return_value.call.side_effect = lambda: False
        self.assertEqual(changes.recover(self.submission_id).status, "confirmed")

    def test_lost_admission_commit_acknowledgement_recovers_original_command(self):
        connection = connections[current_alias()]
        commit = connection.commit
        calls = []

        def lose_first_ack():
            commit()
            calls.append(True)
            if len(calls) == 1:
                raise ConnectionError("Synthetic commit acknowledgement loss")

        with patch.object(connection, "commit", side_effect=lose_first_ack), self.assertRaises(ConnectionError):
            self.submit()
        self.assertEqual(WhitelistChange.objects.count(), 1)
        self.assertEqual(self.submit().status, "confirmed")
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_historical_unknown_transaction_is_not_adopted_or_resent(self):
        BlockchainTransaction.objects.create(
            tx_type=TransactionType.WHITELIST_ADD,
            status="pending",
            to_address=REGISTRY,
            function_args={"investor": ADDRESS},
            related_model="whitelist.WhitelistEntry",
            related_uuid=self.entry.pk,
        )
        with self.assertRaises(WhitelistChangeConflict):
            self.submit()
        self.assertFalse(WhitelistChange.objects.exists())
        self.assertEqual(self.node.broadcasts, [])

    def test_database_refuses_changed_terms_and_invented_terminal_outcomes(self):
        self.node.confirmed = False
        change = self.submit()
        for values in (
            {"address": "0x" + "b" * 40},
            {"initiated_by_id": None},
            {"intent": {}},
            {"status": "failed"},
            {"operation": None},
        ):
            with self.subTest(values=values), self.assertRaises(DatabaseError), atomic():
                WhitelistChange.objects.filter(pk=change.pk).update(**values)
        with self.assertRaises(DatabaseError), atomic():
            WhitelistChange.objects.filter(pk=change.pk).delete()
        self.assertEqual(WhitelistChange.objects.get().status, "executing")

    def test_delayed_projection_does_not_overwrite_a_later_command(self):
        change = self.submit()
        operation = change.operation
        self.submit(WhitelistAction.REMOVE, uuid4())
        changes._project(change, outgoing.OperationClaim(operation.pk, operation.claim_id))
        self.entry.refresh_from_db()
        self.assertFalse(self.entry.is_whitelisted)

    def test_unregistered_add_is_refused_without_creating_a_wallet(self):
        with self.assertRaises(WalletNotRegisteredException):
            changes.submit(uuid4(), WhitelistAction.ADD, "0x" + "b" * 40, self.actor)
        self.assertFalse(WhitelistChange.objects.exists())
