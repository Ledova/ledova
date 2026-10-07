from contextlib import contextmanager
from datetime import datetime, timedelta
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.contrib.auth.models import Group, Permission
from django.core.exceptions import ImproperlyConfigured
from django.db import DatabaseError, connections
from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied
from rest_framework.test import APITransactionTestCase

from companies.services.authority_requests import _requester_principal
from shared.db import atomic, current_alias, principal_of, use_operator
from shared.tests.upload_fixtures import StubUploadDependencies, pdf_bytes
from users.models import (
    CompanyEligibilityDecision,
    UserAccount,
    UserProfile,
)
from users.tests.test_company_eligibility_consumption import (
    CompanyEligibilityConsumptionCases,
)
from users.tests.test_company_eligibility_requests import REQUESTS, SOURCES
from wallets.constants import (
    WALLET_VERIFICATION_STATUS_PENDING,
    WALLET_VERIFICATION_STATUS_VERIFIED,
)
from wallets.models import Wallet
from whitelist.admin import entry_eligibility
from whitelist.exceptions import WhitelistChangeConflict, WhitelistRemovalPending
from whitelist.models import (
    WhitelistApproval,
    WhitelistAuthority,
    WhitelistChange,
    WhitelistChangeStatus,
    WhitelistEligibilityInvalidation,
    WhitelistEntry,
    WhitelistInvalidationCause,
    WhitelistStatus,
)
from whitelist.services import changes, eligibility_invalidation, refresh, whitelist
from whitelist.services.eligibility_invalidation import (
    command_for,
    invalidation_command,
    invalidation_worker_context,
    invalidation_writer_context,
    record_invalidation,
)
from whitelist.tasks.refresh import (
    refresh_whitelist_approvals,
    refresh_whitelist_targets,
)
from whitelist.tests.change_fixtures import (
    ADDRESS,
    CHAIN_ID,
    FACTORY,
    KEY,
    WhitelistNode,
    admitted_signer,
    change_actor,
)
from whitelist.tests.historical_whitelist_fixtures import retained_signed_add


@override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID, SHARE_TOKEN_FACTORY_ADDRESS=FACTORY)
class CompanyEligibilityInvalidationTest(
    CompanyEligibilityConsumptionCases, StubUploadDependencies, APITransactionTestCase
):
    def setUp(self):
        super().setUp()
        with use_operator():
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

    @contextmanager
    def actual_operator(self):
        with use_operator():
            connection = connections[current_alias()]
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_setting('role')")
                previous = cursor.fetchone()[0]
                cursor.execute(f"SET ROLE {connection.ops.quote_name(settings.RLS_ROLES['operator'])}")
            try:
                yield
            finally:
                with connection.cursor() as cursor:
                    if previous == "none":
                        cursor.execute("RESET ROLE")
                    else:
                        cursor.execute(f"SET ROLE {connection.ops.quote_name(previous)}")

    @contextmanager
    def operator_as(self, actor=None):
        with self.actual_operator(), _requester_principal(actor.pk if actor is not None else ""), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("SELECT current_user")
                self.assertEqual(cursor.fetchone()[0], settings.RLS_ROLES["operator"])
            yield

    def approve(self):
        signed = retained_signed_add(
            actor=self.technical, company=self.company, entry=self.entry, client=self.node.client
        )
        with self.actual_operator():
            change = changes.recover(signed.pk)
        self.assertEqual(change.status, WhitelistChangeStatus.CONFIRMED)
        self.assertNotEqual(self.node.expiries[ADDRESS], 0)
        return change

    def approval(self):
        with use_operator():
            return WhitelistApproval.objects.select_related("entry__wallet", "company").get(
                entry=self.entry, company=self.company
            )

    def refresh(self, **arguments):
        with self.actual_operator():
            return refresh.refresh_approval(self.approval(), **arguments)

    def withdraw_source(self):
        self.client.force_authenticate(self.participant)
        response = self.client.delete(f"{SOURCES}{self.source.pk}/")
        self.assertEqual(response.status_code, 204, response.content)

    def raw_change(self, command, **overrides):
        history = eligibility_invalidation.retained_cause(
            command["decision"], command["cause"], command["invalidation"]
        )
        intent = changes._intent("remove", ADDRESS, command["registry"], None)
        return WhitelistChange.objects.create(
            **{
                "uuid": uuid4(),
                "action": "remove",
                "address": ADDRESS,
                "chain_id": CHAIN_ID,
                "registry_address": command["registry"],
                "company_id": self.company.pk,
                "intent": intent,
                "initiated_by_id": int(history["actor"]) if history["actor"] is not None else None,
                "authority": WhitelistAuthority.CLASSIFICATION_REFRESH,
                "entry_id": self.entry.pk,
                "eligibility_decision_id": command["decision"],
                "eligibility_invalidation_id": command["invalidation"],
                "invalidation_cause": command["cause"],
                "invalidated_at": datetime.fromisoformat(history["at"]),
                **overrides,
            }
        )

    def revoked_command(self):
        request, decision = self.accepted()
        self.approve()
        self.revoke(request)
        with use_operator():
            command = command_for(refresh.targets_for([self.approval()])[0])
        self.assertEqual(command["decision"], str(decision.pk))
        return request, decision, command

    def test_company_revocation_removes_under_the_real_now_inactive_company_revoker(self):
        _, decision, _ = self.revoked_command()
        with use_operator():
            type(self.approver).objects.filter(pk=self.approver.pk).update(is_active=False)
        broadcasts = len(self.node.broadcasts)
        change = self.refresh()
        self.assertEqual(change.action, "remove")
        self.assertEqual(change.status, WhitelistChangeStatus.CONFIRMED)
        self.assertEqual(change.eligibility_decision_id, decision.pk)
        self.assertEqual(change.initiated_by_id, self.approver.pk)
        self.assertEqual(change.invalidation_cause, WhitelistInvalidationCause.COMPANY_REVOCATION)
        self.assertEqual(self.node.expiries[ADDRESS], 0)
        self.assertEqual(len(self.node.broadcasts), broadcasts + 1)
        self.assertEqual(self.approval().status, WhitelistStatus.REMOVED)
        self.assertIsNone(self.refresh())

    def test_another_live_general_company_decision_prevents_remove_and_never_renews(self):
        first, _ = self.accepted()
        self.approve()
        self.revoke(first)
        _, second = self.accepted()
        broadcasts = len(self.node.broadcasts)
        expiry = self.node.expiries[ADDRESS]
        self.assertIsNone(self.refresh())
        self.assertEqual(len(self.node.broadcasts), broadcasts)
        self.assertEqual(self.node.expiries[ADDRESS], expiry)
        with use_operator():
            self.assertFalse(WhitelistChange.objects.filter(authority="refresh").exists())
            self.assertTrue(eligibility_invalidation.has_live_general_decision(self.account.pk, self.company.pk))
            self.assertEqual(CompanyEligibilityDecision.objects.get(pk=second.pk).outcome, "accepted")

    def test_a_foreign_company_decision_does_not_protect_the_original_company_approval(self):
        original, _ = self.accepted()
        self.approve()
        self.revoke(original)
        foreign, initial = self.company_fixture("Foreign Whitelist Pty Ltd", "004085616")
        with self.company_context(foreign, initial):
            self.approver, _, self.appointment = self.appointee("foreign-removal", ["approve"])
            _, foreign_decision = self.accepted()
        change = self.refresh()
        self.assertEqual(change.company_id, self.company.pk)
        self.assertNotEqual(change.eligibility_decision_id, foreign_decision.pk)
        self.assertEqual(self.node.expiries[ADDRESS], 0)

    def test_holder_source_withdrawal_retains_the_holder_without_a_staff_reviewer(self):
        _, decision = self.accepted()
        self.approve()
        self.withdraw_source()
        with use_operator():
            type(self.participant).objects.filter(pk=self.participant.pk).update(is_active=False)
        change = self.refresh()
        self.assertEqual(change.invalidation_cause, WhitelistInvalidationCause.SOURCE_WITHDRAWAL)
        self.assertEqual(change.eligibility_decision_id, decision.pk)
        self.assertEqual(change.initiated_by_id, self.participant.pk)
        with use_operator():
            self.source.refresh_from_db()
        self.assertIsNone(self.source.reviewed_by_id)

    def test_request_withdrawal_retains_its_actual_holder_and_exact_decision(self):
        request, decision = self.accepted()
        self.approve()
        self.client.force_authenticate(self.participant)
        response = self.client.post(
            f"{REQUESTS}{request.pk}/withdraw/", {"idempotency_key": str(uuid4())}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        change = self.refresh()
        self.assertEqual(change.initiated_by_id, self.participant.pk)
        self.assertEqual(change.eligibility_decision_id, decision.pk)
        self.assertEqual(change.invalidation_cause, WhitelistInvalidationCause.REQUEST_WITHDRAWAL)

    def test_actual_expiry_is_automation_with_no_invented_human(self):
        self.requested_expiry = timezone.now() + timedelta(seconds=15)
        _, decision = self.accepted()
        self.approve()
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT pg_sleep(GREATEST(0, EXTRACT(EPOCH FROM %s::timestamptz - clock_timestamp())) + 0.02)",
                [decision.expires_at],
            )
            cursor.execute("SELECT clock_timestamp() >= %s", [decision.expires_at])
            self.assertIs(cursor.fetchone()[0], True)
        change = self.refresh()
        self.assertEqual(change.invalidation_cause, WhitelistInvalidationCause.EXPIRY)
        self.assertIsNone(change.initiated_by_id)
        self.assertEqual(change.invalidated_at, decision.expires_at)
        self.assertEqual(change.eligibility_decision_id, decision.pk)

    def test_storage_corruption_is_reported_without_borrowing_a_false_sql_hash_assertion(self):
        first, _ = self.accepted()
        self.approve()
        self.revoke(first)
        self.accepted()
        with open(self.source.evidence_file.path, "wb") as retained:
            retained.write(pdf_bytes(width=641))
        broadcasts = len(self.node.broadcasts)
        with self.assertRaisesMessage(WhitelistChangeConflict, "retained evidence needs reconciliation"):
            self.refresh()
        self.assertEqual(len(self.node.broadcasts), broadcasts)
        with use_operator():
            self.assertFalse(WhitelistChange.objects.filter(authority="refresh").exists())

    def test_new_refresh_entries_can_neither_add_nor_bypass_a_retained_cause(self):
        self.accepted()
        for action in ("add", "remove"):
            with self.subTest(action=action), use_operator(), self.assertRaises(PermissionDenied):
                changes.submit(
                    uuid4(),
                    action,
                    ADDRESS,
                    self.technical,
                    company=self.company,
                    authority=WhitelistAuthority.CLASSIFICATION_REFRESH,
                )
        with use_operator():
            self.assertFalse(WhitelistChange.objects.exists())

    def test_standing_loss_records_the_real_actor_before_commit_and_enqueues_after_commit(self):
        _, decision = self.accepted()
        self.approve()
        with patch("whitelist.tasks.refresh.refresh_whitelist_targets.defer") as defer:
            with self.operator_as(self.technical):
                event = refresh.enqueue_for_account(self.account.pk, self.technical, cause_fields=["account_status"])
                UserAccount.objects.filter(pk=self.account.pk).update(account_status="suspended")
                defer.assert_not_called()
                self.assertIsInstance(event.facts, dict)
                self.assertEqual(event.facts["standing"], "active")
                self.assertEqual(event.initiated_by_id, self.technical.pk)
            defer.assert_called_once()
            self.assertEqual(defer.call_args.kwargs["invalidation_id"], str(event.pk))
        with use_operator():
            type(self.technical).objects.filter(pk=self.technical.pk).update(is_active=False)
        with self.actual_operator():
            history = eligibility_invalidation.retained_cause(decision.pk, "standing_loss", event.pk)
        self.assertIsInstance(history, dict)
        self.assertEqual(history["actor"], str(self.technical.pk))
        self.assertEqual(history["account"], str(self.account.pk))
        self.assertIsInstance(history["targets"], list)
        self.assertEqual(history["targets"][0]["company"], str(self.company.pk))
        self.assertEqual(datetime.fromisoformat(history["at"]), event.invalidated_at)
        change = self.refresh(invalidation_id=event.pk, cause="standing_loss")
        self.assertEqual(change.initiated_by_id, self.technical.pk)
        self.assertEqual(change.eligibility_invalidation_id, event.pk)
        self.assertEqual(change.eligibility_decision_id, decision.pk)

    def test_provider_identity_loss_is_explicit_automation_and_preserves_the_configuration(self):
        self.accepted()
        self.approve()
        with patch("whitelist.tasks.refresh.refresh_whitelist_targets.defer"):
            with self.operator_as():
                event = refresh.enqueue_for_account(
                    self.account.pk, cause=WhitelistInvalidationCause.IDENTITY_LOSS, cause_fields=["is_id_verified"]
                )
                UserProfile.objects.filter(pk=self.account.user_profile_id).update(is_id_verified=False)
        change = self.refresh(invalidation_id=event.pk, cause="identity_loss")
        self.assertIsNone(event.initiated_by_id)
        self.assertIsNone(change.initiated_by_id)
        self.assertEqual(change.invalidation_cause, "identity_loss")
        self.assertTrue(event.facts["kyc_required"])

    def test_a_foreign_actor_cannot_record_changed_standing_as_their_own_instruction(self):
        self.accepted()
        self.approve()
        with self.operator_as(self.other):
            with self.assertRaises(DatabaseError) as caught, atomic():
                record_invalidation(self.account.pk, "standing_loss", actor=self.other, cause_fields=["account_status"])
            self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514")
        with use_operator():
            self.assertFalse(WhitelistEligibilityInvalidation.objects.exists())

    def test_live_standing_cannot_commit_an_invalidation_without_a_genuine_loss(self):
        self.accepted()
        self.approve()
        with self.assertRaises(DatabaseError) as caught:
            with self.operator_as(self.technical):
                record_invalidation(
                    self.account.pk, "standing_loss", actor=self.technical, cause_fields=["account_status"]
                )
        self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514")
        with use_operator():
            self.assertFalse(WhitelistEligibilityInvalidation.objects.exists())

    def test_wallet_deletion_retains_target_and_human_then_removes_despite_a_live_decision(self):
        _, decision = self.accepted()
        self.approve()
        with use_operator():
            targets = refresh.targets_for_wallet(self.wallet.pk)
        with patch("whitelist.tasks.refresh.refresh_whitelist_targets.defer") as defer:
            with self.operator_as(self.participant):
                event = refresh.enqueue_for_wallet(self.wallet.pk, self.participant, remove_only=True)
                self.wallet.delete()
                defer.assert_not_called()
            defer.assert_called_once()
        with self.actual_operator():
            self.assertFalse(WhitelistApproval.objects.exists())
            self.assertFalse(WhitelistEntry.objects.exists())
            self.assertEqual(event.facts["targets"][0]["company"], str(self.company.pk))
            result = refresh.refresh_targets(targets, cause="wallet_removal", invalidation_id=event.pk)
            change = WhitelistChange.objects.get(authority="refresh")
        self.assertEqual(result, {"checked": 1, "submitted": 1, "unattributed": 0, "errors": 0})
        self.assertEqual(change.eligibility_decision_id, decision.pk)
        self.assertEqual(change.initiated_by_id, self.participant.pk)
        self.assertIsNone(change.entry_id)
        self.assertEqual(self.node.expiries[ADDRESS], 0)

    def test_wallet_removal_record_cannot_commit_while_the_exact_verified_wallet_remains(self):
        self.accepted()
        self.approve()
        with self.assertRaises(DatabaseError) as caught:
            with self.operator_as(self.participant):
                record_invalidation(
                    self.account.pk, "wallet_removal", actor=self.participant, wallet_id=self.wallet.pk, address=ADDRESS
                )
        self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514")
        with use_operator():
            self.assertTrue(Wallet.objects.filter(pk=self.wallet.pk).exists())
            self.assertFalse(WhitelistEligibilityInvalidation.objects.exists())

    def test_invalidation_provenance_and_original_human_cannot_be_rewritten(self):
        _, _, _ = self.revoked_command()
        change = self.refresh()
        with self.operator_as():
            for field, value in (
                ("eligibility_decision_id", None),
                ("invalidation_cause", "expiry"),
                ("invalidated_at", timezone.now()),
                ("initiated_by_id", self.technical.pk),
            ):
                with self.subTest(field=field), self.assertRaises(DatabaseError), atomic():
                    WhitelistChange.objects.filter(pk=change.pk).update(**{field: value})
        with use_operator():
            change.refresh_from_db()
        self.assertEqual(change.initiated_by_id, self.approver.pk)
        self.assertEqual(change.invalidation_cause, "company_revocation")

    def test_retained_invalidation_event_cannot_be_changed_or_deleted(self):
        self.accepted()
        self.approve()
        with self.operator_as(self.technical):
            event = record_invalidation(
                self.account.pk, "standing_loss", actor=self.technical, cause_fields=["account_status"]
            )
            UserAccount.objects.filter(pk=self.account.pk).update(account_status="suspended")
        with self.operator_as():
            for mutation in (
                lambda: WhitelistEligibilityInvalidation.objects.filter(pk=event.pk).update(facts={}),
                lambda: WhitelistEligibilityInvalidation.objects.filter(pk=event.pk).delete(),
            ):
                with self.assertRaises(DatabaseError) as caught, atomic():
                    mutation()
                self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514")

    def test_bare_operator_and_incomplete_or_changed_commands_cannot_create_a_removal(self):
        _, _, command = self.revoked_command()
        with self.operator_as():
            with self.assertRaises(DatabaseError) as caught, atomic():
                self.raw_change(command)
            self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514")
            for forged in (
                {key: value for key, value in command.items() if key != "account"},
                {**command, "extra": "unbound"},
                {**command, "actor": str(self.technical.pk)},
                {**command, "decision": None},
                {**command, "account": str(self.other_account.pk)},
                {**command, "operation": "add"},
            ):
                with self.subTest(forged=forged), self.assertRaises(DatabaseError) as caught, atomic():
                    with invalidation_command(forged):
                        self.raw_change(command)
                self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514")
        with use_operator():
            self.assertFalse(WhitelistChange.objects.filter(authority="refresh").exists())

    def test_exact_guarded_operator_insert_commits_its_genuine_cause_without_new_mandate(self):
        _, decision, command = self.revoked_command()
        with self.operator_as(), invalidation_command(command):
            change = self.raw_change(command)
        with use_operator():
            change.refresh_from_db()
        self.assertEqual(change.status, WhitelistChangeStatus.PENDING)
        self.assertEqual(change.eligibility_decision_id, decision.pk)
        self.assertEqual(change.initiated_by_id, self.approver.pk)
        self.assertEqual(change.invalidation_cause, "company_revocation")

    def test_sql_refuses_remove_when_another_real_general_decision_is_current(self):
        _, _, command = self.revoked_command()
        self.accepted()
        with self.operator_as():
            with self.assertRaises(DatabaseError) as caught, atomic():
                with invalidation_command(command):
                    self.raw_change(command)
            self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514")
        self.assertNotEqual(self.node.expiries[ADDRESS], 0)

    def test_original_unresolved_outgoing_is_recovered_without_a_fresh_eligibility_suffix(self):
        self.revoked_command()
        self.node.confirmed = False
        with self.assertRaises(WhitelistRemovalPending):
            self.refresh()
        with use_operator():
            change = WhitelistChange.objects.get(authority="refresh")
        self.assertEqual(change.status, WhitelistChangeStatus.EXECUTING)
        self.accepted()
        self.node.confirmed = True
        with self.actual_operator():
            self.node.send(self.node.broadcasts[-1])
            with patch.object(eligibility_invalidation, "has_live_general_decision", side_effect=AssertionError):
                recovered = changes.recover(change.pk)
        self.assertEqual(recovered.status, WhitelistChangeStatus.CONFIRMED)
        self.assertEqual(recovered.operation_id, change.operation_id)
        self.assertEqual(recovered.initiated_by_id, self.approver.pk)
        self.assertEqual(self.node.expiries[ADDRESS], 0)

    def test_legacy_approval_without_an_actual_cause_is_observable_and_not_fabricated(self):
        self.approve()
        with self.actual_operator():
            result = refresh.sweep()
        self.assertEqual(result, {"checked": 1, "submitted": 0, "unattributed": 1, "errors": 0})
        self.assertNotEqual(self.node.expiries[ADDRESS], 0)
        with use_operator():
            self.assertFalse(WhitelistChange.objects.filter(authority="refresh").exists())

    def test_task_and_worker_restore_their_existing_operator_principal(self):
        _, _, _ = self.revoked_command()
        with self.actual_operator(), _requester_principal(self.technical.pk):
            previous = principal_of()
            change = refresh.refresh_approval(self.approval())
            self.assertEqual(principal_of(), previous)
        self.assertEqual(change.status, WhitelistChangeStatus.CONFIRMED)
        self.assertEqual(change.initiated_by_id, self.approver.pk)

    def test_admin_diagnostic_has_an_actual_approval_company_and_never_a_global_source_boolean(self):
        self.accepted()
        with use_operator():
            self.assertIsNone(entry_eligibility(self.wallet, None))
            self.assertTrue(entry_eligibility(self.wallet, self.company))
        foreign, _ = self.company_fixture("Foreign Admin Decision Pty Ltd", "004085616")
        with use_operator():
            self.assertFalse(entry_eligibility(self.wallet, foreign))

    def test_writer_context_uses_the_actual_human_and_restores_application_and_operator_state(self):
        self.accepted()
        self.approve()
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT current_setting('role'), current_setting('app.user_id', true)")
            before_operator = cursor.fetchone()
        with self.app_as(self.technical):
            connection = connections[current_alias()]
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_setting('role'), current_setting('app.user_id', true)")
                before_app = cursor.fetchone()
            with invalidation_writer_context(self.technical):
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute("SELECT current_user, current_setting('app.user_id', true)")
                    self.assertEqual(cursor.fetchone(), (settings.RLS_ROLES["operator"], str(self.technical.pk)))
                event = record_invalidation(
                    self.account.pk, "standing_loss", actor=self.technical, cause_fields=["account_status"]
                )
                UserAccount.objects.filter(pk=self.account.pk).update(account_status="suspended")
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_setting('role'), current_setting('app.user_id', true)")
                self.assertEqual(cursor.fetchone(), before_app)
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT current_setting('role'), current_setting('app.user_id', true)")
            self.assertEqual(cursor.fetchone(), before_operator)
        self.assertEqual(event.initiated_by_id, self.technical.pk)

    def test_writer_context_cannot_substitute_a_foreign_human_or_relabel_a_human_as_automation(self):
        with self.app_as(self.other):
            before = principal_of()
            for actor in (self.technical, None):
                with self.subTest(actor=actor), self.assertRaises(PermissionDenied):
                    with invalidation_writer_context(actor):
                        self.fail("The foreign writer context must be refused before its body.")
            self.assertEqual(principal_of(), before)

    def test_writer_context_refuses_a_configured_role_that_is_not_the_distinct_pure_operator(self):
        with self.app_as(self.technical):
            before = principal_of()
            for role in (settings.RLS_ROLES["migrate"], "ledova_missing_invalidation_operator"):
                with self.subTest(role=role), override_settings(RLS_ROLES={**settings.RLS_ROLES, "operator": role}):
                    with self.assertRaises(ImproperlyConfigured):
                        with invalidation_writer_context(self.technical):
                            self.fail("An invalid configured role must not enter its writer body.")
            self.assertEqual(principal_of(), before)

    def test_writer_context_can_record_an_actual_provider_loss_as_explicit_automation(self):
        self.accepted()
        self.approve()
        with use_operator(), _requester_principal(""):
            previous = principal_of()
            with invalidation_writer_context():
                event = record_invalidation(self.account.pk, "identity_loss", cause_fields=["is_id_verified"])
                UserProfile.objects.filter(pk=self.account.user_profile_id).update(is_id_verified=False)
            self.assertEqual(principal_of(), previous)
        self.assertIsNone(event.initiated_by_id)
        self.assertTrue(event.facts["identity_verified"])
        self.assertIn("identity_provider", event.facts)
        self.assertIn("identity_status", event.facts)

    def staff_with_permissions(self, *permissions, group=False):
        with use_operator():
            actor = type(self.technical).objects.create_user(
                email=f"invalidation-{uuid4()}@example.test",
                password="synthetic",
                is_active=True,
                is_staff=True,
                is_email_verified=True,
            )
            rows = [
                Permission.objects.get(content_type__app_label=app, codename=codename) for app, codename in permissions
            ]
            if group:
                membership = Group.objects.create(name=f"invalidation-{uuid4()}")
                membership.permissions.add(*rows)
                actor.groups.add(membership)
            else:
                actor.user_permissions.add(*rows)
            return actor

    def wallet_effect(self, actor, *, delete):
        with self.operator_as(actor):
            event = record_invalidation(
                self.account.pk, "wallet_removal", actor=actor, wallet_id=self.wallet.pk, address=ADDRESS
            )
            if delete:
                Wallet.objects.filter(pk=self.wallet.pk).delete()
            else:
                Wallet.objects.filter(pk=self.wallet.pk).update(verification_status=WALLET_VERIFICATION_STATUS_PENDING)
            return event

    def test_change_only_wallet_staff_cannot_delete_but_can_commit_actual_verification_loss(self):
        self.accepted()
        self.approve()
        actor = self.staff_with_permissions(("wallets", "change_wallet"))
        with self.assertRaises(DatabaseError) as caught:
            self.wallet_effect(actor, delete=True)
        self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514")
        with use_operator():
            self.assertTrue(Wallet.objects.filter(pk=self.wallet.pk).exists())
            self.assertFalse(WhitelistEligibilityInvalidation.objects.exists())
        event = self.wallet_effect(actor, delete=False)
        self.assertEqual(event.initiated_by_id, actor.pk)
        with use_operator():
            self.assertEqual(
                Wallet.objects.get(pk=self.wallet.pk).verification_status, WALLET_VERIFICATION_STATUS_PENDING
            )

    def test_delete_only_wallet_staff_can_delete_but_cannot_commit_verification_loss(self):
        self.accepted()
        self.approve()
        actor = self.staff_with_permissions(("wallets", "delete_wallet"))
        with self.assertRaises(DatabaseError) as caught:
            self.wallet_effect(actor, delete=False)
        self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514")
        with use_operator():
            self.assertEqual(Wallet.objects.get(pk=self.wallet.pk).verification_status, "VERIFIED")
            self.assertFalse(WhitelistEligibilityInvalidation.objects.exists())
        event = self.wallet_effect(actor, delete=True)
        self.assertEqual(event.initiated_by_id, actor.pk)
        with use_operator():
            self.assertFalse(Wallet.objects.filter(pk=self.wallet.pk).exists())

    def test_actual_group_delete_permission_and_holder_verification_loss_are_both_retained(self):
        actor = self.staff_with_permissions(("wallets", "delete_wallet"), group=True)
        event = self.wallet_effect(actor, delete=True)
        self.assertEqual(event.initiated_by_id, actor.pk)
        with use_operator():
            wallet = Wallet.objects.create(
                user_account=self.account, address=ADDRESS, chain="base", verification_status="VERIFIED"
            )
        self.wallet = wallet
        event = self.wallet_effect(self.participant, delete=False)
        self.assertEqual(event.initiated_by_id, self.participant.pk)

    def test_wallet_permission_removed_before_commit_refuses_the_effect_and_retained_event(self):
        actor = self.staff_with_permissions(("wallets", "delete_wallet"))
        with self.assertRaises(DatabaseError) as caught:
            with self.operator_as(actor):
                record_invalidation(
                    self.account.pk, "wallet_removal", actor=actor, wallet_id=self.wallet.pk, address=ADDRESS
                )
                Wallet.objects.filter(pk=self.wallet.pk).delete()
                actor.user_permissions.clear()
        self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514")
        with use_operator():
            self.assertTrue(Wallet.objects.filter(pk=self.wallet.pk).exists())
            self.assertFalse(WhitelistEligibilityInvalidation.objects.exists())

    def test_wallet_loss_cannot_transfer_the_retained_target_to_another_account_or_address(self):
        for replacement in (
            {"user_account_id": self.other_account.pk},
            {"address": "0x" + "b" * 40},
        ):
            with self.subTest(replacement=replacement), self.assertRaises(DatabaseError) as caught:
                with self.operator_as(self.participant):
                    record_invalidation(
                        self.account.pk,
                        "wallet_removal",
                        actor=self.participant,
                        wallet_id=self.wallet.pk,
                        address=ADDRESS,
                    )
                    Wallet.objects.filter(pk=self.wallet.pk).update(
                        verification_status=WALLET_VERIFICATION_STATUS_PENDING, **replacement
                    )
            self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514")
        with use_operator():
            wallet = Wallet.objects.get(pk=self.wallet.pk)
            self.assertEqual(wallet.user_account_id, self.account.pk)
            self.assertEqual(wallet.address, ADDRESS)
            self.assertEqual(wallet.verification_status, "VERIFIED")
            self.assertFalse(WhitelistEligibilityInvalidation.objects.exists())

    def test_already_unverified_retained_wallet_cannot_invent_a_new_verification_loss(self):
        with use_operator():
            Wallet.objects.filter(pk=self.wallet.pk).update(verification_status=WALLET_VERIFICATION_STATUS_PENDING)
        with self.assertRaises(DatabaseError) as caught:
            with self.operator_as(self.participant):
                record_invalidation(
                    self.account.pk,
                    "wallet_removal",
                    actor=self.participant,
                    wallet_id=self.wallet.pk,
                    address=ADDRESS,
                )
        self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514")
        event = self.wallet_effect(self.participant, delete=True)
        self.assertEqual(event.facts["wallet_verified"], WALLET_VERIFICATION_STATUS_PENDING)

    def test_actual_holder_can_retain_their_own_deactivation_after_becoming_inactive(self):
        self.accepted()
        self.approve()
        with self.operator_as(self.participant):
            event = record_invalidation(
                self.account.pk, "standing_loss", actor=self.participant, cause_fields=["is_active"]
            )
            type(self.participant).objects.filter(pk=self.participant.pk).update(is_active=False)
        self.assertTrue(event.facts["active"])
        self.assertEqual(event.cause_fields, ["is_active"])
        change = self.refresh(invalidation_id=event.pk, cause="standing_loss")
        self.assertEqual(change.initiated_by_id, self.participant.pk)

    def test_custom_user_loss_requires_its_actual_authentication_permission(self):
        account_writer = self.staff_with_permissions(("users", "change_useraccount"))
        with self.operator_as(account_writer):
            with self.assertRaises(DatabaseError) as caught, atomic():
                record_invalidation(self.account.pk, "standing_loss", actor=account_writer, cause_fields=["is_active"])
            self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514")
        user_writer = self.staff_with_permissions(("authentication", "change_customuser"))
        with self.operator_as(user_writer):
            event = record_invalidation(
                self.account.pk, "standing_loss", actor=user_writer, cause_fields=["is_email_verified"]
            )
            type(self.participant).objects.filter(pk=self.participant.pk).update(is_email_verified=False)
        self.assertEqual(event.initiated_by_id, user_writer.pk)
        self.assertEqual(event.cause_fields, ["is_email_verified"])

    def test_each_declared_loss_field_requires_its_own_effect_and_permission(self):
        account_writer = self.staff_with_permissions(("users", "change_useraccount"))
        with self.operator_as(account_writer):
            with self.assertRaises(DatabaseError) as caught, atomic():
                record_invalidation(
                    self.account.pk,
                    "standing_loss",
                    actor=account_writer,
                    cause_fields=["account_status", "is_active"],
                )
            self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514")
        with self.assertRaises(DatabaseError) as caught:
            with self.operator_as(self.technical):
                record_invalidation(self.account.pk, "standing_loss", actor=self.technical, cause_fields=["role"])
                UserAccount.objects.filter(pk=self.account.pk).update(account_status="suspended")
        self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514")
        with use_operator():
            self.assertEqual(UserAccount.objects.get(pk=self.account.pk).account_status, "active")
            self.assertFalse(WhitelistEligibilityInvalidation.objects.exists())
        writer = self.staff_with_permissions(("users", "change_useraccount"), ("authentication", "change_customuser"))
        with self.operator_as(writer):
            event = record_invalidation(
                self.account.pk, "standing_loss", actor=writer, cause_fields=["account_status", "is_active"]
            )
            UserAccount.objects.filter(pk=self.account.pk).update(account_status="suspended")
            type(self.participant).objects.filter(pk=self.participant.pk).update(is_active=False)
        self.assertEqual(event.cause_fields, ["account_status", "is_active"])

    def test_worker_context_uses_actual_pure_operator_in_autocommit_and_restores_state_after_failure(self):
        with use_operator(), _requester_principal(""):
            connection = connections[current_alias()]
            with connection.cursor() as cursor:
                cursor.execute(
                    "SELECT set_config(%s, 'retained-worker-state', false)", [eligibility_invalidation.SETTING]
                )
                cursor.execute(
                    "SELECT current_setting('role'), current_setting('app.user_id', true), "
                    "current_setting(%s, true)",
                    [eligibility_invalidation.SETTING],
                )
                previous = cursor.fetchone()
            try:
                with self.assertRaisesMessage(RuntimeError, "after rolled back work"):
                    with invalidation_worker_context():
                        worker_connection = connections[current_alias()]
                        self.assertTrue(worker_connection.get_autocommit())
                        self.assertFalse(worker_connection.in_atomic_block)
                        with worker_connection.cursor() as cursor:
                            cursor.execute(
                                "SELECT current_user, current_setting('app.user_id', true), current_setting(%s, true)",
                                [eligibility_invalidation.SETTING],
                            )
                            self.assertEqual(cursor.fetchone(), (settings.RLS_ROLES["operator"], "", ""))
                        with self.assertRaises(DatabaseError), atomic():
                            with worker_connection.cursor() as cursor:
                                cursor.execute("SELECT 1 / 0")
                        raise RuntimeError("after rolled back work")
                with connection.cursor() as cursor:
                    cursor.execute(
                        "SELECT current_setting('role'), current_setting('app.user_id', true), "
                        "current_setting(%s, true)",
                        [eligibility_invalidation.SETTING],
                    )
                    self.assertEqual(cursor.fetchone(), previous)
            finally:
                with connection.cursor() as cursor:
                    cursor.execute("SELECT set_config(%s, '', false)", [eligibility_invalidation.SETTING])

    def test_worker_context_refuses_human_relabelling_and_outer_atomic_work(self):
        with self.app_as(self.participant), self.assertRaises(PermissionDenied):
            with invalidation_worker_context():
                self.fail("A human principal must not become an automatic worker.")
        with use_operator(), _requester_principal(""), atomic(), self.assertRaises(WhitelistChangeConflict):
            with invalidation_worker_context():
                self.fail("A worker must not enclose durable changes in another transaction.")
        with use_operator(), _requester_principal(""):
            for role in (settings.RLS_ROLES["migrate"], "ledova_missing_invalidation_operator"):
                with self.subTest(role=role), override_settings(RLS_ROLES={**settings.RLS_ROLES, "operator": role}):
                    with self.assertRaises(ImproperlyConfigured):
                        with invalidation_worker_context():
                            self.fail("An invalid role must not enter the worker body.")

    def test_actual_target_task_admits_remove_in_autocommit_without_trusting_queued_actor(self):
        _, _, command = self.revoked_command()
        with use_operator(), _requester_principal(""):
            targets = refresh.targets_for_wallet(self.wallet.pk)
            original_boundary = changes._boundary

            def checked_boundary():
                connection = connections[current_alias()]
                self.assertTrue(connection.get_autocommit())
                self.assertFalse(connection.in_atomic_block)
                with connection.cursor() as cursor:
                    cursor.execute("SELECT current_user")
                    self.assertEqual(cursor.fetchone()[0], settings.RLS_ROLES["operator"])
                return original_boundary()

            with patch.object(changes, "_boundary", side_effect=checked_boundary) as boundary:
                result = refresh_whitelist_targets.func(
                    targets, actor_id=str(self.other.pk), cause="company_revocation", decision_id=command["decision"]
                )
                self.assertGreater(boundary.call_count, 0)
            change = WhitelistChange.objects.get(authority="refresh")
        self.assertEqual(result, {"checked": 1, "submitted": 1, "unattributed": 0, "errors": 0})
        self.assertEqual(change.initiated_by_id, self.approver.pk)
        self.assertEqual(self.node.expiries[ADDRESS], 0)

    def test_actual_scheduled_sweep_keeps_noop_work_autocommit_on_the_pure_operator(self):
        self.accepted()
        self.approve()
        broadcasts = len(self.node.broadcasts)
        original = refresh._refresh_target

        def checked_target(*arguments, **keywords):
            connection = connections[current_alias()]
            self.assertTrue(connection.get_autocommit())
            self.assertFalse(connection.in_atomic_block)
            with connection.cursor() as cursor:
                cursor.execute("SELECT current_user")
                self.assertEqual(cursor.fetchone()[0], settings.RLS_ROLES["operator"])
            return original(*arguments, **keywords)

        with use_operator(), _requester_principal(""):
            with patch.object(refresh, "_refresh_target", side_effect=checked_target) as check:
                result = refresh_whitelist_approvals.func()
                check.assert_called_once()
            self.assertFalse(WhitelistChange.objects.filter(authority="refresh").exists())
        self.assertEqual(result, {"checked": 1, "submitted": 0, "unattributed": 0, "errors": 0})
        self.assertEqual(len(self.node.broadcasts), broadcasts)

    def test_installed_retained_foreign_keys_are_deferred_and_wallet_snapshot_has_no_foreign_key(self):
        expected = {
            ("whitelist_whitelisteligibilityinvalidation", "user_account_id"): "customer_accounts_account",
            ("whitelist_whitelisteligibilityinvalidation", "initiated_by_id"): "authentication_customuser",
            ("whitelist_whitelistchange", "initiated_by_id"): "authentication_customuser",
            ("whitelist_whitelistchange", "eligibility_decision_id"): "users_companyeligibilitydecision",
            ("whitelist_whitelistchange", "eligibility_invalidation_id"): "whitelist_whitelisteligibilityinvalidation",
            ("whitelist_whitelistapproval", "company_id"): "companies_company",
        }
        with use_operator(), connections[current_alias()].cursor() as cursor:
            cursor.execute(
                "SELECT parent.relname, field.attname, target.relname, relation.condeferrable, "
                "relation.condeferred, relation.confdeltype, relation.confupdtype "
                "FROM pg_catalog.pg_constraint relation "
                "JOIN pg_catalog.pg_class parent ON parent.oid = relation.conrelid "
                "JOIN pg_catalog.pg_class target ON target.oid = relation.confrelid "
                "JOIN pg_catalog.pg_attribute field "
                "ON field.attrelid = parent.oid AND field.attnum = ANY(relation.conkey) "
                "WHERE relation.contype = 'f' AND parent.relname = ANY(%s)",
                [list({table for table, _ in expected})],
            )
            installed = {
                (table, field): (target, deferred, initially, deletion, update)
                for table, field, target, deferred, initially, deletion, update in cursor.fetchall()
            }
        for scope, target in expected.items():
            with self.subTest(scope=scope):
                self.assertEqual(installed.get(scope), (target, True, True, "a", "a"))
        self.assertNotIn(("whitelist_whitelisteligibilityinvalidation", "wallet_id"), installed)

    def test_raw_sql_cannot_borrow_account_permission_for_a_login_loss_or_forge_noop_history(self):
        account_writer = self.staff_with_permissions(("users", "change_useraccount"))
        statement = (
            "INSERT INTO whitelist_whitelisteligibilityinvalidation "
            "(uuid, created_at, updated_at, user_account_id, cause, chain_id, wallet_id, address, "
            "facts, cause_fields, invalidated_at, initiated_by_id) "
            "VALUES (%s, clock_timestamp(), clock_timestamp(), %s, 'standing_loss', %s, NULL, '', "
            "whitelist_eligibility_invalidation_facts(%s, NULL, %s), %s::jsonb, clock_timestamp(), %s)"
        )
        with self.operator_as(account_writer):
            with self.assertRaises(DatabaseError) as caught, atomic():
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute(
                        statement,
                        [
                            uuid4(),
                            self.account.pk,
                            CHAIN_ID,
                            self.account.pk,
                            CHAIN_ID,
                            '["is_active"]',
                            account_writer.pk,
                        ],
                    )
            self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514")
        with self.assertRaises(DatabaseError) as caught:
            with self.operator_as(account_writer):
                with connections[current_alias()].cursor() as cursor:
                    cursor.execute(
                        statement,
                        [
                            uuid4(),
                            self.account.pk,
                            CHAIN_ID,
                            self.account.pk,
                            CHAIN_ID,
                            '["account_status"]',
                            account_writer.pk,
                        ],
                    )
        self.assertEqual(getattr(caught.exception.__cause__, "sqlstate", None), "23514")
        with use_operator():
            self.assertFalse(WhitelistEligibilityInvalidation.objects.exists())
