import json
import tempfile
from pathlib import Path
from unittest import skipUnless
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import connection, connections
from django.test import override_settings
from rest_framework.test import APITransactionTestCase

from blockchain.models import BlockchainTransaction, OutgoingOperation, SignedAttempt
from blockchain.tests.outgoing_fixtures import KEY
from shared.db import current_alias, use_operator
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.models import PauseChange, ShareToken, SwapOrder, TransferOrder
from tokens.services import pause_changes, pause_recovery
from tokens.tests.order_process_fixtures import OrderChild, wait_for_row_lock
from tokens.tests.order_submission_fixtures import SubmissionFixtures
from tokens.tests.pause_fixtures import PauseNode
from tokens.tests.swap_execution_fixtures import make_execution
from tokens.tests.swap_state_fixtures import BUYER, SELLER


@skipUnless(connection.vendor == "postgresql", "Requires independent PostgreSQL row locks")
@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY)
class SignatureAdmissionProcessesTest(SubmissionFixtures, APITransactionTestCase):
    def setUp(self):
        super().setUp()
        self.directory = Path(self.enterContext(tempfile.TemporaryDirectory()))
        with use_operator():
            self.fixture = make_execution("admission-process", issuer=self.tenant)
        self.swap = self.fixture.swap

    def stage(self, child, expected):
        event = child.read()
        self.assertEqual(event.get("stage"), expected, (event, child.error_output()))
        self.assertIn(event["role"], ("ledova_app", "ledova_operator"))
        with connections["default"].cursor() as cursor:
            cursor.execute("SELECT pg_backend_pid()")
            self.assertNotEqual(event["pid"], cursor.fetchone()[0])
        return event

    def child(self, phase, **payload):
        return OrderChild(
            self,
            "signature_admission_worker",
            phase,
            self.directory,
            chain_id=settings.BLOCKCHAIN_CHAIN_ID,
            **payload,
        )

    def signed_request(self, role):
        order = self.fixture.orders[role == "buyer"]
        return {
            "url": f"/api/v1/trading/orders/{order.pk}/swap/sign/",
            "body": {
                "swap_uuid": str(self.swap.pk),
                "owner_account_uuid": str(order.owner_account_id),
                "wallet_uuid": str(order.wallet_id),
                "settlement_digest": self.swap.settlement_digest,
                "signature": self.fixture.signatures[role],
                "signer_address": SELLER.address if role == "seller" else BUYER.address,
            },
        }

    def signer(self, role="seller", *, hold=False):
        child = self.child(
            "signature-hold" if hold else "signature",
            user_id=getattr(self.fixture, role).user.pk,
            **self.signed_request(role),
        )
        verified = self.stage(child, "verified")
        self.assertTrue(verified["valid"])
        self.assertEqual(verified["role"], "ledova_app")
        self.assertEqual(verified["principal"], str(getattr(self.fixture, role).user.pk))
        return child

    def finish(self, child):
        event = self.stage(child, "done")
        self.assertEqual(child.wait(), 0, child.error_output())
        return event

    def prepare_projection(self):
        with use_operator():
            node = PauseNode(self.tenant.deployed_token.contract_address)
            node.paused = True
            node.client.assert_expected_chain.return_value = settings.BLOCKCHAIN_CHAIN_ID
            change = pause_changes.submit(self.tenant.deployed_token, self.tenant.user, uuid4(), True)
            with (
                patch.object(pause_recovery, "get_base_chain_client", return_value=node.client),
                patch.object(pause_changes, "project", side_effect=lambda pk: PauseChange.objects.get(pk=pk)),
            ):
                result = pause_recovery.recover(change.pk)
            self.assertEqual(result.status, "observed")
            self.assertIsNone(result.completed_at)
            self.assertEqual(ShareToken.objects.get(pk=self.swap.share_token_id).status, "deployed")
        self.assertEqual(node.broadcasts, [])
        return str(change.pk)

    def state(self):
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT task_name, args FROM procrastinate_jobs ORDER BY id")
            jobs = cursor.fetchall()
            return (
                SwapOrder.objects.filter(pk=self.swap.pk).values().get(),
                list(BlockchainTransaction.objects.filter(related_uuid=self.swap.pk).order_by("pk").values()),
                OutgoingOperation.objects.count(),
                SignedAttempt.objects.count(),
                jobs,
                (
                    (self.directory / "signature-events.jsonl").read_text()
                    if (self.directory / "signature-events.jsonl").exists()
                    else ""
                ),
            )

    def assert_new_signature_refused(self, role):
        before = self.state()
        self.client.force_authenticate(getattr(self.fixture, role).user)
        request = self.signed_request(role)
        response = self.client.post(request["url"], request["body"], format="json")
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual(response.json()["code"], "swap_settlement_context_changed")
        self.assertEqual(self.state(), before)

    def test_committed_projection_wins_over_a_verified_signature(self):
        change_id = self.prepare_projection()
        before = self.state()
        signer = self.signer()
        projection = self.child("project-hold", change_id=change_id)
        self.stage(projection, "projecting")
        self.stage(projection, "projection-locking")
        held = self.stage(projection, "projected")
        self.assertEqual(held["status"], "paused")
        signer.release()
        locking = self.stage(signer, "locking")
        self.assertNotEqual(locking["pid"], held["pid"])
        wait_for_row_lock(self, locking["pid"], "tokens_sharetoken", held["pid"])
        projection.release()
        self.assertTrue(self.finish(projection)["completed"])
        refused = self.finish(signer)
        self.assertEqual(refused["status"], 409, refused)
        self.assertEqual(refused["body"]["code"], "swap_settlement_context_changed")
        self.assertEqual(self.state(), before)

    def test_signature_commits_before_waiting_projection_then_blocks_the_other_side(self):
        change_id = self.prepare_projection()
        signer = self.signer(hold=True)
        signer.release()
        self.stage(signer, "locking")
        held = self.stage(signer, "signature-locked")
        projection = self.child("project", change_id=change_id)
        self.stage(projection, "projecting")
        projecting = self.stage(projection, "projection-locking")
        self.assertNotEqual(projecting["pid"], held["pid"])
        wait_for_row_lock(self, projecting["pid"], "tokens_sharetoken", held["pid"])
        signer.release()
        self.assertEqual(self.finish(signer)["status"], 200)
        self.assertTrue(self.finish(projection)["completed"])
        state = self.state()
        self.assertEqual(state[0]["seller_signature"], self.fixture.signatures["seller"])
        self.assertFalse(state[0]["buyer_signature"])
        self.assertIsNone(state[0]["transaction_id"])
        self.assertEqual(state[1:4], ([], 0, 0))
        self.assertEqual([json.loads(line)["event"] for line in state[5].splitlines()], ["swap_signed"])
        self.assert_new_signature_refused("buyer")

    def test_creation_finishes_its_deferred_token_reference_while_signature_waits_for_wallet(self):
        issuer = self.tenant
        self.tenant = self.fixture.seller
        self.wallet = self.fixture.orders[0].wallet
        self.client.force_authenticate(self.tenant.user)
        body = self.signed_body(self.body(token=str(issuer.deployed_token.pk)), signer=SELLER)
        with connections["default"].cursor() as cursor:
            cursor.execute(
                "SELECT condeferrable, condeferred FROM pg_constraint WHERE contype='f' "
                "AND conrelid='tokens_transferorder'::regclass AND confrelid='tokens_sharetoken'::regclass"
            )
            self.assertEqual(cursor.fetchall(), [(True, True)])
        creation = OrderChild(self, "order_submission_worker", "matching", self.directory, body=body)
        holding = creation.read()
        self.assertEqual(holding["stage"], "matching", holding)
        self.assertEqual(holding["database_user"], "ledova_operator")
        signer = self.signer()
        signer.release()
        locking = self.stage(signer, "locking")
        self.assertNotEqual(locking["pid"], holding["pid"])
        wait_for_row_lock(self, locking["pid"], "wallets", holding["pid"])
        with connections["default"].cursor() as cursor:
            cursor.execute(
                "SELECT mode FROM pg_locks WHERE pid=%s AND relation='tokens_sharetoken'::regclass AND granted",
                [locking["pid"]],
            )
            self.assertIn(("RowShareLock",), cursor.fetchall())
        creation.release()
        created = creation.read()
        self.assertEqual(created["status"], 201, (created, creation.error_output()))
        self.assertEqual(creation.wait(), 0, creation.error_output())
        self.assertEqual(self.finish(signer)["status"], 200)
        with use_operator():
            self.assertTrue(TransferOrder.objects.filter(pk=created["body"]["order"]["uuid"]).exists())
        self.assertEqual(self.state()[0]["seller_signature"], self.fixture.signatures["seller"])

    def test_shared_actor_pause_authorization_finishes_before_waiting_signature(self):
        with use_operator():
            self.fixture = make_execution("shared-issuer")
        self.swap = self.fixture.swap
        self.tenant = self.fixture.seller
        signer = self.signer()
        pause = self.child("pause-authority", token_id=str(self.swap.share_token_id))
        held = self.stage(pause, "pause-class-locked")
        signer.release()
        locking = self.stage(signer, "locking")
        self.assertNotEqual(locking["pid"], held["pid"])
        wait_for_row_lock(self, locking["pid"], "tokens_sharetoken", held["pid"])
        pause.release()
        self.assertEqual(self.finish(pause)["status"], "pending")
        self.assertEqual(self.finish(signer)["status"], 200)
        with use_operator():
            self.assertEqual(ShareToken.objects.get(pk=self.swap.share_token_id).status, "deployed")
        self.assertEqual(self.state()[0]["seller_signature"], self.fixture.signatures["seller"])


class ScopedSignatureAdmissionProcessesTest(RunsOnTheScopedConnection, SignatureAdmissionProcessesTest):
    pass
