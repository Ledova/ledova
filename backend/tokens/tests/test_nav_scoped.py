from contextlib import ExitStack
from decimal import Decimal
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings
from rest_framework.exceptions import PermissionDenied

from assets.models import Asset
from blockchain.models import SignedAttempt
from blockchain.tests.outgoing_fixtures import CHAIN_ID, KEY
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
from tokens.models import NAVUpdate, YieldToken
from tokens.services import nav, nav_recovery
from tokens.tasks.nav import recover_nav_update
from tokens.tests.nav_fixtures import install_nav


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class ScopedNAVRecoveryTest(RunsOnTheScopedConnection, TransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            install_nav(self)

    def test_real_task_uses_operator_alias_and_role_and_commits_journal_before_broadcast(self):
        statements = []
        sends = []

        def record_sql(execute, sql, params, many, context):
            if any(name in sql for name in ('"tokens_yieldtoken"', '"tokens_navupdate"', '"assets_asset"')):
                statements.append((context["connection"].alias, sql.split()[0]))
            return execute(sql, params, many, context)

        def send(raw):
            connection = connections[current_alias()]
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_user")
                role = cursor.fetchone()[0]
            current = NAVUpdate.objects.get(pk=self.update.pk)
            sends.append(
                (current_alias(), role, connection.get_autocommit(), current.operation.current_attempt_id is not None)
            )
            return self.node.send(raw)

        self.node.client.send_raw_transaction.side_effect = send
        with ExitStack() as stack:
            for alias in (APP_ALIAS, OPERATOR_ALIAS):
                stack.enter_context(connections[alias].execute_wrapper(record_sql))
            self.assertTrue(recover_nav_update.func(str(self.update.pk))["completed"])
        self.assertEqual(sends, [(OPERATOR_ALIAS, settings.RLS_ROLES[OPERATOR_ALIAS], True, True)])
        self.assertEqual({alias for alias, _ in statements}, {OPERATOR_ALIAS})
        self.assertTrue(any(verb == "UPDATE" for _, verb in statements))
        self.assertIn(principal_of(APP_ALIAS), (None, ""))
        with acting_for(self.tenant.user.pk):
            self.assertEqual(YieldToken.objects.get(pk=self.token.pk).nav_per_token, Decimal("1.25"))
            self.assertEqual(Asset.objects.get(pk=self.asset.pk).current_price, Decimal("1.25"))
            with self.assertRaises(DatabaseError), atomic():
                NAVUpdate.objects.get(pk=self.update.pk)
            with self.assertRaises(DatabaseError), atomic():
                YieldToken.objects.filter(pk=self.token.pk).update(nav_per_token="9")
            with self.assertRaises(PermissionDenied):
                nav_recovery.recover(self.update.pk)

    def test_app_cannot_admit_or_mutate_private_work_and_operator_has_positive_control(self):
        with acting_for(self.tenant.user.pk):
            with self.assertRaises(PermissionDenied):
                nav.submit(self.token, self.tenant.user, uuid4(), "2", "1")
            with self.assertRaises(DatabaseError), atomic():
                NAVUpdate.objects.filter(pk=self.update.pk).update(status="failed")
        with use_operator():
            self.assertIsNotNone(nav_recovery.recover(self.update.pk).completed_at)
            local = nav.submit(self.token, self.tenant.user, uuid4(), "2", "1")
            self.assertEqual(local.status, "applied")

    def test_failed_operator_projection_rolls_back_all_valuation_effects_and_recovers_original_event(self):
        original = NAVUpdate.save

        def fail_completion(row, *args, **kwargs):
            if "completed_at" in kwargs.get("update_fields", ()):
                raise DatabaseError("Synthetic operator projection rollback")
            return original(row, *args, **kwargs)

        with patch.object(NAVUpdate, "save", new=fail_completion), self.assertRaises(DatabaseError):
            recover_nav_update.func(str(self.update.pk))
        with use_operator():
            self.token.refresh_from_db()
            self.update.refresh_from_db()
            self.assertEqual(
                (self.token.nav_per_token, self.update.status, self.update.completed_at),
                (Decimal("1.02"), "confirmed", None),
            )
            self.assertFalse(self.asset.snapshots.exists())
            self.assertEqual(nav.submit(self.token, self.tenant.user, uuid4(), "2", "1").status, "failed")
        with patch.object(nav_recovery, "get_base_chain_client", side_effect=AssertionError("Recorded event")):
            self.assertTrue(recover_nav_update.func(str(self.update.pk))["completed"])
        with use_operator():
            self.assertEqual(self.asset.snapshots.count(), 1)
            self.assertEqual(SignedAttempt.objects.count(), 1)
