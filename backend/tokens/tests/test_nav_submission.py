from contextlib import contextmanager
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from rest_framework.exceptions import PermissionDenied

from blockchain.models import OutgoingOperation, SignedAttempt
from blockchain.tests.outgoing_fixtures import CHAIN_ID, KEY
from shared.db import atomic, current_alias
from shared.tests.tenants import make_tenant
from tokens.exceptions import NAVUpdateConflict
from tokens.models import NAVUpdate, YieldToken
from tokens.services import nav, nav_recovery
from tokens.tasks.nav import recover_nav_update
from tokens.tests.nav_fixtures import install_nav
from tokens.tests.test_mint_admin import TEST_STORAGES


@override_settings(STORAGES=TEST_STORAGES, BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class NAVSubmissionTest(TransactionTestCase):
    def setUp(self):
        install_nav(self, submit=False)

    def submit(self, submission_id=None, **changes):
        values = {"new_nav_per_token": "1.25", "total_reserve_value": "500", "update_on_chain": True}
        return nav.submit(self.token, self.tenant.user, submission_id or uuid4(), **(values | changes))

    def jobs(self, submission_id):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT args FROM procrastinate_jobs WHERE task_name=%s AND args->>'submission_id'=%s",
                [recover_nav_update.name, str(submission_id)],
            )
            return cursor.fetchall()

    def test_admission_and_exact_job_commit_without_rpc_and_same_uuid_has_one_job(self):
        with patch.object(
            nav_recovery, "get_base_chain_client", side_effect=AssertionError("Recovery owns RPC")
        ) as provider:
            update = self.submit()
            replay = self.submit(update.pk)
            provider.assert_not_called()
            with self.assertRaisesMessage(AssertionError, "Recovery owns RPC"):
                nav_recovery.recover(update.pk)
        self.assertEqual((update.pk, update.status), (replay.pk, "queued"))
        self.assertEqual(NAVUpdate.objects.count(), 1)
        self.assertEqual(len(self.jobs(update.pk)), 1)
        self.token.refresh_from_db()
        self.assertEqual(self.token.nav_per_token, Decimal("1.02"))

    def test_queue_failure_rolls_back_admission_and_all_valuation_changes(self):
        with patch.object(recover_nav_update, "defer", side_effect=DatabaseError("Synthetic queue failure")):
            with self.assertRaises(DatabaseError):
                self.submit()
        self.assertFalse(NAVUpdate.objects.exists())
        self.assertFalse(self.asset.snapshots.exists())

    def test_commit_acknowledgement_loss_replays_original_row_and_job(self):
        submission_id = uuid4()
        original = nav.target_transaction

        @contextmanager
        def commit_then_disconnect(*args):
            with original(*args):
                yield
            raise ConnectionError("Synthetic admission commit acknowledgement loss")

        with patch.object(nav, "target_transaction", commit_then_disconnect), self.assertRaises(ConnectionError):
            self.submit(submission_id)
        self.assertEqual(self.submit(submission_id).status, "queued")
        self.assertEqual(len(self.jobs(submission_id)), 1)
        self.assertEqual(NAVUpdate.objects.count(), 1)

    def test_local_mode_needs_no_chain_configuration_or_job_and_replay_cannot_restore_old_value(self):
        with override_settings(BLOCKCHAIN_OPERATOR_KEY="", BLOCKCHAIN_CHAIN_ID=None), patch.object(
            nav, "get_base_chain_client", side_effect=AssertionError("No chain for local NAV")
        ):
            first = self.submit(update_on_chain=False)
            second = self.submit(update_on_chain=False, new_nav_per_token="1.75")
            self.assertEqual(self.submit(first.pk, update_on_chain=False).completed_at, first.completed_at)
        self.assertEqual((first.status, second.status), ("applied", "applied"))
        self.assertEqual(self.jobs(first.pk), [])
        self.assertFalse(OutgoingOperation.objects.exists())
        self.token.refresh_from_db()
        self.assertEqual(self.token.nav_per_token, Decimal("1.75"))

    def test_every_economic_and_authority_change_on_replay_is_refused(self):
        update = self.submit()
        for values in (
            {"new_nav_per_token": "2"},
            {"total_reserve_value": "2"},
            {"custodian_report_ref": "different"},
            {"notes": "different"},
            {"update_on_chain": False},
        ):
            with self.subTest(values=values), self.assertRaises(NAVUpdateConflict):
                self.submit(update.pk, **values)
        other = make_tenant("nav-other", staff=True, superuser=True)
        with self.assertRaises(NAVUpdateConflict):
            nav.submit(self.token, other.user, update.pk, "1.25", "500", update_on_chain=True)
        self.assertEqual(len(self.jobs(update.pk)), 1)

    def test_amounts_must_be_finite_positive_nav_nonnegative_reserve_and_exact_units(self):
        for field, value in (
            ("new_nav_per_token", "0"),
            ("new_nav_per_token", "-1"),
            ("new_nav_per_token", "NaN"),
            ("new_nav_per_token", "Infinity"),
            ("new_nav_per_token", "1.0000001"),
            ("new_nav_per_token", "1e14"),
            ("total_reserve_value", "-1"),
        ):
            with self.subTest(field=field, value=value), self.assertRaises(NAVUpdateConflict):
                self.submit(**{field: value})
        YieldToken.objects.filter(pk=self.token.pk).update(decimals=2)
        self.token.refresh_from_db()
        with self.assertRaises(NAVUpdateConflict):
            self.submit(new_nav_per_token="1.001")
        self.assertFalse(NAVUpdate.objects.exists())
        self.assertEqual(self.submit(new_nav_per_token="1.01", total_reserve_value="0").intent["nav_raw"], "101")

    def test_staff_requires_fresh_change_permission_not_cached_superuser_or_staff_flags(self):
        self.assertTrue(self.tenant.user.has_perm("tokens.change_yieldtoken"))
        get_user_model().objects.filter(pk=self.tenant.user.pk).update(is_superuser=False)
        with self.assertRaises(PermissionDenied):
            self.submit()
        self.tenant.user.user_permissions.add(Permission.objects.get(codename="change_yieldtoken"))
        self.assertEqual(self.submit().status, "queued")

    def test_outer_transaction_and_missing_uuid_cannot_admit(self):
        with self.assertRaises(NAVUpdateConflict), atomic():
            self.submit()
        with self.assertRaises(NAVUpdateConflict):
            nav.submit(self.token, self.tenant.user, None, "1", "0")
        self.assertFalse(NAVUpdate.objects.exists())

    def test_duplicate_contract_under_another_token_cannot_bypass_unresolved_barrier(self):
        first = self.submit()
        duplicate = YieldToken.objects.create(
            name="Duplicate target", symbol="OTHER", contract_address="0x" + self.token.contract_address[2:].upper()
        )
        for chain in (True, False):
            refused = nav.submit(duplicate, self.tenant.user, uuid4(), "2", "1", update_on_chain=chain)
            self.assertEqual(refused.status, "failed")
            self.assertIsNotNone(refused.completed_at)
            self.assertEqual(self.jobs(refused.pk), [])
        self.assertEqual(len(self.jobs(first.pk)), 1)

    def test_staff_form_retains_signed_uuid_and_redirects_retries_to_original_pending_outcome_without_rpc(self):
        get_user_model().objects.filter(pk=self.tenant.user.pk).update(is_superuser=False)
        self.tenant.user.user_permissions.add(Permission.objects.get(codename="change_yieldtoken"))
        self.client.force_login(self.tenant.user)
        path = reverse("admin:tokens_yieldtoken_update_nav", args=[self.token.pk])
        with patch.object(nav, "chain_info", return_value=None):
            response = self.client.get(path, follow=True)
        self.assertEqual(response.status_code, 200)
        confirmation = response.context["form"].initial["submission"]
        values = {
            "submission": confirmation,
            "nav_per_token": "1.25",
            "total_reserve_value": "500",
            "update_on_chain": "on",
        }
        with patch.object(nav, "chain_info", side_effect=AssertionError("Admission cannot wait for RPC")):
            first = self.client.post(path, values)
            second = self.client.post(path, values)
        update = NAVUpdate.objects.get()
        expected = reverse("admin:tokens_navupdate_change", args=[update.pk])
        self.assertEqual((first.status_code, first.url, second.url), (302, expected, expected))
        self.assertEqual(len(self.jobs(update.pk)), 1)
        detail = self.client.get(expected)
        self.assertContains(detail, "Queued")
        self.assertContains(detail, str(update.pk))

    def test_staff_form_rejects_missing_tampered_and_other_actor_confirmation(self):
        self.client.force_login(self.tenant.user)
        path = reverse("admin:tokens_yieldtoken_update_nav", args=[self.token.pk])
        other = make_tenant("nav-form-other", staff=True, superuser=True)
        for value in ("", "tampered", nav.confirmation(self.token, other.user, uuid4())):
            response = self.client.post(
                path, {"submission": value, "nav_per_token": "1.25", "total_reserve_value": "500"}
            )
            self.assertEqual(response.status_code, 200)
            self.assertTrue(response.context["form"].errors)
        self.assertFalse(NAVUpdate.objects.exists())

    def test_admin_action_requires_model_permission_and_blocks_customer(self):
        path = reverse("admin:tokens_yieldtoken_update_nav", args=[self.token.pk])
        for staff in (False, True):
            actor = make_tenant(f"nav-no-perm-{staff}", staff=staff)
            self.client.force_login(actor.user)
            response = self.client.post(path, {"nav_per_token": "1", "total_reserve_value": "0"})
            self.assertIn(response.status_code, (302, 403))
        self.assertFalse(NAVUpdate.objects.exists())

    def test_form_reload_and_back_keep_original_uuid_before_and_after_completion(self):
        self.client.force_login(self.tenant.user)
        path = reverse("admin:tokens_yieldtoken_update_nav", args=[self.token.pk])
        initial = self.client.get(path)
        self.assertEqual(initial.status_code, 302)
        canonical = initial.url
        with patch.object(nav, "chain_info", return_value=None):
            first = self.client.get(canonical)
            reload = self.client.get(canonical)
        signed = first.context["form"].initial["submission"]
        submission_id = nav.submission_from_confirmation(signed, self.token, self.tenant.user)
        self.assertEqual(
            nav.submission_from_confirmation(
                reload.context["form"].initial["submission"], self.token, self.tenant.user
            ),
            submission_id,
        )
        values = {
            "submission": signed,
            "nav_per_token": "1.25",
            "total_reserve_value": "500",
            "update_on_chain": "on",
        }
        expected = reverse("admin:tokens_navupdate_change", args=[submission_id])
        with patch.object(nav, "chain_info", side_effect=AssertionError("Replay cannot read today's chain values")):
            self.assertRedirects(self.client.post(canonical, values), expected)
            self.assertRedirects(self.client.get(canonical), expected)
            nav_recovery.recover(submission_id)
            self.assertRedirects(self.client.get(canonical), expected)
            self.submit(update_on_chain=False, new_nav_per_token="1.75")
            self.assertRedirects(self.client.get(canonical), expected)
            self.assertRedirects(self.client.post(canonical, values), expected)
        self.assertEqual(NAVUpdate.objects.count(), 2)
        self.assertEqual(len(self.jobs(submission_id)), 1)
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(len(self.node.broadcasts), 1)
        self.token.refresh_from_db()
        self.assertEqual(self.token.nav_per_token, Decimal("1.75"))
        self.assertNotEqual(self.client.get(path).url, canonical)

    def test_form_rejects_malformed_foreign_and_historical_url_identity_without_rpc(self):
        self.client.force_login(self.tenant.user)
        path = reverse("admin:tokens_yieldtoken_update_nav", args=[self.token.pk])
        other = make_tenant("nav-url-other", staff=True, superuser=True)
        foreign_actor = nav.submit(self.token, other.user, uuid4(), "1", "0")
        other_token = YieldToken.objects.create(name="Other", symbol="OTHER")
        foreign_token = nav.submit(other_token, self.tenant.user, uuid4(), "1", "0")
        historical = NAVUpdate.objects.create(
            yield_token=self.token,
            updated_by=self.tenant.user,
            old_nav_per_token="1",
            new_nav_per_token="1",
            total_reserve_value="0",
        )
        with patch.object(nav, "chain_info", side_effect=AssertionError("Invalid identity cannot reach RPC")):
            for value in ("", "broken", str(foreign_actor.pk), str(foreign_token.pk), str(historical.pk)):
                with self.subTest(value=value):
                    self.assertEqual(self.client.get(path, {"submission": value}).status_code, 400)
            self.assertEqual(self.client.get(f"{path}?submission={uuid4()}&submission={uuid4()}").status_code, 400)
        self.assertEqual(NAVUpdate.objects.count(), 3)
        self.assertFalse(OutgoingOperation.objects.exists())

    def test_form_rejects_query_and_signed_identity_mismatch_without_admission(self):
        self.client.force_login(self.tenant.user)
        path = reverse("admin:tokens_yieldtoken_update_nav", args=[self.token.pk])
        with patch.object(nav, "chain_info", return_value=None):
            response = self.client.get(path, follow=True)
        values = {
            "submission": response.context["form"].initial["submission"],
            "nav_per_token": "1.25",
            "total_reserve_value": "500",
        }
        response = self.client.post(f"{path}?submission={uuid4()}", values)
        self.assertEqual(response.status_code, 400)
        self.assertFalse(NAVUpdate.objects.exists())
