from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth.models import Permission
from django.db import DatabaseError
from django.test import override_settings
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITransactionTestCase

from blockchain.models import BlockchainTransaction, SignedAttempt
from shared.db import atomic
from shared.tests.schema import migrate_to, restore_every_migration
from tokens.exceptions import CapitalIncreaseConflict
from tokens.models import CapitalIncreaseExecution, CapitalIncreaseRequest, ShareToken
from tokens.services import capital_execution
from tokens.tasks import recover_capital_increases
from tokens.tests.capital_fixtures import CHAIN_ID, KEY, admit
from tokens.tests.company_capital_fixtures import CompanyCapitalCases
from tokens.tests.retained_capital_fixtures import retain_capital_execution


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class SupersededCapitalIncreaseTest(CompanyCapitalCases, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        self.actor = self.owner
        self.owner.is_staff = True
        self.owner.save(update_fields=["is_staff"])
        self.owner.user_permissions.add(Permission.objects.get(codename="change_capitalincreaserequest"))

    def current_request(self):
        self.proposal = self.prepare_capital()
        self.capital_decide(self.proposal, "approve")
        self.request = self.proposal.request
        return self.request

    def execute(self):
        if not hasattr(self, "request"):
            self.current_request()
        command = admit(self.request, self.actor)
        return capital_execution.recover(command.pk)

    def retain_original(self, signed, superseded=False):
        self.request, command = retain_capital_execution(
            token=self.token, actor=self.actor, client=self.capital_node.client, signed=signed, superseded=superseded
        )
        return command

    def historical_request(self, **fields):
        try:
            migrate_to([("tokens", "0102_company_register_capital_increases")])
            return self.draft(**fields)
        finally:
            restore_every_migration()

    def transactions(self):
        return BlockchainTransaction.objects.filter(
            related_model=self.request._meta.label, related_uuid=self.request.pk
        )

    def attempts(self):
        command = CapitalIncreaseExecution.objects.filter(request_id=self.request.pk).first()
        return (
            SignedAttempt.objects.filter(operation_id=command.operation_id) if command else SignedAttempt.objects.none()
        )

    def draft(self, target=1200, **fields):
        return CapitalIncreaseRequest.objects.create(
            token=self.token,
            additional_shares=target - 1000,
            new_authorized_total=target,
            purpose="Later capital request",
            board_resolution_reference="LATER-BOARD",
            **fields,
        )

    def test_a_retained_unsigned_superseded_outcome_is_never_adopted_or_resigned(self):
        ShareToken.objects.filter(pk=self.token.pk).update(total_supply="1100")
        self.token.refresh_from_db()
        command = self.retain_original(signed=False, superseded=True)
        for cap in (1100, 1500):
            with self.subTest(cap=cap):
                ShareToken.objects.filter(pk=self.token.pk).update(total_supply=str(cap))
                result = capital_execution.recover(command.pk)
                self.assertEqual(result["status"], "superseded")
                self.assertIsNone(result["tx_hash"])
        command.refresh_from_db()
        self.assertIsNotNone(command.projected_at)
        self.assertIsNone(command.operation_id)
        self.assertFalse(self.attempts().exists())
        self.capital_node.client.assert_expected_chain.assert_not_called()
        self.request.refresh_from_db()
        self.assertIsNone(self.request.executed_at)
        self.assertFalse(self.request.can_be_executed or self.request.can_be_submitted)
        self.capital_node.cap = 1500
        replacement = self.prepare_capital(additional_shares=100, new_authorized_total=1600)
        self.assertEqual(replacement.request.status, "under_review")

    def test_attributable_revert_can_be_superseded_after_a_later_cap(self):
        command = self.retain_original(signed=True)
        self.capital_node.receipt_status = 0
        self.assertEqual(capital_execution.recover(command.pk)["status"], "failed")
        original = self.transactions().get()
        ShareToken.objects.filter(pk=self.token.pk).update(total_supply="1500")
        self.assertEqual(self.execute()["status"], "superseded")
        original.refresh_from_db()
        self.assertEqual(original.status, "reverted")
        self.assertEqual(self.attempts().count(), 1)
        self.assertEqual(len(self.capital_node.broadcasts), 1)

    def test_accepted_signed_uncertainty_cannot_be_superseded_or_have_its_cap_rewritten(self):
        command = self.retain_original(signed=True)
        self.capital_node.confirmed = False
        self.assertEqual(capital_execution.recover(command.pk)["status"], "executing")
        for model, changes in (
            (CapitalIncreaseRequest, {"status": "superseded"}),
            (ShareToken, {"total_supply": "1500"}),
        ):
            pk = self.request.pk if model is CapitalIncreaseRequest else self.token.pk
            with self.assertRaises(DatabaseError), atomic():
                model.objects.filter(pk=pk).update(**changes)
        self.assertEqual(CapitalIncreaseRequest.objects.get(pk=self.request.pk).status, "executing")
        self.assertEqual(self.transactions().get().status, "submitted")

    def test_historical_hashless_failure_blocks_new_execution_without_being_adopted(self):
        old = self.historical_request(dispatch_id=None, status="failed")
        before = CapitalIncreaseRequest.objects.filter(pk=old.pk).values().get()
        with self.assertRaisesMessage(CapitalIncreaseConflict, "attribution"):
            self.execute()
        self.assertEqual(CapitalIncreaseRequest.objects.filter(pk=old.pk).values().get(), before)
        self.assertFalse(CapitalIncreaseExecution.objects.exists())
        self.capital_node.client.send_raw_transaction.assert_not_called()

    def test_historical_terminal_labels_and_hashes_cannot_supply_new_authority(self):
        old = self.historical_request(dispatch_id=None, status="failed")
        record = BlockchainTransaction.objects.create(
            tx_hash="0x" + "ab" * 32,
            tx_type="other",
            status="submitted",
            function_name="setAuthorizedShares",
            related_model=old._meta.label,
            related_uuid=old.pk,
            to_address=self.token.contract_address,
        )
        for status in ("failed", "executed", "superseded", "rejected"):
            CapitalIncreaseRequest.objects.filter(pk=old.pk).update(status=status)
            with self.subTest(status=status), self.assertRaises(CapitalIncreaseConflict):
                self.execute()
        record.refresh_from_db()
        self.assertEqual(record.status, "submitted")
        self.assertFalse(self.attempts().exists())

    def test_historical_request_itself_is_not_admitted_or_swept(self):
        old = self.historical_request(dispatch_id=None, status="failed")
        with self.assertRaises(CapitalIncreaseConflict):
            capital_execution.confirmation(old, self.actor)
        with patch("tokens.services.capital_execution.recover") as recover:
            self.assertEqual(recover_capital_increases(), {"checked": 0, "resolved": 0})
        recover.assert_not_called()
        with self.assertRaises(DatabaseError), atomic():
            CapitalIncreaseRequest.objects.filter(pk=old.pk).update(dispatch_id=uuid4())

    def test_current_request_with_unexplained_transaction_cannot_be_retired_as_unsigned(self):
        self.current_request()
        ShareToken.objects.filter(pk=self.token.pk).update(total_supply="1500")
        BlockchainTransaction.objects.create(
            tx_hash="0x" + "ab" * 32,
            tx_type="other",
            status="submitted",
            function_name="setAuthorizedShares",
            related_model=self.request._meta.label,
            related_uuid=self.request.pk,
        )
        with self.assertRaises(ValidationError) as refusal:
            self.execute()
        self.assertIn("capital_terms_changed", refusal.exception.detail["unmet_requirements"])
        self.assertIn("class_identity_changed", refusal.exception.detail["unmet_requirements"])
        self.assertEqual(CapitalIncreaseRequest.objects.get(pk=self.request.pk).status, "under_review")
        self.assertFalse(CapitalIncreaseExecution.objects.exists())

    def test_retry_cannot_rewrite_approved_prior_cap_even_if_target_still_exceeds_it(self):
        self.capital_node.client.estimate_gas.side_effect = RuntimeError("Synthetic preparation refusal")
        self.assertEqual(self.execute()["status"], "failed")
        ShareToken.objects.filter(pk=self.token.pk).update(total_supply="1050")
        with self.assertRaisesMessage(CapitalIncreaseConflict, "prior cap changed"):
            self.execute()
        self.assertEqual(CapitalIncreaseExecution.objects.get().intent["prior_authorized_total"], "1000")
        self.assertFalse(self.attempts().exists())

    def test_orphaned_hash_and_hashless_contract_history_refuse_admission(self):
        for tx_hash in (None, "", "0x" + "ce" * 32):
            record = BlockchainTransaction.objects.create(
                tx_hash=tx_hash,
                tx_type="other",
                status="failed",
                function_name="setAuthorizedShares",
                related_model="tokens.CapitalIncreaseRequest",
                related_uuid=uuid4(),
                to_address=self.token.contract_address.upper().replace("0X", "0x"),
            )
            with self.subTest(tx_hash=tx_hash), self.assertRaises(CapitalIncreaseConflict):
                self.execute()
            record.delete()
        self.assertFalse(CapitalIncreaseExecution.objects.exists())
        self.capital_node.client.send_raw_transaction.assert_not_called()

    def test_unexplained_extra_history_on_a_converted_request_refuses_its_retry(self):
        self.capital_node.receipt_status = 0
        self.assertEqual(self.execute()["status"], "failed")
        original = self.attempts().get()
        BlockchainTransaction.objects.create(
            tx_hash="0x" + "ac" * 32,
            tx_type="other",
            status="submitted",
            function_name="setAuthorizedShares",
            related_model=self.request._meta.label,
            related_uuid=self.request.pk,
            to_address=self.token.contract_address,
        )
        with self.assertRaises(CapitalIncreaseConflict):
            self.execute()
        self.assertEqual(self.attempts().get().pk, original.pk)
        self.assertEqual(len(self.capital_node.broadcasts), 1)
