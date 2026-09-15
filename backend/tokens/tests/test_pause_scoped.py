from contextlib import ExitStack
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings
from rest_framework.test import APIClient

from blockchain.models import OutgoingOperation, SignedAttempt
from blockchain.tests.outgoing_fixtures import CHAIN_ID, KEY
from companies.models import Company
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
from shared.tests.tenants import make_tenant
from tokens.exceptions import PauseChangeConflict
from tokens.models import PauseChange, ShareToken
from tokens.services import pause_changes, pause_recovery
from tokens.tasks.pause import recover_pause_change
from tokens.tests.pause_fixtures import install_pause


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class ScopedPauseRecoveryTest(RunsOnTheScopedConnection, TransactionTestCase):
    def setUp(self):
        super().setUp()
        with use_operator():
            install_pause(self)
            self.other = make_tenant("other-pause")

    def test_admission_is_private_signing_is_autocommit_and_public_projection_uses_the_issuer_role(self):
        statements = []
        sends = []

        def record_sql(execute, sql, params, many, context):
            if '"tokens_sharetoken"' in sql or '"tokens_pausechange"' in sql:
                statements.append((context["connection"].alias, sql.split()[0], sql))
            return execute(sql, params, many, context)

        def send(raw):
            connection = connections[current_alias()]
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_user")
                role = cursor.fetchone()[0]
            change = PauseChange.objects.get(pk=self.change.pk)
            sends.append(
                (current_alias(), role, connection.get_autocommit(), change.operation.current_attempt is not None)
            )
            return self.node.send(raw)

        self.node.client.send_raw_transaction.side_effect = send
        with ExitStack() as stack:
            for alias in (APP_ALIAS, OPERATOR_ALIAS):
                stack.enter_context(connections[alias].execute_wrapper(record_sql))
            with use_operator():
                self.assertTrue(recover_pause_change.func(str(self.change.pk))["completed"])
        self.assertEqual(sends, [(OPERATOR_ALIAS, settings.RLS_ROLES[OPERATOR_ALIAS], True, True)])
        token_updates = [
            (alias, verb) for alias, verb, sql in statements if verb == "UPDATE" and '"tokens_sharetoken"' in sql
        ]
        self.assertEqual(token_updates, [(APP_ALIAS, "UPDATE")])
        self.assertEqual({alias for alias, _, sql in statements if '"tokens_pausechange"' in sql}, {OPERATOR_ALIAS})
        self.assertIn(principal_of(APP_ALIAS), (None, ""))
        with acting_for(self.tenant.user.pk):
            self.assertEqual(ShareToken.objects.get(pk=self.token.pk).status, "paused")
            with self.assertRaises(DatabaseError), atomic():
                PauseChange.objects.get(pk=self.change.pk)
            with self.assertRaises(DatabaseError), atomic():
                PauseChange.objects.filter(pk=self.change.pk).update(status="observed")
            with self.assertRaises(PauseChangeConflict):
                pause_recovery.recover(self.change.pk)

    def test_lost_projection_commit_acknowledgement_keeps_opposite_blocked_until_same_outcome_finishes(self):
        original = PauseChange.save

        def lose_completion(instance, *args, **kwargs):
            if "completed_at" in kwargs.get("update_fields", ()):
                raise ConnectionError("Synthetic lost scoped commit acknowledgement")
            return original(instance, *args, **kwargs)

        with use_operator():
            with patch.object(PauseChange, "save", new=lose_completion):
                with self.assertRaises(ConnectionError):
                    pause_recovery.recover(self.change.pk)
            self.change.refresh_from_db()
            self.token.refresh_from_db()
            self.assertEqual(
                (self.change.status, self.change.completed_at, self.token.status), ("confirmed", None, "paused")
            )
            refused = pause_changes.submit(self.token, self.tenant.user, uuid4(), False)
            self.assertEqual(refused.status, "failed")
            self.assertIsNotNone(refused.completed_at)
            self.assertIsNotNone(pause_recovery.recover(self.change.pk).completed_at)
            next_change = pause_changes.submit(self.token, self.tenant.user, uuid4(), False)
            pause_recovery.recover(next_change.pk)
            pause_recovery.recover(self.change.pk)
            self.token.refresh_from_db()
            self.assertEqual(self.token.status, "deployed")
            self.assertEqual(SignedAttempt.objects.count(), 2)

    def test_ownership_change_after_signed_confirmation_never_falls_back_to_operator_projection(self):
        with use_operator():
            with patch.object(pause_changes, "project", side_effect=SystemExit):
                with self.assertRaises(SystemExit):
                    pause_recovery.recover(self.change.pk)
            Company.objects.filter(pk=self.token.company_id).update(owner=self.other.user)
            with self.assertRaises(PauseChangeConflict):
                pause_recovery.recover(self.change.pk)
            self.token.refresh_from_db()
            self.change.refresh_from_db()
            self.assertEqual(
                (self.token.status, self.change.status, self.change.completed_at), ("deployed", "confirmed", None)
            )
            Company.objects.filter(pk=self.token.company_id).update(owner=self.tenant.user)
            self.assertIsNotNone(pause_recovery.recover(self.change.pk).completed_at)

    def test_real_scoped_api_replay_reads_only_its_authorized_submission(self):
        client = APIClient()
        client.force_authenticate(self.tenant.user)
        path = f"/api/v1/tokens/{self.token.pk}/pause-submissions/{self.change.pk}/"
        self.assertEqual(client.get(path).status_code, 202)
        response = client.post(
            f"/api/v1/tokens/{self.token.pk}/pause/", {"submissionId": str(self.change.pk)}, format="json"
        )
        self.assertEqual(response.status_code, 202, response.content)
        client.force_authenticate(self.other.user)
        self.assertEqual(client.get(path).status_code, 404)
        with use_operator():
            self.assertEqual(PauseChange.objects.count(), 1)
            self.assertFalse(OutgoingOperation.objects.exists())
