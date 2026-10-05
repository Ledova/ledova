from contextlib import contextmanager
from copy import deepcopy
from unittest.mock import Mock, patch
from uuid import uuid4

from django.conf import settings
from django.contrib import admin
from django.contrib.auth.models import Permission
from django.db import DatabaseError, connections
from django.test import RequestFactory, override_settings
from django.utils import timezone
from rest_framework.test import APITransactionTestCase
from rest_framework_simplejwt.tokens import RefreshToken

from authentication.admin.user import CustomUserAdmin
from authentication.services import TokenService
from companies.services.authority_requests import _requester_principal
from integrations.kyc.base import NormalizedVerificationResult
from integrations.kyc.constants import REVIEW_GREEN, REVIEW_RED
from operators.models import Operator
from shared.db import atomic, current_alias, principal_of, use_operator
from shared.tests.upload_fixtures import StubUploadDependencies
from users.admin.user_account import UserAccountAdmin
from users.admin.user_profile import UserProfileAdmin
from users.constants import ACCOUNT_STATUS_ACTIVE, ACCOUNT_STATUS_SUSPENDED
from users.models import InvestorClassification, UserAccount, UserProfile
from users.models.user_account import AccountRole
from users.services.identity import update_status_from_normalized
from users.tests.factories import make_investor
from users.tests.test_company_eligibility_consumption import (
    CompanyEligibilityConsumptionCases,
)
from wallets.admin.wallet import WalletAdmin
from wallets.constants import (
    WALLET_VERIFICATION_STATUS_PENDING,
    WALLET_VERIFICATION_STATUS_VERIFIED,
)
from wallets.models import Wallet
from whitelist.models import (
    WhitelistAction,
    WhitelistApproval,
    WhitelistChangeStatus,
    WhitelistEligibilityInvalidation,
    WhitelistEntry,
    WhitelistInvalidationCause,
)
from whitelist.services import changes, eligibility_invalidation, refresh, whitelist
from whitelist.tests.change_fixtures import (
    ADDRESS,
    CHAIN_ID,
    FACTORY,
    KEY,
    WhitelistNode,
    admitted_signer,
    change_actor,
)


class EligibilityLossProducerCases(CompanyEligibilityConsumptionCases):
    def setUp(self):
        super().setUp()
        self.request, self.decision = self.accepted()
        with use_operator():
            self.profile = UserProfile.objects.get(pk=self.account.user_profile_id)
            self.technical = change_actor()
            self.wallet = Wallet.objects.create(
                user_account=self.account,
                address=ADDRESS,
                chain="base",
                verification_status=WALLET_VERIFICATION_STATUS_VERIFIED,
            )
            self.entry = WhitelistEntry.objects.create(wallet=self.wallet)
            admitted_signer()
        self.node = WhitelistNode()
        for module in (changes, whitelist, eligibility_invalidation):
            self.enterContext(patch.object(module, "get_base_chain_client", return_value=self.node.client))
        with self.actual_operator():
            change = changes.submit(uuid4(), WhitelistAction.ADD, ADDRESS, self.technical, company=self.company)
        self.assertEqual(change.status, WhitelistChangeStatus.CONFIRMED)
        self.assertNotEqual(self.node.expiries[ADDRESS], 0)
        with use_operator():
            self.approval = WhitelistApproval.objects.select_related("entry__wallet", "company").get(
                entry=self.entry, company=self.company
            )
            self.targets = refresh.targets_for([self.approval])
            self.original_source = InvestorClassification.objects.values().get(pk=self.source.pk)
        self.original_history = self.snapshots()
        with self.source.evidence_file.open("rb") as evidence:
            self.original_evidence = evidence.read()
        self.queued = []
        self.queue_task = Mock()
        self.queue_task.configure.return_value = self.queue_task
        self.queue_task.defer.side_effect = self.capture_committed_queue
        self.enterContext(patch("whitelist.tasks.refresh_whitelist_targets", self.queue_task))
        self.enterContext(patch("users.tasks.notifications.send_push_notification.defer"))

    @contextmanager
    def actual_operator(self):
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

    @contextmanager
    def as_actor(self, actor=None):
        with use_operator(), _requester_principal(actor.pk if actor is not None else ""):
            connection = connections[current_alias()]
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_setting('role'), current_setting('app.user_id', true)")
                previous = cursor.fetchone()
            try:
                yield
            finally:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT current_setting('role'), current_setting('app.user_id', true)")
                    self.assertEqual(cursor.fetchone(), previous)

    def capture_committed_queue(self, **arguments):
        connection = connections[current_alias()]
        self.assertFalse(connection.in_atomic_block)
        self.assertTrue(connection.get_autocommit())
        with connection.cursor() as cursor:
            cursor.execute("SELECT current_user")
            self.assertEqual(cursor.fetchone()[0], settings.RLS_ROLES["operator"])
        event = WhitelistEligibilityInvalidation.objects.get(pk=arguments["invalidation_id"])
        self.assertEqual(principal_of() or "", str(event.initiated_by_id) if event.initiated_by_id is not None else "")
        self.assertEqual(arguments["cause"], event.cause)
        self.assertIsNone(arguments["decision_id"])
        self.assertEqual(arguments["targets"], self.targets)
        if event.cause == WhitelistInvalidationCause.WALLET_REMOVAL:
            wallet = Wallet.objects.filter(pk=event.wallet_id).first()
            self.assertTrue(wallet is None or wallet.verification_status == WALLET_VERIFICATION_STATUS_PENDING)
        else:
            account = UserAccount.objects.select_related("user_profile__user").get(pk=event.user_account_id)
            changed = {
                "account_status": account.account_status != event.facts["standing"],
                "role": account.role != event.facts["role"],
                "is_active": account.user_profile.user.is_active != event.facts["active"],
                "is_email_verified": account.user_profile.user.is_email_verified != event.facts["email_verified"],
                "is_id_verified": account.user_profile.is_id_verified != event.facts["identity_verified"],
            }
            for field in event.cause_fields:
                self.assertTrue(changed[field], field)
        self.queued.append(deepcopy(arguments))

    def staff_actor(self, label, *permissions):
        with use_operator():
            actor, _ = make_investor(f"loss-producer-{label}", staff=True)
            for app_label, codename in permissions:
                actor.user_permissions.add(Permission.objects.get(content_type__app_label=app_label, codename=codename))
            for app_label, codename in permissions:
                self.assertTrue(actor.has_perm(f"{app_label}.{codename}"))
        self.assertFalse(actor.is_superuser)
        return actor

    def admin_request(self, actor):
        request = RequestFactory().post("/admin/")
        request.user = actor
        return request

    def save_admin(self, model_admin, actor, obj):
        with self.as_actor(actor):
            model_admin.save_model(self.admin_request(actor), obj, None, True)

    def assert_sql_refused(self, operation):
        with self.assertRaises(DatabaseError) as caught:
            operation()
        self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514", str(caught.exception))
        with use_operator():
            self.assertFalse(WhitelistEligibilityInvalidation.objects.exists())
        self.assertEqual(self.queued, [])

    def assert_retained_private_history(self):
        with use_operator():
            self.assertEqual(InvestorClassification.objects.values().get(pk=self.source.pk), self.original_source)
            self.source.refresh_from_db()
        self.assertEqual(self.snapshots(), self.original_history)
        with self.source.evidence_file.open("rb") as evidence:
            self.assertEqual(evidence.read(), self.original_evidence)
        self.assertIsNone(self.source.reviewed_by_id)
        self.assertIsNone(self.source.withdrawn_by_id)

    def assert_single_loss(self, cause, fields, actor, *, wallet=False):
        with use_operator():
            event = WhitelistEligibilityInvalidation.objects.get()
        self.assertEqual(event.cause, cause)
        self.assertEqual(event.cause_fields, sorted(fields))
        self.assertEqual(event.initiated_by_id, actor.pk if actor is not None else None)
        self.assertEqual(event.user_account_id, self.account.pk)
        self.assertEqual(event.chain_id, CHAIN_ID)
        self.assertEqual(event.facts["holder"], str(self.participant.pk))
        self.assertEqual(event.facts["account"], str(self.account.pk))
        self.assertEqual(event.facts["profile"], str(self.profile.pk))
        self.assertEqual(event.facts["role"], AccountRole.INVESTOR)
        self.assertEqual(event.facts["standing"], ACCOUNT_STATUS_ACTIVE)
        self.assertTrue(event.facts["active"])
        self.assertTrue(event.facts["email_verified"])
        self.assertTrue(event.facts["identity_verified"])
        self.assertEqual(
            event.facts["targets"],
            [{key: target[key] for key in ("company", "registry", "address", "wallet")} for target in self.targets],
        )
        self.assertEqual(event.wallet_id, self.wallet.pk if wallet else None)
        self.assertEqual(event.address, ADDRESS if wallet else "")
        self.assertTrue(timezone.is_aware(event.invalidated_at))
        self.assertEqual(len(self.queued), 1)
        self.assertEqual(self.queued[0]["invalidation_id"], str(event.pk))
        self.assert_retained_private_history()
        return event

    def normalized(self, review=REVIEW_RED):
        return NormalizedVerificationResult(
            verification_status="completed",
            review_result=review,
            is_verified=review == REVIEW_GREEN,
            rejection_labels=["DOCUMENT_EXPIRED"] if review == REVIEW_RED else [],
        )

    def provider_result(self, actor=None, review=REVIEW_RED):
        with self.as_actor(actor):
            return update_status_from_normalized(self.profile, self.normalized(review))


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class EligibilityLossProducerTest(EligibilityLossProducerCases, StubUploadDependencies, APITransactionTestCase):
    def test_holder_wallet_delete_retains_its_target_and_queues_after_the_actual_commit(self):
        self.client.force_authenticate(self.participant)
        response = self.client.delete(f"/api/wallets/{self.wallet.pk}/")
        self.assertEqual(response.status_code, 204, response.content)
        self.assert_single_loss(WhitelistInvalidationCause.WALLET_REMOVAL, [], self.participant, wallet=True)
        with use_operator():
            self.assertFalse(Wallet.objects.filter(pk=self.wallet.pk).exists())
            self.assertFalse(WhitelistEntry.objects.filter(pk=self.entry.pk).exists())
        self.assertEqual(len(self.node.broadcasts), 1)

    def test_foreign_wallet_delete_is_404_and_retains_the_original_approval(self):
        self.client.force_authenticate(self.other)
        response = self.client.delete(f"/api/wallets/{self.wallet.pk}/")
        self.assertEqual(response.status_code, 404, response.content)
        with use_operator():
            self.assertTrue(Wallet.objects.filter(pk=self.wallet.pk).exists())
            self.assertTrue(WhitelistApproval.objects.filter(pk=self.approval.pk).exists())
            self.assertFalse(WhitelistEligibilityInvalidation.objects.exists())
        self.assertEqual(self.queued, [])
        self.assert_retained_private_history()

    def test_bitcoin_wallet_delete_does_not_create_a_base_removal_or_touch_its_approval(self):
        with use_operator():
            wallet = Wallet.objects.create(
                user_account=self.account, address="synthetic-bitcoin-address", chain="bitcoin"
            )
        self.client.force_authenticate(self.participant)
        response = self.client.delete(f"/api/wallets/{wallet.pk}/")
        self.assertEqual(response.status_code, 204, response.content)
        with use_operator():
            self.assertFalse(Wallet.objects.filter(pk=wallet.pk).exists())
            self.assertTrue(Wallet.objects.filter(pk=self.wallet.pk).exists())
            self.assertTrue(WhitelistApproval.objects.filter(pk=self.approval.pk).exists())
            self.assertFalse(WhitelistEligibilityInvalidation.objects.exists())
        self.assertEqual(self.queued, [])
        self.assert_retained_private_history()

    def test_admin_wallet_delete_requires_delete_permission_at_the_actual_commit(self):
        change_only = self.staff_actor("wallet-change-only", ("wallets", "change_wallet"))
        delete_only = self.staff_actor("wallet-delete-only", ("wallets", "delete_wallet"))
        model_admin = WalletAdmin(Wallet, admin.site)

        def delete_as(actor):
            with self.as_actor(actor):
                model_admin.delete_model(self.admin_request(actor), self.wallet)

        self.assert_sql_refused(lambda: delete_as(change_only))
        with use_operator():
            self.assertTrue(Wallet.objects.filter(pk=self.wallet.pk).exists())
        delete_as(delete_only)
        self.assert_single_loss(WhitelistInvalidationCause.WALLET_REMOVAL, [], delete_only, wallet=True)

    def test_admin_wallet_deverification_requires_change_permission_and_ignores_restoration_or_noop(self):
        delete_only = self.staff_actor("deverify-delete-only", ("wallets", "delete_wallet"))
        change_only = self.staff_actor("deverify-change-only", ("wallets", "change_wallet"))
        model_admin = WalletAdmin(Wallet, admin.site)
        self.wallet.verification_status = WALLET_VERIFICATION_STATUS_PENDING
        self.assert_sql_refused(lambda: self.save_admin(model_admin, delete_only, self.wallet))
        with use_operator():
            self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.verification_status, WALLET_VERIFICATION_STATUS_VERIFIED)
        self.wallet.verification_status = WALLET_VERIFICATION_STATUS_PENDING
        self.save_admin(model_admin, change_only, self.wallet)
        self.assert_single_loss(WhitelistInvalidationCause.WALLET_REMOVAL, [], change_only, wallet=True)
        self.wallet.name = "Synthetic name without another verification loss"
        self.save_admin(model_admin, change_only, self.wallet)
        self.wallet.verification_status = WALLET_VERIFICATION_STATUS_VERIFIED
        self.save_admin(model_admin, change_only, self.wallet)
        with use_operator():
            self.assertEqual(WhitelistEligibilityInvalidation.objects.count(), 1)
            self.wallet.refresh_from_db()
        self.assertEqual(self.wallet.verification_status, WALLET_VERIFICATION_STATUS_VERIFIED)
        self.assertEqual(len(self.queued), 1)
        self.assert_retained_private_history()

    def test_admin_pending_wallet_rebind_has_no_loss_and_verified_rebind_is_refused_without_losing_approval(self):
        actor = self.staff_actor("wallet-account-rebind", ("wallets", "change_wallet"))
        model_admin = WalletAdmin(Wallet, admin.site)
        with use_operator():
            pending = Wallet.objects.create(
                user_account=self.account,
                address="0x" + "b" * 40,
                chain="base",
                verification_status=WALLET_VERIFICATION_STATUS_PENDING,
            )
            self.assertTrue(model_admin.has_change_permission(self.admin_request(actor), pending))
        pending.user_account = self.other_account
        self.save_admin(model_admin, actor, pending)
        with use_operator():
            pending.refresh_from_db()
            self.assertFalse(WhitelistEligibilityInvalidation.objects.exists())
            self.assertTrue(WhitelistApproval.objects.filter(pk=self.approval.pk, entry=self.entry).exists())
        self.assertEqual(pending.user_account_id, self.other_account.pk)
        self.assertEqual(pending.verification_status, WALLET_VERIFICATION_STATUS_PENDING)
        self.assertEqual(self.queued, [])
        self.wallet.user_account = self.other_account
        self.assert_sql_refused(lambda: self.save_admin(model_admin, actor, self.wallet))
        with use_operator():
            self.wallet.refresh_from_db()
            self.assertTrue(WhitelistApproval.objects.filter(pk=self.approval.pk, entry=self.entry).exists())
        self.assertEqual(self.wallet.user_account_id, self.account.pk)
        self.assertEqual(self.wallet.verification_status, WALLET_VERIFICATION_STATUS_VERIFIED)
        self.assertEqual(len(self.node.broadcasts), 1)
        self.assert_retained_private_history()

    def test_rolled_back_wallet_delete_keeps_its_history_and_never_dispatches_queue_transport(self):
        model_admin = WalletAdmin(Wallet, admin.site)
        actor = self.staff_actor("wallet-delete-rollback", ("wallets", "delete_wallet"))
        with self.assertRaisesMessage(RuntimeError, "Synthetic original loss rollback"):
            with self.as_actor(actor), atomic():
                model_admin.delete_model(self.admin_request(actor), self.wallet)
                with use_operator():
                    self.assertTrue(WhitelistEligibilityInvalidation.objects.exists())
                    self.assertFalse(Wallet.objects.filter(pk=self.wallet.pk).exists())
                self.assertEqual(self.queued, [])
                raise RuntimeError("Synthetic original loss rollback")
        with use_operator():
            self.assertTrue(Wallet.objects.filter(pk=self.wallet.pk).exists())
            self.assertTrue(WhitelistApproval.objects.filter(pk=self.approval.pk).exists())
            self.assertFalse(WhitelistEligibilityInvalidation.objects.exists())
        self.assertEqual(self.queued, [])
        self.assert_retained_private_history()

    def test_own_account_deletion_retains_its_actual_inactive_holder_and_private_evidence(self):
        with use_operator():
            sessions = [TokenService.issue(self.participant)[1] for _ in range(2)]
        self.client.force_authenticate(self.participant)
        response = self.client.post("/api/user-profiles/delete-account/")
        self.assertEqual(response.status_code, 200, response.content)
        self.assert_single_loss(
            WhitelistInvalidationCause.STANDING_LOSS, ["is_active", "is_email_verified"], self.participant
        )
        with use_operator():
            self.participant.refresh_from_db()
            self.profile.refresh_from_db()
            self.assertTrue(UserAccount.objects.filter(pk=self.account.pk).exists())
            self.assertTrue(Wallet.objects.filter(pk=self.wallet.pk).exists())
            for raw in sessions:
                self.assertFalse(TokenService.is_session_live(RefreshToken(raw, verify=False)["jti"]))
        self.assertFalse(self.participant.is_active)
        self.assertFalse(self.participant.is_email_verified)
        self.assertTrue(self.participant.email.endswith("@deleted.invalid"))
        self.assertEqual(self.profile.full_name, "Deleted User")

    def test_own_pre_signup_role_loss_is_retained_without_a_staff_principal(self):
        self.client.force_authenticate(self.other)
        response = self.client.patch(f"/api/user-accounts/{self.account.pk}/", {"role": AccountRole.COMPANY})
        self.assertEqual(response.status_code, 404, response.content)
        self.assertEqual(self.queued, [])
        self.client.force_authenticate(self.participant)
        response = self.client.patch(f"/api/user-accounts/{self.account.pk}/", {"role": AccountRole.COMPANY})
        self.assertEqual(response.status_code, 200, response.content)
        self.assert_single_loss(WhitelistInvalidationCause.STANDING_LOSS, ["role"], self.participant)
        with use_operator():
            self.account.refresh_from_db()
        self.assertEqual(self.account.role, AccountRole.COMPANY)
        self.assertFalse(self.eligibility().is_eligible)

    def test_staff_standing_and_role_loss_require_the_exact_account_permission_and_keep_original_facts(self):
        wrong = self.staff_actor("standing-auth-only", ("authentication", "change_customuser"))
        right = self.staff_actor("standing-account-only", ("users", "change_useraccount"))
        model_admin = UserAccountAdmin(UserAccount, admin.site)
        self.account.account_status = ACCOUNT_STATUS_SUSPENDED
        self.account.role = AccountRole.COMPANY
        self.assert_sql_refused(lambda: self.save_admin(model_admin, wrong, self.account))
        with use_operator():
            self.account.refresh_from_db()
        self.assertEqual(self.account.account_status, ACCOUNT_STATUS_ACTIVE)
        self.assertEqual(self.account.role, AccountRole.INVESTOR)
        self.account.account_status = ACCOUNT_STATUS_SUSPENDED
        self.account.role = AccountRole.COMPANY
        self.save_admin(model_admin, right, self.account)
        self.assert_single_loss(WhitelistInvalidationCause.STANDING_LOSS, ["account_status", "role"], right)
        self.save_admin(model_admin, right, self.account)
        self.account.account_status = ACCOUNT_STATUS_ACTIVE
        self.account.role = AccountRole.INVESTOR
        self.save_admin(model_admin, right, self.account)
        self.assertEqual(len(self.queued), 1)
        with use_operator():
            self.assertEqual(WhitelistEligibilityInvalidation.objects.count(), 1)

    def test_staff_email_change_requires_auth_permission_and_retains_original_verified_email_loss(self):
        wrong = self.staff_actor("email-account-only", ("users", "change_useraccount"))
        right = self.staff_actor("email-auth-only", ("authentication", "change_customuser"))
        model_admin = CustomUserAdmin(type(self.participant), admin.site)
        with use_operator():
            raw = TokenService.issue(self.participant)[1]
        original_email = self.participant.email
        self.participant.email = "synthetic-new-email@investors.example.test"
        self.assert_sql_refused(lambda: self.save_admin(model_admin, wrong, self.participant))
        with use_operator():
            self.participant.refresh_from_db()
        self.assertEqual(self.participant.email, original_email)
        self.assertTrue(self.participant.is_email_verified)
        self.participant.email = "synthetic-new-email@investors.example.test"
        self.save_admin(model_admin, right, self.participant)
        self.assert_single_loss(WhitelistInvalidationCause.STANDING_LOSS, ["is_email_verified"], right)
        with use_operator():
            self.participant.refresh_from_db()
            self.assertFalse(TokenService.is_session_live(RefreshToken(raw, verify=False)["jti"]))
        self.assertEqual(self.participant.email, "synthetic-new-email@investors.example.test")
        self.assertFalse(self.participant.is_email_verified)

    def test_staff_auth_loss_records_both_original_fields_and_never_records_a_noop_or_restoration(self):
        actor = self.staff_actor("auth-loss", ("authentication", "change_customuser"))
        model_admin = CustomUserAdmin(type(self.participant), admin.site)
        self.participant.is_active = False
        self.participant.is_email_verified = False
        self.save_admin(model_admin, actor, self.participant)
        self.assert_single_loss(WhitelistInvalidationCause.STANDING_LOSS, ["is_active", "is_email_verified"], actor)
        self.save_admin(model_admin, actor, self.participant)
        self.participant.is_active = True
        self.participant.is_email_verified = True
        self.save_admin(model_admin, actor, self.participant)
        self.assertEqual(len(self.queued), 1)
        with use_operator():
            self.assertEqual(WhitelistEligibilityInvalidation.objects.count(), 1)
            self.participant.refresh_from_db()
        self.assertTrue(self.participant.is_active)
        self.assertTrue(self.participant.is_email_verified)

    def test_automatic_provider_identity_loss_retains_its_actual_prior_facts_without_a_human(self):
        self.assertFalse(self.provider_result())
        event = self.assert_single_loss(WhitelistInvalidationCause.IDENTITY_LOSS, ["is_id_verified"], None)
        self.assertTrue(event.facts["kyc_required"])
        self.assertEqual(event.facts["identity_provider"], self.profile.kyc_provider)
        self.assertIsNone(event.facts["identity_review"])
        with use_operator():
            self.profile.refresh_from_db()
        self.assertFalse(self.profile.is_id_verified)
        self.assertEqual(self.profile.review_result, REVIEW_RED)
        self.assertEqual(self.profile.rejection_labels, ["DOCUMENT_EXPIRED"])
        self.assertIsNone(self.profile.verified_at)
        self.assertFalse(self.eligibility().is_eligible)

    def test_holder_provider_loss_keeps_the_human_and_does_not_duplicate_on_red_or_green(self):
        self.assertFalse(self.provider_result(self.participant))
        self.assert_single_loss(WhitelistInvalidationCause.IDENTITY_LOSS, ["is_id_verified"], self.participant)
        self.assertFalse(self.provider_result(self.participant))
        self.assertTrue(self.provider_result(self.participant, REVIEW_GREEN))
        self.assertEqual(len(self.queued), 1)
        with use_operator():
            self.assertEqual(WhitelistEligibilityInvalidation.objects.count(), 1)
            self.profile.refresh_from_db()
        self.assertEqual(self.profile.review_result, REVIEW_GREEN)
        self.assertIsNotNone(self.profile.verified_at)
        self.assert_admitted(self.eligibility(), self.request, self.decision)
        self.assert_retained_private_history()

    def test_provider_identity_loss_with_kyc_disabled_does_not_invent_a_required_loss_or_removal(self):
        with use_operator():
            operator = Operator.get()
            operator.investor_kyc_required = False
            operator.save(update_fields=["investor_kyc_required"])
        self.assertFalse(self.provider_result())
        with use_operator():
            self.assertFalse(WhitelistEligibilityInvalidation.objects.exists())
            self.profile.refresh_from_db()
        self.assertFalse(self.profile.is_id_verified)
        self.assertEqual(self.queued, [])
        self.assert_admitted(self.eligibility(), self.request, self.decision)
        self.assert_retained_private_history()

    def test_staff_provider_identity_loss_requires_profile_permission_and_restores_the_actual_principal(self):
        wrong = self.staff_actor("identity-auth-only", ("authentication", "change_customuser"))
        right = self.staff_actor("identity-profile-only", ("users", "change_userprofile"))
        self.assert_sql_refused(lambda: self.provider_result(wrong))
        with use_operator():
            self.profile.refresh_from_db()
        self.assertTrue(self.profile.is_id_verified)
        self.assertIsNone(self.profile.review_result)
        self.assertFalse(self.provider_result(right))
        self.assert_single_loss(WhitelistInvalidationCause.IDENTITY_LOSS, ["is_id_verified"], right)

    def test_profile_admin_identity_loss_requires_profile_permission_and_ignores_noop_or_restoration(self):
        wrong = self.staff_actor(
            "profile-account-auth-only", ("users", "change_useraccount"), ("authentication", "change_customuser")
        )
        right = self.staff_actor("profile-admin-only", ("users", "change_userprofile"))
        model_admin = UserProfileAdmin(UserProfile, admin.site)
        self.profile.is_id_verified = False
        self.assert_sql_refused(lambda: self.save_admin(model_admin, wrong, self.profile))
        with use_operator():
            self.profile.refresh_from_db()
        self.assertTrue(self.profile.is_id_verified)
        self.profile.is_id_verified = False
        self.save_admin(model_admin, right, self.profile)
        self.assert_single_loss(WhitelistInvalidationCause.IDENTITY_LOSS, ["is_id_verified"], right)
        self.save_admin(model_admin, right, self.profile)
        self.profile.is_id_verified = True
        self.save_admin(model_admin, right, self.profile)
        self.assertEqual(len(self.queued), 1)
        with use_operator():
            self.assertEqual(WhitelistEligibilityInvalidation.objects.count(), 1)
            self.profile.refresh_from_db()
        self.assertTrue(self.profile.is_id_verified)
        self.assert_retained_private_history()
