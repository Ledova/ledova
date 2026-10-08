from uuid import uuid4

from django.test import override_settings
from rest_framework.test import APITransactionTestCase

from blockchain.tests.outgoing_fixtures import CHAIN_ID, KEY, admitted_signer
from shared.db import atomic
from shared.tests.tenants import make_tenant
from tokens.models import PauseChange
from tokens.services import pause_changes, pause_recovery
from tokens.tests.pause_fixtures import PauseNode
from tokens.tests.retained_pause_fixtures import retain_pause_change


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class PauseSubmissionTest(APITransactionTestCase):
    def setUp(self):
        self.tenant = make_tenant("pause-owner")
        self.token = self.tenant.deployed_token
        self.client.force_authenticate(self.tenant.user)

    def post(self, submission_id, paused=True, token=None):
        token = token or self.token
        return self.client.post(
            f"/api/v1/tokens/{token.pk}/{'pause' if paused else 'unpause'}/",
            {"submissionId": str(submission_id)},
            format="json",
        )

    def test_fresh_admission_answers_explicit_retirement_without_waiting_for_a_provider(self):
        from unittest.mock import patch

        with patch.object(
            pause_recovery, "get_base_chain_client", side_effect=AssertionError("No fresh issuer recovery")
        ) as provider:
            response = self.post(uuid4())
        self.assertEqual(response.status_code, 409, response.content)
        provider.assert_not_called()
        self.assertFalse(PauseChange.objects.exists())
        self.token.refresh_from_db()
        self.assertEqual(self.token.status, "deployed")

    def test_exact_existing_submission_replays_without_duplicate_and_changed_direction_refuses(self):
        change = retain_pause_change(self.token, self.tenant.user)
        first = self.post(change.pk)
        self.assertEqual(first.status_code, 202, first.content)
        self.assertEqual(self.post(change.pk).json(), first.json())
        self.assertEqual(PauseChange.objects.count(), 1)
        self.assertEqual(self.post(change.pk, False).status_code, 409)
        self.assertEqual(self.post(uuid4(), False).status_code, 409)

    def test_unknown_saved_uuid_is_not_adopted_into_a_company_proposal_or_execution(self):
        self.assertEqual(self.post(uuid4()).status_code, 409)
        self.assertFalse(PauseChange.objects.exists())
        change = retain_pause_change(self.token, self.tenant.user, observed=True)
        self.assertEqual(self.post(change.pk).status_code, 202)
        self.assertIsNone(change.completed_at)

    def test_unsigned_original_does_not_gain_current_signing_or_a_fresh_conflicting_job(self):
        change = retain_pause_change(self.token, self.tenant.user)
        self.assertEqual(self.post(change.pk).status_code, 202)
        self.assertEqual(self.post(uuid4()).status_code, 409)
        node = PauseNode(self.token.contract_address)
        from unittest.mock import patch

        with patch.object(pause_recovery, "get_base_chain_client", return_value=node.client):
            pause_recovery.recover(change.pk)
        self.assertEqual(PauseChange.objects.get(pk=change.pk).status, "pending")
        self.assertFalse(PauseChange.objects.get(pk=change.pk).operation_id)

    def test_lost_legacy_admission_acknowledgement_retains_original_uuid_and_actor(self):
        submission_id = uuid4()
        change = retain_pause_change(self.token, self.tenant.user, submission_id=submission_id)
        response = self.post(submission_id)
        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()["submission"]["uuid"], str(submission_id))
        self.assertEqual(change.initiated_by_id, self.tenant.user.pk)
        self.assertEqual(PauseChange.objects.count(), 1)

    def test_missing_identity_and_outer_transaction_never_admit_fresh_issuer_work(self):
        self.assertEqual(self.client.post(f"/api/v1/tokens/{self.token.pk}/pause/", {}, format="json").status_code, 400)
        from tokens.exceptions import PauseChangeConflict

        with self.assertRaisesMessage(PauseChangeConflict, "autocommit"), atomic():
            pause_changes.submit(self.token, self.tenant.user, uuid4(), True)
        self.assertFalse(PauseChange.objects.exists())

    def test_original_outcome_response_is_separate_from_current_class_state(self):
        admitted_signer()
        first = retain_pause_change(self.token, self.tenant.user, signed=True)
        node = PauseNode(self.token.contract_address)
        from unittest.mock import patch

        with patch.object(pause_recovery, "get_base_chain_client", return_value=node.client):
            pause_recovery.recover(first.pk)
        second = retain_pause_change(self.token, self.tenant.user, paused=False, observed=True)
        pause_changes.project(second.pk)
        response = self.post(first.pk)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["submission"]["status"], "confirmed")
        self.assertEqual(response.json()["token"]["status"], "deployed")

    def test_only_original_issuer_can_read_or_replay_the_saved_submission(self):
        change = retain_pause_change(self.token, self.tenant.user)
        path = f"/api/v1/tokens/{self.token.pk}/pause-submissions/{change.pk}/"
        self.assertEqual(self.client.get(path).status_code, 202)
        other = make_tenant("pause-foreign")
        self.client.force_authenticate(other.user)
        self.assertEqual(self.client.get(path).status_code, 404)
        self.assertEqual(self.post(change.pk).status_code, 404)
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(path).status_code, 401)
        self.assertEqual(PauseChange.objects.count(), 1)
