import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from threading import Event
from unittest.mock import patch

from django.db import connections
from django.test import TransactionTestCase, override_settings
from eth_account.messages import encode_typed_data
from rest_framework.exceptions import NotFound

from shared.db import atomic, current_alias, use_migrate, use_operator
from shared.tests.row_contention import RealRowContention
from shared.tests.scoped import RunsOnTheScopedConnection
from tokens.models import SwapOrder
from tokens.tests.swap_state_fixtures import (
    CONTRACT,
    SELLER,
    make_swap,
    sign_swap,
    swap_service,
)
from users.models import UserAccount, UserProfile

logger = logging.getLogger(__name__)


@override_settings(ATOMIC_SWAP_ADDRESS=CONTRACT, BLOCKCHAIN_OPERATOR_KEY="")
class SwapAuthorityLockOrderTest(RealRowContention, TransactionTestCase):
    def setUp(self):
        super().setUp()
        self.swap = make_swap("authority-lock-order")
        swap_service(self)
        self.enterContext(patch("tokens.services.swap_execution.publish_trading_event"))
        with use_operator():
            self.wallet = self.swap.sell_order.wallet
            self.account = self.swap.sell_order.owner_account
            self.profile = self.account.user_profile
            self.actor = self.profile.user
        self.signature = SELLER.sign_message(
            encode_typed_data(full_message=self.swap.settlement_context["typed_data"])
        ).signature.hex()

    def sign(self):
        return sign_swap(self.swap, self.signature, SELLER.address)

    def test_new_signature_locks_wallet_before_account_actor_and_profile(self):
        self.while_row_is_held(self.sign, self.wallet, free=(self.account, self.actor, self.profile))
        with use_operator():
            self.assertEqual(SwapOrder.objects.get(pk=self.swap.pk).seller_signature, self.signature)

    def test_new_signature_locks_account_before_actor_and_profile(self):
        self.while_row_is_held(self.sign, self.account, free=(self.actor, self.profile), held=(self.wallet,))

    def test_new_signature_locks_actor_before_profile(self):
        self.while_row_is_held(self.sign, self.actor, free=(self.profile,), held=(self.wallet, self.account))

    def test_changed_profile_owner_after_actor_wait_refuses_without_a_signature(self):
        with use_migrate():
            other = self.actor.__class__.objects.create_user(email="changed-owner@example.test", password="synthetic")

        def change_owner():
            UserProfile.objects.filter(pk=self.profile.pk).update(user=other)

        def sign_or_refuse():
            try:
                self.sign()
            except NotFound:
                return "refused"
            return "signed"

        self.assertEqual(self.while_row_is_held(sign_or_refuse, self.actor, after_wait=change_owner), "refused")
        with use_operator():
            self.assertFalse(SwapOrder.objects.get(pk=self.swap.pk).seller_signature)

    def test_changed_account_owner_refuses_without_waiting_on_the_foreign_profile(self):
        with use_migrate():
            foreign_actor = self.actor.__class__.objects.create_user(
                email="swap-foreign-owner@example.test", password="synthetic"
            )
            foreign_profile = UserProfile.objects.create(user=foreign_actor)
        account_held, release_account, candidate_started = Event(), Event(), Event()
        account_pid, candidate_pid = [], []
        inspection = connections["default"].copy()
        foreign_wait = False

        def rebind_account():
            connections.close_all()
            try:
                with use_migrate(), atomic():
                    UserAccount.objects.select_for_update().get(pk=self.account.pk)
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET LOCAL lock_timeout = '10s'")
                        cursor.execute("SELECT pg_backend_pid()")
                        account_pid.append(cursor.fetchone()[0])
                    account_held.set()
                    if not release_account.wait(10):
                        raise AssertionError("The swap account rebind barrier was not released")
                    UserAccount.objects.filter(pk=self.account.pk).update(user_profile=foreign_profile)
                return "rebound-and-committed"
            finally:
                connections.close_all()

        def sign_or_refuse():
            connections.close_all()
            try:
                with use_operator():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SET lock_timeout = '10s'")
                        cursor.execute("SET statement_timeout = '15s'")
                        cursor.execute("SELECT pg_backend_pid()")
                        candidate_pid.append(cursor.fetchone()[0])
                    candidate_started.set()
                    try:
                        self.sign()
                    except NotFound:
                        return "refused"
                    return "signed"
            finally:
                connections.close_all()

        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                with use_migrate(), atomic():
                    UserProfile.objects.select_for_update(no_key=True).get(pk=foreign_profile.pk)
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        foreign_pid = cursor.fetchone()[0]
                    changing = pool.submit(rebind_account)
                    self.assertTrue(account_held.wait(5))
                    signing = pool.submit(sign_or_refuse)
                    self.assertTrue(candidate_started.wait(5))
                    self.assertEqual(len({foreign_pid, account_pid[0], candidate_pid[0]}), 3)
                    self.wait_for_pid(inspection, candidate_pid[0], account_pid[0], row=self.account)
                    release_account.set()
                    self.assertEqual(changing.result(timeout=5), "rebound-and-committed")
                    with inspection.cursor() as cursor:
                        cursor.execute(
                            "SELECT user_profile_id FROM customer_accounts_account WHERE uuid = %s",
                            [self.account.pk],
                        )
                        self.assertEqual(cursor.fetchone()[0], foreign_profile.pk)
                    logger.info(
                        "Observed committed swap account rebind row=%s profile=%s holder=%s candidate=%s foreign=%s",
                        self.account.pk,
                        foreign_profile.pk,
                        account_pid[0],
                        candidate_pid[0],
                        foreign_pid,
                    )
                    try:
                        self.assertEqual(signing.result(timeout=3), "refused")
                    except TimeoutError:
                        self.wait_for_pid(inspection, candidate_pid[0], foreign_pid, row=foreign_profile)
                        foreign_wait = True
                    self.assert_row_lock(inspection, foreign_profile, held=True)
                self.assertEqual(signing.result(timeout=5), "refused")
            with use_operator():
                self.assertEqual(UserAccount.objects.get(pk=self.account.pk).user_profile_id, foreign_profile.pk)
                self.assertFalse(SwapOrder.objects.get(pk=self.swap.pk).seller_signature)
            logger.info("Observed changed swap owner refused without persisting a signature")
            self.assertFalse(foreign_wait, "The changed swap owner refusal waited on the newly named foreign profile")
        finally:
            release_account.set()
            inspection.close()


class ScopedSwapAuthorityLockOrderTest(RunsOnTheScopedConnection, SwapAuthorityLockOrderTest):
    pass
