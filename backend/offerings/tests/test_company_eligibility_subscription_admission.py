import json
import logging
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import timedelta
from decimal import Decimal
from threading import Event
from time import monotonic, sleep
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.contrib.auth.models import Group, Permission
from django.core.exceptions import ImproperlyConfigured
from django.db import DatabaseError, connections
from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import APIException, PermissionDenied
from rest_framework.test import APITransactionTestCase

from companies.services.authority_requests import _requester_principal
from offerings.exceptions import SubscriptionRefusedException
from offerings.models import Offering, SettlementRail, Subscription, SubscriptionStatus
from offerings.services.subscription import (
    accept,
    allot,
    confirm_payment,
    create_draft,
    issue_instruction,
    record_refund,
    submit,
    withdraw,
)
from offerings.tests.factories import configure_operator
from operators.models import Operator
from shared.db import atomic, current_alias, use_migrate, use_operator
from shared.tests.row_contention import RealRowContention
from shared.tests.upload_fixtures import StubUploadDependencies, pdf_bytes
from tokens.models import RequestStatus, ShareIssuanceExecution
from tokens.tests.instruction_fixtures import apply_instruction
from users.exceptions import InvestorNotEligibleException
from users.models import (
    InvestorCategory,
    InvestorClassificationStatus,
    UserAccount,
    UserProfile,
)
from users.services.company_eligibility import revoke_eligibility_decision
from users.services.investor_classification import withdraw_classification
from users.tests.factories import make_investor
from users.tests.test_company_eligibility_consumption import (
    CompanyEligibilityConsumptionCases,
)
from users.tests.test_company_eligibility_requests import PDF, SOURCES
from wallets.constants import WALLET_VERIFICATION_STATUS_VERIFIED
from wallets.models import Wallet

BASE = "/api/v1/subscriptions/"
ADMISSION_LOCK_QUERY = "offerings_lock_subscription_admission"
logger = logging.getLogger(__name__)


class CompanyEligibilitySubscriptionCases(CompanyEligibilityConsumptionCases, RealRowContention):
    def setUp(self):
        super().setUp()
        self.set_issuer_directory_visibility(self.company, True)
        with use_operator():
            configure_operator()
            self.technical, _ = make_investor("subscription-technical", staff=True)
            self.staff_without_permission, _ = make_investor("subscription-unmandated-staff", staff=True)
        with use_migrate():
            permission = Permission.objects.get(content_type__app_label="offerings", codename="change_subscription")
            self.technical.user_permissions.add(permission)
            self.wallet = self.wallet_fixture(self.account)
            self.other_wallet = self.wallet_fixture(self.other_account)
        self.offer = self.offering(price="2.50", label="ADMIT")
        with self.database_role("operator", self.participant):
            self.offer_token = self.offer.token

    def set_issuer_directory_visibility(self, company, visible):
        self.client.force_authenticate(self.owner)
        response = self.client.patch(f"/api/v1/companies/{company.pk}/", {"isOpenToInvestors": visible}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["isOpenToInvestors"], visible)
        with use_operator():
            company.refresh_from_db()
        self.assertEqual(company.is_open_to_investors, visible)

    def wallet_fixture(self, account):
        return Wallet.objects.create(
            user_account=account,
            address="0x" + uuid4().hex + "12345678",
            chain="base",
            verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
            verified_at=timezone.now(),
        )

    def post_draft(self, *, offering=None, wallet=None, quantity=2, **changes):
        self.client.force_authenticate(self.participant)
        return self.client.post(
            BASE,
            {
                "offering": str((offering or self.offer).pk),
                "wallet": str((wallet or self.wallet).pk),
                "quantity": quantity,
                **changes,
            },
            format="json",
        )

    def api_draft(self, **changes):
        response = self.post_draft(**changes)
        self.assertEqual(response.status_code, 201, response.content)
        with use_operator():
            subscription = Subscription.objects.get(pk=response.json()["uuid"])
        self.assertEqual(subscription.status, SubscriptionStatus.DRAFT)
        self.assertIsNone(subscription.eligibility_decision_id)
        return subscription, response.json()

    def draft(self, *, offering=None, quantity=2, actor=None, account=None, wallet=None):
        actor = actor or self.participant
        with use_operator(), _requester_principal(actor.pk):
            return create_draft(
                offering or self.offer,
                account or self.account,
                wallet or self.wallet,
                quantity,
                submitted_by=actor,
            )

    def submitted(self, *, offering=None, quantity=2):
        subscription = self.draft(offering=offering, quantity=quantity)
        with use_operator(), _requester_principal(self.participant.pk):
            submit(subscription, submitted_by=self.participant)
            subscription.refresh_from_db()
        return subscription

    def accepted_subscription(self):
        request, decision = self.accepted()
        subscription = self.submitted()
        with use_operator(), _requester_principal(self.technical.pk):
            accept(subscription)
            subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.ACCEPTED)
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        return subscription, request, decision

    def subscription_snapshot(self, subscription):
        with use_operator():
            return Subscription.objects.filter(pk=subscription.pk).values().get()

    def assert_subscription_unchanged(self, subscription, before):
        self.assertEqual(self.subscription_snapshot(subscription), before)

    def assert_source_unreviewed(self):
        with use_operator():
            self.source.refresh_from_db()
        self.assertEqual(self.source.status, InvestorClassificationStatus.SUBMITTED)
        self.assertIsNone(self.source.reviewed_by_id)
        self.assertIsNone(self.source.reviewed_at)

    @contextmanager
    def operator_role(self):
        with use_operator():
            connection = connections[current_alias()]
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_setting('role')")
                previous = cursor.fetchone()[0]
                cursor.execute(f"SET ROLE {connection.ops.quote_name(settings.RLS_ROLES['operator'])}")
                cursor.execute("SELECT current_user")
                self.assertEqual(cursor.fetchone()[0], settings.RLS_ROLES["operator"])
            try:
                yield
            finally:
                with connection.cursor() as cursor:
                    if previous == "none":
                        cursor.execute("RESET ROLE")
                    else:
                        cursor.execute(f"SET ROLE {connection.ops.quote_name(previous)}")

    def run_command(self, command, started, pids):
        connections.close_all()
        try:
            with self.operator_role():
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SET lock_timeout = '10s'")
                    cursor.execute("SET statement_timeout = '15s'")
                    cursor.execute("SELECT pg_backend_pid()")
                    pids.append(cursor.fetchone()[0])
                started.set()
                return command()
        finally:
            connections.close_all()

    def primary_result(self, actor, operation):
        try:
            with self.database_role("operator", actor):
                subscription = operation()
                result = {
                    "status": 200,
                    "subscription": subscription.pk,
                    "basis": subscription.eligibility_decision_id,
                    "submitted_at": subscription.submitted_at,
                    "accepted_at": subscription.accepted_at,
                }
            return result
        except APIException as error:
            return {"status": error.status_code, "detail": error.detail}

    def two_primary_waiters(self, first, second, row):
        started, pids = [Event(), Event()], [[], []]
        inspection = connections["default"].copy()
        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                with use_migrate(), atomic():
                    type(row).objects.select_for_update(no_key=True).get(pk=row.pk)
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute("SELECT pg_backend_pid()")
                        blocker = cursor.fetchone()[0]
                    futures = []
                    for index, command in enumerate((first, second)):
                        future = pool.submit(self.run_command, command, started[index], pids[index])
                        futures.append(future)
                        self.assertTrue(started[index].wait(5))
                        deadline, last = monotonic() + 5, None
                        while monotonic() < deadline:
                            with inspection.cursor() as cursor:
                                cursor.execute("SELECT pg_blocking_pids(%s)", [pids[index][0]])
                                last = cursor.fetchone()[0]
                            queued = set(last) & {blocker, *(prior[0] for prior in pids[:index])}
                            if queued:
                                self.wait_for_pid(
                                    inspection, pids[index][0], min(queued), row=row, query=ADMISSION_LOCK_QUERY
                                )
                                break
                            if future.done():
                                future.result()
                            sleep(0.01)
                        else:
                            self.fail(f"Primary PID {pids[index][0]} did not join the company queue: {last}")
                        self.assertFalse(future.done())
                    self.assertEqual(len({blocker, pids[0][0], pids[1][0]}), 3)
                return [future.result(timeout=10) for future in futures]
        finally:
            inspection.close()

    def await_database_expiry(self, expiry):
        deadline = monotonic() + 10
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT transaction_timestamp(), clock_timestamp()")
            transaction_started, before = cursor.fetchone()
            self.assertLess(transaction_started, expiry)
            self.assertLess(before, expiry)
            while monotonic() < deadline:
                cursor.execute("SELECT clock_timestamp()")
                after = cursor.fetchone()[0]
                if after > expiry:
                    logger.info(
                        "Observed primary expiry transaction_started=%s before=%s expires=%s after=%s",
                        transaction_started,
                        before,
                        expiry,
                        after,
                    )
                    return
                sleep(0.01)
        self.fail(f"The PostgreSQL clock did not pass genuine decision expiry {expiry}")

    def after_genuine_command_locks(self, command, matches, candidate, row):
        locked, release = Event(), Event()
        started, pids = [Event(), Event()], [[], []]
        inspection = connections["default"].copy()

        def blocking_command():
            connection = connections[current_alias()]

            def hold(execute, sql, params, many, context):
                result = execute(sql, params, many, context)
                if not locked.is_set() and matches(sql):
                    locked.set()
                    self.assertTrue(release.wait(10), "The genuine command was not released")
                return result

            with connection.execute_wrapper(hold):
                return command()

        try:
            with ThreadPoolExecutor(max_workers=2) as pool:
                blocking = pool.submit(self.run_command, blocking_command, started[0], pids[0])
                try:
                    self.assertTrue(started[0].wait(5))
                    if not locked.wait(5):
                        if blocking.done():
                            blocking.result()
                        self.fail("The genuine evidence command did not obtain its actual lock prefix")
                    waiting = pool.submit(self.run_command, candidate, started[1], pids[1])
                    self.assertTrue(started[1].wait(5))
                    try:
                        self.wait_for_pid(inspection, pids[1][0], pids[0][0], row=row, query=ADMISSION_LOCK_QUERY)
                    except AssertionError:
                        if waiting.done():
                            waiting.result()
                        raise
                    self.assertEqual(len({pids[0][0], pids[1][0]}), 2)
                    self.assertFalse(waiting.done())
                    release.set()
                    committed = blocking.result(timeout=10)
                    result = waiting.result(timeout=10)
                    return committed, result
                finally:
                    release.set()
        finally:
            inspection.close()

    def legacy_subscription(self, status):
        with use_migrate():
            return Subscription.objects.create(
                offering=self.offer,
                user_account=self.account,
                wallet=self.wallet,
                submitted_by=self.participant,
                company_name=self.company.display_name,
                token_name=self.offer.token.name,
                token_symbol=self.offer.token.symbol,
                quantity=2,
                price_per_share=Decimal("2.50"),
                currency="AUD",
                amount_due=Decimal("5.00"),
                status=status,
                submitted_at=timezone.now() - timedelta(days=2),
                accepted_at=timezone.now() - timedelta(days=1) if status == SubscriptionStatus.ACCEPTED else None,
            )


class CompanyEligibilitySubscriptionAdmissionTest(
    CompanyEligibilitySubscriptionCases, StubUploadDependencies, APITransactionTestCase
):
    def test_private_submitted_source_without_a_company_decision_cannot_create_an_application(self):
        response = self.post_draft()
        self.assertEqual(response.status_code, 403, response.content)
        self.assertIn("no_live_company_decision", response.json()["detail"])
        with use_operator():
            self.assertFalse(Subscription.objects.exists())
        self.assert_source_unreviewed()

    def test_actual_company_decision_creates_a_basis_free_draft_then_holder_submit_records_d1(self):
        request, decision = self.accepted()
        subscription, body = self.api_draft()
        self.assertEqual(body["pricePerShare"], "2.50")
        self.assertEqual(body["amountDue"], "5.00")
        self.assertIsNone(body["submittedAt"])
        records = self.snapshots()

        response = self.client.post(f"{BASE}{subscription.pk}/submit/", {}, format="json")

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["status"], SubscriptionStatus.SUBMITTED)
        with use_operator():
            subscription.refresh_from_db()
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        self.assertEqual(subscription.submitted_by_id, self.participant.pk)
        self.assertIsNotNone(subscription.submitted_at)
        self.assertEqual(decision.request_id, request.pk)
        self.assertEqual(self.snapshots(), records)
        self.assert_source_unreviewed()

    def test_company_a_decision_does_not_make_company_b_offering_a_choice(self):
        self.accepted()
        foreign, _ = self.company_fixture("Subscription Foreign Pty Ltd", "004085616")
        self.set_issuer_directory_visibility(foreign, True)
        foreign_offer = self.offering(company=foreign, price="2.50", label="FOREIGN")

        response = self.post_draft(offering=foreign_offer)

        self.assertEqual(response.status_code, 403, response.content)
        self.assertIn("no_live_company_decision", response.json()["detail"])
        with use_operator():
            self.assertFalse(Subscription.objects.exists())
        self.api_draft()

    def test_actual_certificate_decision_supplies_this_company_primary_admission(self):
        self.replace_source(
            category=InvestorCategory.ACCOUNTANT_CERTIFICATE,
            certificate_issued_at=(timezone.localdate() - timedelta(days=1)).isoformat(),
            certifier_name="Synthetic Subscription Accountant",
            certifier_body="ca_anz",
            certifier_membership_number="SUBSCRIPTION-863",
        )
        _, decision = self.accepted()
        subscription, _ = self.api_draft()
        response = self.client.post(f"{BASE}{subscription.pk}/submit/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        with use_operator():
            subscription.refresh_from_db()
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        self.assert_source_unreviewed()

    def test_actual_associated_person_decision_supplies_named_issuer_primary_admission(self):
        self.replace_source(category=InvestorCategory.ASSOCIATED_PERSON, company=str(self.company.pk))
        _, decision = self.accepted()
        subscription, _ = self.api_draft()
        response = self.client.post(f"{BASE}{subscription.pk}/submit/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        with use_operator():
            subscription.refresh_from_db()
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        self.assert_source_unreviewed()

    def test_product_decision_admits_only_its_exact_offer_and_quantity_at_the_server_threshold(self):
        product_offer = self.offering(label="PRODUCT")
        sibling = self.offering(label="SIBLING")
        self.replace_source(category=InvestorCategory.PRODUCT_VALUE)
        request, decision = self.accepted(offering=str(product_offer.pk), quantity=1)
        self.assertEqual(request.amount_aud, Decimal("500000.00"))

        for offering, quantity in ((sibling, 1), (product_offer, 2)):
            with self.subTest(offering=offering.pk, quantity=quantity):
                response = self.post_draft(offering=offering, quantity=quantity)
                self.assertIn(response.status_code, (400, 403), response.content)
                with use_operator():
                    self.assertFalse(Subscription.objects.exists())

        subscription, body = self.api_draft(offering=product_offer, quantity=1)
        self.assertEqual(body["amountDue"], "500000.00")
        response = self.client.post(f"{BASE}{subscription.pk}/submit/", {}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        with use_operator():
            subscription.refresh_from_db()
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        self.assert_source_unreviewed()

    def test_product_request_and_decision_do_not_supply_the_issuer_directory_opt_in(self):
        self.set_issuer_directory_visibility(self.company, False)
        product_offer = self.offering(label="KNOWN")
        self.replace_source(category=InvestorCategory.PRODUCT_VALUE)
        request, decision = self.accepted(offering=str(product_offer.pk), quantity=1)
        records = self.snapshots()

        response = self.post_draft(offering=product_offer, quantity=1)

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn("offering", response.json())
        with use_operator():
            self.assertFalse(Subscription.objects.exists())
        self.assertEqual(self.snapshots(), records)
        self.assert_admitted(self.subscription(product_offer, 1), request, decision)
        self.set_issuer_directory_visibility(self.company, True)
        subscription, _ = self.api_draft(offering=product_offer, quantity=1)
        self.assertIsNone(subscription.eligibility_decision_id)
        self.assertEqual(self.snapshots(), records)
        self.assert_source_unreviewed()

    def test_caller_supplied_basis_never_records_a_decision_on_draft_or_replaces_selected_d1(self):
        _, decision = self.accepted()
        claimed = uuid4()
        subscription, _ = self.api_draft(eligibility_decision=str(claimed), submitted_by=self.other.pk)
        response = self.client.post(
            f"{BASE}{subscription.pk}/submit/",
            {"eligibility_decision": str(claimed), "submitted_by": self.other.pk},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        with use_operator():
            subscription.refresh_from_db()
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        self.assertEqual(subscription.submitted_by_id, self.participant.pk)

    def test_another_holder_cannot_use_the_application_detail_or_submit_route(self):
        self.accepted()
        subscription, _ = self.api_draft()
        before = self.subscription_snapshot(subscription)
        self.client.force_authenticate(self.other)

        self.assertEqual(self.client.get(f"{BASE}{subscription.pk}/").status_code, 404)
        response = self.client.post(f"{BASE}{subscription.pk}/submit/", {}, format="json")
        self.assertEqual(response.status_code, 404, response.content)
        listed = self.client.get(BASE)
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertEqual(listed.json()["results"], [])
        self.assert_subscription_unchanged(subscription, before)

    def test_decision_loss_refuses_new_submit_but_keeps_own_list_and_detail_history(self):
        request, _ = self.accepted()
        subscription, _ = self.api_draft()
        self.revoke(request)
        before = self.subscription_snapshot(subscription)
        self.client.force_authenticate(self.participant)

        response = self.client.post(f"{BASE}{subscription.pk}/submit/", {}, format="json")

        self.assertEqual(response.status_code, 403, response.content)
        self.assert_subscription_unchanged(subscription, before)
        detail = self.client.get(f"{BASE}{subscription.pk}/")
        self.assertEqual(detail.status_code, 200, detail.content)
        self.assertEqual(detail.json()["status"], SubscriptionStatus.DRAFT)
        listed = self.client.get(BASE)
        self.assertEqual(listed.status_code, 200, listed.content)
        self.assertEqual([row["uuid"] for row in listed.json()["results"]], [str(subscription.pk)])


class CompanyEligibilitySubscriptionServiceTest(
    CompanyEligibilitySubscriptionCases, StubUploadDependencies, APITransactionTestCase
):
    def test_an_actorless_operator_context_cannot_borrow_holder_authority_for_draft_or_submit(self):
        _, decision = self.accepted()
        with use_operator(), _requester_principal(""):
            with self.assertRaises(PermissionDenied):
                create_draft(self.offer, self.account, self.wallet, 2, submitted_by=self.participant)
        with use_operator():
            self.assertFalse(Subscription.objects.exists())
        draft = self.draft()
        before = self.subscription_snapshot(draft)
        with use_operator(), _requester_principal(""):
            with self.assertRaises(PermissionDenied):
                submit(draft, submitted_by=self.participant)
        self.assert_subscription_unchanged(draft, before)
        with use_operator(), _requester_principal(self.participant.pk):
            submit(draft, submitted_by=self.participant)
            draft.refresh_from_db()
        self.assertEqual(draft.eligibility_decision_id, decision.pk)

    def test_create_draft_requires_the_actual_holder_even_when_another_principal_names_the_holder(self):
        self.accepted()
        with use_operator(), _requester_principal(self.other.pk):
            with self.assertRaises(PermissionDenied):
                create_draft(self.offer, self.account, self.wallet, 2, submitted_by=self.participant)
        with use_operator():
            self.assertFalse(Subscription.objects.exists())
        self.assertIsNone(self.draft().eligibility_decision_id)

    def test_submit_requires_the_actual_holder_and_preserves_a_refused_draft(self):
        self.accepted()
        subscription = self.draft()
        before = self.subscription_snapshot(subscription)
        with use_operator(), _requester_principal(self.other.pk):
            with self.assertRaises(PermissionDenied):
                submit(subscription, submitted_by=self.participant)
        self.assert_subscription_unchanged(subscription, before)
        with use_operator(), _requester_principal(self.participant.pk):
            with self.assertRaises(PermissionDenied):
                submit(subscription, submitted_by=self.other)
        self.assert_subscription_unchanged(subscription, before)

    def test_accept_requires_existing_technical_permission_and_keeps_the_holder_original_d1(self):
        _, decision = self.accepted()
        subscription = self.submitted()
        before = self.subscription_snapshot(subscription)
        for actor in (self.participant, self.approver, self.staff_without_permission):
            with self.subTest(actor=actor.pk):
                with use_operator(), _requester_principal(actor.pk):
                    with self.assertRaises(PermissionDenied):
                        accept(subscription)
                self.assert_subscription_unchanged(subscription, before)
        with use_operator(), _requester_principal(self.technical.pk):
            accept(subscription)
            subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.ACCEPTED)
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        self.assertEqual(subscription.submitted_by_id, self.participant.pk)
        self.assertEqual(subscription.submitted_at, before["submitted_at"])
        self.assertIsNotNone(subscription.accepted_at)

    def test_actual_group_change_subscription_permission_matches_direct_technical_authority(self):
        _, decision = self.accepted()
        subscription = self.submitted()
        with use_migrate():
            group = Group.objects.create(name=f"synthetic-subscription-review-{uuid4()}")
            group.permissions.add(
                Permission.objects.get(content_type__app_label="offerings", codename="change_subscription")
            )
            self.staff_without_permission.groups.add(group)
        with use_operator(), _requester_principal(self.staff_without_permission.pk):
            accept(subscription)
            subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.ACCEPTED)
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        self.assertEqual(subscription.submitted_by_id, self.participant.pk)

    def test_original_d1_revocation_cannot_be_repaired_by_a_genuine_current_d2_at_acceptance(self):
        request_one, decision_one = self.accepted()
        subscription = self.submitted()
        self.revoke(request_one)
        request_two, decision_two = self.accepted()
        self.assertNotEqual(decision_one.pk, decision_two.pk)
        self.assert_admitted(self.subscription(self.offer, 2), request_two, decision_two)
        before = self.subscription_snapshot(subscription)
        records = self.snapshots()

        with use_operator(), _requester_principal(self.technical.pk):
            with self.assertRaises((InvestorNotEligibleException, SubscriptionRefusedException)):
                accept(subscription)

        self.assert_subscription_unchanged(subscription, before)
        self.assertEqual(before["eligibility_decision_id"], decision_one.pk)
        self.assertEqual(self.snapshots(), records)
        fresh = self.submitted()
        self.assertEqual(fresh.eligibility_decision_id, decision_two.pk)

    def test_primary_source_bytes_are_rechecked_before_submit_and_again_before_accept(self):
        _, decision = self.accepted()
        subscription = self.draft()
        before = self.subscription_snapshot(subscription)
        with open(self.source.evidence_file.path, "wb") as evidence:
            evidence.write(pdf_bytes(width=647))
        with use_operator(), _requester_principal(self.participant.pk):
            with self.assertRaises(InvestorNotEligibleException):
                submit(subscription, submitted_by=self.participant)
        self.assert_subscription_unchanged(subscription, before)
        with open(self.source.evidence_file.path, "wb") as evidence:
            evidence.write(PDF)
        with use_operator(), _requester_principal(self.participant.pk):
            submit(subscription, submitted_by=self.participant)
            subscription.refresh_from_db()
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        before = self.subscription_snapshot(subscription)
        self.source.evidence_file.storage.delete(self.source.evidence_file.name)
        with use_operator(), _requester_principal(self.technical.pk):
            with self.assertRaises(InvestorNotEligibleException):
                accept(subscription)
        self.assert_subscription_unchanged(subscription, before)

    def test_cached_verified_identity_cannot_admit_submit_after_current_identity_loss(self):
        self.accepted()
        subscription = self.draft()
        self.assertTrue(self.account.user_profile.is_id_verified)
        with use_operator():
            UserProfile.objects.filter(pk=self.account.user_profile_id).update(is_id_verified=False)
        self.assertTrue(self.account.user_profile.is_id_verified)
        before = self.subscription_snapshot(subscription)
        with use_operator(), _requester_principal(self.participant.pk):
            with self.assertRaises(InvestorNotEligibleException):
                submit(subscription, submitted_by=self.participant)
        self.assert_subscription_unchanged(subscription, before)

    def test_current_refused_standing_blocks_accept_under_either_installed_identity_policy(self):
        self.accepted()
        subscription = self.submitted()
        before = self.subscription_snapshot(subscription)
        for required in (True, False):
            with use_operator():
                Operator.objects.filter(pk=1).update(investor_kyc_required=required)
            for standing in ("rejected", "suspended", "terminated"):
                with self.subTest(required=required, standing=standing):
                    with use_operator():
                        UserAccount.objects.filter(pk=self.account.pk).update(account_status=standing)
                    with use_operator(), _requester_principal(self.technical.pk):
                        with self.assertRaises((InvestorNotEligibleException, SubscriptionRefusedException)):
                            accept(subscription)
                    self.assert_subscription_unchanged(subscription, before)
        with use_operator():
            UserAccount.objects.filter(pk=self.account.pk).update(account_status="active")
        with use_operator(), _requester_principal(self.technical.pk):
            accept(subscription)

    def test_missing_configuration_refuses_submit_without_bootstrap_or_admission_effect(self):
        self.accepted()
        subscription = self.draft()
        before = self.subscription_snapshot(subscription)
        with use_operator():
            Operator.objects.filter(pk=1).delete()
        with use_operator(), _requester_principal(self.participant.pk):
            with self.assertRaises(ImproperlyConfigured):
                submit(subscription, submitted_by=self.participant)
        self.assert_subscription_unchanged(subscription, before)
        with use_operator():
            self.assertFalse(Operator.objects.exists())

    def test_frozen_price_and_currency_refuse_drift_at_submit_and_accept(self):
        self.accepted()
        draft = self.draft()
        submitted = self.submitted()
        for field, changed in (("price_per_share", Decimal("2.51")), ("price_currency", "USD")):
            with self.subTest(field=field):
                original = getattr(self.offer, field)
                with use_operator():
                    Offering.objects.filter(pk=self.offer.pk).update(**{field: changed})
                for subscription, actor, operation in (
                    (draft, self.participant, lambda: submit(draft, submitted_by=self.participant)),
                    (submitted, self.technical, lambda: accept(submitted)),
                ):
                    before = self.subscription_snapshot(subscription)
                    with use_operator(), _requester_principal(actor.pk):
                        with self.assertRaises((InvestorNotEligibleException, SubscriptionRefusedException)):
                            operation()
                    self.assert_subscription_unchanged(subscription, before)
                with use_operator():
                    Offering.objects.filter(pk=self.offer.pk).update(**{field: original})
        with use_operator(), _requester_principal(self.participant.pk):
            submit(draft, submitted_by=self.participant)
        with use_operator(), _requester_principal(self.technical.pk):
            accept(submitted)

    def test_product_current_terms_drift_refuses_the_original_basis_without_changing_it(self):
        product_offer = self.offering(label="TERMS")
        self.replace_source(category=InvestorCategory.PRODUCT_VALUE)
        _, decision = self.accepted(offering=str(product_offer.pk), quantity=1)
        subscription = self.submitted(offering=product_offer, quantity=1)
        before = self.subscription_snapshot(subscription)
        with use_operator():
            Offering.objects.filter(pk=product_offer.pk).update(summary="Synthetic changed exact offer terms")
        with use_operator(), _requester_principal(self.technical.pk):
            with self.assertRaises((InvestorNotEligibleException, SubscriptionRefusedException)):
                accept(subscription)
        self.assert_subscription_unchanged(subscription, before)
        self.assertEqual(before["eligibility_decision_id"], decision.pk)
        with use_operator():
            Offering.objects.filter(pk=product_offer.pk).update(summary=product_offer.summary)
        with use_operator(), _requester_principal(self.technical.pk):
            accept(subscription)

    def test_actual_holder_source_withdrawal_stops_new_acceptance_without_rewriting_d1(self):
        _, decision = self.accepted()
        subscription = self.submitted()
        self.client.force_authenticate(self.participant)
        response = self.client.delete(f"{SOURCES}{self.source.pk}/")
        self.assertEqual(response.status_code, 204, response.content)
        before = self.subscription_snapshot(subscription)
        with use_operator(), _requester_principal(self.technical.pk):
            with self.assertRaises((InvestorNotEligibleException, SubscriptionRefusedException)):
                accept(subscription)
        self.assert_subscription_unchanged(subscription, before)
        with use_operator():
            self.source.refresh_from_db()
            decision.refresh_from_db()
        self.assertEqual(self.source.withdrawn_by_id, self.participant.pk)
        self.assertEqual(decision.outcome, "accepted")
        self.assertEqual(decision.decided_by_id, self.approver.pk)

    def test_two_actual_holder_submits_wait_on_company_and_commit_only_one_original_basis(self):
        _, decision = self.accepted()
        subscription = self.draft()
        records = self.snapshots()
        first, second = self.two_primary_waiters(
            lambda: self.primary_result(self.participant, lambda: submit(subscription, submitted_by=self.participant)),
            lambda: self.primary_result(
                self.participant,
                lambda: submit(Subscription(pk=subscription.pk), submitted_by=self.participant),
            ),
            self.company,
        )
        self.assertEqual(first["status"], 200, first)
        self.assertEqual(second["status"], 400, second)
        with use_operator():
            subscription.refresh_from_db()
            self.assertEqual(Subscription.objects.count(), 1)
        self.assertEqual(subscription.status, SubscriptionStatus.SUBMITTED)
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        self.assertEqual(subscription.submitted_by_id, self.participant.pk)
        self.assertEqual(subscription.submitted_at, first["submitted_at"])
        self.assertIsNone(subscription.accepted_at)
        self.assertEqual(self.snapshots(), records)

    def test_accept_rechecks_genuine_decision_expiry_after_waiting_on_company(self):
        self.requested_expiry = timezone.now() + timedelta(seconds=8)
        _, decision = self.accepted()
        subscription = self.submitted()
        before, records = self.subscription_snapshot(subscription), self.snapshots()
        result = self.while_row_is_held(
            lambda: self.primary_result(self.technical, lambda: accept(subscription)),
            self.company,
            free=(self.wallet, self.account, self.source, decision, subscription),
            after_wait=lambda: self.await_database_expiry(decision.expires_at),
            no_key=True,
            wait_query=ADMISSION_LOCK_QUERY,
        )
        self.assertEqual(result["status"], 400, result)
        self.assert_subscription_unchanged(subscription, before)
        self.assertEqual(before["eligibility_decision_id"], decision.pk)
        self.assertEqual(self.snapshots(), records)

    def test_submit_rechecks_committed_identity_loss_after_waiting_on_profile(self):
        _, decision = self.accepted()
        subscription = self.draft()
        before = self.subscription_snapshot(subscription)
        profile = self.account.user_profile
        result = self.while_row_is_held(
            lambda: self.primary_result(self.participant, lambda: submit(subscription, submitted_by=self.participant)),
            profile,
            held=(self.company, self.offer_token, self.offer, self.wallet, self.account, self.participant),
            free=(self.source, decision, subscription),
            after_wait=lambda: UserProfile.objects.filter(pk=profile.pk).update(is_id_verified=False),
            no_key=True,
            wait_query=ADMISSION_LOCK_QUERY,
        )
        self.assertEqual(result["status"], 400, result)
        self.assert_subscription_unchanged(subscription, before)
        with use_migrate():
            self.assertFalse(UserProfile.objects.get(pk=profile.pk).is_id_verified)
            UserProfile.objects.filter(pk=profile.pk).update(is_id_verified=True)
        with self.database_role("operator", self.participant):
            submit(subscription, submitted_by=self.participant)
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)

    def test_accept_rechecks_committed_offering_price_after_waiting_on_offering(self):
        _, decision = self.accepted()
        subscription = self.submitted()
        before = self.subscription_snapshot(subscription)
        result = self.while_row_is_held(
            lambda: self.primary_result(self.technical, lambda: accept(subscription)),
            self.offer,
            held=(self.company, self.offer_token),
            free=(self.wallet, self.account, self.source, decision, subscription),
            after_wait=lambda: Offering.objects.filter(pk=self.offer.pk).update(price_per_share=Decimal("2.51")),
            no_key=True,
            wait_query=ADMISSION_LOCK_QUERY,
        )
        self.assertEqual(result["status"], 400, result)
        self.assert_subscription_unchanged(subscription, before)
        with use_migrate():
            Offering.objects.filter(pk=self.offer.pk).update(price_per_share=Decimal("2.50"))
        with self.database_role("operator", self.technical):
            accept(subscription)
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)

    def test_accept_rechecks_current_technical_permission_after_waiting_on_subscription(self):
        _, decision = self.accepted()
        subscription = self.submitted()
        before = self.subscription_snapshot(subscription)
        with use_migrate():
            permission = Permission.objects.get(content_type__app_label="offerings", codename="change_subscription")
        result = self.while_row_is_held(
            lambda: self.primary_result(self.technical, lambda: accept(subscription)),
            subscription,
            held=(
                self.company,
                self.offer_token,
                self.offer,
                self.wallet,
                self.account,
                self.participant,
                self.technical,
                self.source,
                decision,
            ),
            after_wait=lambda: self.technical.user_permissions.remove(permission),
            no_key=True,
            wait_query=ADMISSION_LOCK_QUERY,
        )
        self.assertEqual(result["status"], 400, result)
        self.assert_subscription_unchanged(subscription, before)
        with use_migrate():
            self.assertFalse(self.technical.user_permissions.filter(pk=permission.pk).exists())
            self.technical.user_permissions.add(permission)
        with self.database_role("operator", self.technical):
            accept(subscription)
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        self.assertEqual(subscription.submitted_at, before["submitted_at"])

    def test_actual_company_revocation_commits_ahead_of_waiting_acceptance(self):
        request, decision = self.accepted()
        subscription = self.submitted()
        before = self.subscription_snapshot(subscription)

        def revoke_original():
            retained = revoke_eligibility_decision(
                actor=self.approver,
                request_id=request.pk,
                company_id=self.company.pk,
                appointment=self.appointment.pk,
                idempotency_key=uuid4(),
                reason="Synthetic primary concurrency revocation",
            )
            return retained.pk

        committed, result = self.after_genuine_command_locks(
            revoke_original,
            lambda sql: "users_lock_company_eligibility_context" in sql,
            lambda: self.primary_result(self.technical, lambda: accept(subscription)),
            self.company,
        )
        self.assertEqual(committed, request.pk)
        self.assertEqual(result["status"], 400, result)
        self.assert_subscription_unchanged(subscription, before)
        with use_operator():
            decision.refresh_from_db()
            revocation = decision.revocation
        self.assertEqual(revocation.revoked_by_id, self.approver.pk)
        self.assertEqual(revocation.appointment_id, self.appointment.pk)
        self.assertEqual(decision.outcome, "accepted")
        self.assertEqual(before["eligibility_decision_id"], decision.pk)
        self.assert_source_unreviewed()

    def test_actual_holder_source_withdrawal_commits_ahead_of_waiting_acceptance(self):
        _, decision = self.accepted()
        subscription = self.submitted()
        before = self.subscription_snapshot(subscription)
        committed, result = self.after_genuine_command_locks(
            lambda: withdraw_classification(actor=self.participant, classification_id=self.source.pk).pk,
            lambda sql: 'FROM "users_investorclassification"' in sql and "FOR UPDATE" in sql,
            lambda: self.primary_result(self.technical, lambda: accept(subscription)),
            self.account,
        )
        self.assertEqual(committed, self.source.pk)
        self.assertEqual(result["status"], 400, result)
        self.assert_subscription_unchanged(subscription, before)
        with use_operator():
            self.source.refresh_from_db()
            decision.refresh_from_db()
        self.assertEqual(self.source.status, InvestorClassificationStatus.WITHDRAWN)
        self.assertEqual(self.source.withdrawn_by_id, self.participant.pk)
        self.assertIsNotNone(self.source.reviewed_at)
        self.assertEqual(decision.outcome, "accepted")
        self.assertEqual(before["eligibility_decision_id"], decision.pk)


class CompanyEligibilitySubscriptionRecoveryTest(
    CompanyEligibilitySubscriptionCases, StubUploadDependencies, APITransactionTestCase
):
    def test_legacy_submitted_null_basis_cannot_be_accepted_or_filled_from_a_current_decision(self):
        self.accepted()
        legacy = self.legacy_subscription(SubscriptionStatus.SUBMITTED)
        before = self.subscription_snapshot(legacy)
        records = self.snapshots()
        with use_operator(), _requester_principal(self.technical.pk):
            with self.assertRaises(InvestorNotEligibleException):
                accept(legacy)
        self.assert_subscription_unchanged(legacy, before)
        self.assertIsNone(before["eligibility_decision_id"])
        self.assertEqual(self.snapshots(), records)

    def test_original_accepted_application_keeps_instructions_payments_refunds_and_history_after_loss(self):
        subscription, request, decision = self.accepted_subscription()
        submitted_at = subscription.submitted_at
        accepted_at = subscription.accepted_at
        self.revoke(request)
        with use_operator(), _requester_principal(self.technical.pk):
            issue_instruction(subscription, rail=SettlementRail.BANK_TRANSFER)
            subscription.refresh_from_db()
        self.client.force_authenticate(self.participant)
        detail = self.client.get(f"{BASE}{subscription.pk}/")
        self.assertEqual(detail.status_code, 200, detail.content)
        self.assertEqual(detail.json()["paymentInstruction"]["amountDue"], "5.00")
        self.assertEqual(detail.json()["paymentInstruction"]["reference"], subscription.reference)
        with use_operator(), _requester_principal(self.technical.pk):
            confirm_payment(
                subscription,
                confirmed_by=self.technical,
                amount_received=Decimal("5.00"),
                received_on=timezone.now().date(),
                reference_seen=subscription.reference,
            )
            record_refund(subscription, Decimal("5.00"), reference="SYNTHETIC-REFUND-863")
            subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.REFUNDED)
        self.assertEqual(subscription.refunded_total, Decimal("5.00"))
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        self.assertEqual(subscription.payment_confirmed_by_id, self.technical.pk)
        self.assertEqual(subscription.submitted_at, submitted_at)
        self.assertEqual(subscription.accepted_at, accepted_at)
        detail = self.client.get(f"{BASE}{subscription.pk}/")
        self.assertEqual(detail.status_code, 200, detail.content)
        self.assertEqual(detail.json()["refundReference"], "SYNTHETIC-REFUND-863")
        self.assertIsNone(detail.json()["paymentInstruction"])

    def test_retained_legacy_accepted_null_basis_recovers_money_without_inventing_admission_history(self):
        request, _ = self.accepted()
        legacy = self.legacy_subscription(SubscriptionStatus.ACCEPTED)
        before = self.subscription_snapshot(legacy)
        self.revoke(request)
        with use_operator(), _requester_principal(self.technical.pk):
            issue_instruction(legacy, rail=SettlementRail.BANK_TRANSFER)
            confirm_payment(
                legacy,
                confirmed_by=self.technical,
                amount_received=Decimal("5.00"),
                received_on=timezone.now().date(),
            )
            record_refund(legacy, Decimal("5.00"), reference="SYNTHETIC-LEGACY-REFUND")
            withdraw(legacy, reason="Synthetic legacy recovery completed")
            legacy.refresh_from_db()
        self.assertEqual(legacy.status, SubscriptionStatus.WITHDRAWN)
        self.assertIsNone(legacy.eligibility_decision_id)
        self.assertEqual(legacy.submitted_by_id, before["submitted_by_id"])
        self.assertEqual(legacy.submitted_at, before["submitted_at"])
        self.assertEqual(legacy.accepted_at, before["accepted_at"])
        self.assertEqual(legacy.refunded_total, Decimal("5.00"))
        self.client.force_authenticate(self.participant)
        detail = self.client.get(f"{BASE}{legacy.pk}/")
        self.assertEqual(detail.status_code, 200, detail.content)
        self.assertEqual(detail.json()["refundReference"], "SYNTHETIC-LEGACY-REFUND")

    @override_settings(BLOCKCHAIN_CHAIN_ID=31337, BLOCKCHAIN_OPERATOR_KEY="0x" + "11" * 32)
    def test_genuinely_paid_application_can_queue_existing_authorized_allotment_after_decision_loss(self):
        subscription, request, decision = self.accepted_subscription()
        with use_operator(), _requester_principal(self.technical.pk):
            issue_instruction(subscription, rail=SettlementRail.BANK_TRANSFER)
            confirm_payment(
                subscription,
                confirmed_by=self.technical,
                amount_received=subscription.amount_due,
                received_on=timezone.now().date(),
            )
            subscription.refresh_from_db()
            instruction = apply_instruction(self.offer.token, subscription)
        self.assertEqual(instruction.status, "applied")
        self.revoke(request)
        with use_operator(), _requester_principal(self.technical.pk):
            with patch("offerings.tasks.subscription.allot_subscription_task.defer") as deferred:
                issuance = allot(subscription, self.technical, headroom=(10, 10))
            subscription.refresh_from_db()
            command = ShareIssuanceExecution.objects.get(request_id=issuance.pk)
        self.assertEqual(subscription.status, SubscriptionStatus.PAID)
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        self.assertEqual(subscription.issuance_request_id, issuance.pk)
        self.assertEqual(issuance.status, RequestStatus.APPROVED)
        self.assertEqual(issuance.amount, 2)
        self.assertEqual(issuance.reviewed_by_id, self.technical.pk)
        self.assertEqual(command.executed_by_id, self.technical.pk)
        self.assertEqual(command.status, "queued")
        self.assertIsNone(command.operation_id)
        deferred.assert_called_once()

    @override_settings(BLOCKCHAIN_CHAIN_ID=31337, BLOCKCHAIN_OPERATOR_KEY="0x" + "11" * 32)
    def test_legacy_paid_null_basis_can_queue_existing_allotment_without_filling_admission_history(self):
        request, _ = self.accepted()
        legacy = self.legacy_subscription(SubscriptionStatus.ACCEPTED)
        history = self.subscription_snapshot(legacy)
        with use_operator(), _requester_principal(self.technical.pk):
            issue_instruction(legacy, rail=SettlementRail.BANK_TRANSFER)
            confirm_payment(
                legacy,
                confirmed_by=self.technical,
                amount_received=legacy.amount_due,
                received_on=timezone.now().date(),
            )
            legacy.refresh_from_db()
            instruction = apply_instruction(self.offer.token, legacy)
        self.assertEqual(instruction.status, "applied")
        self.revoke(request)
        with use_operator(), _requester_principal(self.technical.pk):
            with patch("offerings.tasks.subscription.allot_subscription_task.defer") as deferred:
                issuance = allot(legacy, self.technical, headroom=(10, 10))
            legacy.refresh_from_db()
            command = ShareIssuanceExecution.objects.get(request_id=issuance.pk)
        self.assertEqual(legacy.status, SubscriptionStatus.PAID)
        self.assertIsNone(legacy.eligibility_decision_id)
        self.assertEqual(legacy.submitted_by_id, history["submitted_by_id"])
        self.assertEqual(legacy.submitted_at, history["submitted_at"])
        self.assertEqual(legacy.accepted_at, history["accepted_at"])
        self.assertEqual(legacy.issuance_request_id, issuance.pk)
        self.assertEqual(issuance.status, RequestStatus.APPROVED)
        self.assertEqual(command.status, "queued")
        self.assertIsNone(command.operation_id)
        deferred.assert_called_once()


class CompanyEligibilitySubscriptionGuardTest(
    CompanyEligibilitySubscriptionCases, StubUploadDependencies, APITransactionTestCase
):
    def admission_command(self, operation, subscription, decision):
        with self.database_role("operator", self.participant):
            return {
                "operation": operation,
                "subscription": str(subscription.pk),
                "company": str(subscription.company_id),
                "token": str(subscription.offering.token_id),
                "offering": str(subscription.offering_id),
                "wallet": str(subscription.wallet_id),
                "account": str(subscription.user_account_id),
                "profile": str(self.account.user_profile_id),
                "holder": str(self.participant.pk),
                "decision": str(decision.pk),
                "request": str(decision.request_id),
                "source": str(decision.request.source_id),
                "quantity": subscription.quantity,
                "price_per_share": str(subscription.price_per_share),
                "currency": subscription.currency,
                "amount_due": str(subscription.amount_due),
            }

    def declare_admission(self, command):
        with connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT set_config('app.subscription_admission_command', %s, true)",
                [json.dumps(command)],
            )
            cursor.execute("SELECT offerings_lock_subscription_admission()")

    def assert_guard_refusal(self, operation):
        with self.assertRaises(DatabaseError) as raised, atomic():
            operation()
        self.assertEqual(getattr(raised.exception.__cause__, "sqlstate", None), "23514")

    def test_actual_operator_role_reaches_genuine_draft_submit_and_technical_accept_guards(self):
        _, decision = self.accepted()
        with self.database_role("operator", self.participant):
            subscription = create_draft(self.offer, self.account, self.wallet, 2, submitted_by=self.participant)
            self.assertIsNone(subscription.eligibility_decision_id)
            submit(subscription, submitted_by=self.participant)
            subscription.refresh_from_db()
            self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        with self.database_role("operator", self.technical):
            accept(subscription)
            subscription.refresh_from_db()
            self.assertEqual(subscription.status, SubscriptionStatus.ACCEPTED)
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        self.assert_source_unreviewed()

    def test_exact_raw_operator_submit_and_accept_commit_the_original_d1(self):
        _, decision = self.accepted()
        subscription = self.draft()
        records = self.snapshots()
        forged_submission = timezone.now() - timedelta(days=3650)
        before_submission = timezone.now()
        with self.database_role("operator", self.participant):
            self.declare_admission(self.admission_command("submit", subscription, decision))
            changed = Subscription.objects.filter(pk=subscription.pk).update(
                status=SubscriptionStatus.SUBMITTED,
                eligibility_decision_id=decision.pk,
                submitted_by_id=self.participant.pk,
                submitted_at=forged_submission,
            )
            self.assertEqual(changed, 1)
        after_submission = timezone.now()
        with use_operator():
            subscription.refresh_from_db()
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        submitted_at = subscription.submitted_at
        self.assertGreaterEqual(submitted_at, before_submission)
        self.assertLessEqual(submitted_at, after_submission)
        self.assertNotEqual(submitted_at, forged_submission)
        forged_acceptance = timezone.now() + timedelta(days=3650)
        before_acceptance = timezone.now()
        with self.database_role("operator", self.technical):
            self.declare_admission(self.admission_command("accept", subscription, decision))
            changed = Subscription.objects.filter(pk=subscription.pk).update(
                status=SubscriptionStatus.ACCEPTED, accepted_at=forged_acceptance
            )
            self.assertEqual(changed, 1)
        after_acceptance = timezone.now()
        with use_operator():
            subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.ACCEPTED)
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        self.assertEqual(subscription.submitted_at, submitted_at)
        self.assertGreaterEqual(subscription.accepted_at, before_acceptance)
        self.assertLessEqual(subscription.accepted_at, after_acceptance)
        self.assertNotEqual(subscription.accepted_at, forged_acceptance)
        self.assertEqual(self.snapshots(), records)

    def test_raw_accept_rechecks_real_expiry_after_waiting_on_the_last_subscription_lock(self):
        self.requested_expiry = timezone.now() + timedelta(seconds=8)
        request, decision = self.accepted()
        subscription = self.submitted()
        before, records = self.subscription_snapshot(subscription), self.snapshots()
        command = self.admission_command("accept", subscription, decision)

        def raw_accept():
            with self.database_role("operator", self.technical):
                with self.assertRaises(DatabaseError) as raised, atomic():
                    self.declare_admission(command)
                    Subscription.objects.filter(pk=subscription.pk).update(
                        status=SubscriptionStatus.ACCEPTED, accepted_at=decision.decided_at
                    )
                self.assertEqual(getattr(raised.exception.__cause__, "sqlstate", None), "23514")
            return "refused"

        result = self.while_row_is_held(
            raw_accept,
            subscription,
            held=(
                self.company,
                self.offer_token,
                self.offer,
                self.wallet,
                self.account,
                self.participant,
                self.technical,
                self.account.user_profile,
                self.source,
                request,
                decision,
            ),
            after_wait=lambda: self.await_database_expiry(decision.expires_at),
            no_key=True,
            wait_query=ADMISSION_LOCK_QUERY,
        )
        self.assertEqual(result, "refused")
        self.assert_subscription_unchanged(subscription, before)
        self.assertEqual(self.snapshots(), records)

    def test_original_basis_and_technical_acceptance_survive_actual_deferred_foreign_key_commit(self):
        _, decision = self.accepted()
        subscription = self.draft()
        inspection = connections["default"].copy()
        records = self.snapshots()
        try:
            with inspection.cursor() as cursor:
                cursor.execute("SELECT pg_backend_pid()")
                observer = cursor.fetchone()[0]
            with self.database_role("operator", self.participant):
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT pg_backend_pid()")
                    submitting = cursor.fetchone()[0]
                    self.assertNotEqual(observer, submitting)
                    cursor.execute(
                        "SELECT condeferrable, condeferred FROM pg_constraint "
                        "WHERE conrelid = 'offerings_subscription'::regclass AND contype = 'f' "
                        "AND confrelid = 'users_companyeligibilitydecision'::regclass"
                    )
                    self.assertEqual(cursor.fetchall(), [(True, True)])
                    cursor.execute("SET CONSTRAINTS ALL DEFERRED")
                self.declare_admission(self.admission_command("submit", subscription, decision))
                Subscription.objects.filter(pk=subscription.pk).update(
                    status=SubscriptionStatus.SUBMITTED,
                    eligibility_decision_id=decision.pk,
                    submitted_by_id=self.participant.pk,
                    submitted_at=timezone.now(),
                )
                with inspection.cursor() as cursor:
                    cursor.execute(
                        "SELECT status, eligibility_decision_id FROM offerings_subscription WHERE uuid = %s",
                        [subscription.pk],
                    )
                    self.assertEqual(cursor.fetchone(), (SubscriptionStatus.DRAFT, None))
            with inspection.cursor() as cursor:
                cursor.execute(
                    "SELECT status, eligibility_decision_id, submitted_by_id, submitted_at "
                    "FROM offerings_subscription WHERE uuid = %s",
                    [subscription.pk],
                )
                status, basis, holder, submitted_at = cursor.fetchone()
            self.assertEqual((status, basis, holder), (SubscriptionStatus.SUBMITTED, decision.pk, self.participant.pk))
            self.assertIsNotNone(submitted_at)
            with use_operator():
                subscription.refresh_from_db()
            with self.database_role("operator", self.technical):
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SET CONSTRAINTS ALL DEFERRED")
                self.declare_admission(self.admission_command("accept", subscription, decision))
                Subscription.objects.filter(pk=subscription.pk).update(
                    status=SubscriptionStatus.ACCEPTED, accepted_at=timezone.now()
                )
                with inspection.cursor() as cursor:
                    cursor.execute("SELECT status FROM offerings_subscription WHERE uuid = %s", [subscription.pk])
                    self.assertEqual(cursor.fetchone()[0], SubscriptionStatus.SUBMITTED)
            with inspection.cursor() as cursor:
                cursor.execute(
                    "SELECT status, eligibility_decision_id, submitted_at, accepted_at "
                    "FROM offerings_subscription WHERE uuid = %s",
                    [subscription.pk],
                )
                status, basis, retained_submission, accepted_at = cursor.fetchone()
            self.assertEqual(
                (status, basis, retained_submission), (SubscriptionStatus.ACCEPTED, decision.pk, submitted_at)
            )
            self.assertIsNotNone(accepted_at)
            logger.info(
                "Observed actual deferred basis commit observer_pid=%s submitting_pid=%s subscription=%s basis=%s",
                observer,
                submitting,
                subscription.pk,
                decision.pk,
            )
            self.assertEqual(self.snapshots(), records)
        finally:
            inspection.close()

    def test_correct_accept_command_cannot_attach_a_payment_or_reference_to_the_admission_effect(self):
        _, decision = self.accepted()
        subscription = self.submitted()
        before = self.subscription_snapshot(subscription)
        with self.database_role("operator", self.technical):
            self.declare_admission(self.admission_command("accept", subscription, decision))
            self.assert_guard_refusal(
                lambda: Subscription.objects.filter(pk=subscription.pk).update(
                    status=SubscriptionStatus.ACCEPTED,
                    accepted_at=timezone.now(),
                    amount_received=Decimal("1.00"),
                    reference="FORGED-863",
                )
            )
            self.assert_subscription_unchanged(subscription, before)
            changed = Subscription.objects.filter(pk=subscription.pk).update(
                status=SubscriptionStatus.ACCEPTED, accepted_at=timezone.now()
            )
            self.assertEqual(changed, 1)
        with use_operator():
            subscription.refresh_from_db()
        self.assertEqual(subscription.status, SubscriptionStatus.ACCEPTED)
        self.assertEqual(subscription.eligibility_decision_id, decision.pk)
        self.assertIsNone(subscription.amount_received)
        self.assertEqual(subscription.reference, "")

    def test_bare_operator_model_transitions_cannot_forge_submit_or_accept(self):
        _, decision = self.accepted()
        draft = self.draft()
        before = self.subscription_snapshot(draft)
        with self.database_role("operator", self.participant):
            self.assert_guard_refusal(
                lambda: draft.submit(submitted_by=self.participant, eligibility_decision=decision)
            )
        self.assert_subscription_unchanged(draft, before)
        submitted = self.submitted()
        before = self.subscription_snapshot(submitted)
        with self.database_role("operator", self.technical):
            self.assert_guard_refusal(submitted.accept)
        self.assert_subscription_unchanged(submitted, before)

    def test_bare_operator_cannot_set_clear_or_replace_d1_or_edit_admitted_economics(self):
        _, decision_one = self.accepted()
        draft = self.draft()
        submitted = self.submitted()
        _, decision_two = self.accepted()
        with self.database_role("operator", self.participant):
            self.assert_guard_refusal(
                lambda: Subscription.objects.filter(pk=draft.pk).update(eligibility_decision_id=decision_one.pk)
            )
        self.assertIsNone(self.subscription_snapshot(draft)["eligibility_decision_id"])
        before = self.subscription_snapshot(submitted)
        for changes in (
            {"eligibility_decision_id": None},
            {"eligibility_decision_id": decision_two.pk},
            {"quantity": 3},
            {"price_per_share": Decimal("2.51")},
            {"currency": "USD"},
            {"amount_due": Decimal("5.01")},
        ):
            with self.subTest(changes=changes):
                with self.database_role("operator", self.participant):
                    self.assert_guard_refusal(lambda: Subscription.objects.filter(pk=submitted.pk).update(**changes))
                self.assert_subscription_unchanged(submitted, before)
        self.assertEqual(before["eligibility_decision_id"], decision_one.pk)

    def test_partial_extra_null_and_foreign_command_facts_refuse_before_a_new_effect(self):
        _, decision = self.accepted()
        subscription = self.draft()
        correct = self.admission_command("submit", subscription, decision)
        missing = correct.copy()
        missing.pop("source")
        commands = (
            missing,
            {**correct, "claimed_evidence_valid": True},
            {**correct, "source": None},
            {**correct, "holder": str(self.other.pk)},
            {**correct, "account": str(self.other_account.pk)},
            {**correct, "wallet": str(self.other_wallet.pk)},
            {**correct, "quantity": 3},
            {**correct, "amount_due": "500000.00"},
        )
        before = self.subscription_snapshot(subscription)
        for command in commands:
            with self.subTest(command=command):
                with self.database_role("operator", self.participant):
                    self.assert_guard_refusal(lambda: self.declare_admission(command))
                self.assert_subscription_unchanged(subscription, before)

    def test_actual_app_role_cannot_borrow_a_copied_correct_operator_command(self):
        _, decision = self.accepted()
        subscription = self.draft()
        command = self.admission_command("submit", subscription, decision)
        before = self.subscription_snapshot(subscription)
        with self.database_role("app", self.participant):
            with self.assertRaises(DatabaseError) as raised, atomic():
                self.declare_admission(command)
            self.assertIn(getattr(raised.exception.__cause__, "sqlstate", None), ("23514", "42501"))
        self.assert_subscription_unchanged(subscription, before)

    def test_current_d2_command_cannot_substitute_the_admitted_original_d1_at_raw_accept(self):
        request_one, decision_one = self.accepted()
        subscription = self.submitted()
        self.revoke(request_one)
        _, decision_two = self.accepted()
        before = self.subscription_snapshot(subscription)
        command = self.admission_command("accept", subscription, decision_two)
        with self.database_role("operator", self.technical):
            self.assert_guard_refusal(lambda: self.declare_admission(command))
        self.assert_subscription_unchanged(subscription, before)
        self.assertEqual(before["eligibility_decision_id"], decision_one.pk)

    def test_correct_current_command_cannot_fill_legacy_submitted_null_admission(self):
        _, decision = self.accepted()
        legacy = self.legacy_subscription(SubscriptionStatus.SUBMITTED)
        before = self.subscription_snapshot(legacy)
        command = self.admission_command("accept", legacy, decision)
        with self.database_role("operator", self.technical):
            self.assert_guard_refusal(lambda: self.declare_admission(command))
        self.assert_subscription_unchanged(legacy, before)
        self.assertIsNone(before["eligibility_decision_id"])

    def test_missing_configuration_refuses_raw_operator_admission_without_bootstrap_or_record_change(self):
        _, decision = self.accepted()
        subscription = self.draft()
        command = self.admission_command("submit", subscription, decision)
        before = self.subscription_snapshot(subscription)
        records = self.snapshots()
        with use_migrate():
            Operator.objects.filter(pk=1).delete()
        with self.database_role("operator", self.participant):
            with self.assertRaises(DatabaseError) as raised, atomic():
                self.declare_admission(command)
            self.assertEqual(getattr(raised.exception.__cause__, "sqlstate", None), "55000")
        self.assert_subscription_unchanged(subscription, before)
        self.assertEqual(self.snapshots(), records)
        with use_operator():
            self.assertFalse(Operator.objects.exists())
