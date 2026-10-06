import json
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import timedelta
from decimal import Decimal
from threading import Event
from time import sleep
from unittest import skipUnless
from unittest.mock import Mock, patch
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.exceptions import ImproperlyConfigured
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError, connection, connections
from django.test import override_settings
from django.utils import timezone
from eth_account.messages import encode_typed_data
from rest_framework.exceptions import NotFound
from rest_framework.test import APITransactionTestCase

from blockchain.models import BlockchainTransaction
from blockchain.tests.outgoing_fixtures import KEY
from companies.services.authority_requests import _requester_principal
from feature_flags.models import FeatureFlag
from operators.models import Operator
from shared.db import atomic, current_alias, principal_of, use_migrate, use_operator
from shared.tests.row_contention import RealRowContention
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import reference_data
from shared.tests.upload_fixtures import StubUploadDependencies
from shared.utils.typed_data import signable_message
from tokens.models import (
    OrderActionSubmission,
    OrderModificationLog,
    OrderSubmission,
    ShareToken,
    ShareTokenStatus,
    SigningChallenge,
    SwapOrder,
    TransferOrder,
)
from tokens.services import atomic_swap_service
from tokens.services.order_actions import execute_order_action
from tokens.services.order_modification_service import apply_order_modification
from tokens.services.signing_challenge import spend
from tokens.services.trading_admission import TradingAdmission, participant_context
from tokens.tests.order_submission_fixtures import COUNTERPARTY, OWNER, chain_client
from users.models import (
    InvestorClassification,
    InvestorClassificationStatus,
    UserAccount,
    UserProfile,
)
from users.models.company_eligibility import (
    CompanyEligibilityDecision,
    CompanyEligibilityRequest,
)
from users.services.investor_classification import withdraw_classification
from users.tests.test_company_eligibility_consumption import (
    CompanyEligibilityConsumptionCases,
)
from users.tests.test_company_eligibility_requests import SOURCES
from wallets.models import Wallet

ORDERS = "/api/v1/trading/orders/"
CONTRACT = "0x" + "9d" * 20


class TradingAdmissionCases(CompanyEligibilityConsumptionCases):
    def setUp(self):
        super().setUp()
        self.enterContext(override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT, BLOCKCHAIN_OPERATOR_KEY=""))
        with use_operator():
            FeatureFlag.objects.update_or_create(name="trading_enabled", defaults={"enabled": True})
            self.refs = reference_data()
            Operator.get().supported_settlement_assets.set([self.refs.stablecoin])
            self.wallet = Wallet.objects.create(
                user_account=self.account,
                address=OWNER.address,
                chain="base",
                verification_status="VERIFIED",
            )
            self.other_wallet = Wallet.objects.create(
                user_account=self.other_account,
                address=COUNTERPARTY.address,
                chain="base",
                verification_status="VERIFIED",
            )
        with use_migrate():
            self.token = ShareToken.objects.create(
                company=self.company,
                name="Synthetic company admission shares",
                symbol="ADMIT",
                total_supply="100",
                status=ShareTokenStatus.DEPLOYED,
                contract_address="0x" + "8e" * 20,
                chain="base",
                deployed_at=timezone.now(),
            )
            self.order = self.legacy_order()
        self.request, self.decision = self.accepted()
        self.chain = chain_client()
        self.balance = Mock()
        self.balance.get_token_balance.return_value = 10**30
        self.whitelist = Mock()
        self.whitelist.is_whitelisted.return_value = True
        self.events = []
        for target, replacement in (
            ("tokens.services.token_transfer_service.get_base_chain_client", self.chain),
            ("tokens.services.atomic_swap_service.get_base_chain_client", self.chain),
            ("tokens.services.token_transfer_service.whitelist", self.whitelist),
            ("tokens.services.share_token_service", self.balance),
            ("tokens.services.order_modification_service.share_token_service", self.balance),
        ):
            self.enterContext(
                patch(
                    target,
                    **(
                        {"new": replacement}
                        if target.endswith((".whitelist", ".share_token_service"))
                        else {"return_value": replacement}
                    ),
                )
            )
        self.enterContext(patch("tokens.events._publish", side_effect=lambda *args: self.events.append(args)))
        self.enterContext(patch("rest_framework.throttling.SimpleRateThrottle.allow_request", return_value=True))

    def legacy_order(self, *, wallet=None, kind="buy", **changes):
        wallet = wallet or self.wallet
        return TransferOrder.objects.create(
            token=self.token,
            payment_asset=self.refs.stablecoin,
            wallet=wallet,
            owner_account=wallet.user_account,
            wallet_address=wallet.address,
            order_type=kind,
            quantity=10,
            min_quantity=0,
            price_per_share=Decimal("2.50"),
            **changes,
        )

    def order_intent(self, **changes):
        return {
            "submission_id": str(uuid4()),
            "owner_account_uuid": str(self.account.pk),
            "token": str(self.token.pk),
            "wallet_uuid": str(self.wallet.pk),
            "wallet_address": self.wallet.address,
            "order_type": "buy",
            "quantity": 10,
            "min_quantity": 0,
            "price_per_share": "2.50",
            **changes,
        }

    @contextmanager
    def public_operator_role(self):
        with use_operator():
            operator_connection = connections[current_alias()]
        with operator_connection.cursor() as cursor:
            cursor.execute("SELECT current_user")
            previous_role = cursor.fetchone()[0]
            cursor.execute(f"SET ROLE {operator_connection.ops.quote_name(settings.RLS_ROLES['operator'])}")
            cursor.execute("SELECT current_user")
            self.assertEqual(cursor.fetchone()[0], settings.RLS_ROLES["operator"])
        try:
            yield
        finally:
            with operator_connection.cursor() as cursor:
                cursor.execute(f"SET ROLE {operator_connection.ops.quote_name(previous_role)}")

    def trading_post(self, url, body):
        return self.client.post(url, body, format="json")

    def signed_order(self, **changes):
        self.client.force_authenticate(self.participant)
        body = self.order_intent(**changes)
        response = self.trading_post(f"{ORDERS}create/message/", body)
        self.assertEqual(response.status_code, 200, response.content)
        challenge = response.json()["challenge"]
        signature = OWNER.sign_message(
            signable_message(challenge["domain"], challenge["types"], challenge["message"])
        ).signature.to_0x_hex()
        return {**body, "digest": challenge["digest"], "signature": signature}

    def execute_order(self, body):
        self.client.force_authenticate(self.participant)
        return self.trading_post(f"{ORDERS}create/", body)

    def signed_action(self, purpose="modify", **changes):
        self.client.force_authenticate(self.participant)
        body = {"action_id": str(uuid4()), "owner_account_uuid": str(self.account.pk)}
        if purpose == "modify":
            body.update(new_quantity="12", new_min_quantity="1", new_price_per_share="3.00")
        body.update(changes)
        response = self.trading_post(f"{ORDERS}{self.order.pk}/{purpose}/message/", body)
        self.assertEqual(response.status_code, 200, response.content)
        challenge = response.json()["challenge"]
        signature = OWNER.sign_message(
            signable_message(challenge["domain"], challenge["types"], challenge["message"])
        ).signature.to_0x_hex()
        return {
            "action_id": body["action_id"],
            "owner_account_uuid": body["owner_account_uuid"],
            "digest": challenge["digest"],
            "signature": signature,
        }

    def execute_action(self, signed, purpose="modify"):
        self.client.force_authenticate(self.participant)
        return self.trading_post(f"{ORDERS}{self.order.pk}/{purpose}/", signed)

    def action(self, signed):
        with use_operator():
            return OrderActionSubmission.objects.get(owner_account=self.account, action_id=signed["action_id"])

    def submission(self, signed):
        with use_operator():
            return OrderSubmission.objects.get(owner_account=self.account, submission_id=signed["submission_id"])

    def challenge(self, signed):
        with use_operator():
            return SigningChallenge.objects.get(digest=signed["digest"])

    def order_snapshot(self):
        with use_operator():
            return TransferOrder.objects.filter(pk=self.order.pk).values().get()

    def other_decision(self):
        previous = self.participant, self.account, self.source
        try:
            self.participant, self.account = self.other, self.other_account
            self.source = self.submit_source()
            request, decision = self.accepted()
            return self.source, request, decision
        finally:
            self.participant, self.account, self.source = previous

    def swap_fixture(self):
        other_source, other_request, other_decision = self.other_decision()
        with use_migrate():
            seller = self.legacy_order(kind="sell", filled_quantity=10, status="pending_signature")
            buyer = self.legacy_order(wallet=self.other_wallet, filled_quantity=10, status="pending_signature")
            swap = atomic_swap_service.create_swap_order(seller, buyer, share_amount=10)
        message = encode_typed_data(full_message=atomic_swap_service.get_typed_data(swap))
        signatures = {
            party: key.sign_message(message).signature.to_0x_hex()
            for party, key in (("seller", OWNER), ("buyer", COUNTERPARTY))
        }
        return swap, (seller, buyer), signatures, (other_source, other_request, other_decision)

    def sign_swap(self, swap, orders, signatures, party):
        seller = party == "seller"
        actor = self.participant if seller else self.other
        order = orders[0 if seller else 1]
        self.client.force_authenticate(actor)
        return self.trading_post(
            f"{ORDERS}{order.pk}/swap/sign/",
            {
                "swap_uuid": str(swap.pk),
                "owner_account_uuid": str(order.owner_account_id),
                "wallet_uuid": str(order.wallet_id),
                "settlement_digest": swap.settlement_digest,
                "signature": signatures[party],
                "signer_address": OWNER.address if seller else COUNTERPARTY.address,
            },
        )

    def command(self, operation, target, *, decision=None, local=None, challenge=None, **changes):
        decision = decision or self.decision
        with use_operator():
            request = decision.request
        result = {
            "version": 1,
            "operation": operation,
            "actor_id": str(self.participant.pk),
            "company_uuid": str(self.company.pk),
            "token_uuid": str(self.token.pk),
            "owner_account_uuid": str(self.account.pk),
            "wallet_uuid": str(self.wallet.pk),
            "profile_uuid": str(self.account.user_profile_id),
            "source_uuid": str(request.source_id),
            "request_uuid": str(request.pk),
            "decision_uuid": str(decision.pk),
            "request_digest": request.digest,
            "decision_digest": decision.digest,
            "target_uuid": str(target),
        }
        if operation in ("create_order", "modify_order"):
            name = "submission" if operation == "create_order" else "action"
            result.update(
                {
                    name + "_uuid": str(local.pk),
                    name + "_id": str(getattr(local, name + "_id")),
                    "challenge_uuid": str(challenge.pk),
                    "payment_asset_uuid": str(self.refs.stablecoin.pk),
                }
            )
        return {**result, **changes}

    def install_command(self, command, *, lock=True):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT set_config('app.trading_admission', %s, true)", [json.dumps(command)])
            if lock:
                cursor.execute("SELECT public.tokens_lock_trading_admission(%s::jsonb)", [json.dumps(command)])

    def assert_sql_refused(self, write, *, command=None, role="operator", actor=None):
        with self.assertRaises(DatabaseError) as raised, self.database_role(role, actor or self.participant):
            if command is not None:
                self.install_command(command, lock=False)
            write()
        self.assertIn(getattr(raised.exception.__cause__, "sqlstate", None), ("23514", "42501"), str(raised.exception))

    def direct_order(self, command, submission, challenge, signed, *, resolve=True, immediate=False):
        self.install_command(command)
        spend(challenge, signed["signature"])
        order = TransferOrder.objects.create(
            uuid=command["target_uuid"],
            token=self.token,
            payment_asset=self.refs.stablecoin,
            wallet=self.wallet,
            owner_account=self.account,
            wallet_address=self.wallet.address,
            order_type=submission.order_type,
            quantity=submission.quantity,
            min_quantity=submission.min_quantity,
            price_per_share=submission.price_per_share,
            eligibility_decision=self.decision,
            creation_submission=submission,
        )
        order.refresh_from_db()
        if resolve:
            OrderSubmission.objects.filter(pk=submission.pk).update(
                status="created",
                order=order,
                executed_challenge=challenge,
                eligibility_decision=self.decision,
                resolved_at=timezone.now(),
            )
        if immediate:
            self.make_constraints_immediate()
        return order

    def direct_modification(self, command, action, challenge, signed, *, decision=None, resolve=True):
        decision = decision or self.decision
        self.install_command(command)
        spend(challenge, signed["signature"])
        order = TransferOrder.objects.get(pk=action.order_id)
        admission = TradingAdmission(decision, command, ())
        order, changes = apply_order_modification(order, challenge, 10**30, action=action, admission=admission)
        if resolve:
            self.resolve_modification(action, challenge, order, changes, decision)
        return order, changes

    def resolve_modification(self, action, challenge, order, changes, decision):
        OrderActionSubmission.objects.filter(pk=action.pk).update(
            status="applied",
            executed_challenge=challenge,
            executed_by=self.participant,
            eligibility_decision=decision,
            eligibility_admitted_at=order.last_modified_at,
            resolved_at=timezone.now(),
            result={"kind": "modify", "modification_count": order.modification_count, "changes": changes},
        )

    def make_constraints_immediate(self):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")

    def prelock_modification_parents(self, actions, decisions):
        requests = [decision.request for decision in decisions]
        for queryset in (
            ShareToken.objects.filter(pk=self.token.pk),
            OrderActionSubmission.objects.filter(pk__in=[action.pk for action in actions]),
            Wallet.objects.filter(pk=self.wallet.pk),
            UserAccount.objects.filter(pk=self.account.pk),
            get_user_model().objects.filter(pk=self.participant.pk),
            UserProfile.objects.filter(pk=self.account.user_profile_id),
        ):
            list(queryset.order_by("pk").select_for_update(no_key=True))
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT id FROM operators_operator WHERE id=1 FOR SHARE")
        for queryset in (
            InvestorClassification.objects.filter(pk__in=[request.source_id for request in requests]),
            CompanyEligibilityRequest.objects.filter(pk__in=[request.pk for request in requests]),
            CompanyEligibilityDecision.objects.filter(pk__in=[decision.pk for decision in decisions]),
        ):
            list(queryset.order_by("pk").select_for_update(no_key=True))

    def admission_worker(self, pool, callback):
        started, pid = Event(), []

        def run():
            connections.close_all()
            try:
                with self.public_operator_role(), use_operator(), _requester_principal(self.participant.pk):
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET lock_timeout='10s'")
                        cursor.execute("SET statement_timeout='15s'")
                        cursor.execute("SELECT pg_backend_pid(), current_user")
                        backend, role = cursor.fetchone()
                        pid.append(backend)
                        self.assertEqual(role, settings.RLS_ROLES["operator"])
                    started.set()
                    return callback()
            finally:
                connections.close_all()

        future = pool.submit(run)
        self.assertTrue(started.wait(5))
        return future, pid[0]


class CompanyEligibilityTradingAdmissionTest(TradingAdmissionCases, StubUploadDependencies, APITransactionTestCase):
    def test_new_order_retains_its_actual_company_decision_and_reciprocal_submission(self):
        signed = self.signed_order()
        before = timezone.now()
        response = self.execute_order(signed)
        after = timezone.now()
        self.assertEqual(response.status_code, 201, response.content)
        submission = self.submission(signed)
        with use_operator():
            order = submission.order
            self.source.refresh_from_db()
        self.assertEqual(order.eligibility_decision_id, self.decision.pk)
        self.assertEqual(order.creation_submission_id, submission.pk)
        self.assertEqual(submission.eligibility_decision_id, self.decision.pk)
        self.assertEqual(submission.executed_challenge_id, self.challenge(signed).pk)
        self.assertLessEqual(before, order.created_at)
        self.assertLessEqual(order.created_at, after)
        self.assertEqual(self.source.status, InvestorClassificationStatus.SUBMITTED)
        self.assertIsNone(self.source.reviewed_by_id)
        self.assertTrue(self.source.evidence_file.storage.exists(self.source.evidence_file.name))
        self.chain.send_raw_transaction.assert_not_called()

    def test_created_order_replay_survives_decision_revocation_without_rewriting_basis(self):
        signed = self.signed_order()
        created = self.execute_order(signed)
        self.assertEqual(created.status_code, 201, created.content)
        before = self.submission(signed)
        self.revoke(self.request)
        replay = self.execute_order(signed)
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertEqual(replay.json(), created.json())
        after = self.submission(signed)
        self.assertEqual(
            (after.order_id, after.eligibility_decision_id, after.resolved_at),
            (before.order_id, before.eligibility_decision_id, before.resolved_at),
        )

    def test_new_order_after_revocation_refuses_with_its_genuine_challenge_spent(self):
        signed = self.signed_order()
        self.revoke(self.request)
        refused = self.execute_order(signed)
        self.assertEqual(refused.status_code, 403, refused.content)
        submission = self.submission(signed)
        self.assertEqual((submission.status, submission.refusal_code), ("refused", "investor_not_eligible"))
        self.assertIsNone(submission.eligibility_decision_id)
        self.assertIsNone(submission.order_id)
        challenge = self.challenge(signed)
        self.assertTrue(challenge.is_consumed)
        self.assertEqual(challenge.consumed_signature, signed["signature"])
        self.assertEqual(submission.executed_challenge_id, challenge.pk)

    def test_modify_legacy_order_records_event_decision_without_inventing_birth_provenance(self):
        signed = self.signed_action()
        response = self.execute_action(signed)
        self.assertEqual(response.status_code, 200, response.content)
        action = self.action(signed)
        with use_operator():
            self.order.refresh_from_db()
            logs = list(OrderModificationLog.objects.filter(challenge=self.challenge(signed)).order_by("field_name"))
        self.assertIsNone(self.order.eligibility_decision_id)
        self.assertIsNone(self.order.creation_submission_id)
        self.assertEqual(self.order.last_modification_action_id, action.pk)
        self.assertEqual(self.order.last_modification_eligibility_decision_id, self.decision.pk)
        self.assertEqual(action.eligibility_decision_id, self.decision.pk)
        self.assertEqual(action.eligibility_admitted_at, self.order.last_modified_at)
        self.assertEqual(self.order.modification_count, 1)
        self.assertEqual([log.field_name for log in logs], ["min_quantity", "price_per_share", "quantity"])
        self.assertTrue(all(log.signature == signed["signature"] for log in logs))

    def test_signed_noop_records_one_actual_event_and_no_audit_changes(self):
        signed = self.signed_action(new_quantity="10", new_min_quantity="0", new_price_per_share="2.50")
        response = self.execute_action(signed)
        self.assertEqual(response.status_code, 200, response.content)
        action = self.action(signed)
        with use_operator():
            self.order.refresh_from_db()
            self.assertFalse(OrderModificationLog.objects.filter(challenge=self.challenge(signed)).exists())
        self.assertEqual(action.result, {"kind": "modify", "modification_count": 1, "changes": []})
        self.assertEqual(action.eligibility_decision_id, self.decision.pk)
        self.assertEqual(action.eligibility_admitted_at, self.order.last_modified_at)
        self.assertEqual(self.order.last_modification_action_id, action.pk)

    def test_revoked_modify_is_spent_refusal_and_preserves_the_previous_event(self):
        applied = self.signed_action()
        self.assertEqual(self.execute_action(applied).status_code, 200)
        signed = self.signed_action(new_quantity="13")
        before = self.order_snapshot()
        self.revoke(self.request)
        response = self.execute_action(signed)
        self.assertEqual(response.status_code, 403, response.content)
        self.assertEqual(self.order_snapshot(), before)
        action = self.action(signed)
        self.assertEqual(
            (action.status, action.refusal_code, action.refusal_status), ("refused", "investor_not_eligible", 403)
        )
        self.assertIsNone(action.eligibility_decision_id)
        self.assertIsNone(action.eligibility_admitted_at)
        challenge = self.challenge(signed)
        self.assertTrue(challenge.is_consumed)
        self.assertEqual(action.executed_challenge_id, challenge.pk)
        with use_operator():
            self.assertFalse(OrderModificationLog.objects.filter(challenge=challenge).exists())

    def test_pending_cancel_and_terminal_modify_replay_survive_source_withdrawal(self):
        signed = self.signed_action()
        applied = self.execute_action(signed)
        self.assertEqual(applied.status_code, 200, applied.content)
        action_before = self.action(signed)
        cancel = self.signed_action("cancel")
        self.client.force_authenticate(self.participant)
        withdrawn = self.client.delete(f"{SOURCES}{self.source.pk}/")
        self.assertEqual(withdrawn.status_code, 204, withdrawn.content)
        replay = self.execute_action(signed)
        self.assertEqual(replay.status_code, 200, replay.content)
        self.assertEqual(replay.json()["result"], applied.json()["result"])
        cancelled = self.execute_action(cancel, "cancel")
        self.assertEqual(cancelled.status_code, 200, cancelled.content)
        action_after = self.action(signed)
        self.assertEqual(
            (action_after.eligibility_decision_id, action_after.eligibility_admitted_at),
            (action_before.eligibility_decision_id, action_before.eligibility_admitted_at),
        )
        cancel_action = self.action(cancel)
        self.assertIsNone(cancel_action.eligibility_decision_id)
        self.assertIsNone(cancel_action.eligibility_admitted_at)

    def test_missing_actual_private_source_bytes_refuses_new_modify_after_spend(self):
        signed = self.signed_action()
        before = self.order_snapshot()
        storage = self.source.evidence_file.storage
        name = self.source.evidence_file.name
        with storage.open(name, "rb") as evidence:
            original = evidence.read()
        storage.delete(name)
        self.addCleanup(storage.save, name, SimpleUploadedFile("retained.pdf", original))
        refused = self.execute_action(signed)
        self.assertEqual(refused.status_code, 403, refused.content)
        self.assertTrue(self.challenge(signed).is_consumed)
        self.assertEqual(self.order_snapshot(), before)
        self.assertIsNone(self.action(signed).eligibility_decision_id)

    def test_each_first_party_signature_retains_its_own_decision_and_unchanged_digest(self):
        swap, orders, signatures, other = self.swap_fixture()
        original = (swap.settlement_context, swap.settlement_digest, swap.order_hash)
        first = self.sign_swap(swap, orders, signatures, "seller")
        self.assertEqual(first.status_code, 200, first.content)
        with use_operator():
            swap.refresh_from_db()
        self.assertEqual(swap.seller_eligibility_decision_id, self.decision.pk)
        self.assertIsNotNone(swap.seller_eligibility_admitted_at)
        self.assertIsNone(swap.buyer_eligibility_decision_id)
        self.assertIsNone(swap.buyer_eligibility_admitted_at)
        second = self.sign_swap(swap, orders, signatures, "buyer")
        self.assertEqual(second.status_code, 200, second.content)
        with use_operator():
            swap.refresh_from_db()
            self.assertFalse(BlockchainTransaction.objects.filter(related_uuid=swap.pk).exists())
        self.assertEqual(swap.buyer_eligibility_decision_id, other[2].pk)
        self.assertIsNotNone(swap.buyer_eligibility_admitted_at)
        self.assertEqual((swap.settlement_context, swap.settlement_digest, swap.order_hash), original)
        self.assertEqual(swap.status, "ready")

    def test_stored_signature_replay_after_revocation_keeps_pair_but_other_new_party_refuses(self):
        swap, orders, signatures, other = self.swap_fixture()
        self.assertEqual(self.sign_swap(swap, orders, signatures, "seller").status_code, 200)
        with use_operator():
            swap.refresh_from_db()
            before = (swap.seller_signature, swap.seller_eligibility_decision_id, swap.seller_eligibility_admitted_at)
        self.revoke(self.request)
        self.revoke(other[1])
        replay = self.sign_swap(swap, orders, signatures, "seller")
        self.assertEqual(replay.status_code, 200, replay.content)
        refused = self.sign_swap(swap, orders, signatures, "buyer")
        self.assertEqual(refused.status_code, 403, refused.content)
        with use_operator():
            swap.refresh_from_db()
        self.assertEqual(
            (swap.seller_signature, swap.seller_eligibility_decision_id, swap.seller_eligibility_admitted_at), before
        )
        self.assertEqual(swap.buyer_signature, "")
        self.assertIsNone(swap.buyer_eligibility_decision_id)

    def test_stored_ready_retry_with_relayer_restored_retains_basis_and_original_journal(self):
        swap, orders, signatures, other = self.swap_fixture()
        self.assertEqual(self.sign_swap(swap, orders, signatures, "seller").status_code, 200)
        self.assertEqual(self.sign_swap(swap, orders, signatures, "buyer").status_code, 200)
        with use_operator():
            swap.refresh_from_db()
        before = (
            swap.seller_eligibility_decision_id,
            swap.seller_eligibility_admitted_at,
            swap.buyer_eligibility_decision_id,
            swap.buyer_eligibility_admitted_at,
            swap.settlement_digest,
            swap.settlement_context,
        )
        self.assertEqual(swap.status, "ready")
        self.assertIsNone(swap.transaction_id)
        self.revoke(self.request)
        self.revoke(other[1])
        with override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY):
            restored = self.sign_swap(swap, orders, signatures, "seller")
            self.assertEqual(restored.status_code, 200, restored.content)
            replay = self.sign_swap(swap, orders, signatures, "seller")
            self.assertEqual(replay.status_code, 200, replay.content)
        with use_operator():
            swap.refresh_from_db()
            transaction = swap.transaction
            self.assertEqual(BlockchainTransaction.objects.filter(related_uuid=swap.pk).count(), 1)
        self.assertEqual(swap.status, "executing")
        self.assertEqual(
            (
                swap.seller_eligibility_decision_id,
                swap.seller_eligibility_admitted_at,
                swap.buyer_eligibility_decision_id,
                swap.buyer_eligibility_admitted_at,
                swap.settlement_digest,
                swap.settlement_context,
            ),
            before,
        )
        self.assertEqual(
            transaction.function_args["admission"],
            {"version": 1, "actor_id": str(self.participant.pk), "participant": "seller"},
        )
        self.chain.send_raw_transaction.assert_not_called()


@skipUnless(connection.vendor == "postgresql", "PostgreSQL guards authentic trading admission and commit")
class CompanyEligibilityTradingAdmissionSQLTest(
    RealRowContention, TradingAdmissionCases, StubUploadDependencies, APITransactionTestCase
):
    def test_real_operator_create_commits_reciprocal_basis_and_immediate_constraints(self):
        signed = self.signed_order()
        submission, challenge = self.submission(signed), self.challenge(signed)
        target = uuid4()
        command = self.command("create_order", target, local=submission, challenge=challenge)
        with self.database_role("operator", self.participant):
            order = self.direct_order(command, submission, challenge, signed, immediate=True)
        retained = self.submission(signed)
        self.assertEqual((retained.order_id, retained.eligibility_decision_id), (order.pk, self.decision.pk))

    def test_valid_looking_order_without_created_submission_fails_actual_commit_and_rolls_back_spend(self):
        signed = self.signed_order()
        submission, challenge = self.submission(signed), self.challenge(signed)
        target = uuid4()
        command = self.command("create_order", target, local=submission, challenge=challenge)
        with self.assertRaises(DatabaseError) as raised, self.database_role("operator", self.participant):
            self.direct_order(command, submission, challenge, signed, resolve=False)
        self.assertEqual(getattr(raised.exception.__cause__, "sqlstate", None), "23514")
        with use_operator():
            self.assertFalse(TransferOrder.objects.filter(pk=target).exists())
        self.assertEqual(self.submission(signed).status, "pending")
        self.assertFalse(self.challenge(signed).is_consumed)

    def test_bare_operator_and_copied_app_command_cannot_create_orders(self):
        signed = self.signed_order()
        submission, challenge = self.submission(signed), self.challenge(signed)
        target = uuid4()
        command = self.command("create_order", target, local=submission, challenge=challenge)
        values = {
            "uuid": target,
            "token": self.token,
            "payment_asset": self.refs.stablecoin,
            "wallet": self.wallet,
            "owner_account": self.account,
            "wallet_address": self.wallet.address,
            "order_type": "buy",
            "quantity": 10,
            "price_per_share": "2.50",
            "eligibility_decision": self.decision,
            "creation_submission": submission,
        }
        self.assert_sql_refused(lambda: TransferOrder.objects.create(**values))
        self.assert_sql_refused(lambda: TransferOrder.objects.create(**values), command=command, role="app")
        self.assert_sql_refused(lambda: TransferOrder.objects.create(**values), command=command, role="migrate")
        with use_operator():
            self.assertFalse(TransferOrder.objects.filter(pk=target).exists())

    def test_wrong_types_missing_extra_and_foreign_real_context_cannot_modify(self):
        signed = self.signed_action()
        action, challenge = self.action(signed), self.challenge(signed)
        command = self.command("modify_order", self.order.pk, local=action, challenge=challenge)
        wrong_commands = [
            {**command, "version": True},
            {**command, "version": "1"},
            {key: value for key, value in command.items() if key != "payment_asset_uuid"},
            {**command, "evidence_verified": True},
            {**command, "decision_uuid": None},
            {**command, "owner_account_uuid": str(self.other_account.pk)},
            {**command, "wallet_uuid": str(self.other_wallet.pk)},
            {**command, "actor_id": str(self.other.pk)},
            {**command, "profile_uuid": str(self.other_account.user_profile_id)},
        ]
        before = self.order_snapshot()
        for wrong in wrong_commands:
            with self.subTest(command=wrong):
                self.assert_sql_refused(
                    lambda: TransferOrder.objects.filter(pk=self.order.pk).update(quantity=12), command=wrong
                )
        self.assertEqual(self.order_snapshot(), before)
        self.assertFalse(self.challenge(signed).is_consumed)

    def test_real_foreign_account_decision_is_not_interchangeable_with_the_holder_decision(self):
        _, _, foreign_decision = self.other_decision()
        signed = self.signed_action()
        action, challenge = self.action(signed), self.challenge(signed)
        foreign = self.command(
            "modify_order", self.order.pk, decision=foreign_decision, local=action, challenge=challenge
        )
        before = self.order_snapshot()
        self.assert_sql_refused(
            lambda: TransferOrder.objects.filter(pk=self.order.pk).update(quantity=12), command=foreign
        )
        self.assertEqual(self.order_snapshot(), before)
        self.assertFalse(self.challenge(signed).is_consumed)

    def test_legacy_null_basis_and_completed_birth_context_cannot_be_backfilled_or_rewritten(self):
        signed = self.signed_order()
        response = self.execute_order(signed)
        self.assertEqual(response.status_code, 201, response.content)
        submission = self.submission(signed)
        for target, changes in (
            (self.order.pk, {"eligibility_decision": self.decision, "creation_submission": submission}),
            (self.order.pk, {"last_modification_eligibility_decision": self.decision}),
            (submission.order_id, {"eligibility_decision": None, "creation_submission": None}),
            (submission.order_id, {"token_id": uuid4()}),
            (submission.order_id, {"wallet_address": COUNTERPARTY.address}),
            (submission.order_id, {"order_type": "sell"}),
            (submission.order_id, {"payment_asset": None}),
        ):
            with self.subTest(target=target, changes=changes):
                self.assert_sql_refused(lambda: TransferOrder.objects.filter(pk=target).update(**changes))
        with use_operator():
            self.order.refresh_from_db()
        self.assertIsNone(self.order.eligibility_decision_id)
        self.assertIsNone(self.order.creation_submission_id)

    def test_historical_created_and_applied_null_outcomes_cannot_acquire_a_new_decision(self):
        order_signed = self.signed_order()
        submission, order_challenge = self.submission(order_signed), self.challenge(order_signed)
        action_signed = self.signed_action()
        action, action_challenge = self.action(action_signed), self.challenge(action_signed)
        with use_migrate(), atomic():
            spend(order_challenge, order_signed["signature"])
            historical_order = TransferOrder.objects.create(
                token_id=submission.token_id,
                payment_asset=self.refs.stablecoin,
                wallet_id=submission.wallet_id,
                owner_account_id=submission.owner_account_id,
                wallet_address=submission.wallet_address,
                order_type=submission.order_type,
                quantity=submission.quantity,
                min_quantity=submission.min_quantity,
                price_per_share=submission.price_per_share,
            )
            OrderSubmission.objects.filter(pk=submission.pk).update(
                status="created",
                order=historical_order,
                executed_challenge=order_challenge,
                resolved_at=timezone.now(),
            )
            spend(action_challenge, action_signed["signature"])
            self.order.refresh_from_db()
            self.order.record_original_values()
            changes = []
            for field, replacement in (
                ("quantity", action.new_quantity),
                ("min_quantity", action.new_min_quantity),
                ("price_per_share", action.new_price_per_share),
            ):
                old = getattr(self.order, field)
                if replacement != old:
                    changes.append({"field": field, "old": str(old), "new": str(replacement)})
                setattr(self.order, field, replacement)
            self.order.modification_count += 1
            self.order.last_modified_at = timezone.now()
            self.order.current_signature = action_signed["signature"]
            self.order.save(
                update_fields=[
                    "quantity",
                    "min_quantity",
                    "price_per_share",
                    "original_quantity",
                    "original_price",
                    "modification_count",
                    "last_modified_at",
                    "current_signature",
                    "updated_at",
                ]
            )
            OrderModificationLog.objects.bulk_create(
                OrderModificationLog(
                    order=self.order,
                    challenge=action_challenge,
                    field_name=change["field"],
                    old_value=change["old"],
                    new_value=change["new"],
                    signature=action_signed["signature"],
                    signer_address=self.wallet.address,
                )
                for change in changes
            )
            OrderActionSubmission.objects.filter(pk=action.pk).update(
                status="applied",
                executed_challenge=action_challenge,
                executed_by=self.participant,
                resolved_at=timezone.now(),
                result={"kind": "modify", "modification_count": self.order.modification_count, "changes": changes},
            )
        with use_operator():
            self.assertIsNone(historical_order.eligibility_decision_id)
            self.assertIsNone(historical_order.creation_submission_id)
            self.order.refresh_from_db()
            self.assertIsNone(self.order.last_modification_action_id)
            self.assertIsNone(self.order.last_modification_eligibility_decision_id)
            submission_before = OrderSubmission.objects.filter(pk=submission.pk).values().get()
            action_before = OrderActionSubmission.objects.filter(pk=action.pk).values().get()
        self.assertEqual(submission_before["status"], "created")
        self.assertIsNone(submission_before["eligibility_decision_id"])
        self.assertEqual(action_before["status"], "applied")
        self.assertIsNone(action_before["eligibility_decision_id"])
        self.assertIsNone(action_before["eligibility_admitted_at"])
        self.assert_sql_refused(
            lambda: OrderSubmission.objects.filter(pk=submission.pk).update(eligibility_decision=self.decision)
        )
        self.assert_sql_refused(
            lambda: OrderActionSubmission.objects.filter(pk=action.pk).update(
                eligibility_decision=self.decision, eligibility_admitted_at=timezone.now()
            )
        )
        order_replay = self.execute_order(order_signed)
        action_replay = self.execute_action(action_signed)
        self.assertEqual(order_replay.status_code, 200, order_replay.content)
        self.assertEqual(action_replay.status_code, 200, action_replay.content)
        with use_operator():
            self.assertEqual(OrderSubmission.objects.filter(pk=submission.pk).values().get(), submission_before)
            self.assertEqual(OrderActionSubmission.objects.filter(pk=action.pk).values().get(), action_before)

    def test_applied_action_without_a_real_increment_or_event_pointer_refuses(self):
        signed = self.signed_action()
        action, challenge = self.action(signed), self.challenge(signed)
        command = self.command("modify_order", self.order.pk, local=action, challenge=challenge)
        before = self.order_snapshot()
        with self.assertRaises(DatabaseError) as raised, self.database_role("operator", self.participant):
            self.install_command(command)
            spend(challenge, signed["signature"])
            OrderActionSubmission.objects.filter(pk=action.pk).update(
                status="applied",
                executed_challenge=challenge,
                executed_by=self.participant,
                eligibility_decision=self.decision,
                eligibility_admitted_at=timezone.now(),
                resolved_at=timezone.now(),
                result={"kind": "modify", "modification_count": 1, "changes": []},
            )
        self.assertEqual(getattr(raised.exception.__cause__, "sqlstate", None), "23514")
        self.assertEqual(self.order_snapshot(), before)
        self.assertEqual(self.action(signed).status, "pending")

    def test_genuine_cancel_and_refused_modify_cannot_store_an_admission_basis(self):
        cancel = self.signed_action("cancel")
        self.assertEqual(self.execute_action(cancel, "cancel").status_code, 200)
        cancel_action = self.action(cancel)
        self.assert_sql_refused(
            lambda: OrderActionSubmission.objects.filter(pk=cancel_action.pk).update(
                eligibility_decision=self.decision, eligibility_admitted_at=timezone.now()
            )
        )
        with use_migrate():
            self.order = self.legacy_order()
        refused = self.signed_action()
        self.revoke(self.request)
        self.assertEqual(self.execute_action(refused).status_code, 403)
        refused_action = self.action(refused)
        self.assert_sql_refused(
            lambda: OrderActionSubmission.objects.filter(pk=refused_action.pk).update(
                eligibility_decision=self.decision, eligibility_admitted_at=timezone.now()
            )
        )
        self.assertIsNone(self.action(cancel).eligibility_decision_id)
        self.assertIsNone(self.action(refused).eligibility_decision_id)

    def test_real_operator_modify_commits_exact_event_logs_and_action_basis(self):
        signed = self.signed_action()
        action, challenge = self.action(signed), self.challenge(signed)
        command = self.command("modify_order", self.order.pk, local=action, challenge=challenge)
        with self.database_role("operator", self.participant):
            order, changes = self.direct_modification(command, action, challenge, signed)
            self.make_constraints_immediate()
        retained = self.action(signed)
        self.assertEqual(retained.result["changes"], changes)
        self.assertEqual(retained.eligibility_decision_id, self.decision.pk)
        self.assertEqual(retained.eligibility_admitted_at, order.last_modified_at)

    def test_pending_modify_event_without_applied_outcome_fails_actual_commit(self):
        signed = self.signed_action()
        action, challenge = self.action(signed), self.challenge(signed)
        command = self.command("modify_order", self.order.pk, local=action, challenge=challenge)
        before = self.order_snapshot()
        with self.assertRaises(DatabaseError) as raised, self.database_role("operator", self.participant):
            self.direct_modification(command, action, challenge, signed, resolve=False)
        self.assertEqual(getattr(raised.exception.__cause__, "sqlstate", None), "23514")
        self.assertEqual(self.order_snapshot(), before)
        self.assertEqual(self.action(signed).status, "pending")
        self.assertFalse(self.challenge(signed).is_consumed)

    def test_event_d1_cannot_be_resolved_with_another_accepted_d2_for_the_same_company(self):
        _, decision2 = self.accepted()
        signed = self.signed_action()
        action, challenge = self.action(signed), self.challenge(signed)
        command1 = self.command("modify_order", self.order.pk, local=action, challenge=challenge)
        command2 = self.command("modify_order", self.order.pk, decision=decision2, local=action, challenge=challenge)
        before = self.order_snapshot()
        with self.assertRaises(DatabaseError) as raised, self.database_role("operator", self.participant):
            order, changes = self.direct_modification(command1, action, challenge, signed, resolve=False)
            self.install_command(command2)
            self.resolve_modification(action, challenge, order, changes, decision2)
        self.assertEqual(getattr(raised.exception.__cause__, "sqlstate", None), "23514")
        self.assertEqual(self.order_snapshot(), before)
        self.assertEqual(self.action(signed).status, "pending")

    def test_same_action_d2_substitution_refuses_while_its_distinct_source_is_held_elsewhere(self):
        original_source = self.source
        self.source = self.submit_source()
        request2, decision2 = self.accepted()
        source2 = self.source
        self.source = original_source
        signed = self.signed_action()
        action, challenge = self.action(signed), self.challenge(signed)
        command1 = self.command("modify_order", self.order.pk, local=action, challenge=challenge)
        command2 = self.command("modify_order", self.order.pk, decision=decision2, local=action, challenge=challenge)
        before = self.order_snapshot()

        def substitute():
            try:
                with self.database_role("operator", self.participant):
                    self.direct_modification(command1, action, challenge, signed, resolve=False)
                    self.install_command(command2)
            except DatabaseError as error:
                return error.__cause__.sqlstate
            return "unexpected_substitution"

        with ThreadPoolExecutor(max_workers=1) as pool:
            with use_migrate(), atomic():
                InvestorClassification.objects.select_for_update(no_key=True).get(pk=source2.pk)
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    blocker = cursor.fetchone()[0]
                future, waiter = self.admission_worker(pool, substitute)
                self.assertNotEqual(waiter, blocker)
                self.assertEqual(future.result(timeout=5), "23514")
        self.assertNotEqual(request2.source_id, self.request.source_id)
        self.assertEqual(self.order_snapshot(), before)
        self.assertFalse(self.challenge(signed).is_consumed)

    def test_completed_action_closes_log_insert_update_delete_and_basis_replacement(self):
        signed = self.signed_action()
        response = self.execute_action(signed)
        self.assertEqual(response.status_code, 200, response.content)
        action, challenge = self.action(signed), self.challenge(signed)
        command = self.command("modify_order", self.order.pk, local=action, challenge=challenge)
        with use_operator():
            log = OrderModificationLog.objects.filter(challenge=challenge).first()
            before = list(OrderModificationLog.objects.filter(challenge=challenge).order_by("pk").values())
        attempts = (
            lambda: OrderModificationLog.objects.create(
                order=self.order,
                challenge=challenge,
                field_name=log.field_name,
                old_value=log.old_value,
                new_value=log.new_value,
                signature=log.signature,
                signer_address=log.signer_address,
            ),
            lambda: OrderModificationLog.objects.filter(pk=log.pk).update(new_value="999"),
            lambda: OrderModificationLog.objects.filter(pk=log.pk).delete(),
            lambda: OrderActionSubmission.objects.filter(pk=action.pk).update(
                eligibility_decision=None, eligibility_admitted_at=None
            ),
            lambda: TransferOrder.objects.filter(pk=self.order.pk).update(
                last_modification_action=None, last_modification_eligibility_decision=None
            ),
        )
        for index, attempt in enumerate(attempts):
            with self.subTest(attempt=index):
                self.assert_sql_refused(attempt, command=command)
        with use_operator():
            self.assertEqual(
                list(OrderModificationLog.objects.filter(challenge=challenge).order_by("pk").values()), before
            )

    def test_duplicate_pending_event_log_cannot_pass_deferred_commit(self):
        signed = self.signed_action()
        action, challenge = self.action(signed), self.challenge(signed)
        command = self.command("modify_order", self.order.pk, local=action, challenge=challenge)
        before = self.order_snapshot()
        with self.assertRaises(DatabaseError) as raised, self.database_role("operator", self.participant):
            order, changes = self.direct_modification(command, action, challenge, signed, resolve=False)
            log = OrderModificationLog.objects.filter(challenge=challenge).first()
            OrderModificationLog.objects.create(
                order=order,
                challenge=challenge,
                field_name=log.field_name,
                old_value=log.old_value,
                new_value=log.new_value,
                signature=log.signature,
                signer_address=log.signer_address,
            )
            self.resolve_modification(action, challenge, order, changes, self.decision)
        self.assertEqual(getattr(raised.exception.__cause__, "sqlstate", None), "23514")
        self.assertEqual(self.order_snapshot(), before)

    def test_missing_pending_event_log_and_forged_result_each_fail_actual_commit(self):
        for defect in ("missing_log", "result_count", "result_changes"):
            with self.subTest(defect=defect):
                signed = self.signed_action()
                action, challenge = self.action(signed), self.challenge(signed)
                command = self.command("modify_order", self.order.pk, local=action, challenge=challenge)
                before = self.order_snapshot()
                with self.assertRaises(DatabaseError) as raised, self.database_role("operator", self.participant):
                    self.install_command(command)
                    spend(challenge, signed["signature"])
                    if defect == "missing_log":
                        with patch(
                            "tokens.services.order_modification_service.OrderModificationLog.objects.bulk_create"
                        ):
                            order, changes = apply_order_modification(
                                TransferOrder.objects.get(pk=self.order.pk),
                                challenge,
                                10**30,
                                action=action,
                                admission=TradingAdmission(self.decision, command, ()),
                            )
                    else:
                        order, changes = apply_order_modification(
                            TransferOrder.objects.get(pk=self.order.pk),
                            challenge,
                            10**30,
                            action=action,
                            admission=TradingAdmission(self.decision, command, ()),
                        )
                    if defect == "result_count":
                        order.modification_count += 1
                    if defect == "result_changes":
                        changes = []
                    self.resolve_modification(action, challenge, order, changes, self.decision)
                self.assertEqual(getattr(raised.exception.__cause__, "sqlstate", None), "23514")
                self.assertEqual(self.order_snapshot(), before)
                self.assertFalse(self.challenge(signed).is_consumed)

    def test_two_genuine_events_before_commit_keep_independent_d1_and_d2_snapshots(self):
        _, decision2 = self.accepted()
        signed1 = self.signed_action()
        signed2 = self.signed_action(new_quantity="13", new_min_quantity="2", new_price_per_share="3.50")
        action1, action2 = self.action(signed1), self.action(signed2)
        challenge1, challenge2 = self.challenge(signed1), self.challenge(signed2)
        command1 = self.command("modify_order", self.order.pk, local=action1, challenge=challenge1)
        command2 = self.command("modify_order", self.order.pk, decision=decision2, local=action2, challenge=challenge2)
        with self.database_role("operator", self.participant):
            self.prelock_modification_parents([action1, action2], [self.decision, decision2])
            first, _ = self.direct_modification(command1, action1, challenge1, signed1)
            first_time = first.last_modified_at
            self.direct_modification(command2, action2, challenge2, signed2, decision=decision2)
        action1, action2 = self.action(signed1), self.action(signed2)
        self.assertEqual(
            (action1.eligibility_decision_id, action1.eligibility_admitted_at, action1.result["modification_count"]),
            (self.decision.pk, first_time, 1),
        )
        self.assertEqual((action2.eligibility_decision_id, action2.result["modification_count"]), (decision2.pk, 2))
        with use_operator():
            self.order.refresh_from_db()
        self.assertEqual(
            (self.order.last_modification_action_id, self.order.last_modification_eligibility_decision_id),
            (action2.pk, decision2.pk),
        )
        self.assertIsNone(self.order.eligibility_decision_id)
        self.assertIsNone(self.order.creation_submission_id)

    def test_real_source_withdrawal_wins_account_wait_and_modify_records_spent_refusal(self):
        signed = self.signed_action()
        before = self.order_snapshot()
        inspection = connections["default"].copy()

        def execute():
            return execute_order_action(
                self.participant,
                self.order.pk,
                "modify",
                {"action_id": signed["action_id"], "owner_account_uuid": self.account.pk},
                {"digest": signed["digest"], "signature": signed["signature"]},
            )

        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                with self.database_role("operator", self.participant):
                    UserAccount.objects.select_for_update(no_key=True).get(pk=self.account.pk)
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        blocker = cursor.fetchone()[0]
                    future, waiter = self.admission_worker(pool, execute)
                    self.wait_for_pid(inspection, waiter, blocker, row=self.account)
                    withdraw_classification(actor=self.participant, classification_id=self.source.pk)
                result = future.result(timeout=10)
        finally:
            inspection.close()
        self.assertEqual(result.http_status, 403)
        self.assertEqual((result.action.status, result.action.refusal_code), ("refused", "investor_not_eligible"))
        self.assertTrue(self.challenge(signed).is_consumed)
        self.assertIsNone(result.action.eligibility_decision_id)
        self.assertEqual(self.order_snapshot(), before)

    def test_genuine_modify_admission_blocks_actual_source_withdrawal_until_commit(self):
        signed = self.signed_action()
        action, challenge = self.action(signed), self.challenge(signed)
        command = self.command("modify_order", self.order.pk, local=action, challenge=challenge)
        inspection = connections["default"].copy()
        try:
            with ThreadPoolExecutor(max_workers=1) as pool:
                with self.database_role("operator", self.participant):
                    self.direct_modification(command, action, challenge, signed)
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        blocker = cursor.fetchone()[0]
                    future, waiter = self.admission_worker(
                        pool, lambda: withdraw_classification(actor=self.participant, classification_id=self.source.pk)
                    )
                    self.wait_for_pid(inspection, waiter, blocker, row=self.account)
                withdrawn = future.result(timeout=10)
        finally:
            inspection.close()
        self.assertEqual(withdrawn.status, InvestorClassificationStatus.WITHDRAWN)
        retained = self.action(signed)
        self.assertEqual((retained.status, retained.eligibility_decision_id), ("applied", self.decision.pk))
        self.assertEqual(self.order_snapshot()["last_modification_eligibility_decision_id"], self.decision.pk)

    def test_target_wait_crossing_real_decision_expiry_uses_fresh_sql_clock(self):
        self.requested_expiry = timezone.now() + timedelta(seconds=5)
        _, short_decision = self.accepted()
        signed = self.signed_action()
        action, challenge = self.action(signed), self.challenge(signed)
        command = self.command(
            "modify_order", self.order.pk, decision=short_decision, local=action, challenge=challenge
        )
        before = self.order_snapshot()

        def attempt():
            try:
                with self.database_role("operator", self.participant):
                    self.direct_modification(command, action, challenge, signed, decision=short_decision)
            except DatabaseError as error:
                return error.__cause__.sqlstate, error.__cause__.diag.constraint_name
            return "unexpected_admission", None

        result = self.while_row_is_held(
            lambda: self.with_principal(attempt),
            self.order,
            held=(self.account, self.source, short_decision),
            wait_query="tokens_lock_trading_admission",
            after_wait=lambda: sleep(max(0, (short_decision.expires_at - timezone.now()).total_seconds()) + 0.05),
        )
        self.assertEqual(result, ("23514", "tokens_trading_eligibility_current"))
        self.assertEqual(self.order_snapshot(), before)
        self.assertFalse(self.challenge(signed).is_consumed)

    def test_actual_event_keeps_d1_when_expiry_passes_before_resolution_and_commit(self):
        self.requested_expiry = timezone.now() + timedelta(seconds=8)
        _, short_decision = self.accepted()
        signed = self.signed_action()
        action, challenge = self.action(signed), self.challenge(signed)
        command = self.command(
            "modify_order", self.order.pk, decision=short_decision, local=action, challenge=challenge
        )
        with self.database_role("operator", self.participant):
            order, changes = self.direct_modification(
                command, action, challenge, signed, decision=short_decision, resolve=False
            )
            event_time = order.last_modified_at
            self.assertLess(event_time, short_decision.expires_at)
            sleep(max(0, (short_decision.expires_at - timezone.now()).total_seconds()) + 0.05)
            self.resolve_modification(action, challenge, order, changes, short_decision)
            self.make_constraints_immediate()
        retained = self.action(signed)
        self.assertEqual(
            (retained.status, retained.eligibility_decision_id, retained.eligibility_admitted_at),
            ("applied", short_decision.pk, event_time),
        )
        self.assertEqual(retained.result["modification_count"], 1)
        self.assertTrue(self.challenge(signed).is_consumed)

    def test_first_signature_commits_sql_stamp_and_rejects_later_pair_or_signature_mutation(self):
        swap, _, signatures, _ = self.swap_fixture()
        command = self.command(
            "first_signature",
            swap.pk,
            participant="seller",
            signature=signatures["seller"],
            settlement_digest=swap.settlement_digest,
        )
        before = timezone.now()
        with self.database_role("operator", self.participant):
            self.install_command(command)
            SwapOrder.objects.filter(pk=swap.pk).update(
                seller_signature=signatures["seller"],
                seller_eligibility_decision=self.decision,
                seller_eligibility_admitted_at=timezone.now(),
                status="seller_signed",
            )
            self.make_constraints_immediate()
        after = timezone.now()
        with use_operator():
            swap.refresh_from_db()
            retained = SwapOrder.objects.filter(pk=swap.pk).values().get()
        self.assertLessEqual(before, swap.seller_eligibility_admitted_at)
        self.assertLessEqual(swap.seller_eligibility_admitted_at, after)
        for changes in (
            {"seller_signature": ""},
            {"seller_signature": signatures["buyer"]},
            {"seller_eligibility_decision": None, "seller_eligibility_admitted_at": None},
            {"seller_eligibility_admitted_at": swap.seller_eligibility_admitted_at + timedelta(seconds=1)},
            {"buyer_eligibility_decision": self.decision, "buyer_eligibility_admitted_at": timezone.now()},
        ):
            with self.subTest(changes=changes):
                self.assert_sql_refused(lambda: SwapOrder.objects.filter(pk=swap.pk).update(**changes), command=command)
        with use_operator():
            self.assertEqual(SwapOrder.objects.filter(pk=swap.pk).values().get(), retained)

    def with_principal(self, callback):
        with _requester_principal(self.participant.pk):
            return callback()

    def test_first_signature_refuses_both_parties_and_legacy_basis_only_fill(self):
        swap, orders, signatures, _ = self.swap_fixture()
        command = self.command(
            "first_signature",
            swap.pk,
            participant="seller",
            signature=signatures["seller"],
            settlement_digest=swap.settlement_digest,
        )
        self.assert_sql_refused(
            lambda: SwapOrder.objects.filter(pk=swap.pk).update(
                seller_signature=signatures["seller"],
                buyer_signature=signatures["buyer"],
                status="ready",
                seller_eligibility_decision=self.decision,
                seller_eligibility_admitted_at=timezone.now(),
            ),
            command=command,
        )
        with use_migrate():
            SwapOrder.objects.filter(pk=swap.pk).update(seller_signature=signatures["seller"], status="seller_signed")
        self.assert_sql_refused(
            lambda: SwapOrder.objects.filter(pk=swap.pk).update(
                seller_eligibility_decision=self.decision, seller_eligibility_admitted_at=timezone.now()
            ),
            command=command,
        )
        with use_operator():
            swap.refresh_from_db()
        self.assertEqual(swap.seller_signature, signatures["seller"])
        self.assertIsNone(swap.seller_eligibility_decision_id)
        self.assertIsNone(swap.seller_eligibility_admitted_at)

    def test_token_with_actual_legacy_trading_history_cannot_change_to_same_owner_company(self):
        sibling, _ = self.company_fixture("Synthetic sibling issuer Pty Ltd", "004085616")
        with use_operator():
            self.assertEqual(sibling.owner_id, self.company.owner_id)
        self.assert_sql_refused(lambda: ShareToken.objects.filter(pk=self.token.pk).update(company=sibling))
        with use_operator():
            self.token.refresh_from_db()
        self.assertEqual(self.token.company_id, self.company.pk)

    def test_participant_context_restores_real_principal_and_command_after_transaction_rollback(self):
        with use_operator(), _requester_principal(self.participant.pk):
            connection = connections[current_alias()]
            previous = principal_of()
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT current_user, current_setting('role'), current_setting('app.trading_admission', true)"
                )
                previous_user, previous_role, previous_command = cursor.fetchone()
                previous_command = previous_command or ""
            with self.assertRaisesRegex(RuntimeError, "Synthetic rollback"):
                with participant_context(self.participant), atomic(durable=True):
                    with connection.cursor() as cursor:
                        cursor.execute("SELECT current_user")
                        self.assertEqual(cursor.fetchone()[0], settings.RLS_ROLES["operator"])
                        cursor.execute("SELECT set_config('app.trading_admission', %s, true)", ["{}"])
                    raise RuntimeError("Synthetic rollback")
            self.assertEqual(principal_of(), previous)
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT current_user, current_setting('role'), current_setting('app.trading_admission', true)"
                )
                actual_user, actual_role, actual_command = cursor.fetchone()
                self.assertEqual((actual_user, actual_role), (previous_user, previous_role))
                self.assertEqual(actual_command or "", previous_command)

    def test_participant_context_uses_only_actual_operator_and_restores_commit_and_savepoint(self):
        with use_operator(), _requester_principal(self.participant.pk):
            selected = connections[current_alias()]
            with selected.cursor() as cursor:
                cursor.execute(
                    "SELECT current_user, current_setting('role'), current_setting('app.trading_admission', true)"
                )
                before = cursor.fetchone()
            with participant_context(self.participant), atomic(durable=True):
                with selected.cursor() as cursor:
                    cursor.execute("SELECT current_user, current_setting('app.user_id', true)")
                    self.assertEqual(cursor.fetchone(), (settings.RLS_ROLES["operator"], str(self.participant.pk)))
                with self.assertRaisesRegex(RuntimeError, "Synthetic savepoint rollback"), atomic():
                    with selected.cursor() as cursor:
                        cursor.execute("SELECT set_config('app.trading_admission', %s, true)", ["{}"])
                    raise RuntimeError("Synthetic savepoint rollback")
                with selected.cursor() as cursor:
                    cursor.execute("SELECT current_setting('app.trading_admission', true)")
                    self.assertEqual(cursor.fetchone()[0], "")
                with selected.cursor() as cursor:
                    cursor.execute("SELECT set_config('app.trading_admission', %s, true)", ["{}"])
            with selected.cursor() as cursor:
                cursor.execute(
                    "SELECT current_user, current_setting('role'), current_setting('app.trading_admission', true)"
                )
                after = cursor.fetchone()
            self.assertEqual(after[:2], before[:2])
            self.assertEqual(after[2] or "", before[2] or "")
            self.assertEqual(principal_of(), str(self.participant.pk))

    def test_participant_context_refuses_missing_and_foreign_ambient_holder_without_role_changes(self):
        with use_operator():
            selected = connections[current_alias()]
            for principal in ("", str(self.other.pk)):
                with self.subTest(principal=principal), _requester_principal(principal):
                    with selected.cursor() as cursor:
                        cursor.execute("SELECT current_user, current_setting('role')")
                        before = cursor.fetchone()
                    with self.assertRaises(NotFound), participant_context(self.participant):
                        self.fail("An unrelated ambient holder entered trading admission")
                    with selected.cursor() as cursor:
                        cursor.execute("SELECT current_user, current_setting('role')")
                        self.assertEqual(cursor.fetchone(), before)
                    self.assertEqual(principal_of() or "", principal)

    def test_participant_context_refuses_operator_configured_as_app_or_migrate(self):
        with use_operator(), _requester_principal(self.participant.pk):
            selected = connections[current_alias()]
            for role in ("app", "migrate"):
                roles = {**settings.RLS_ROLES, "operator": settings.RLS_ROLES[role]}
                with self.subTest(role=role), override_settings(RLS_ROLES=roles):
                    with selected.cursor() as cursor:
                        cursor.execute("SELECT current_user, current_setting('role')")
                        before = cursor.fetchone()
                    with self.assertRaises(ImproperlyConfigured), participant_context(self.participant):
                        self.fail("A non-operator configuration entered trading admission")
                    with selected.cursor() as cursor:
                        cursor.execute("SELECT current_user, current_setting('role')")
                        self.assertEqual(cursor.fetchone(), before)
                    self.assertEqual(principal_of(), str(self.participant.pk))


class ScopedCompanyEligibilityTradingAdmissionTest(RunsOnTheScopedConnection, CompanyEligibilityTradingAdmissionTest):
    pass


class ScopedCompanyEligibilityTradingAdmissionSQLTest(
    RunsOnTheScopedConnection, CompanyEligibilityTradingAdmissionSQLTest
):
    pass
