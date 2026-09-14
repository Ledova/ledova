from unittest.mock import patch
from uuid import uuid4

from django.db import DatabaseError
from django.test import TransactionTestCase, override_settings

from blockchain.models import BlockchainTransaction, OutgoingOperation, SignedAttempt
from shared.db import atomic
from tokens.exceptions import CapitalIncreaseConflict
from tokens.models import CapitalIncreaseExecution, CapitalIncreaseRequest, ShareToken
from tokens.services import capital_execution
from tokens.services.capital_increase import submit_capital_increase
from tokens.tasks import recover_capital_increases
from tokens.tests.capital_fixtures import CHAIN_ID, KEY, admit, install_capital


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
class SupersededCapitalIncreaseTest(TransactionTestCase):
    def setUp(self):
        install_capital(self)

    def execute(self):
        command = admit(self.request, self.actor)
        return capital_execution.recover(command.pk)

    def draft(self, target=1200, **fields):
        return CapitalIncreaseRequest.objects.create(
            token=self.token,
            additional_shares=target - 1000,
            new_authorized_total=target,
            purpose="Later capital request",
            board_resolution_reference="LATER-BOARD",
            **fields,
        )

    def test_known_unsigned_overtaken_request_is_retired_without_adopting_a_transaction(self):
        for cap in (1100, 1500):
            with self.subTest(cap=cap):
                ShareToken.objects.filter(pk=self.token.pk).update(total_supply=str(cap))
                result = self.execute()
                self.assertEqual(result["status"], "superseded")
                self.assertIsNone(result["tx_hash"])
        command = CapitalIncreaseExecution.objects.get()
        self.assertIsNotNone(command.projected_at)
        self.assertIsNone(command.operation_id)
        self.assertFalse(OutgoingOperation.objects.exists())
        self.node.client.assert_expected_chain.assert_not_called()
        self.request.refresh_from_db()
        self.assertIsNone(self.request.executed_at)
        self.assertFalse(self.request.can_be_executed or self.request.can_be_edited)
        replacement = self.draft(1600)
        submit_capital_increase(replacement, self.tenant.user)
        self.assertEqual(replacement.status, "submitted")

    def test_attributable_revert_can_be_superseded_after_a_later_cap(self):
        self.node.receipt_status = 0
        self.assertEqual(self.execute()["status"], "failed")
        original = BlockchainTransaction.objects.get()
        ShareToken.objects.filter(pk=self.token.pk).update(total_supply="1500")
        self.assertEqual(self.execute()["status"], "superseded")
        original.refresh_from_db()
        self.assertEqual(original.status, "reverted")
        self.assertEqual(SignedAttempt.objects.count(), 1)
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_accepted_signed_uncertainty_cannot_be_superseded_or_have_its_cap_rewritten(self):
        self.node.confirmed = False
        self.assertEqual(self.execute()["status"], "executing")
        for model, changes in (
            (CapitalIncreaseRequest, {"status": "superseded"}),
            (ShareToken, {"total_supply": "1500"}),
        ):
            pk = self.request.pk if model is CapitalIncreaseRequest else self.token.pk
            with self.assertRaises(DatabaseError), atomic():
                model.objects.filter(pk=pk).update(**changes)
        self.assertEqual(CapitalIncreaseRequest.objects.get(pk=self.request.pk).status, "executing")
        self.assertEqual(BlockchainTransaction.objects.get().status, "submitted")

    def test_historical_hashless_failure_blocks_new_execution_without_being_adopted(self):
        old = self.draft(dispatch_id=None, status="failed")
        before = CapitalIncreaseRequest.objects.filter(pk=old.pk).values().get()
        with self.assertRaisesMessage(CapitalIncreaseConflict, "attribution"):
            self.execute()
        self.assertEqual(CapitalIncreaseRequest.objects.filter(pk=old.pk).values().get(), before)
        self.assertFalse(CapitalIncreaseExecution.objects.exists())
        self.node.client.assert_expected_chain.assert_not_called()

    def test_historical_terminal_labels_and_hashes_cannot_supply_new_authority(self):
        old = self.draft(dispatch_id=None, status="failed")
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
        self.assertFalse(SignedAttempt.objects.exists())

    def test_historical_request_itself_is_not_admitted_or_swept(self):
        old = self.draft(dispatch_id=None, status="failed")
        with self.assertRaises(CapitalIncreaseConflict):
            admit(old, self.actor)
        with patch("tokens.services.capital_execution.recover") as recover:
            self.assertEqual(recover_capital_increases(), {"checked": 0, "resolved": 0})
        recover.assert_not_called()
        with self.assertRaises(DatabaseError), atomic():
            CapitalIncreaseRequest.objects.filter(pk=old.pk).update(dispatch_id=self.request.dispatch_id)

    def test_current_request_with_unexplained_transaction_cannot_be_retired_as_unsigned(self):
        ShareToken.objects.filter(pk=self.token.pk).update(total_supply="1500")
        BlockchainTransaction.objects.create(
            tx_hash="0x" + "ab" * 32,
            tx_type="other",
            status="submitted",
            function_name="setAuthorizedShares",
            related_model=self.request._meta.label,
            related_uuid=self.request.pk,
        )
        with self.assertRaises(CapitalIncreaseConflict):
            self.execute()
        self.assertEqual(CapitalIncreaseRequest.objects.get(pk=self.request.pk).status, "approved")
        self.assertFalse(CapitalIncreaseExecution.objects.exists())

    def test_retry_cannot_rewrite_approved_prior_cap_even_if_target_still_exceeds_it(self):
        self.node.client.estimate_gas.side_effect = RuntimeError("Synthetic preparation refusal")
        self.assertEqual(self.execute()["status"], "failed")
        ShareToken.objects.filter(pk=self.token.pk).update(total_supply="1050")
        with self.assertRaisesMessage(CapitalIncreaseConflict, "prior cap changed"):
            self.execute()
        self.assertEqual(CapitalIncreaseExecution.objects.get().intent["prior_authorized_total"], "1000")
        self.assertFalse(SignedAttempt.objects.exists())

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
        self.node.client.assert_expected_chain.assert_not_called()

    def test_unexplained_extra_history_on_a_converted_request_refuses_its_retry(self):
        self.node.receipt_status = 0
        self.assertEqual(self.execute()["status"], "failed")
        original = SignedAttempt.objects.get()
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
        self.assertEqual(SignedAttempt.objects.get().pk, original.pk)
        self.assertEqual(len(self.node.broadcasts), 1)
