from contextlib import contextmanager
from unittest.mock import patch
from uuid import uuid4

from django.db import DatabaseError, connections
from django.test import override_settings
from rest_framework.test import APITransactionTestCase

from blockchain.tests.outgoing_fixtures import CHAIN_ID, KEY
from shared.db import atomic, current_alias
from shared.tests.tenants import make_tenant
from tokens.exceptions import PauseChangeConflict
from tokens.models import PauseChange
from tokens.services import pause_changes, pause_recovery
from tokens.tasks.pause import recover_pause_change
from tokens.tests.pause_fixtures import PauseNode


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class PauseSubmissionTest(APITransactionTestCase):
    def setUp(self):
        self.tenant = make_tenant("pause-owner")
        self.token = self.tenant.deployed_token
        self.client.force_authenticate(self.tenant.user)

    def test_admission_answers_pending_without_waiting_for_the_provider(self):
        submission_id = uuid4()
        with patch(
            "tokens.services.share_token_service.get_base_chain_client",
            side_effect=AssertionError("A provider cannot decide whether admission committed"),
        ), patch.object(
            pause_recovery, "get_base_chain_client", side_effect=AssertionError("Only recovery contacts the provider")
        ) as provider:
            response = self.client.post(
                f"/api/v1/tokens/{self.token.pk}/pause/", {"submissionId": str(submission_id)}, format="json"
            )
            provider.assert_not_called()
            with self.assertRaisesMessage(AssertionError, "Only recovery"):
                pause_recovery.recover(submission_id)
        self.assertEqual(response.status_code, 202, response.content)
        self.assertEqual(response.json()["submission"]["uuid"], str(submission_id))
        self.assertEqual(response.json()["submission"]["status"], "pending")
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, "deployed")

    def post(self, submission_id, paused=True, token=None):
        token = token or self.token
        return self.client.post(
            f"/api/v1/tokens/{token.pk}/{'pause' if paused else 'unpause'}/",
            {"submissionId": str(submission_id)},
            format="json",
        )

    def jobs(self, submission_id):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT args FROM procrastinate_jobs WHERE task_name=%s AND args->>'submission_id'=%s",
                [recover_pause_change.name, str(submission_id)],
            )
            return cursor.fetchall()

    def test_exact_submission_and_job_commit_together_and_repeated_posts_do_not_duplicate_either(self):
        submission_id = uuid4()
        first = self.post(submission_id)
        self.assertEqual(first.status_code, 202)
        self.assertEqual(self.post(submission_id).json(), first.json())
        self.assertEqual(PauseChange.objects.count(), 1)
        self.assertEqual(len(self.jobs(submission_id)), 1)
        self.assertEqual(self.post(submission_id, False).status_code, 409)
        self.assertEqual(self.post(uuid4(), False).json()["submission"]["status"], "failed")

    def test_enqueue_failure_rolls_back_admission(self):
        submission_id = uuid4()
        with patch.object(recover_pause_change, "defer", side_effect=DatabaseError("Synthetic queue failure")):
            with self.assertRaises(DatabaseError):
                pause_changes.submit(self.token, self.tenant.user, submission_id, True)
        self.assertFalse(PauseChange.objects.exists())
        self.assertEqual(self.jobs(submission_id), [])

    def test_competing_refusal_is_permanent_and_does_not_gain_a_job_after_later_opposite_intent(self):
        first_id, refused_id, unpause_id = uuid4(), uuid4(), uuid4()
        self.assertEqual(self.post(first_id).status_code, 202)
        refused = self.post(refused_id)
        self.assertEqual(refused.status_code, 200, refused.content)
        self.assertEqual(refused.json()["submission"]["status"], "failed")
        self.assertIsNotNone(refused.json()["submission"]["completedAt"])
        self.assertIn("refused before signing", refused.json()["message"])
        self.assertEqual(self.jobs(refused_id), [])
        node = PauseNode(self.token.contract_address)
        with patch.object(pause_recovery, "get_base_chain_client", return_value=node.client):
            node.paused = True
            pause_recovery.recover(first_id)
            self.assertEqual(self.post(unpause_id, False).status_code, 202)
            node.paused = False
            pause_recovery.recover(unpause_id)
        replay = self.post(refused_id)
        self.assertEqual(replay.json()["submission"], refused.json()["submission"])
        self.assertEqual(replay.json()["token"]["status"], "deployed")
        self.assertEqual(self.jobs(refused_id), [])
        self.assertIsNone(PauseChange.objects.get(pk=refused_id).operation_id)

    def test_lost_admission_commit_acknowledgement_recovers_same_command_and_job(self):
        submission_id = uuid4()
        original = pause_changes.target_transaction

        @contextmanager
        def committed_then_disconnect(*args):
            with original(*args):
                yield
            raise ConnectionError("Synthetic admission commit response loss")

        with patch.object(pause_changes, "target_transaction", committed_then_disconnect):
            with self.assertRaises(ConnectionError):
                pause_changes.submit(self.token, self.tenant.user, submission_id, True)
        self.assertEqual(self.post(submission_id).status_code, 202)
        self.assertEqual(PauseChange.objects.count(), 1)
        self.assertEqual(len(self.jobs(submission_id)), 1)

    def test_missing_identity_and_outer_transaction_cannot_admit(self):
        self.assertEqual(self.client.post(f"/api/v1/tokens/{self.token.pk}/pause/", {}, format="json").status_code, 400)
        with self.assertRaisesMessage(PauseChangeConflict, "autocommit"), atomic():
            pause_changes.submit(self.token, self.tenant.user, uuid4(), True)
        self.assertFalse(PauseChange.objects.exists())

    def test_original_outcome_response_is_separate_from_the_current_token_status(self):
        first_id = uuid4()
        self.post(first_id)
        node = PauseNode(self.token.contract_address)
        node.paused = True
        with patch.object(pause_recovery, "get_base_chain_client", return_value=node.client):
            pause_recovery.recover(first_id)
            second_id = uuid4()
            self.post(second_id, False)
            node.paused = False
            pause_recovery.recover(second_id)
        replay = self.post(first_id)
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["submission"]["status"], "observed")
        self.assertTrue(replay.json()["submission"]["paused"])
        self.assertEqual(replay.json()["token"]["status"], "deployed")
        self.assertEqual(len(self.jobs(first_id)), 1)

    def test_all_routes_hide_foreign_token_and_submission_from_staff_and_superusers(self):
        submission_id = uuid4()
        self.post(submission_id)
        self.assertEqual(
            self.client.get(f"/api/v1/tokens/{self.token.pk}/pause-submissions/{submission_id}/").status_code, 202
        )
        for label, staff, superuser in (("other", False, False), ("staff", True, False), ("root", True, True)):
            actor = make_tenant(label, staff=staff, superuser=superuser)
            self.client.force_authenticate(actor.user)
            for target in (self.token.pk, uuid4()):
                self.assertEqual(
                    self.client.get(f"/api/v1/tokens/{target}/pause-submissions/{submission_id}/").status_code, 404
                )
                for verb in ("pause", "unpause"):
                    response = self.client.post(
                        f"/api/v1/tokens/{target}/{verb}/", {"submissionId": str(uuid4())}, format="json"
                    )
                    self.assertEqual(response.status_code, 404)
            self.assertEqual(
                self.client.get(
                    f"/api/v1/tokens/{actor.deployed_token.pk}/pause-submissions/{submission_id}/"
                ).status_code,
                404,
            )
        self.client.force_authenticate(None)
        self.assertIn(self.post(submission_id).status_code, (401, 403))
        self.assertIn(
            self.client.get(f"/api/v1/tokens/{self.token.pk}/pause-submissions/{submission_id}/").status_code,
            (401, 403),
        )
        self.assertEqual(PauseChange.objects.count(), 1)
