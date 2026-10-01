import json
from io import StringIO
from unittest.mock import Mock, patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection
from django.test import TransactionTestCase, override_settings

from blockchain.exceptions import LocalSignerAdmissionError
from blockchain.models import SigningAccount
from blockchain.services.local_signer import admit_local_signer
from blockchain.services.outgoing import close_signer_admission, record_receipt
from blockchain.tests.outgoing_fixtures import (
    KEY,
    SENDER,
    chain_client,
    claim_operation,
    receipt,
    sign_claim,
)
from integrations.base_chain.client import BaseChainClient
from shared.db import atomic

LOCAL_CHAIN_ID = 31337


class LocalSignerAdmissionTest(TransactionTestCase):
    def setUp(self):
        configured = override_settings(BLOCKCHAIN_CHAIN_ID=LOCAL_CHAIN_ID, BLOCKCHAIN_OPERATOR_KEY=KEY)
        configured.enable()
        self.addCleanup(configured.disable)
        self.chain = Mock(spec=BaseChainClient)
        self.chain.w3.eth.chain_id = LOCAL_CHAIN_ID
        self.chain.w3.eth.get_transaction_count.return_value = 5
        patched = patch("blockchain.services.local_signer.get_base_chain_client", return_value=self.chain)
        patched.start()
        self.addCleanup(patched.stop)

    def refuse(self, message):
        with self.assertRaisesMessage(LocalSignerAdmissionError, message):
            admit_local_signer()

    def mined(self, count):
        self.chain.w3.eth.get_transaction_count.return_value = count

    def test_the_configured_operator_is_admitted_on_the_local_chain(self):
        result = admit_local_signer()

        self.assertEqual(
            result,
            {"chain_id": LOCAL_CHAIN_ID, "address": SENDER.lower(), "admission_generation": 1, "unchanged": False},
        )
        signer = SigningAccount.objects.get()
        self.assertEqual(
            (signer.chain_id, signer.address, signer.admission_state, signer.admission_generation, signer.next_nonce),
            (LOCAL_CHAIN_ID, SENDER.lower(), "admitted", 1, 0),
        )
        self.chain.w3.eth.get_transaction_count.assert_called_once_with(SENDER, "latest")

    def test_a_rerun_leaves_the_admitted_signer_unchanged(self):
        first = admit_local_signer()
        SigningAccount.objects.update(next_nonce=5)

        self.assertEqual(admit_local_signer(), first | {"unchanged": True})
        signer = SigningAccount.objects.get()
        self.assertEqual((signer.admission_state, signer.admission_generation, signer.next_nonce), ("admitted", 1, 5))

    def test_every_other_chain_id_is_refused_before_the_chain_is_read(self):
        for chain_id in (84532, 11155111, 1337, "31337"):
            with self.subTest(chain_id=chain_id), override_settings(BLOCKCHAIN_CHAIN_ID=chain_id):
                self.refuse("restricted to the local chain (31337)")
        self.assertFalse(SigningAccount.objects.exists())
        self.chain.w3.eth.get_transaction_count.assert_not_called()

    def test_a_provider_on_another_chain_is_refused(self):
        self.chain.w3.eth.chain_id = 84532

        self.refuse("not on the local chain (31337)")
        self.assertFalse(SigningAccount.objects.exists())

    def test_an_unreadable_chain_or_an_invalid_key_admits_nothing(self):
        self.chain.w3.eth.get_transaction_count.side_effect = ConnectionError("synthetic outage")
        self.refuse("could not be read")
        self.chain.w3.eth.get_transaction_count.side_effect = None
        with override_settings(BLOCKCHAIN_OPERATOR_KEY=""):
            self.refuse("valid configured operator key")
        self.assertFalse(SigningAccount.objects.exists())

    def test_an_unused_closed_row_is_admitted_but_a_closed_signer_stays_closed(self):
        existing = SigningAccount.objects.create(chain_id=LOCAL_CHAIN_ID, address=SENDER.lower())
        self.assertFalse(admit_local_signer()["unchanged"])
        self.assertEqual(SigningAccount.objects.get().pk, existing.pk)

        close_signer_admission(chain_id=LOCAL_CHAIN_ID, sender=SENDER)

        self.refuse("stays closed")
        signer = SigningAccount.objects.get()
        self.assertEqual((signer.admission_state, signer.admission_generation), ("closed", 2))

    def test_a_chain_missing_transactions_the_database_recorded_is_refused(self):
        admit_local_signer()
        first = claim_operation("synthetic:first")
        confirmed = sign_claim(first)
        self.assertTrue(
            record_receipt(first, confirmed.tx_hash, receipt(confirmed), client=chain_client(receipt(confirmed)))
        )
        self.assertEqual((confirmed.nonce, SigningAccount.objects.get().next_nonce), (7, 8))

        self.mined(7)
        self.refuse("make dev-clean resets the local chain and database together")
        self.mined(8)
        self.assertTrue(admit_local_signer()["unchanged"])

        waiting = sign_claim(claim_operation("synthetic:second"))
        self.assertEqual(waiting.nonce, 8)
        self.assertTrue(admit_local_signer()["unchanged"])
        self.mined(7)
        self.refuse("lost its latest blocks")

    def test_admission_refuses_the_app_role_and_any_enclosing_transaction(self):
        with patch("blockchain.services.local_signer.current_alias", return_value="app"):
            self.refuse("operator connection")
        with atomic():
            self.refuse("outside every transaction block")
        connection.set_autocommit(False)
        try:
            self.refuse("outside every transaction block")
        finally:
            connection.rollback()
            connection.set_autocommit(True)
        self.chain.w3.eth.get_transaction_count.assert_not_called()
        self.assertFalse(admit_local_signer()["unchanged"])

    def test_the_command_reports_its_result_and_refuses_other_chains(self):
        for unchanged in (False, True):
            output = StringIO()
            call_command("admit_local_signer", stdout=output)
            self.assertEqual(json.loads(output.getvalue())["unchanged"], unchanged)
        with override_settings(BLOCKCHAIN_CHAIN_ID=84532), self.assertRaisesMessage(CommandError, "local chain"):
            call_command("admit_local_signer", stdout=StringIO())
        self.assertEqual(SigningAccount.objects.get().admission_generation, 1)
