from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.db import DatabaseError, connection, connections
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.test import APITransactionTestCase
from web3 import Web3

from blockchain.tests.outgoing_fixtures import CHAIN_ID, KEY
from companies.models import CompanyDocument
from companies.tests.test_document_file_access import (
    ADMIN_STORAGES,
    attach_file,
    make_document,
)
from offerings.models import Subscription, SubscriptionStatus
from offerings.tests.factories import (
    eligible_subscriber,
    open_offering,
    paid_subscription,
    retained_paid_execution,
)
from shared.db import atomic, current_alias, use_operator
from shared.db.principal import PRINCIPAL_SETTING
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_tenant
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterEntry,
    RegisterInstruction,
    RequestStatus,
    ShareIssuanceRequest,
    ShareToken,
)
from tokens.services.register_instructions import (
    SETTLED,
    decide_instruction,
    prepare_instruction_review,
    submit_instruction,
)
from tokens.tests.instruction_fixtures import (
    DIRECTOR,
    instruction_item,
    instruction_payload,
    instruction_reviewer,
    retained_approved_request,
    retained_instruction,
    retained_paid_instruction,
    verified_authority,
)
from tokens.tests.test_register_workflow_events import (
    SETTLEMENT,
    SettledTransferFixtures,
)


def instruction_fixture(label="instruction"):
    tenant = make_tenant(label)
    open_offering(tenant)
    reviewer = instruction_reviewer()
    document = verified_authority(tenant.company, reviewer)
    eligible_subscriber(tenant)
    subscription = paid_subscription(tenant, quantity=10)
    return tenant, reviewer, document, subscription


def forged(proposal, model=RegisterInstruction, **changes):
    forged_id = uuid4()
    return model.objects.create(
        **{
            "uuid": forged_id,
            "company_id": proposal.company_id,
            "token_id": proposal.token_id,
            "kind": proposal.kind,
            "items": proposal.items,
            "approving_director": proposal.approving_director,
            "authority_reference": proposal.authority_reference,
            "reason": proposal.reason,
            "source_document": proposal.source_document,
            "evidence_fingerprint": proposal.evidence_fingerprint,
            "evidence_snapshot": proposal.evidence_snapshot,
            "file": f"companies/{proposal.company_id}/register-instructions/{forged_id}/{uuid4()}.bin",
            "submitted_by_id": proposal.submitted_by_id,
            **changes,
        }
    )


def issuance_request(tenant, **fields):
    return ShareIssuanceRequest.objects.create(
        **{
            "token": tenant.deployed_token,
            "recipient_address": tenant.wallet.address,
            "recipient_name": "Rita Recipient",
            "amount": 10,
            "reason": "Allotment",
            "submitted_by": tenant.user,
            **fields,
        }
    )


class RegisterInstructionTest(TransactionTestCase):
    def setUp(self):
        self.tenant, self.reviewer, self.document, self.subscription = instruction_fixture()
        self.token = self.tenant.deployed_token
        self.cover = retained_approved_request(self.token, self.tenant.wallet.address, reviewer=self.reviewer)
        self.payload = instruction_payload(self.token, self.document, [self.cover])

    def submit(self, **changes):
        return submit_instruction(actor=self.tenant.user, **{**self.payload, **changes})

    def review(self, proposal, reviewer=None):
        return prepare_instruction_review(proposal_id=proposal.pk, reviewer=reviewer or self.reviewer)[2]

    def decide(self, proposal, decision="apply", confirmation=None, rejection_reason=""):
        return decide_instruction(
            proposal_id=proposal.pk,
            reviewer=self.reviewer,
            confirmation=self.review(proposal) if confirmation is None and decision == "apply" else confirmation or "",
            decision=decision,
            rejection_reason=rejection_reason,
        )

    def test_submission_binds_the_exact_items_verified_evidence_and_a_retained_copy(self):
        eligible_subscriber(self.tenant)
        request = retained_approved_request(self.token, self.tenant.wallet.address, reviewer=self.reviewer, amount=12)
        proposal = self.submit(
            items=[
                {**instruction_item(request), "recipient": request.recipient_address.lower()},
                {**instruction_item(self.cover), "recipient": self.subscription.wallet.address.lower()},
            ]
        )
        self.assertEqual((proposal.status, proposal.kind, proposal.token_id), ("submitted", "issue", self.token.pk))
        self.assertEqual(
            proposal.items,
            sorted(
                [
                    {
                        "request": str(self.cover.pk),
                        "recipient": self.tenant.wallet.address,
                        "amount": "10",
                    },
                    {"request": str(request.pk), "recipient": self.tenant.wallet.address, "amount": "12"},
                ],
                key=lambda item: item["request"],
            ),
        )
        document = CompanyDocument.objects.get(pk=self.document.pk)
        self.assertEqual(proposal.evidence_fingerprint, document.verified_fingerprint)
        self.assertEqual(proposal.evidence_snapshot["document"], str(document.pk))
        self.assertNotEqual(proposal.file.name, document.file.name)
        with proposal.file.open("rb") as retained, document.file.open("rb") as source:
            self.assertEqual(retained.read(), source.read())
        replay = {"operation_id": proposal.pk, "items": list(reversed(proposal.items))}
        self.assertEqual(self.submit(**replay).pk, proposal.pk)
        with self.assertRaises(RegisterChangeConflict):
            self.submit(**replay, reason="Another reason")
        with self.assertRaises(RegisterChangeConflict):
            self.submit(operation_id=proposal.pk)
        self.assertEqual(RegisterInstruction.objects.count(), 1)
        self.assertEqual(Subscription.objects.get(pk=self.subscription.pk).status, SubscriptionStatus.PAID)

    def test_submission_refuses_strangers_unverified_evidence_and_unusable_items(self):
        stranger = make_tenant("instruction-stranger")
        with self.assertRaises(NotFound):
            submit_instruction(actor=stranger.user, **self.payload)
        unverified = attach_file(make_document(self.tenant.company))
        with self.assertRaises(ValidationError):
            self.submit(operation_id=uuid4(), document_id=unverified.pk)
        for changes in ({"approving_director": " "}, {"kind": "transfer"}, {"reason": ""}):
            with self.subTest(changes=changes), self.assertRaises(ValidationError):
                self.submit(operation_id=uuid4(), **changes)
        item = instruction_item(self.cover)
        open_offering(stranger)
        eligible_subscriber(stranger)
        foreign = retained_approved_request(stranger.deployed_token, stranger.wallet.address, reviewer=self.reviewer)
        for items in (
            [],
            [item, {**item, "recipient": item["recipient"].lower()}],
            [{**item, "recipient": "not-an-address"}],
            [{**item, "amount": "0"}],
            [{**item, "amount": 10}],
            [{"request": item["request"], "amount": "10"}],
            [{**item, "request": str(uuid4())}],
            [instruction_item(foreign)],
            [{**item, "amount": "11"}],
            [{**item, "recipient": Web3.to_checksum_address("0x" + "4d" * 20)}],
        ):
            with self.subTest(items=items), self.assertRaises(ValidationError):
                self.submit(operation_id=uuid4(), items=items)
        self.assertFalse(RegisterInstruction.objects.exists())

    def test_nonpaid_cover_refuses_new_grants_and_invalid_states_but_retains_original_approvals(self):
        pending = issuance_request(self.tenant)
        rejected = issuance_request(self.tenant)
        rejected.reject(self.reviewer, "Not approved")
        draft = issuance_request(self.tenant, status=RequestStatus.DRAFT)
        for row, refusal in (
            (pending, "New non-paid grants"),
            (rejected, "neither awaiting approval"),
            (draft, "neither awaiting approval"),
        ):
            with self.subTest(row=row), self.assertRaisesMessage(ValidationError, refusal):
                self.submit(operation_id=uuid4(), items=[instruction_item(row)])
        earlier = retained_approved_request(self.token, self.tenant.wallet.address, reviewer=self.reviewer)
        proposal = self.submit(operation_id=uuid4(), items=[instruction_item(earlier), instruction_item(self.cover)])
        self.assertEqual(len(proposal.items), 2)

    def test_the_approving_director_cannot_be_a_recipient_the_item_identifies(self):
        with self.assertRaisesMessage(ValidationError, "is the recipient"):
            self.submit(operation_id=uuid4(), approving_director=self.tenant.profile.full_name.upper())
        named = retained_approved_request(
            self.token, self.tenant.wallet.address, reviewer=self.reviewer, recipient_name=f" {DIRECTOR.lower()} "
        )
        with self.assertRaisesMessage(ValidationError, "is the recipient"):
            self.submit(operation_id=uuid4(), items=[instruction_item(named)])
        unnamed = retained_approved_request(
            self.token, Web3.to_checksum_address("0x" + "5e" * 20), reviewer=self.reviewer, recipient_name=""
        )
        self.assertEqual(
            self.submit(operation_id=uuid4(), items=[instruction_item(unnamed)]).approving_director, DIRECTOR
        )

    def test_nonpaid_cover_retains_each_original_approval_with_the_covering_reviewer_exactly_once(self):
        other = retained_approved_request(self.token, self.tenant.wallet.address, reviewer=self.reviewer, amount=17)
        proposal = self.submit(items=[instruction_item(self.cover), instruction_item(other)])
        original = list(
            ShareIssuanceRequest.objects.filter(token=self.token).values_list(
                "pk", "status", "reviewed_by_id", "reviewed_at", "review_notes"
            )
        )
        confirmation = self.review(proposal)
        applied = self.decide(proposal, confirmation=confirmation)
        self.assertEqual((applied.status, applied.reviewed_by_id), ("applied", self.reviewer.pk))
        self.assertEqual(
            list(
                ShareIssuanceRequest.objects.filter(token=self.token).values_list(
                    "pk", "status", "reviewed_by_id", "reviewed_at", "review_notes"
                )
            ),
            original,
        )
        self.subscription.refresh_from_db()
        self.assertEqual(
            (self.subscription.status, self.subscription.issuance_request_id), (SubscriptionStatus.PAID, None)
        )
        with patch("django.core.signing.time.time", return_value=timezone.now().timestamp() + 901):
            self.assertEqual(self.decide(proposal, confirmation=confirmation).status, "applied")
        with self.assertRaises(RegisterChangeConflict):
            self.decide(proposal, "reject", rejection_reason="Too late")
        with self.assertRaisesMessage(ValidationError, "already has a decision"):
            self.review(proposal)
        self.assertEqual(ShareIssuanceRequest.objects.filter(token=self.token).count(), 2)

    def test_nonpaid_cover_preserves_immutable_terms_and_refuses_changed_recipient_identity_but_allows_rejection(self):
        from users.models import UserProfile

        proposal = self.submit()
        confirmation = self.review(proposal)
        with self.assertRaises(DatabaseError), atomic():
            ShareIssuanceRequest.objects.filter(pk=self.cover.pk).update(amount=9)
        UserProfile.objects.filter(pk=self.tenant.profile.pk).update(full_name=DIRECTOR)
        with self.assertRaisesMessage(ValidationError, "is the recipient"):
            self.review(proposal)
        with self.assertRaisesMessage(ValidationError, "is the recipient"):
            self.decide(proposal, confirmation=confirmation)
        self.assertEqual(RegisterInstruction.objects.get(pk=proposal.pk).status, "submitted")
        for _ in range(2):
            rejected = self.decide(proposal, "reject", rejection_reason="The request was rejected")
            self.assertEqual((rejected.status, rejected.rejection_reason), ("rejected", "The request was rejected"))

    def test_deleted_authority_evidence_refuses_application_and_keeps_the_retained_copy(self):
        proposal = self.submit()
        confirmation = self.review(proposal)
        CompanyDocument.objects.get(pk=self.document.pk).delete()
        with self.assertRaisesMessage(ValidationError, "Submit a fresh register instruction"):
            self.review(proposal)
        with self.assertRaisesMessage(ValidationError, "Submit a fresh register instruction"):
            self.decide(proposal, confirmation=confirmation)
        self.assertTrue(proposal.file.storage.exists(proposal.file.name))
        self.assertEqual(Subscription.objects.get(pk=self.subscription.pk).status, SubscriptionStatus.PAID)

    def test_decisions_need_a_permitted_reviewer_a_reason_and_this_reviewers_confirmation(self):
        proposal = self.submit()
        with self.assertRaisesMessage(ValidationError, "Open a fresh review"):
            self.decide(proposal, confirmation="forged")
        with self.assertRaises(ValidationError):
            self.decide(proposal, "reject")
        confirmation = self.review(proposal)
        other = instruction_reviewer()
        with self.assertRaisesMessage(ValidationError, "another proposal, reviewer or evidence"):
            decide_instruction(proposal_id=proposal.pk, reviewer=other, confirmation=confirmation, decision="apply")
        link_reviewer = get_user_model().objects.create_user(
            email=f"link-only-{uuid4()}@example.test", is_active=True, is_staff=True
        )
        link_reviewer.user_permissions.add(Permission.objects.get(codename="change_registerwalletlink"))
        with self.assertRaises(PermissionDenied):
            self.review(proposal, reviewer=link_reviewer)
        with patch("django.core.signing.time.time", return_value=timezone.now().timestamp() + 901):
            with self.assertRaisesMessage(ValidationError, "invalid or expired"):
                self.decide(proposal, confirmation=confirmation)
        self.reviewer.is_active = False
        self.reviewer.save(update_fields=["is_active"])
        with self.assertRaises(PermissionDenied):
            self.decide(proposal, confirmation=confirmation)
        self.assertEqual(RegisterInstruction.objects.get(pk=proposal.pk).status, "submitted")
        self.assertEqual(Subscription.objects.get(pk=self.subscription.pk).status, SubscriptionStatus.PAID)

    def test_a_failed_decision_write_rolls_back_every_approval(self):
        proposal = self.submit()
        confirmation = self.review(proposal)
        with patch.object(RegisterInstruction, "save", side_effect=RuntimeError("write failed")):
            with self.assertRaises(RuntimeError):
                self.decide(proposal, confirmation=confirmation)
        self.assertEqual(RegisterInstruction.objects.get(pk=proposal.pk).status, "submitted")
        request = Subscription.objects.get(pk=self.subscription.pk)
        self.assertEqual((request.status, request.issuance_request_id), (SubscriptionStatus.PAID, None))

    def test_database_refuses_rewrites_deletion_forged_decisions_and_foreign_items(self):
        pending = issuance_request(self.tenant)
        proposal = retained_instruction(
            actor=self.tenant.user, **{**self.payload, "items": [instruction_item(pending)]}
        )
        decided = {"reviewed_at": timezone.now(), "reviewed_by": self.reviewer}
        for changes in (
            {"reason": "Rewritten"},
            {"items": [{**proposal.items[0], "amount": "11"}]},
            {"status": "applied", **decided},
            {"status": "rejected", "rejection_reason": " ", **decided},
            {"status": "applied"},
        ):
            with self.subTest(changes=changes), self.assertRaises(DatabaseError), atomic():
                RegisterInstruction.objects.filter(pk=proposal.pk).update(**changes)
        with self.assertRaises(DatabaseError), atomic():
            proposal.delete()
        stranger = make_tenant("instruction-forger")
        eligible_subscriber(stranger)
        open_offering(stranger)
        subscription = paid_subscription(stranger, quantity=10)
        item = proposal.items[0]
        for items in (
            [],
            [instruction_item(paid_subscription(stranger))],
            [instruction_item(subscription)],
            [{**item, "amount": "010"}],
            [{**item, "recipient": None}],
            [{**item, "subscription": str(uuid4())}],
            [item, item],
        ):
            with self.subTest(items=items), self.assertRaises(DatabaseError), atomic():
                forged(proposal, items=items)
        with self.assertRaises(DatabaseError), atomic():
            forged(proposal, approving_director=" ")
        with self.assertRaisesMessage(DatabaseError, "retained company decision"), atomic():
            forged(proposal)
        earlier = retained_approved_request(self.token, self.tenant.wallet.address, reviewer=self.reviewer)
        with self.assertRaises(RuntimeError), atomic():
            forged(proposal, items=[instruction_item(earlier)])
            raise RuntimeError("rollback")
        self.decide(proposal, "reject", rejection_reason="Retired pending grant")
        with self.assertRaises(DatabaseError), atomic():
            RegisterInstruction.objects.filter(pk=proposal.pk).update(reviewed_at=timezone.now())
        self.assertEqual(RegisterInstruction.objects.count(), 1)

    def test_the_database_refuses_an_application_that_leaves_a_retained_request_unapproved(self):
        pending = issuance_request(self.tenant)
        proposal = retained_instruction(
            actor=self.tenant.user, **{**self.payload, "items": [instruction_item(pending)]}
        )
        with self.assertRaisesMessage(DatabaseError, "approve every listed issuance request"), atomic():
            RegisterInstruction.objects.filter(pk=proposal.pk).update(
                status="applied", reviewed_at=timezone.now(), reviewed_by=self.reviewer
            )
        with self.assertRaisesMessage(DatabaseError, "approve every listed issuance request"), atomic():
            ShareIssuanceRequest.objects.filter(pk=pending.pk).delete()
            RegisterInstruction.objects.filter(pk=proposal.pk).update(
                status="applied", reviewed_at=timezone.now(), reviewed_by=self.reviewer
            )
        with self.assertRaisesMessage(
            DatabaseError, "Fresh paid and nonpaid approval requires its retained company decision"
        ), atomic():
            pending.approve(self.reviewer)
        approved = retained_approved_request(self.token, self.tenant.wallet.address, reviewer=self.reviewer)
        historical = self.submit(operation_id=uuid4(), items=[instruction_item(approved)])
        with self.assertRaises(RuntimeError), atomic():
            self.decide(historical)
            raise RuntimeError("rollback")
        self.assertEqual(RegisterInstruction.objects.get(pk=proposal.pk).status, "submitted")
        self.assertEqual(RegisterInstruction.objects.get(pk=historical.pk).status, "submitted")
        self.assertEqual(ShareIssuanceRequest.objects.get(pk=pending.pk).status, RequestStatus.SUBMITTED)
        self.assertEqual(ShareIssuanceRequest.objects.get(pk=approved.pk).status, RequestStatus.APPROVED)

    @override_settings(STORAGES={**settings.STORAGES, **ADMIN_STORAGES})
    def test_admin_reviews_the_file_the_director_and_each_items_exact_terms_before_applying(self):
        proposal = self.submit()
        self.client.force_login(self.reviewer)
        url = reverse("admin:tokens_registerinstruction_review", args=[proposal.pk])
        response = self.client.get(url)
        for shown in (
            DIRECTOR,
            str(self.cover.pk),
            self.tenant.wallet.address,
            self.tenant.profile.full_name,
            self.token.symbol,
        ):
            self.assertContains(response, shown)
        self.assertContains(response, reverse("admin:tokens_registerinstruction_evidence", args=[proposal.pk]))
        self.assertContains(response, "<td>10</td>", html=True)
        token = response.context["form"].initial["confirmation"]
        self.assertEqual(self.client.put(url).status_code, 405)
        response = self.client.post(url, {"confirmation": token, "decision": "apply"})
        self.assertContains(response, "explicit authority confirmation")
        response = self.client.post(url, {"confirmation": token, "decision": "apply", "reviewed": True})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(RegisterInstruction.objects.get(pk=proposal.pk).status, "applied")
        self.assertIsNone(Subscription.objects.get(pk=self.subscription.pk).issuance_request_id)
        self.assertEqual(
            self.client.post(
                reverse("admin:tokens_registerinstruction_change", args=[proposal.pk]), {"reason": "rewrite"}
            ).status_code,
            405,
        )
        named = retained_approved_request(self.token, self.tenant.wallet.address, reviewer=self.reviewer)
        pending = self.submit(operation_id=uuid4(), items=[instruction_item(named)])
        from users.models import UserProfile

        UserProfile.objects.filter(pk=self.tenant.profile.pk).update(full_name=DIRECTOR)
        response = self.client.get(reverse("admin:tokens_registerinstruction_review", args=[pending.pk]))
        self.assertContains(response, "is the recipient")
        self.assertContains(response, str(named.pk))
        model_admin = admin.site._registry[RegisterInstruction]
        self.assertFalse(model_admin.has_delete_permission(None, proposal))
        self.assertFalse(model_admin.has_add_permission(None))
        self.assertTrue(
            set(field.name for field in RegisterInstruction._meta.fields) - {"file"} <= set(model_admin.readonly_fields)
        )

    @override_settings(BLOCKCHAIN_OPERATOR_KEY=KEY, BLOCKCHAIN_CHAIN_ID=CHAIN_ID)
    def test_paid_legacy_history_keeps_evidence_and_financial_state_but_cannot_create_or_apply_fresh_authority(self):
        pending = retained_paid_instruction(
            actor=self.tenant.user, **instruction_payload(self.token, self.document, [self.subscription])
        )
        with pending.file.open("rb") as retained, self.document.file.open("rb") as source:
            self.assertEqual(retained.read(), source.read())
        self.assertEqual((pending.preparing_appointment_id, pending.paid_subscription_id), (None, None))
        financial_fields = (
            "status",
            "quantity",
            "allotted_quantity",
            "price_per_share",
            "currency",
            "amount_due",
            "settlement_rail",
            "settlement_asset_id",
            "settlement_amount",
            "reference",
            "amount_received",
            "payment_received_on",
            "payment_reference_seen",
            "payment_tx_hash",
            "payment_confirmed_by_id",
            "payment_confirmed_at",
            "payment_notes",
            "refund_amount",
            "refunded_at",
            "refund_reference",
            "allotted_at",
        )
        before = Subscription.objects.filter(pk=self.subscription.pk).values(*financial_fields).get()
        with self.assertRaises(PermissionDenied):
            submit_instruction(
                actor=self.tenant.user, **instruction_payload(self.token, self.document, [self.subscription])
            )
        with self.assertRaises(PermissionDenied):
            self.decide(pending, confirmation="retired")
        with self.assertRaises(DatabaseError), atomic():
            forged(pending)
        rejected = self.decide(pending, "reject", rejection_reason="Retired pending paid proposal")
        self.assertEqual(rejected.status, "rejected")
        request, execution = retained_paid_execution(self.subscription, self.reviewer)
        self.assertIsNotNone(execution)
        for row in (self.subscription, request):
            with self.subTest(source=type(row).__name__), self.assertRaises(PermissionDenied):
                self.submit(operation_id=uuid4(), items=[instruction_item(row)])
        applied = RegisterInstruction.objects.get(
            items__contains=[{"subscription": str(self.subscription.pk)}], status="applied"
        )
        self.assertEqual(
            (applied.preparing_appointment_id, applied.paid_subscription_id, applied.submitted_by_id),
            (None, None, self.tenant.user.pk),
        )
        self.assertIsNotNone(applied.reviewed_by_id)
        self.assertEqual(
            (request.reviewed_by_id, execution.executed_by_id, execution.source_instruction_id),
            (self.reviewer.pk, self.reviewer.pk, None),
        )
        original_document = CompanyDocument.objects.get(pk=applied.source_document)
        with applied.file.open("rb") as retained, original_document.file.open("rb") as source:
            self.assertEqual(retained.read(), source.read())
        with self.assertRaises(RegisterChangeConflict):
            self.decide(applied, confirmation="another reviewer's receipt")
        receipt = decide_instruction(
            proposal_id=applied.pk,
            reviewer=applied.reviewed_by,
            confirmation="original applied receipt",
            decision="apply",
        )
        self.assertEqual(receipt.pk, applied.pk)
        self.subscription.refresh_from_db()
        self.assertEqual(Subscription.objects.filter(pk=self.subscription.pk).values(*financial_fields).get(), before)
        self.assertEqual(self.subscription.issuance_request_id, request.pk)
        self.assertEqual(RegisterEntry.objects.count(), 0)


class IssuanceReviewGuardTest(TransactionTestCase):
    def setUp(self):
        self.tenant = make_tenant("review-guard")
        self.staff = make_tenant("review-guard-staff", staff=True).user
        self.request = issuance_request(self.tenant)

    def as_the_app_role(self):
        self.addCleanup(self.restore_role)
        with connection.cursor() as cursor:
            cursor.execute(f'SET ROLE "{settings.RLS_ROLES["app"]}"')
            cursor.execute("SELECT set_config(%s, %s, false)", [PRINCIPAL_SETTING, str(self.tenant.user.pk)])

    def restore_role(self):
        with connection.cursor() as cursor:
            cursor.execute("RESET ROLE")
            cursor.execute("SELECT set_config(%s, NULL, false)", [PRINCIPAL_SETTING])

    def test_the_app_role_cannot_decide_or_rewrite_the_review_of_its_own_request(self):
        approved = retained_approved_request(
            self.tenant.deployed_token, self.tenant.wallet.address, reviewer=self.staff, notes="Earlier approval"
        )
        self.as_the_app_role()
        now = timezone.now()
        for target, changes in (
            (self.request, {"status": RequestStatus.APPROVED, "reviewed_by_id": self.staff.pk, "reviewed_at": now}),
            (self.request, {"status": RequestStatus.REJECTED, "rejection_reason": "Forged"}),
            (self.request, {"status": RequestStatus.UNDER_REVIEW}),
            (self.request, {"reviewed_by_id": self.staff.pk}),
            (self.request, {"reviewed_at": now}),
            (self.request, {"review_notes": "Forged notes"}),
            (self.request, {"rejection_reason": "Forged reason"}),
            (approved, {"reviewed_by_id": self.tenant.user.pk}),
            (approved, {"review_notes": ""}),
        ):
            refusal = (
                "Fresh paid and nonpaid approval requires its retained company decision"
                if changes.get("status") == RequestStatus.APPROVED
                else "Only operator review may decide an issuance request"
            )
            with self.subTest(changes=changes), self.assertRaisesMessage(DatabaseError, refusal), atomic():
                ShareIssuanceRequest.objects.filter(pk=target.pk).update(**changes)
        for fields in (
            {"status": RequestStatus.APPROVED, "reviewed_by_id": self.staff.pk, "reviewed_at": now},
            {"review_notes": "Forged notes"},
        ):
            with self.subTest(fields=fields), self.assertRaises(DatabaseError), atomic():
                issuance_request(self.tenant, **fields)
        self.assertEqual(ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(reason="Edited reason"), 1)
        self.restore_role()
        self.request.refresh_from_db()
        self.assertEqual(
            (self.request.status, self.request.reviewed_by_id, self.request.review_notes, self.request.reason),
            (RequestStatus.SUBMITTED, None, "", "Edited reason"),
        )

    def test_no_platform_reviewer_can_approve_a_fresh_unbound_nonpaid_request(self):
        inactive = make_tenant("review-guard-inactive", staff=True).user
        inactive.is_active = False
        inactive.save(update_fields=["is_active"])
        for reviewer in (None, self.tenant.user, inactive, self.staff):
            with self.subTest(reviewer=reviewer), self.assertRaisesMessage(
                DatabaseError, "Fresh paid and nonpaid approval requires its retained company decision"
            ), atomic():
                ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(
                    status=RequestStatus.APPROVED, reviewed_by=reviewer, reviewed_at=timezone.now()
                )
        with self.assertRaisesMessage(
            DatabaseError, "Fresh paid and nonpaid approval requires its retained company decision"
        ), atomic():
            issuance_request(self.tenant, status=RequestStatus.APPROVED, reviewed_by=self.staff)
        self.request.start_review(self.tenant.user)
        with self.assertRaisesMessage(
            DatabaseError, "Fresh paid and nonpaid approval requires its retained company decision"
        ), atomic():
            self.request.approve(self.staff)
        self.request.refresh_from_db()
        self.assertEqual(
            (self.request.status, self.request.reviewed_by_id), (RequestStatus.UNDER_REVIEW, self.tenant.user.pk)
        )
        historical = retained_approved_request(
            self.tenant.deployed_token, self.tenant.wallet.address, reviewer=self.staff
        )
        self.staff.is_active = False
        self.staff.save(update_fields=["is_active"])
        self.assertEqual(ShareIssuanceRequest.objects.filter(pk=historical.pk).update(updated_at=timezone.now()), 1)

    def test_a_disabled_review_guard_cannot_commit_a_fresh_unbound_nonpaid_approval(self):
        self.as_the_app_role()
        with self.assertRaisesMessage(
            DatabaseError, "permission denied for table tokens_registerinstructiondecision"
        ), atomic():
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("RESET ROLE")
                cursor.execute(
                    "ALTER TABLE tokens_shareissuancerequest DISABLE TRIGGER tokens_issuance_review_decision"
                )
                cursor.execute(f'SET ROLE "{settings.RLS_ROLES["app"]}"')
            ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(
                status=RequestStatus.APPROVED, reviewed_by_id=self.staff.pk, reviewed_at=timezone.now()
            )
            self.assertEqual(ShareIssuanceRequest.objects.get(pk=self.request.pk).status, RequestStatus.APPROVED)
        self.restore_role()
        self.assertEqual(ShareIssuanceRequest.objects.get(pk=self.request.pk).status, RequestStatus.SUBMITTED)


class RegisterInstructionApiTest(APITransactionTestCase):
    def setUp(self):
        self.tenant, self.reviewer, self.document, self.subscription = instruction_fixture("instruction-api")
        self.client.force_authenticate(self.tenant.user)
        self.cover = retained_approved_request(
            self.tenant.deployed_token, self.tenant.wallet.address, reviewer=self.reviewer
        )
        self.payload = instruction_payload(self.tenant.deployed_token, self.document, [self.cover])
        self.url = reverse("tokens:register-instructions-list")

    def test_external_issuer_submission_and_private_read_contract(self):
        response = self.client.post(self.url, self.payload, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        row = response.json()
        self.assertEqual((row["status"], row["kind"], row["items"]), ("submitted", "issue", self.payload["items"]))
        self.assertNotIn("file", row)
        detail = reverse("tokens:register-instructions-detail", args=[row["uuid"]])
        self.assertEqual(self.client.get(detail).status_code, 200)
        self.assertEqual(
            self.client.get(reverse("tokens:register-instructions-file", args=[row["uuid"]])).status_code, 200
        )
        self.assertEqual(self.client.patch(detail, {"reason": "rewrite"}).status_code, 405)
        self.assertEqual(self.client.delete(detail).status_code, 405)
        self.assertEqual(self.client.post(self.url, self.payload, format="json").json()["uuid"], row["uuid"])
        self.assertEqual(
            self.client.post(self.url, {**self.payload, "reason": "other"}, format="json").status_code, 409
        )
        for changes in ({"items": []}, {"kind": "transfer"}, {"approving_director": ""}):
            with self.subTest(changes=changes):
                self.assertEqual(
                    self.client.post(
                        self.url, {**self.payload, "operation_id": uuid4(), **changes}, format="json"
                    ).status_code,
                    400,
                )
        stranger = make_tenant("instruction-api-stranger")
        self.client.force_authenticate(stranger.user)
        self.assertEqual(self.client.get(detail).status_code, 404)
        self.assertEqual(self.client.get(self.url).json()["results"], [])
        self.assertEqual(
            self.client.post(self.url, {**self.payload, "operation_id": uuid4()}, format="json").status_code, 404
        )
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(detail).status_code, 401)
        self.assertEqual(self.client.post(self.url, self.payload, format="json").status_code, 401)


class ScopedRegisterInstructionTest(RunsOnTheScopedConnection, APITransactionTestCase):
    def setUp(self):
        with use_operator():
            self.tenant, self.reviewer, self.document, self.subscription = instruction_fixture("scoped-instruction")
            self.staff = make_tenant("scoped-instruction-staff", staff=True).user
            self.stranger = make_tenant("scoped-instruction-stranger")
            self.cover = retained_approved_request(
                self.tenant.deployed_token, self.tenant.wallet.address, reviewer=self.reviewer
            )
        self.the_principal_the_middleware_would_set(self.tenant.user)
        self.proposal = submit_instruction(
            actor=self.tenant.user,
            **instruction_payload(self.tenant.deployed_token, self.document, [self.cover]),
        )

    def test_app_submits_and_reads_but_only_the_operator_reviews_and_approves(self):
        self.assertEqual(list(RegisterInstruction.objects.values_list("pk", flat=True)), [self.proposal.pk])
        with self.assertRaises(PermissionDenied):
            prepare_instruction_review(proposal_id=self.proposal.pk, reviewer=self.reviewer)
        with self.assertRaises(PermissionDenied):
            decide_instruction(proposal_id=self.proposal.pk, reviewer=self.reviewer, confirmation="", decision="apply")
        for change in ({"status": "rejected", "rejection_reason": "forged"}, {"reason": "forged"}):
            with self.subTest(change=change), self.assertRaises(DatabaseError), atomic():
                RegisterInstruction.objects.filter(pk=self.proposal.pk).update(**change)
        with self.assertRaises(DatabaseError), atomic():
            self.proposal.delete()
        with use_operator():
            raw = issuance_request(self.tenant)
        for changes in (
            {"status": RequestStatus.APPROVED, "reviewed_by_id": self.staff.pk, "reviewed_at": timezone.now()},
            {"reviewed_by_id": self.staff.pk},
            {"review_notes": "Forged notes"},
        ):
            with self.subTest(changes=changes), self.assertRaises(DatabaseError), atomic():
                ShareIssuanceRequest.objects.filter(pk=raw.pk).update(**changes)
        self.the_principal_the_middleware_would_set(self.stranger.user)
        self.assertEqual(RegisterInstruction.objects.count(), 0)
        self.no_principal_is_set()
        self.assertEqual(RegisterInstruction.objects.count(), 0)
        self.the_principal_the_middleware_would_set(self.tenant.user)
        with use_operator():
            _, _, confirmation = prepare_instruction_review(proposal_id=self.proposal.pk, reviewer=self.reviewer)
            applied = decide_instruction(
                proposal_id=self.proposal.pk, reviewer=self.reviewer, confirmation=confirmation, decision="apply"
            )
        self.assertEqual(applied.status, "applied")
        subscription = Subscription.objects.get(pk=self.subscription.pk)
        self.assertEqual((subscription.status, subscription.issuance_request_id), (SubscriptionStatus.PAID, None))


@override_settings(**SETTLEMENT)
class TransferInstructionTest(SettledTransferFixtures, TransactionTestCase):
    def setUp(self):
        super().setUp()
        self.open_register()
        self.token = ShareToken.objects.get(pk=self.swap.share_token_id)
        self.payload = instruction_payload(self.token, self.document, [self.swap])

    def submit(self, **changes):
        return submit_instruction(actor=self.owner, **{**self.payload, **changes})

    def decide(self, proposal, decision="apply", confirmation="", rejection_reason=""):
        return decide_instruction(
            proposal_id=proposal.pk,
            reviewer=self.reviewer,
            confirmation=confirmation,
            decision=decision,
            rejection_reason=rejection_reason,
        )

    def as_the_app_role(self):
        self.addCleanup(self.restore_role)
        with connection.cursor() as cursor:
            cursor.execute(f'SET ROLE "{settings.RLS_ROLES["app"]}"')
            cursor.execute("SELECT set_config(%s, %s, false)", [PRINCIPAL_SETTING, str(self.owner.pk)])

    def restore_role(self):
        with connection.cursor() as cursor:
            cursor.execute("RESET ROLE")
            cursor.execute("SELECT set_config(%s, NULL, false)", [PRINCIPAL_SETTING])

    def apply_by_sql(self, instruction):
        with connection.cursor() as cursor:
            cursor.execute(
                "UPDATE tokens_registerinstruction SET status = 'applied', reviewed_by_id = %s, reviewed_at = now() "
                "WHERE uuid = %s",
                [self.reviewer.pk, instruction.pk],
            )

    def test_submission_binds_the_exact_settlement_terms_verified_evidence_and_a_retained_copy(self):
        self.complete()
        item = instruction_item(self.swap)
        proposal = self.submit(items=[{**item, "seller": item["seller"].lower(), "buyer": item["buyer"].lower()}])
        self.assertEqual((proposal.status, proposal.kind, proposal.token_id), ("submitted", "transfer", self.token.pk))
        self.assertEqual(
            proposal.items,
            [
                {
                    "settlement": str(self.swap.pk),
                    "seller": Web3.to_checksum_address(self.swap.seller_address),
                    "buyer": Web3.to_checksum_address(self.swap.buyer_address),
                    "amount": "10",
                }
            ],
        )
        document = CompanyDocument.objects.get(pk=self.document.pk)
        self.assertEqual(proposal.evidence_fingerprint, document.verified_fingerprint)
        with proposal.file.open("rb") as retained, document.file.open("rb") as source:
            self.assertEqual(retained.read(), source.read())
        self.assertEqual(self.submit(operation_id=proposal.pk).pk, proposal.pk)
        for changes in ({"reason": "Another reason"}, {"items": [{**item, "amount": "9"}]}):
            with self.subTest(changes=changes), self.assertRaises(RegisterChangeConflict):
                self.submit(operation_id=proposal.pk, **changes)
        self.assertEqual(RegisterInstruction.objects.count(), 1)
        self.assertEqual(self.transfers(), [])

    def test_submission_lists_only_completed_settlements_of_the_class_on_their_terms(self):
        with self.assertRaisesMessage(ValidationError, "is not a completed settlement of this share class"):
            self.submit()
        self.complete()
        stranger = make_tenant("transfer-stranger")
        with self.assertRaises(NotFound):
            submit_instruction(actor=stranger.user, **self.payload)
        item = instruction_item(self.swap)
        request = {"request": str(uuid4()), "recipient": item["seller"], "amount": "1"}
        for items, refusal in (
            ([], "List each settlement"),
            ([{**item, "buyer": "not-an-address"}], "List each settlement"),
            ([{**item, "amount": "0"}], "List each settlement"),
            ([{**item, "amount": 10}], "List each settlement"),
            ([{key: value for key, value in item.items() if key != "buyer"}], "List each settlement"),
            ([{**item, "request": item["settlement"]}], "List each settlement"),
            ([item, request], "List each settlement"),
            ([item, {**item, "seller": item["seller"].lower()}], "lists a settlement more than once"),
            ([{**item, "amount": "11"}], "differs from the instruction"),
            ([{**item, "seller": item["buyer"], "buyer": item["seller"]}], "differs from the instruction"),
            ([instruction_item(stranger.swap)], "is not a completed settlement of this share class"),
            ([{**item, "settlement": str(uuid4())}], "is not a completed settlement of this share class"),
        ):
            with self.subTest(items=items), self.assertRaisesMessage(ValidationError, refusal):
                self.submit(operation_id=uuid4(), items=items)
        for changes, refusal in (
            ({"kind": "issue"}, "List each issuance request or subscription"),
            ({"kind": "transfer", "items": [request]}, "List each settlement"),
            ({"kind": "refusal"}, "approves issues or transfers"),
        ):
            with self.subTest(changes=changes), self.assertRaisesMessage(ValidationError, refusal):
                self.submit(operation_id=uuid4(), **changes)
        self.assertFalse(RegisterInstruction.objects.exists())

    def test_the_approving_director_cannot_be_a_party_to_a_listed_settlement(self):
        self.complete()
        for party in (self.fixture.seller, self.fixture.buyer):
            with self.subTest(party=party.label), self.assertRaisesMessage(ValidationError, "is a party to settlement"):
                self.submit(operation_id=uuid4(), approving_director=f" {party.profile.full_name.upper()} ")
        self.assertEqual(self.submit(operation_id=uuid4()).approving_director, DIRECTOR)

    def test_application_covers_each_listed_settlement_once_and_records_its_transfer(self):
        self.complete()
        proposal, duplicate = self.submit(), self.submit(operation_id=uuid4(), reason="A second approval")
        _, rows, confirmation = prepare_instruction_review(proposal_id=proposal.pk, reviewer=self.reviewer)
        self.assertEqual(
            [
                (row["settlement"], row["seller_member"], row["seller_name"], row["buyer_member"], row["buyer_name"])
                for row in rows
            ],
            [
                (
                    str(self.swap.pk),
                    str(self.seller_member.pk),
                    self.fixture.seller.profile.full_name,
                    str(self.buyer_member.pk),
                    self.fixture.buyer.profile.full_name,
                )
            ],
        )
        self.assertEqual([(row["completed_at"], row["state"]) for row in rows], [(self.swap.completed_at, SETTLED)])
        applied = self.decide(proposal, confirmation=confirmation)
        self.assertEqual((applied.status, applied.reviewed_by_id), ("applied", self.reviewer.pk))
        entry = RegisterEntry.objects.get(operation_id=self.swap.pk)
        self.assertEqual((entry.kind, entry.recorded_by_id), ("transfer", self.fixture.seller.user.pk))
        with patch("django.core.signing.time.time", return_value=timezone.now().timestamp() + 901):
            self.assertEqual(self.decide(proposal, confirmation=confirmation).status, "applied")
        with self.assertRaises(RegisterChangeConflict):
            self.decide(proposal, "reject", rejection_reason="Too late")
        with self.assertRaisesMessage(ValidationError, "is already covered by an applied instruction"):
            prepare_instruction_review(proposal_id=duplicate.pk, reviewer=self.reviewer)
        with self.assertRaisesMessage(ValidationError, "is already covered by an applied instruction"):
            self.submit(operation_id=uuid4())
        self.assertEqual(self.decide(duplicate, "reject", rejection_reason="Already covered").status, "rejected")
        self.assertEqual(RegisterEntry.objects.filter(operation_id=self.swap.pk).count(), 1)

    def test_a_second_instruction_for_a_settlement_cannot_be_applied_once_the_first_covers_it(self):
        self.complete()
        proposal, duplicate = self.submit(), self.submit(operation_id=uuid4(), reason="A second approval")
        confirmation = prepare_instruction_review(proposal_id=duplicate.pk, reviewer=self.reviewer)[2]
        self.decide(
            proposal, confirmation=prepare_instruction_review(proposal_id=proposal.pk, reviewer=self.reviewer)[2]
        )
        with self.assertRaisesMessage(ValidationError, "is already covered by an applied instruction"):
            self.decide(duplicate, confirmation=confirmation)
        self.assertEqual(RegisterInstruction.objects.get(pk=duplicate.pk).status, "submitted")

    def test_the_database_refuses_malformed_settlements_and_app_role_decisions(self):
        self.complete()
        evidence = self.submit()
        item = evidence.items[0]
        self.as_the_app_role()
        for items in (
            [],
            [{**item, "amount": "010"}],
            [{**item, "seller": None}],
            [{**item, "buyer": "0x" + "zz" * 20}],
            [{**item, "settlement": "not-a-uuid"}],
            [{key: value for key, value in item.items() if key != "buyer"}],
            [{**item, "request": item["settlement"]}],
            [{"request": item["settlement"], "recipient": item["seller"], "amount": "1"}],
            [item, item],
        ):
            with self.subTest(items=items), self.assertRaisesMessage(
                DatabaseError, "require exact current intent"
            ), atomic():
                forged(evidence, items=items)
        for kind in ("issue", "refusal"):
            with self.subTest(kind=kind), self.assertRaisesMessage(
                DatabaseError, "require exact current intent"
            ), atomic():
                forged(evidence, kind=kind)
        unseen = forged(evidence, items=[{**item, "settlement": str(uuid4())}])
        with self.assertRaisesMessage(DatabaseError, "Only operator review may decide"), atomic():
            self.apply_by_sql(unseen)
        self.restore_role()
        self.assertEqual(RegisterInstruction.objects.get(pk=unseen.pk).status, "submitted")

    def test_the_database_applies_only_completed_settlements_of_the_class_on_their_terms_once(self):
        request = retained_approved_request(self.token, self.swap.buyer_address, reviewer=self.reviewer, amount=1)
        evidence = submit_instruction(actor=self.owner, **instruction_payload(self.token, self.document, [request]))
        item = instruction_item(self.swap)
        settling = forged(evidence, kind="transfer", items=[item])
        with self.assertRaisesMessage(DatabaseError, "Application must cover completed settlements"), atomic():
            self.apply_by_sql(settling)
        self.complete()
        for changes in (
            {"items": [{**item, "amount": "9"}]},
            {"items": [{**item, "seller": item["buyer"], "buyer": item["seller"]}]},
            {"items": [{**item, "settlement": str(uuid4())}]},
            {"token_id": self.fixture.seller.token.pk},
        ):
            with self.subTest(changes=changes), self.assertRaisesMessage(
                DatabaseError, "Application must cover completed settlements"
            ), atomic():
                self.apply_by_sql(forged(evidence, **{"kind": "transfer", "items": [item], **changes}))
        duplicate = forged(evidence, kind="transfer", items=[item])
        self.apply_by_sql(settling)
        self.assertEqual(RegisterInstruction.objects.get(pk=settling.pk).status, "applied")
        with self.assertRaisesMessage(DatabaseError, "Application must cover completed settlements"), atomic():
            self.apply_by_sql(duplicate)
        self.assertEqual(RegisterInstruction.objects.get(pk=duplicate.pk).status, "submitted")

    @override_settings(STORAGES=ADMIN_STORAGES)
    def test_admin_reviews_each_settlements_parties_members_shares_and_completion_before_applying(self):
        self.complete()
        proposal = self.submit()
        self.client.force_login(self.reviewer)
        url = reverse("admin:tokens_registerinstruction_review", args=[proposal.pk])
        response = self.client.get(url)
        for shown in (
            DIRECTOR,
            str(self.swap.pk),
            Web3.to_checksum_address(self.swap.seller_address),
            Web3.to_checksum_address(self.swap.buyer_address),
            f"{self.seller_member.pk}; {self.fixture.seller.profile.full_name}",
            f"{self.buyer_member.pk}; {self.fixture.buyer.profile.full_name}",
            self.token.symbol,
            self.swap.completed_at.isoformat(),
            SETTLED,
            "neither their seller nor their buyer",
        ):
            self.assertContains(response, shown)
        self.assertContains(response, "<td>10</td>", html=True)
        token = response.context["form"].initial["confirmation"]
        response = self.client.post(url, {"confirmation": token, "decision": "apply", "reviewed": True})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(RegisterInstruction.objects.get(pk=proposal.pk).status, "applied")
        self.assertEqual([operation for operation, _ in self.transfers()], [self.swap.pk])


@override_settings(**SETTLEMENT)
class TransferInstructionApiTest(SettledTransferFixtures, APITransactionTestCase):
    def test_the_owner_names_a_settlement_it_is_no_party_to_from_the_waiting_list(self):
        self.open_register()
        self.complete()
        token = ShareToken.objects.get(pk=self.swap.share_token_id)
        waiting = f"/api/v1/tokens/{token.uuid}/register/waiting/"
        self.client.force_authenticate(self.owner)
        (effect,) = self.client.get(waiting).json()["effects"]
        self.assertEqual((effect["kind"], effect["reason"]), ("transfer", "uninstructed"))
        seller, buyer = effect["wallets"]
        payload = {
            "operation_id": str(uuid4()),
            "token_id": str(token.pk),
            "document_id": str(self.document.pk),
            "kind": "transfer",
            "items": [{"settlement": effect["source"], "seller": seller, "buyer": buyer, "amount": effect["shares"]}],
            "approving_director": DIRECTOR,
            "authority_reference": "SYNTHETIC-RESOLUTION-TRANSFER-1",
            "reason": "Register the settled transfer",
        }
        url = reverse("tokens:register-instructions-list")
        response = self.client.post(url, payload, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        row = response.json()
        self.assertEqual((row["status"], row["kind"], row["items"]), ("submitted", "transfer", payload["items"]))
        self.assertEqual(self.client.post(url, payload, format="json").json()["uuid"], row["uuid"])
        self.assertEqual(self.client.post(url, {**payload, "reason": "other"}, format="json").status_code, 409)
        for changes in ({"kind": "issue"}, {"items": [{**payload["items"][0], "amount": "9"}]}):
            with self.subTest(changes=changes):
                self.assertEqual(
                    self.client.post(
                        url, {**payload, "operation_id": str(uuid4()), **changes}, format="json"
                    ).status_code,
                    400,
                )
        stranger = make_tenant("transfer-api-stranger")
        self.client.force_authenticate(stranger.user)
        self.assertEqual(self.client.get(waiting).status_code, 404)
        self.assertEqual(
            self.client.post(url, {**payload, "operation_id": str(uuid4())}, format="json").status_code, 404
        )


class CompanyInstructionBoundaryTest(TransactionTestCase):
    def setUp(self):
        from tokens.tests.issuance_fixtures import install_issuance

        install_issuance(self)

    def test_platform_instructions_and_staff_reviews_cannot_replace_the_exact_company_grant(self):
        document = verified_authority(self.token.company, instruction_reviewer())
        fresh = ShareIssuanceRequest.objects.create(
            token=self.token,
            recipient_address=self.request.recipient_address,
            amount=10,
            reason="Unbound grant",
            submitted_by=self.owner,
        )
        for candidate in (fresh, self.request):
            with self.subTest(request=candidate.pk), self.assertRaisesMessage(
                ValidationError, "company's retained appointment"
            ):
                submit_instruction(actor=self.owner, **instruction_payload(self.token, document, [candidate]))
        with self.assertRaisesMessage(
            DatabaseError, "Fresh paid and nonpaid approval requires its retained company decision"
        ), atomic():
            fresh.approve(instruction_reviewer())
        fresh.refresh_from_db()
        self.assertEqual((fresh.status, fresh.reviewed_by_id), (RequestStatus.SUBMITTED, None))
        with self.assertRaisesMessage(ValidationError, "current company appointee"):
            prepare_instruction_review(proposal_id=self.proposal.pk, reviewer=instruction_reviewer())
        applied, _ = self.company_issue.issue_decide(self.proposal, "apply")
        self.request.refresh_from_db()
        self.assertEqual(
            (applied.reviewed_by_id, self.request.status, self.request.reviewed_by_id),
            (self.owner.pk, RequestStatus.APPROVED, self.owner.pk),
        )
        self.assertEqual(self.request.reviewed_at, applied.reviewed_at)

    def test_a_failed_company_apply_rolls_back_the_request_decision_and_private_admission(self):
        from tokens.models import ShareIssuanceExecution
        from tokens.services import issuance_execution

        with patch.object(issuance_execution, "_enqueue", side_effect=RuntimeError("write failed")):
            with self.assertRaises(RuntimeError):
                self.company_issue.issue_decide(self.proposal, "apply")
        self.request.refresh_from_db()
        self.proposal.refresh_from_db()
        self.assertEqual((self.request.status, self.proposal.status), (RequestStatus.UNDER_REVIEW, "submitted"))
        self.assertIsNone(self.request.reviewed_by_id)
        self.assertFalse(ShareIssuanceExecution.objects.filter(request_id=self.request.pk).exists())
        rejected, _ = self.company_issue.issue_decide(self.proposal, "reject", reason="Company declined")
        self.request.refresh_from_db()
        self.assertEqual(
            (rejected.status, self.request.status, self.request.rejection_reason),
            ("rejected", RequestStatus.REJECTED, "Company declined"),
        )
