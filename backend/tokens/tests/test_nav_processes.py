import json
import os
import signal
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.db import connections
from django.test import TransactionTestCase, override_settings
from django.urls import reverse

from blockchain.models import SignedAttempt, SigningAccount
from blockchain.tests.outgoing_fixtures import CHAIN_ID, KEY
from blockchain.tests.test_outgoing_processes import finish
from shared.db import atomic, current_alias
from tokens.admin.yield_token import YieldTokenAdmin
from tokens.models import NAVUpdate, YieldToken
from tokens.services import nav_recovery
from tokens.tasks.nav import recover_nav_update
from tokens.tests.nav_fixtures import install_nav
from tokens.tests.test_mint_admin import TEST_STORAGES


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class NAVProcessTest(TransactionTestCase):
    def setUp(self):
        install_nav(self)

    def worker(self, directory, phase, *extra):
        database = connections[current_alias()].settings_dict
        fields = ("ENGINE", "NAME", "USER", "PASSWORD", "HOST", "PORT", "OPTIONS")
        env = os.environ.copy()
        env["NAV_TEST_DATABASE"] = json.dumps({key: database[key] for key in fields})
        return subprocess.Popen(
            [
                sys.executable,
                "-m",
                "tokens.tests.nav_worker",
                str(directory),
                phase,
                str(self.update.pk),
                *map(str, extra),
            ],
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )

    def attempts(self):
        return SignedAttempt.objects.filter(operation__operation_key=f"nav-update:{self.update.pk}")

    def recover_killed(self, phase, signed):
        with tempfile.TemporaryDirectory(prefix="nav-crash-") as temporary:
            directory = Path(temporary)
            code, out, err = finish(self.worker(directory, phase))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            self.assertEqual(self.attempts().count(), int(signed))
            original = self.attempts().first()
            code, out, err = finish(self.worker(directory, "recover"))
            self.assertEqual(code, 0, out + err)
            self.assertEqual(json.loads(out)["status"], "confirmed")
            self.update.refresh_from_db()
            self.token.refresh_from_db()
            self.assertEqual(self.token.nav_per_token, self.update.new_nav_per_token)
            self.assertEqual(self.attempts().count(), 1)
            attempt = self.attempts().get()
            self.assertEqual(self.update.operation.current_attempt.tx_hash, attempt.tx_hash)
            if original:
                self.assertEqual(
                    (attempt.tx_hash, bytes(attempt.raw_transaction), attempt.nonce),
                    (original.tx_hash, bytes(original.raw_transaction), original.nonce),
                )
            ledger = json.loads((directory / "node.json").read_text())
            self.assertEqual(ledger["hashes"], [attempt.tx_hash])
            self.assertEqual(len(ledger["broadcasts"]), 1)
            self.assertEqual(SigningAccount.objects.get().next_nonce, 8)

    def test_kill_after_signing_decision_recovers_admitted_nav(self):
        self.recover_killed("decided", False)

    def test_kill_after_open_before_binding_recovers_original_operation(self):
        self.recover_killed("opened", False)

    def test_kill_before_signed_commit_rolls_back_bytes_and_nonce(self):
        self.recover_killed("before_commit", False)

    def test_kill_after_signed_commit_recovers_original_bytes(self):
        self.recover_killed("signed", True)

    def test_kill_after_provider_acceptance_recovers_original_receipt_without_send(self):
        self.recover_killed("accepted", True)

    def test_kill_after_revert_receipt_retains_it_before_retry(self):
        with tempfile.TemporaryDirectory(prefix="nav-revert-") as temporary:
            directory = Path(temporary)
            code, out, err = finish(self.worker(directory, "reverted"))
            self.assertEqual(code, -signal.SIGKILL, out + err)
            self.update.refresh_from_db()
            self.assertEqual(self.update.operation.status, "reverted")
            self.assertEqual(self.update.status, "executing")
            code, out, err = finish(self.worker(directory, "recover"))
            self.assertEqual(code, 0, out + err)
            self.assertEqual(json.loads(out)["status"], "failed")
            self.update.refresh_from_db()
            self.assertEqual(self.update.status, "failed")
            self.assertIsNotNone(self.update.completed_at)
            self.assertEqual(self.attempts().count(), 1)

    def test_independent_workers_share_one_attempt_and_nonce(self):
        self.race()
        self.assertEqual(self.attempts().count(), 1)
        self.assertEqual(SigningAccount.objects.get().next_nonce, 8)

    def race(self, phase="race", *extra):
        with tempfile.TemporaryDirectory(prefix="nav-race-") as temporary:
            directory = Path(temporary)
            processes = [self.worker(directory, phase, *extra) for _ in range(2)]
            try:
                until = time.monotonic() + 20
                while len(list(directory.glob("ready-*"))) != 2 and time.monotonic() < until:
                    time.sleep(0.01)
                self.assertEqual(len(list(directory.glob("ready-*"))), 2)
                (directory / "go").touch()
                for process in processes:
                    code, out, err = finish(process)
                    self.assertEqual(code, 0, out + err)
                    self.assertIn(json.loads(out)["status"], ("executing", "confirmed"))
                self.update.refresh_from_db()
                self.assertEqual(self.update.status, "confirmed")
            finally:
                for process in processes:
                    if process.poll() is None:
                        process.kill()
                        process.communicate()

    def test_kill_after_outcome_retains_barrier_until_projection_finishes(self):
        self.recover_killed("outcome", True)

    def test_kill_after_completion_replays_without_touching_token_or_signer(self):
        self.recover_killed("completed", True)

    def revoke_during_target_wait(self, revoke):
        with tempfile.TemporaryDirectory(prefix="nav-authority-") as temporary:
            directory = Path(temporary)
            process = self.worker(directory, "sign_wait")
            try:
                until = time.monotonic() + 20
                while not (directory / "sign-ready").exists() and time.monotonic() < until:
                    time.sleep(0.01)
                self.assertTrue((directory / "sign-ready").exists())
                process_id = int((directory / "sign-ready").read_text())
                with atomic():
                    YieldToken.objects.select_for_update().get(pk=self.update.yield_token_id)
                    (directory / "sign-go").touch()
                    blocked = False
                    until = time.monotonic() + 15
                    with connections[current_alias()].cursor() as cursor:
                        while time.monotonic() < until:
                            cursor.execute("SELECT pg_stat_clear_snapshot()")
                            cursor.execute(
                                "SELECT wait_event_type, query FROM pg_stat_activity WHERE pid=%s", [process_id]
                            )
                            observed = cursor.fetchone()
                            if observed and observed[0] == "Lock" and "tokens_yieldtoken" in observed[1]:
                                blocked = True
                                break
                            time.sleep(0.01)
                    self.assertTrue(blocked, "The signing callback must actually wait on the target row")
                    revoke()
                code, out, err = finish(process)
                self.assertEqual(code, 0, out + err)
                self.assertEqual(json.loads(out), {"status": "failed", "completed": True})
                self.assertFalse(self.attempts().exists())
                self.assertFalse((directory / "node.json").exists())
            finally:
                if process.poll() is None:
                    process.kill()
                    process.communicate()

    def test_actor_deactivated_while_signing_waits_cannot_use_the_earlier_authority_read(self):
        self.revoke_during_target_wait(
            lambda: get_user_model().objects.filter(pk=self.tenant.user.pk).update(is_active=False)
        )

    def test_staff_permission_revoked_while_signing_waits_is_rechecked_after_the_lock(self):
        permission = Permission.objects.get(codename="change_yieldtoken")
        get_user_model().objects.filter(pk=self.tenant.user.pk).update(is_superuser=False)
        self.tenant.user.user_permissions.add(permission)
        self.revoke_during_target_wait(lambda: self.tenant.user.user_permissions.remove(permission))

    @override_settings(STORAGES=TEST_STORAGES)
    def test_stale_admin_metadata_post_preserves_nav_completed_by_another_process(self):
        self.client.force_login(self.tenant.user)
        original = YieldTokenAdmin.save_model
        observed = []

        def save_after_nav(model_admin, request, obj, form, change):
            with tempfile.TemporaryDirectory(prefix="nav-admin-stale-") as temporary:
                code, out, err = finish(self.worker(Path(temporary), "recover"))
                self.assertEqual(code, 0, out + err)
                self.assertEqual(json.loads(out)["status"], "confirmed")
            observed.append((obj.nav_per_token, YieldToken.objects.get(pk=obj.pk).nav_per_token))
            return original(model_admin, request, obj, form, change)

        with patch.object(YieldTokenAdmin, "save_model", save_after_nav):
            response = self.client.post(
                reverse("admin:tokens_yieldtoken_change", args=[self.token.pk]),
                {
                    "name": "Renamed NAV",
                    "symbol": self.token.symbol,
                    "contract_address": self.token.contract_address,
                    "decimals": self.token.decimals,
                    "is_active": "on",
                },
            )
        self.assertEqual(response.status_code, 302, response.content)
        self.assertEqual(len(observed), 1)
        self.assertNotEqual(*observed[0])
        self.token.refresh_from_db()
        self.update.refresh_from_db()
        self.asset.refresh_from_db()
        self.assertEqual(self.token.name, "Renamed NAV")
        self.assertEqual(self.token.nav_per_token, self.update.new_nav_per_token)
        self.assertEqual(self.token.nav_per_token, self.asset.current_price)
        self.assertEqual(self.token.last_nav_update, self.update.completed_at)

    def race_admission(self, same_uuid):
        nav_recovery.recover(self.update.pk)
        ids = [uuid4(), uuid4()]
        if same_uuid:
            ids[1] = ids[0]
        with tempfile.TemporaryDirectory(prefix="nav-admit-") as temporary:
            directory = Path(temporary)
            processes = [self.worker(directory, "admit", submission_id) for submission_id in ids]
            try:
                until = time.monotonic() + 20
                while len(list(directory.glob("ready-*"))) != 2 and time.monotonic() < until:
                    time.sleep(0.01)
                self.assertEqual(len(list(directory.glob("ready-*"))), 2)
                (directory / "go").touch()
                outcomes = []
                for process in processes:
                    code, out, err = finish(process)
                    self.assertEqual(code, 0, out + err)
                    outcomes.append(json.loads(out)["status"])
                self.assertEqual(sorted(outcomes), ["queued", "queued"] if same_uuid else ["failed", "queued"])
            finally:
                for process in processes:
                    if process.poll() is None:
                        process.kill()
                        process.communicate()
        rows = NAVUpdate.objects.filter(pk__in=ids)
        self.assertEqual(rows.count(), 1 if same_uuid else 2)
        self.assertEqual(rows.filter(status="queued").count(), 1)
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT count(*) FROM procrastinate_jobs WHERE task_name=%s AND args->>'submission_id' IN (%s,%s)",
                [recover_nav_update.name, *map(str, ids)],
            )
            self.assertEqual(cursor.fetchone()[0], 1)

    def test_independent_admission_of_same_uuid_commits_one_row_and_job(self):
        self.race_admission(True)

    def test_independent_competing_uuids_commit_one_admission_and_permanent_refusal(self):
        self.race_admission(False)
