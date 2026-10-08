from datetime import timedelta
from unittest.mock import Mock, patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import DatabaseError, connections
from django.http import Http404
from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.test import APITransactionTestCase
from web3 import Web3

from blockchain.models import (
    BlockchainTransaction,
    OutgoingOperation,
    SignedAttempt,
    SigningAccount,
)
from blockchain.services import outgoing
from blockchain.tests.outgoing_fixtures import receipt
from shared.db import atomic, current_alias, use_operator
from wallets.models import Wallet
from whitelist.constants import WHITELIST_NO_EXPIRY
from whitelist.exceptions import (
    WhitelistChangeConflict,
    WhitelistChangeUnresolved,
    WhitelistRegistryMissing,
)
from whitelist.models import (
    WhitelistAction,
    WhitelistApproval,
    WhitelistAuthority,
    WhitelistChange,
    WhitelistChangeStatus,
    WhitelistEntry,
)
from whitelist.services import changes, whitelist
from whitelist.services.company_wallet_instructions import (
    decide_wallet_instruction,
    preview_wallet_instruction_decision,
)
from whitelist.tests.change_fixtures import (
    ADDRESS,
    CHAIN_ID,
    FACTORY,
    KEY,
    REGISTRY,
    SENDER,
    change_actor,
    change_company,
)
from whitelist.tests.company_wallet_fixtures import CompanyWalletCases
from whitelist.tests.historical_whitelist_fixtures import retained_signed_add

OTHER_REGISTRY = "0x" + "e" * 40


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class WhitelistChangeRecoveryTest(CompanyWalletCases, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        self.actor = self.owner
        self.entry = WhitelistEntry.objects.create(wallet=self.wallet)
        self.submission_id = uuid4()

    def admit(self, submission_id=None, action="add", **options):
        proposal = self.admit_change(submission_id or self.submission_id, action, **options)
        with use_operator():
            return WhitelistChange.objects.get(pk=proposal.change_id)

    def submit(self, action=WhitelistAction.ADD, submission_id=None, **options):
        change = self.admit(submission_id, action, **options)
        if submission_id is None:
            self.submission_id = change.pk
        with use_operator():
            try:
                return changes.recover(change.pk)
            except (PermissionDenied, WhitelistChangeConflict):
                raise
            except Exception:
                raise WhitelistChangeUnresolved() from None

    def approval(self):
        return WhitelistApproval.objects.get(entry=self.entry, company=self.company)

    def move_registry(self):
        self.node.registry = Web3.to_checksum_address(OTHER_REGISTRY)

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
        self.assertEqual((self.approval().status, self.approval().expires_at), ("active", first.expires_at))

    def test_old_add_replay_cannot_undo_later_removal(self):
        first = self.submit()
        removed = self.submit(WhitelistAction.REMOVE, uuid4())
        replay = self.submit()
        self.assertEqual((removed.status, replay.status), ("confirmed", "confirmed"))
        self.assertEqual(replay.transaction_id, first.transaction_id)
        self.assertEqual(self.approval().status, "removed")
        self.assertEqual(self.node.expiries[ADDRESS], 0)
        self.assertEqual(len(self.node.broadcasts), 2)
        third = self.submit(submission_id=uuid4())
        self.assertEqual(third.status, "confirmed")
        self.assertEqual(len(self.node.broadcasts), 3)
        self.assertEqual(len({attempt.nonce for attempt in SignedAttempt.objects.all()}), 3)

    def test_an_expiry_is_written_on_chain_and_recorded_on_the_company_approval(self):
        expires_at = ((timezone.now() + timedelta(days=30)).replace(microsecond=0)).replace(microsecond=0)
        change = self.submit(expires_at=expires_at)
        self.assertEqual(change.status, "confirmed")
        self.assertEqual(change.expires_at, expires_at)
        self.assertEqual(self.node.expiries[ADDRESS], int(expires_at.timestamp()))
        self.assertEqual(change.intent["data"][-64:], f"{int(expires_at.timestamp()):064x}")
        self.assertEqual(BlockchainTransaction.objects.get().function_args["expiry"], str(int(expires_at.timestamp())))
        self.assertEqual((self.approval().status, self.approval().expires_at), ("active", expires_at))
        self.assertEqual(change.approval.pk, self.approval().pk)

    def test_a_retained_legacy_unlimited_signature_recovers_the_largest_uint64_without_new_authority(self):
        technical = change_actor()
        original = retained_signed_add(actor=technical, company=self.company, entry=self.entry, client=self.node.client)
        with use_operator():
            change = changes.recover(original.pk)
        self.assertEqual(change.intent["data"][-64:], "0" * 48 + "f" * 16)
        self.assertEqual(self.node.expiries[ADDRESS], WHITELIST_NO_EXPIRY)
        self.assertIsNone(change.source_instruction_id)
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_a_removal_writes_a_zero_expiry(self):
        self.submit()
        change = self.submit(WhitelistAction.REMOVE, uuid4())
        self.assertEqual(change.status, "confirmed")
        self.assertEqual(change.intent["data"][-64:], "0" * 64)
        self.assertEqual(self.node.expiries[ADDRESS], 0)
        self.assertEqual(self.approval().status, "removed")

    def test_renewing_a_listed_wallet_with_another_expiry_sends_the_new_expiry(self):
        self.node.approve(int((timezone.now() + timedelta(days=1)).timestamp()))
        expires_at = (timezone.now() + timedelta(days=60)).replace(microsecond=0)
        change = self.submit(expires_at=expires_at)
        self.assertEqual(change.status, "confirmed")
        self.assertEqual(self.node.expiries[ADDRESS], int(expires_at.timestamp()))

    def test_an_identical_expiry_on_chain_is_unchanged_and_sends_nothing(self):
        expires_at = ((timezone.now() + timedelta(days=30)).replace(microsecond=0)).replace(microsecond=0)
        self.node.approve(int(expires_at.timestamp()))
        change = self.submit(expires_at=expires_at)
        self.assertEqual(change.status, "unchanged")
        self.assertEqual(self.node.broadcasts, [])
        self.assertEqual((self.approval().status, self.approval().expires_at), ("active", expires_at))

    def test_an_expiry_must_be_a_future_aware_moment_on_an_addition(self):
        nomination = self.nominate()
        past = timezone.now().replace(microsecond=0) - timedelta(seconds=1)
        for action, expires_at in (
            ("add", past),
            ("add", (past + timedelta(days=2)).replace(tzinfo=None)),
            ("remove", timezone.now().replace(microsecond=0) + timedelta(days=1)),
        ):
            with self.subTest(action=action, expires_at=expires_at), self.assertRaises(ValidationError):
                self.prepare_wallet(nomination, action=action, expires_at=expires_at)
        self.assertFalse(WhitelistChange.objects.exists())
        self.assertEqual(self.node.broadcasts, [])

    def test_a_company_without_a_registry_on_chain_is_refused_before_admission(self):
        self.node.registry = "0x" + "0" * 40
        with self.assertRaises(WhitelistRegistryMissing):
            self.submit()
        self.assertFalse(WhitelistChange.objects.exists())
        self.assertFalse(WhitelistApproval.objects.exists())

    def test_the_registry_is_resolved_from_the_factory_by_the_companys_acn(self):
        change = self.submit()
        self.assertEqual(change.registry_address, REGISTRY)
        self.assertEqual(change.intent["to"], REGISTRY)
        self.node.contract.functions.registryOf.assert_called_with(self.company.acn)
        self.node.client.load_contract.assert_any_call("ShareTokenFactory", Web3.to_checksum_address(FACTORY))

    def test_each_company_keeps_its_own_approval_row_and_registry(self):
        other, other_initial = self.company_fixture("Second wallet registry Pty Ltd", "100000002")
        registries = {
            self.company.acn: Web3.to_checksum_address(REGISTRY),
            other.acn: Web3.to_checksum_address(OTHER_REGISTRY),
        }
        self.node.contract.functions.registryOf.side_effect = lambda acn: Mock(call=lambda: registries[acn])
        first = self.submit()
        with self.company_context(other, other_initial):
            self.appointment = self.appoint_actor(self.approver, ["prepare", "approve"])
            self.request, self.eligibility_decision = self.accepted()
            nomination = self.nominate()
            proposal = self.prepare_wallet(nomination)
            self.wallet_decide(proposal, "approve")
            applied, _ = self.wallet_decide(proposal, "apply")
            second = self.execute(applied)
        self.assertEqual((first.registry_address, second.registry_address), (REGISTRY, OTHER_REGISTRY))
        self.assertEqual(
            sorted(WhitelistApproval.objects.values_list("company_id", "registry_address")),
            sorted([(self.company.pk, REGISTRY), (other.pk, OTHER_REGISTRY)]),
        )
        self.assertEqual(second.approval.company_id, other.pk)

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
        self.submit()
        self.entry.delete()
        self.node.confirmed = False
        change = self.submit(WhitelistAction.REMOVE, uuid4())
        self.assertIsNone(change.entry_id)
        self.assertIsNone(change.approval)
        self.assertEqual(change.status, "executing")
        with self.assertRaises(WhitelistChangeConflict):
            self.submit(submission_id=uuid4())
        self.assertFalse(WhitelistEntry.objects.exists())
        self.assertEqual(SignedAttempt.objects.count(), 2)

    def test_recorded_revert_never_reopens_from_an_old_submission(self):
        self.node.receipt_status = 0
        first = self.submit()
        self.assertEqual(first.status, "failed")
        self.assertEqual(self.approval().status, "failed")
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
        self.node.approve(int(self.eligibility_decision.expires_at.timestamp()))
        whitelist.sync_entry(ADDRESS)
        approval = self.approval()
        self.assertEqual(approval.status, "pending")
        self.assertIsNotNone(approval.last_synced_at)
        self.assertEqual(changes.recover(change.pk).status, "executing")
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_sync_mirrors_the_chain_expiry_once_nothing_is_unresolved(self):
        self.submit()
        expiry = int((timezone.now() + timedelta(days=3)).timestamp())
        self.node.approve(expiry)
        whitelist.sync_entry(ADDRESS)
        self.assertEqual(self.approval().expires_at, whitelist.expiry_datetime(expiry))
        self.node.approve(0)
        self.assertEqual(whitelist.sync_all_entries(), 1)
        self.assertEqual((self.approval().status, self.approval().expires_at), ("removed", None))

    def test_unchanged_submission_is_remembered_after_later_membership_changes(self):
        self.node.approve(int(self.eligibility_decision.expires_at.timestamp()))
        first = self.submit()
        self.assertEqual(first.status, "unchanged")
        self.assertFalse(OutgoingOperation.objects.exists())
        self.submit(WhitelistAction.REMOVE, uuid4())
        self.assertEqual(self.submit().status, "unchanged")
        self.assertEqual(len(self.node.broadcasts), 1)
        self.assertEqual(self.approval().status, "removed")

    def test_changed_terms_or_actor_cannot_reuse_submission(self):
        self.submit()
        other = change_company("whitelist-other")
        for options in (
            {"action": WhitelistAction.REMOVE},
            {"company": other},
            {"expires_at": (timezone.now() + timedelta(days=5)).replace(microsecond=0)},
        ):
            with self.subTest(options=sorted(options)), self.assertRaises(
                (WhitelistChangeConflict, ValidationError, NotFound, Http404)
            ):
                self.submit(**options)
        staff = get_user_model().objects.create_superuser(email="other-operator@example.test", password="synthetic")
        with self.assertRaises(WhitelistChangeConflict):
            changes.submit(self.submission_id, WhitelistAction.ADD, ADDRESS, staff, company=self.company)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_a_retried_submission_with_the_same_expiry_is_the_same_submission(self):
        expires_at = (timezone.now() + timedelta(days=30)).replace(microsecond=0)
        first = self.submit(expires_at=expires_at)
        self.assertEqual(self.submit(expires_at=expires_at).pk, first.pk)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_legacy_signed_receipt_survives_original_staff_access_loss_without_new_admission(self):
        technical = change_actor()
        change = retained_signed_add(actor=technical, company=self.company, entry=self.entry, client=self.node.client)
        get_user_model().objects.filter(pk=technical.pk).update(is_staff=False, is_active=False)
        with use_operator(), self.assertRaises(PermissionDenied):
            changes.submit(uuid4(), "add", ADDRESS, technical, company=self.company)
        with use_operator():
            self.assertEqual(changes.recover(change.pk).status, "confirmed")
            self.assertEqual(WhitelistChange.objects.get().initiated_by_id, technical.pk)
            self.assertIsNone(WhitelistChange.objects.get().source_instruction_id)

    def test_whitelist_and_subscription_permissions_are_separate(self):
        from django.contrib.auth.models import Permission

        staff = get_user_model().objects.create_user(
            email="subscription-admin@example.test", password="synthetic", is_staff=True, is_active=True
        )
        staff.user_permissions.add(
            Permission.objects.get(content_type__app_label="offerings", codename="change_subscription")
        )
        with self.assertRaises(PermissionDenied):
            changes.submit(
                uuid4(),
                WhitelistAction.ADD,
                ADDRESS,
                staff,
                company=self.company,
                authority=WhitelistAuthority.WHITELIST_ADMIN,
            )
        with self.assertRaises(PermissionDenied):
            changes.submit(
                uuid4(),
                WhitelistAction.ADD,
                ADDRESS,
                staff,
                company=self.company,
                authority=WhitelistAuthority.SUBSCRIPTION_ADMIN,
            )
        self.assertFalse(WhitelistChange.objects.exists())

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
        change = self.admit()
        self.node.client.load_contract.reset_mock()
        with use_operator(), self.assertRaises(WhitelistChangeConflict), atomic():
            changes.recover(change.pk)
        self.node.client.load_contract.assert_not_called()
        self.assertFalse(SignedAttempt.objects.exists())

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
        self.move_registry()
        with override_settings(BLOCKCHAIN_OPERATOR_KEY=""):
            self.assertEqual(changes.recover(change.pk).status, "confirmed")
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_old_registry_receipt_does_not_overwrite_current_registry_membership(self):
        self.node.confirmed = False
        original = self.submit()
        attempt = SignedAttempt.objects.get()
        self.move_registry()
        WhitelistApproval.objects.filter(entry=self.entry, company=self.company).update(
            registry_address=OTHER_REGISTRY, status="removed", expires_at=None
        )
        approval = self.approval()
        self.assertEqual((approval.registry_address, approval.status), (OTHER_REGISTRY, "removed"))
        self.node.receipts[attempt.tx_hash] = receipt(attempt)
        recovered = changes.recover(original.pk)
        self.assertEqual(recovered.status, "confirmed")
        self.assertEqual(recovered.transaction.tx_hash, attempt.tx_hash)
        self.assertIsNone(recovered.approval)
        self.assertEqual(self.approval().status, "removed")
        self.assertEqual(self.approval().updated_at, approval.updated_at)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_a_pending_change_is_refused_once_the_company_registry_moves(self):
        change = self.admit()
        self.move_registry()
        with self.assertRaisesMessage(WhitelistChangeConflict, "registry changed after admission"):
            changes.recover(change.pk)
        self.assertEqual(WhitelistChange.objects.get().status, "pending")
        self.assertEqual(self.node.broadcasts, [])

    def test_unchanged_membership_observation_cannot_project_into_a_changed_wallet(self):
        def observe():
            Wallet.objects.filter(pk=self.entry.wallet_id).update(address="0x" + "b" * 40)
            return int(self.eligibility_decision.expires_at.timestamp())

        self.node.contract.functions.expiresAt.return_value.call.side_effect = observe
        self.assertEqual(self.submit().status, "unchanged")
        self.assertEqual(self.approval().status, "pending")
        self.assertFalse(SignedAttempt.objects.exists())

    def test_unchanged_membership_observation_cannot_project_into_a_moved_approval(self):
        def observe():
            WhitelistApproval.objects.filter(entry=self.entry).update(registry_address=OTHER_REGISTRY)
            return int(self.eligibility_decision.expires_at.timestamp())

        self.node.contract.functions.expiresAt.return_value.call.side_effect = observe
        self.assertEqual(self.submit().status, "unchanged")
        self.assertEqual(self.approval().status, "pending")
        self.assertFalse(SignedAttempt.objects.exists())

    def test_sync_does_not_label_an_old_registry_observation_as_current(self):
        approval = WhitelistApproval.objects.create(entry=self.entry, company=self.company, registry_address=REGISTRY)

        def observe():
            WhitelistApproval.objects.filter(pk=approval.pk).update(registry_address=OTHER_REGISTRY)
            return int(self.eligibility_decision.expires_at.timestamp())

        self.node.contract.functions.expiresAt.return_value.call.side_effect = observe
        whitelist.sync_entry(ADDRESS)
        approval.refresh_from_db()
        self.assertEqual(approval.status, "pending")
        self.assertIsNone(approval.last_synced_at)
        self.node.client.load_contract.assert_called_once_with("WhitelistRegistry", Web3.to_checksum_address(REGISTRY))

    def test_sync_does_not_project_into_a_wallet_edited_during_the_provider_read(self):
        WhitelistApproval.objects.create(entry=self.entry, company=self.company, registry_address=REGISTRY)

        def observe():
            Wallet.objects.filter(pk=self.entry.wallet_id).update(chain="ethereum")
            return int(self.eligibility_decision.expires_at.timestamp())

        self.node.contract.functions.expiresAt.return_value.call.side_effect = observe
        whitelist.sync_entry(ADDRESS)
        self.assertEqual(self.approval().status, "pending")

    def test_membership_projection_locks_the_wallet_against_concurrent_identity_changes(self):
        from whitelist.querysets.entry import WhitelistEntryQuerySet

        separate = connections[current_alias()].copy(alias="whitelist-lock-control")
        self.addCleanup(separate.close)
        original = WhitelistEntryQuerySet.matching_identity
        observed = []

        def check_lock(queryset, entry_id, address):
            if connections[current_alias()].in_atomic_block:
                with self.assertRaises(DatabaseError), separate.cursor() as cursor:
                    cursor.execute("SELECT uuid FROM wallets WHERE uuid = %s FOR UPDATE NOWAIT", [self.entry.wallet_id])
                observed.append(True)
            return original(queryset, entry_id, address)

        with patch.object(WhitelistEntryQuerySet, "matching_identity", check_lock):
            self.assertEqual(self.submit().status, "confirmed")
        self.assertEqual(observed, [True])
        with separate.cursor() as cursor:
            cursor.execute("SELECT uuid FROM wallets WHERE uuid = %s FOR UPDATE NOWAIT", [self.entry.wallet_id])
            self.assertEqual(cursor.fetchone()[0], self.entry.wallet_id)

    def test_signing_configuration_change_during_preparation_refuses_to_sign_old_configuration(self):
        prepare = outgoing.prepare_operation
        changed = override_settings(BLOCKCHAIN_OPERATOR_KEY="0x" + "22" * 32)

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

    def test_admin_actions_expose_unresolved_work_and_both_directions(self):
        from django.contrib.admin import site

        model_admin = site._registry[WhitelistEntry]
        self.node.confirmed = False
        change = self.submit()
        self.entry.refresh_from_db()
        self.assertIn("unresolved", model_admin.status_actions(self.entry))
        self.node.receipts[change.transaction.tx_hash] = receipt(SignedAttempt.objects.get())
        changes.recover(change.pk)
        actions = model_admin.status_actions(self.entry)
        self.assertIn("Company appointees", actions)
        self.assertNotIn("add-to-blockchain", actions)
        self.assertNotIn("remove-from-blockchain", actions)

    def test_unknown_membership_keeps_admitted_command_for_later_recovery(self):
        self.node.contract.functions.expiresAt.return_value.call.side_effect = ConnectionError(
            "private provider message"
        )
        with self.assertRaises(WhitelistChangeUnresolved) as error:
            self.submit()
        self.assertNotIn("private provider", str(error.exception))
        self.assertEqual(WhitelistChange.objects.get().status, "pending")
        with self.assertRaises(WhitelistChangeConflict):
            self.submit(WhitelistAction.REMOVE, uuid4())
        self.node.contract.functions.expiresAt.return_value.call.side_effect = lambda: 0
        self.assertEqual(changes.recover(self.submission_id).status, "confirmed")

    def test_lost_admission_commit_acknowledgement_recovers_original_command(self):
        proposal = self.prepare_wallet()
        self.wallet_decide(proposal, "approve")
        _, preview = preview_wallet_instruction_decision(
            actor=self.actor, instruction_id=proposal.pk, appointment=self.initial.pk, kind="apply", reason=""
        )
        values = dict(
            actor=self.actor,
            instruction_id=proposal.pk,
            appointment=self.initial.pk,
            kind="apply",
            idempotency_key=uuid4(),
            preview_digest=preview["preview_digest"],
            confirmation=True,
            reason="",
        )
        with use_operator():
            connection = connections[current_alias()]
            commit = connection.commit

        def lose_ack():
            commit()
            raise ConnectionError("Synthetic commit acknowledgement loss")

        with patch.object(connection, "commit", side_effect=lose_ack), self.assertRaises(ConnectionError):
            decide_wallet_instruction(**values)
        self.assertEqual(WhitelistChange.objects.count(), 1)
        applied = decide_wallet_instruction(**values)
        self.assertEqual(self.execute(applied).status, "confirmed")
        self.assertEqual(SignedAttempt.objects.count(), 1)

    def test_database_refuses_changed_terms_and_invented_terminal_outcomes(self):
        self.node.confirmed = False
        change = self.submit(expires_at=(timezone.now() + timedelta(days=30)).replace(microsecond=0))
        other = change_company("whitelist-other")
        for values in (
            {"address": "0x" + "b" * 40},
            {"initiated_by_id": None},
            {"intent": {}},
            {"company_id": other.pk},
            {"expires_at": change.expires_at + timedelta(days=1)},
            {"expires_at": None},
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
        self.assertEqual(self.approval().status, "removed")

    def test_unregistered_add_is_refused_without_creating_a_wallet(self):
        with self.assertRaises(PermissionDenied):
            changes.submit(uuid4(), WhitelistAction.ADD, "0x" + "b" * 40, self.actor, company=self.company)
        self.assertFalse(WhitelistChange.objects.exists())
