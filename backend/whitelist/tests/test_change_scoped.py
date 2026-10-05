import json
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import DatabaseError, connections
from django.test import override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APITransactionTestCase

from blockchain.models import SignedAttempt
from blockchain.tests.outgoing_fixtures import receipt
from ledova_backend.procrastinate_app import app
from operators.models import Operator
from shared.db import (
    APP_ALIAS,
    OPERATOR_ALIAS,
    acting_for,
    atomic,
    current_alias,
    principal_of,
    use_operator,
)
from shared.tests.scoped import RunsOnTheScopedConnection
from wallets.models import Wallet
from whitelist.constants import WHITELIST_REMOVAL_RETRY_SECONDS
from whitelist.models import (
    WhitelistApproval,
    WhitelistAuthority,
    WhitelistChange,
    WhitelistEligibilityInvalidation,
    WhitelistEntry,
    WhitelistInvalidationCause,
)
from whitelist.services import changes, eligibility_invalidation, refresh, whitelist
from whitelist.tasks import refresh_whitelist_targets
from whitelist.tasks.recovery import recover_whitelist_changes
from whitelist.tests.change_fixtures import (
    ADDRESS,
    CHAIN_ID,
    FACTORY,
    KEY,
    REGISTRY,
    WhitelistNode,
    admitted_signer,
    change_actor,
    change_company,
    change_entry,
)
from whitelist.tests.test_admin_blockchain_views import TEST_STORAGES


@override_settings(
    BLOCKCHAIN_OPERATOR_KEY=KEY,
    BLOCKCHAIN_CHAIN_ID=CHAIN_ID,
    SHARE_TOKEN_FACTORY_ADDRESS=FACTORY,
    STORAGES=TEST_STORAGES,
)
class ScopedWhitelistChangeTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            Operator.get()
            self.actor = change_actor()
            self.entry = change_entry()
            self.company = change_company()
            admitted_signer()
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT current_user")
                self.assertEqual(cursor.fetchone()[0], settings.RLS_ROLES[OPERATOR_ALIAS])
        self.node = WhitelistNode()
        patcher = patch.object(changes, "get_base_chain_client", return_value=self.node.client)
        patcher.start()
        self.addCleanup(patcher.stop)
        reader = patch.object(whitelist, "get_base_chain_client", return_value=self.node.client)
        reader.start()
        self.addCleanup(reader.stop)
        invalidation_reader = patch.object(
            eligibility_invalidation, "get_base_chain_client", return_value=self.node.client
        )
        invalidation_reader.start()
        self.addCleanup(invalidation_reader.stop)
        self.initial_jobs = set(self.removal_jobs())
        self.addCleanup(self.remove_jobs)

    def removal_jobs(self):
        with use_operator(), connections[OPERATOR_ALIAS].cursor() as cursor:
            cursor.execute(
                "SELECT id, args, status, attempts FROM procrastinate_jobs WHERE task_name = %s",
                [refresh_whitelist_targets.name],
            )
            return {
                row[0]: (row[1] if isinstance(row[1], dict) else json.loads(row[1]), row[2], row[3])
                for row in cursor.fetchall()
            }

    def remove_jobs(self):
        with use_operator(), connections[OPERATOR_ALIAS].cursor() as cursor:
            for job_id in set(self.removal_jobs()) - self.initial_jobs:
                cursor.execute("DELETE FROM procrastinate_jobs WHERE id = %s", [job_id])

    def delete_wallet_with_queued_removal(self):
        with use_operator():
            wallet = self.entry.wallet
            self.customer = wallet.user_account.user_profile.user
            self.customer.is_active = True
            self.customer.save(update_fields=["is_active"])
        self.signed_in_as(self.customer)
        response = self.client.delete(f"/api/wallets/{wallet.pk}/")
        self.assertEqual(response.status_code, 204, response.data)
        with use_operator():
            self.assertFalse(Wallet.objects.filter(pk=wallet.pk).exists())
            self.assertFalse(WhitelistEntry.objects.filter(pk=self.entry.pk).exists())
            self.assertFalse(WhitelistApproval.objects.exists())
            self.wallet_removal = WhitelistEligibilityInvalidation.objects.get(
                wallet_id=wallet.pk, cause=WhitelistInvalidationCause.WALLET_REMOVAL
            )
            self.assertEqual(self.wallet_removal.initiated_by_id, self.customer.pk)
            self.assertEqual(self.wallet_removal.user_account_id, wallet.user_account_id)
            self.assertEqual(self.wallet_removal.address, ADDRESS)
        queued = {key: value for key, value in self.removal_jobs().items() if key not in self.initial_jobs}
        self.assertEqual(len(queued), 1)
        job_id, (payload, status, attempts) = next(iter(queued.items()))
        self.assertEqual(
            payload,
            {
                "targets": [
                    {
                        "address": ADDRESS,
                        "company": str(self.company.pk),
                        "registry": REGISTRY,
                        "chain_id": CHAIN_ID,
                        "wallet": str(wallet.pk),
                        "account": str(wallet.user_account_id),
                    }
                ],
                "cause": WhitelistInvalidationCause.WALLET_REMOVAL,
                "decision_id": None,
                "invalidation_id": str(self.wallet_removal.pk),
            },
        )
        self.assertEqual((status, attempts), ("todo", 0))
        return job_id, payload

    def run_removal_job(self, job_id):
        queue = f"whitelist-removal-{job_id}"
        with use_operator(), connections[OPERATOR_ALIAS].cursor() as cursor:
            cursor.execute(
                "UPDATE procrastinate_jobs SET queue_name = %s, scheduled_at = NULL WHERE id = %s", [queue, job_id]
            )
        app.perform_import_paths()
        with (
            patch.dict(connections[OPERATOR_ALIAS].settings_dict, {"CONN_MAX_AGE": 0}),
            patch.dict(app.periodic_registry.periodic_tasks, {}, clear=True),
            app.replace_connector(app.connector.get_worker_connector()),
        ):
            app.run_worker(
                queues=[queue], wait=False, listen_notify=False, install_signal_handlers=False, delete_jobs="never"
            )
        return self.removal_jobs()[job_id]

    def submit_approval(self):
        with use_operator():
            return changes.submit(uuid4(), "add", ADDRESS, self.actor, company=self.company)

    def assert_removal_complete(self, job_id, payload, attempts):
        self.assertEqual(self.removal_jobs()[job_id], (payload, "succeeded", attempts))
        self.assertEqual(self.node.expiries[ADDRESS], 0)
        with use_operator():
            removal = WhitelistChange.objects.filter(action="remove").latest("created_at")
            self.assertEqual(removal.status, "confirmed")
            self.assertEqual(removal.initiated_by_id, self.customer.pk)
            self.assertEqual(removal.authority, WhitelistAuthority.CLASSIFICATION_REFRESH)
            self.assertIsNone(removal.requested_wallet_id)
            self.assertEqual(removal.eligibility_invalidation_id, self.wallet_removal.pk)
            self.assertEqual(removal.invalidation_cause, WhitelistInvalidationCause.WALLET_REMOVAL)
            self.assertIsNone(removal.eligibility_decision_id)
        sent = len(self.node.broadcasts)
        self.assertEqual(
            refresh_whitelist_targets.func(**payload), {"checked": 1, "submitted": 0, "unattributed": 0, "errors": 0}
        )
        self.assertEqual(len(self.node.broadcasts), sent)

    def test_deleted_wallet_removal_job_survives_pending_add_then_removes_its_late_confirmation(self):
        self.node.confirmed = False
        original = self.submit_approval()
        job_id, payload = self.delete_wallet_with_queued_removal()

        self.assertEqual(self.run_removal_job(job_id), (payload, "todo", 1))

        with use_operator():
            self.assertEqual(WhitelistChange.objects.count(), 1)
            attempt = SignedAttempt.objects.get()
            self.node.receipts[attempt.tx_hash] = receipt(attempt)
            self.node.approve()
        self.node.confirmed = True
        self.assertEqual(recover_whitelist_changes.func()["completed"], 1)
        observed = []
        original_refresh = refresh._refresh_target

        def record_authority(*args, **kwargs):
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT current_user")
                observed.append((current_alias(), cursor.fetchone()[0]))
            return original_refresh(*args, **kwargs)

        with patch.object(refresh, "_refresh_target", side_effect=record_authority):
            self.run_removal_job(job_id)

        self.assertEqual(observed, [(OPERATOR_ALIAS, settings.RLS_ROLES[OPERATOR_ALIAS])])
        self.assert_removal_complete(job_id, payload, 2)
        with use_operator():
            self.assertEqual(WhitelistChange.objects.get(pk=original.pk).status, "confirmed")
            self.assertEqual(WhitelistChange.objects.filter(action="add").count(), 1)
            self.assertEqual(WhitelistChange.objects.filter(action="remove").count(), 1)
            self.assertFalse(WhitelistApproval.objects.exists())

    def test_deleted_wallet_removal_job_survives_an_expiry_read_failure(self):
        self.submit_approval()
        job_id, payload = self.delete_wallet_with_queued_removal()
        with patch.object(refresh, "observed_expiry", side_effect=ConnectionError("Synthetic read outage")):
            for attempt in range(1, 7):
                started = timezone.now()
                self.assertEqual(self.run_removal_job(job_id), (payload, "todo", attempt))
                with use_operator(), connections[OPERATOR_ALIAS].cursor() as cursor:
                    cursor.execute("SELECT scheduled_at FROM procrastinate_jobs WHERE id = %s", [job_id])
                    scheduled = cursor.fetchone()[0]
                delay = timedelta(seconds=WHITELIST_REMOVAL_RETRY_SECONDS)
                self.assertGreaterEqual(scheduled, started + delay)
                self.assertLessEqual(scheduled, timezone.now() + delay)
        self.assertNotEqual(self.node.expiries[ADDRESS], 0)

        self.run_removal_job(job_id)

        self.assert_removal_complete(job_id, payload, 7)

    def test_deleted_wallet_removal_job_survives_a_failure_before_admission(self):
        self.submit_approval()
        job_id, payload = self.delete_wallet_with_queued_removal()
        with patch.object(
            eligibility_invalidation, "registry_for", side_effect=ConnectionError("Synthetic registry outage")
        ) as registry_outage:
            self.assertEqual(self.run_removal_job(job_id), (payload, "todo", 1))
        registry_outage.assert_called_once_with(self.company, self.node.client)
        with use_operator():
            self.assertEqual(WhitelistChange.objects.count(), 1)

        self.run_removal_job(job_id)

        self.assert_removal_complete(job_id, payload, 2)

    def test_deleted_wallet_removal_job_retries_a_failed_removal_with_a_new_journal(self):
        self.submit_approval()
        job_id, payload = self.delete_wallet_with_queued_removal()
        self.node.receipt_status = 0
        self.assertEqual(self.run_removal_job(job_id), (payload, "todo", 1))
        with use_operator():
            failed = WhitelistChange.objects.get(action="remove")
            self.assertEqual(failed.status, "failed")
        self.assertNotEqual(self.node.expiries[ADDRESS], 0)
        self.node.receipt_status = 1

        self.run_removal_job(job_id)

        self.assert_removal_complete(job_id, payload, 2)
        with use_operator():
            self.assertEqual(WhitelistChange.objects.filter(action="remove").count(), 2)
            self.assertEqual(WhitelistChange.objects.get(pk=failed.pk).status, "failed")

    def test_deleted_wallet_removal_job_waits_for_its_pending_removal_without_signing_again(self):
        self.submit_approval()
        job_id, payload = self.delete_wallet_with_queued_removal()
        self.node.confirmed = False
        self.assertEqual(self.run_removal_job(job_id), (payload, "todo", 1))
        with use_operator():
            removal = WhitelistChange.objects.get(action="remove")
            attempt = SignedAttempt.objects.get(operation=removal.operation)
            signed = (attempt.pk, attempt.nonce, attempt.tx_hash, bytes(attempt.raw_transaction))
            next_nonce = attempt.signer.next_nonce
            self.assertEqual(SignedAttempt.objects.count(), 2)
        self.assertEqual(self.node.broadcasts[1:], [signed[3]])
        self.assertEqual(self.run_removal_job(job_id), (payload, "todo", 2))
        with use_operator():
            removal = WhitelistChange.objects.get(action="remove")
            self.assertEqual(removal.status, "executing")
            attempt = SignedAttempt.objects.get(operation=removal.operation)
            self.assertEqual((attempt.pk, attempt.nonce, attempt.tx_hash, bytes(attempt.raw_transaction)), signed)
            self.assertEqual(attempt.signer.next_nonce, next_nonce)
            self.assertEqual(SignedAttempt.objects.count(), 2)
            confirmed_receipt = receipt(attempt)
            self.node.receipts[attempt.tx_hash] = confirmed_receipt
            self.node.expiries[ADDRESS] = 0
        self.assertEqual(self.node.broadcasts[1:], [signed[3], signed[3]])
        self.assertEqual(recover_whitelist_changes.func()["completed"], 1)

        self.run_removal_job(job_id)

        self.assert_removal_complete(job_id, payload, 3)
        with use_operator():
            self.assertEqual(WhitelistChange.objects.filter(action="remove").count(), 1)
            removal.refresh_from_db()
            self.assertEqual(removal.operation.current_attempt_id, signed[0])
            self.assertEqual(removal.operation.block_number, confirmed_receipt["blockNumber"])
            self.assertEqual(removal.operation.block_hash, confirmed_receipt["blockHash"])
            self.assertEqual(removal.operation.gas_used, confirmed_receipt["gasUsed"])
            attempt.refresh_from_db()
            self.assertEqual((attempt.pk, attempt.nonce, attempt.tx_hash, bytes(attempt.raw_transaction)), signed)
            self.assertEqual(attempt.signer.next_nonce, next_nonce)
            self.assertEqual(SignedAttempt.objects.count(), 2)
        self.assertEqual(self.node.broadcasts[1:], [signed[3], signed[3]])

    def test_deleted_wallet_removal_job_retains_its_actual_holder_after_login_deactivation(self):
        self.submit_approval()
        job_id, payload = self.delete_wallet_with_queued_removal()
        with use_operator():
            get_user_model().objects.filter(pk=self.customer.pk).update(is_active=False)

        self.run_removal_job(job_id)

        self.assert_removal_complete(job_id, payload, 1)
        sent = len(self.node.broadcasts)
        result = refresh_whitelist_targets.func(**payload, actor_id=str(self.customer.pk + 10000), remove_only=False)
        self.assertEqual(result, {"checked": 1, "submitted": 0, "unattributed": 0, "errors": 0})
        self.assertEqual(len(self.node.broadcasts), sent)
        with use_operator():
            removal = WhitelistChange.objects.get(action="remove")
            self.assertEqual(removal.initiated_by_id, self.customer.pk)
            self.assertEqual(removal.eligibility_invalidation_id, self.wallet_removal.pk)
            self.assertFalse(get_user_model().objects.get(pk=self.customer.pk).is_active)

    def test_app_alias_cannot_admit_recover_or_read_private_commands(self):
        with use_operator():
            change = changes._admit(uuid4(), "add", ADDRESS, self.actor, "operator_api", None, self.company, None)
        self.node.client.load_contract.reset_mock()
        with acting_for(self.actor.pk):
            for invoke in (
                lambda: changes.submit(uuid4(), "add", ADDRESS, self.actor, company=self.company),
                lambda: changes.recover(change.pk),
            ):
                with self.assertRaises(PermissionDenied):
                    invoke()
            with self.assertRaises(DatabaseError), atomic():
                WhitelistChange.objects.filter(pk=change.pk).exists()
        with use_operator():
            self.assertTrue(WhitelistChange.objects.filter(pk=change.pk).exists())
            self.assertFalse(SignedAttempt.objects.exists())
        self.node.client.load_contract.assert_not_called()

    def test_recovery_job_selects_operator_then_restores_app_principal(self):
        with use_operator():
            changes._admit(uuid4(), "add", ADDRESS, self.actor, "operator_api", None, self.company, None)
        send = self.node.send
        seen = []

        def observe(raw):
            self.assertEqual(current_alias(), OPERATOR_ALIAS)
            self.assertTrue(connections[current_alias()].get_autocommit())
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT current_user")
                seen.append(cursor.fetchone()[0])
            return send(raw)

        self.node.client.send_raw_transaction.side_effect = observe
        with acting_for(self.actor.pk):
            self.assertEqual(recover_whitelist_changes.func(), {"checked": 1, "completed": 1, "unresolved": 0})
            self.assertEqual(current_alias(), APP_ALIAS)
            self.assertEqual(principal_of(APP_ALIAS), str(self.actor.pk))
        self.assertEqual(seen, [settings.RLS_ROLES[OPERATOR_ALIAS]])

    def test_operator_api_commits_and_recovers_original_identity(self):
        self.client.force_authenticate(self.actor)
        incoming = {"submissionId": str(uuid4()), "walletAddress": ADDRESS, "company": str(self.company.pk)}
        response = self.client.post("/api/v1/whitelist/add/", incoming, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        repeated = self.client.post("/api/v1/whitelist/add/", incoming, format="json")
        self.assertEqual(repeated.json()["txHash"], response.json()["txHash"])
        self.assertEqual(len(self.node.broadcasts), 1)
        self.assertEqual(current_alias(), APP_ALIAS)
        with use_operator():
            self.assertEqual(WhitelistChange.objects.get().initiated_by_id, self.actor.pk)

    def test_admin_confirmation_preserves_identity_across_repeated_posts(self):
        with use_operator():
            self.client.force_login(self.actor)
        url = reverse("admin:whitelist_whitelistentry_add_to_blockchain", args=[self.entry.pk])
        page = self.client.get(url)
        self.assertEqual(page.status_code, 200)
        self.node.client.send_raw_transaction.assert_not_called()
        incoming = {
            "confirm_whitelist": "1",
            "whitelist_confirmation": page.context["whitelist_confirmation"],
            "whitelist_company": str(self.company.pk),
        }
        response = self.client.post(url, incoming)
        self.assertEqual(response.status_code, 302)
        self.assertEqual(self.client.post(url, incoming).status_code, 302)
        self.assertEqual(len(self.node.broadcasts), 1)
        with use_operator():
            self.assertEqual(WhitelistChange.objects.get().authority, "whitelist_admin")
            self.assertEqual(WhitelistChange.objects.get().status, "confirmed")
            self.assertEqual(WhitelistApproval.objects.get().status, "active")

    def test_customer_can_delete_a_wallet_with_a_company_approval(self):
        with use_operator():
            wallet = self.entry.wallet
            customer = wallet.user_account.user_profile.user
            WhitelistApproval.objects.create(entry=self.entry, company=self.company, registry_address=REGISTRY)
        self.signed_in_as(customer)
        response = self.client.delete(f"/api/wallets/{wallet.pk}/")
        self.assertEqual(response.status_code, 204, response.data)
        with use_operator():
            self.assertFalse(Wallet.objects.filter(pk=wallet.pk).exists())
            self.assertFalse(WhitelistEntry.objects.filter(pk=self.entry.pk).exists())
            self.assertFalse(WhitelistApproval.objects.exists())

    def test_customer_can_delete_a_wallet_with_an_unadmitted_whitelist_entry(self):
        with use_operator():
            wallet = self.entry.wallet
            customer = wallet.user_account.user_profile.user
        self.signed_in_as(customer)
        response = self.client.delete(f"/api/wallets/{wallet.pk}/")
        self.assertEqual(response.status_code, 204, response.data)
        with use_operator():
            self.assertFalse(Wallet.objects.filter(pk=wallet.pk).exists())
            self.assertFalse(WhitelistEntry.objects.filter(pk=self.entry.pk).exists())

    def test_customer_deletion_preserves_private_command_without_recreating_or_reassigning_entry(self):
        self.node.confirmed = False
        with use_operator():
            wallet = self.entry.wallet
            customer = wallet.user_account.user_profile.user
            original = changes.submit(uuid4(), "add", ADDRESS, self.actor, company=self.company)
            attempt = SignedAttempt.objects.get()
        self.signed_in_as(customer)
        response = self.client.delete(f"/api/wallets/{wallet.pk}/")
        self.assertEqual(response.status_code, 204, response.data)
        with self.assertRaises(DatabaseError), atomic():
            WhitelistChange.objects.filter(pk=original.pk).exists()
        with use_operator():
            self.assertFalse(WhitelistEntry.objects.filter(pk=self.entry.pk).exists())
            replacement_wallet = Wallet.objects.create(user_account=wallet.user_account, address=ADDRESS, chain="base")
            replacement = WhitelistEntry.objects.create(wallet=replacement_wallet)
            self.node.receipts[attempt.tx_hash] = receipt(attempt)
            recovered = changes.recover(original.pk)
            self.assertEqual(recovered.status, "confirmed")
            self.assertEqual(recovered.entry_id, self.entry.pk)
            self.assertIsNone(recovered.approval)
            self.assertEqual(recovered.transaction.tx_hash, attempt.tx_hash)
            self.assertEqual(SignedAttempt.objects.count(), 1)
            self.assertFalse(WhitelistEntry.objects.filter(pk=self.entry.pk).exists())
            self.assertFalse(WhitelistApproval.objects.filter(entry=replacement).exists())
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_customer_wallet_address_edit_cannot_receive_the_original_address_receipt(self):
        self.node.confirmed = False
        with use_operator():
            wallet = self.entry.wallet
            customer = wallet.user_account.user_profile.user
            original = changes.submit(uuid4(), "add", ADDRESS, self.actor, company=self.company)
            attempt = SignedAttempt.objects.get()
        self.signed_in_as(customer)
        response = self.client.patch(f"/api/wallets/{wallet.pk}/", {"address": "0x" + "b" * 40}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        with use_operator():
            self.node.receipts[attempt.tx_hash] = receipt(attempt)
            recovered = changes.recover(original.pk)
            self.assertEqual(recovered.status, "confirmed")
            self.assertIsNone(recovered.approval)
            self.assertEqual(WhitelistApproval.objects.get(entry=self.entry).status, "pending")
        self.assertEqual(len(self.node.broadcasts), 1)
