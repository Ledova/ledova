import importlib
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

from companies.models import CompanyDocument
from companies.tests.test_document_file_access import (
    ADMIN_STORAGES,
    attach_file,
    make_document,
)
from offerings.models import Subscription, SubscriptionStatus
from offerings.tests.factories import open_offering, paid_subscription
from shared.db import atomic, current_alias, use_operator
from shared.db.principal import PRINCIPAL_SETTING
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.scoped import RunsOnTheScopedConnection
from shared.tests.tenants import make_tenant
from tokens.exceptions import RegisterChangeConflict
from tokens.models import (
    RegisterEntry,
    RegisterInstruction,
    RequestStatus,
    ShareIssuanceRequest,
    ShareToken,
    SwapOrder,
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
    request = issuance_request(tenant)
    return tenant, reviewer, document, request


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
        self.tenant, self.reviewer, self.document, self.request = instruction_fixture()
        self.token = self.tenant.deployed_token
        self.payload = instruction_payload(self.token, self.document, [self.request])

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
        subscription = paid_subscription(self.tenant, quantity=12)
        proposal = self.submit(
            items=[
                {**instruction_item(subscription), "recipient": subscription.wallet.address.lower()},
                {**instruction_item(self.request), "recipient": self.request.recipient_address.lower()},
            ]
        )
        self.assertEqual((proposal.status, proposal.kind, proposal.token_id), ("submitted", "issue", self.token.pk))
        self.assertEqual(
            proposal.items,
            [
                {"request": str(self.request.pk), "recipient": self.tenant.wallet.address, "amount": "10"},
                {"subscription": str(subscription.pk), "recipient": self.tenant.wallet.address, "amount": "12"},
            ],
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
        self.assertEqual(ShareIssuanceRequest.objects.get(pk=self.request.pk).status, RequestStatus.SUBMITTED)

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
        item = instruction_item(self.request)
        foreign = issuance_request(stranger)
        for items in (
            [],
            [item, {**item, "recipient": item["recipient"].lower()}],
            [{**item, "recipient": "not-an-address"}],
            [{**item, "amount": "0"}],
            [{**item, "amount": 10}],
            [{"request": item["request"], "amount": "10"}],
            [{**item, "subscription": str(uuid4())}],
            [instruction_item(foreign)],
            [{**item, "amount": "11"}],
            [{**item, "recipient": Web3.to_checksum_address("0x" + "4d" * 20)}],
        ):
            with self.subTest(items=items), self.assertRaises(ValidationError):
                self.submit(operation_id=uuid4(), items=items)
        self.assertFalse(RegisterInstruction.objects.exists())

    def test_submission_lists_only_items_awaiting_approval_or_earlier_approvals(self):
        unpaid = paid_subscription(self.tenant, quantity=12)
        Subscription.objects.filter(pk=unpaid.pk).update(status=SubscriptionStatus.SUBMITTED)
        unpaid.refresh_from_db()
        rejected = issuance_request(self.tenant)
        rejected.reject(self.reviewer, "Not approved")
        draft = issuance_request(self.tenant, status=RequestStatus.DRAFT)
        for row, refusal in (
            (rejected, "neither awaiting approval"),
            (draft, "neither awaiting approval"),
            (unpaid, "is not paid and awaiting allotment"),
        ):
            with self.subTest(row=row), self.assertRaisesMessage(ValidationError, refusal):
                self.submit(operation_id=uuid4(), items=[instruction_item(row)])
        earlier = issuance_request(self.tenant)
        earlier.approve(self.reviewer)
        proposal = self.submit(operation_id=uuid4(), items=[instruction_item(earlier), instruction_item(self.request)])
        self.assertEqual(len(proposal.items), 2)

    def test_the_approving_director_cannot_be_a_recipient_the_item_identifies(self):
        named = issuance_request(self.tenant, recipient_name=f" {DIRECTOR.lower()} ")
        with self.assertRaisesMessage(ValidationError, "is the recipient"):
            self.submit(operation_id=uuid4(), items=[instruction_item(named)])
        with self.assertRaisesMessage(ValidationError, "is the recipient"):
            self.submit(operation_id=uuid4(), approving_director=self.tenant.profile.full_name.upper())
        unnamed = issuance_request(
            self.tenant, recipient_name="", recipient_address=Web3.to_checksum_address("0x" + "5e" * 20)
        )
        self.assertEqual(
            self.submit(operation_id=uuid4(), items=[instruction_item(unnamed)]).approving_director, DIRECTOR
        )

    def test_application_approves_each_listed_request_with_the_reviewer_exactly_once(self):
        other = issuance_request(self.tenant, amount=7)
        proposal = self.submit(items=[instruction_item(self.request), instruction_item(other)])
        confirmation = self.review(proposal)
        applied = self.decide(proposal, confirmation=confirmation)
        self.assertEqual((applied.status, applied.reviewed_by_id), ("applied", self.reviewer.pk))
        for request in (self.request, other):
            request.refresh_from_db()
            self.assertEqual(
                (request.status, request.reviewed_by_id, request.review_notes),
                (RequestStatus.APPROVED, self.reviewer.pk, f"Approved by register instruction {proposal.pk}."),
            )
            self.assertIsNotNone(request.reviewed_at)
        with patch("django.core.signing.time.time", return_value=timezone.now().timestamp() + 901):
            self.assertEqual(self.decide(proposal, confirmation=confirmation).status, "applied")
        with self.assertRaises(RegisterChangeConflict):
            self.decide(proposal, "reject", rejection_reason="Too late")
        with self.assertRaisesMessage(ValidationError, "already has a decision"):
            self.review(proposal)
        with self.assertRaisesMessage(ValidationError, "neither awaiting approval"):
            self.submit(operation_id=uuid4())

    def test_an_item_that_changed_after_submission_refuses_review_and_application_but_not_rejection(self):
        proposal = self.submit()
        confirmation = self.review(proposal)
        ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(amount=1000)
        with self.assertRaisesMessage(ValidationError, "differs from the instruction"):
            self.review(proposal)
        with self.assertRaisesMessage(ValidationError, "differs from the instruction"):
            self.decide(proposal, confirmation=confirmation)
        ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(amount=10)
        self.request.refresh_from_db()
        self.request.reject(self.reviewer, "Withdrawn by the company")
        with self.assertRaisesMessage(ValidationError, "neither awaiting approval"):
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
        self.assertEqual(ShareIssuanceRequest.objects.get(pk=self.request.pk).status, RequestStatus.SUBMITTED)

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
        self.assertEqual(ShareIssuanceRequest.objects.get(pk=self.request.pk).status, RequestStatus.SUBMITTED)

    def test_a_failed_decision_write_rolls_back_every_approval(self):
        proposal = self.submit()
        confirmation = self.review(proposal)
        with patch.object(RegisterInstruction, "save", side_effect=RuntimeError("write failed")):
            with self.assertRaises(RuntimeError):
                self.decide(proposal, confirmation=confirmation)
        self.assertEqual(RegisterInstruction.objects.get(pk=proposal.pk).status, "submitted")
        request = ShareIssuanceRequest.objects.get(pk=self.request.pk)
        self.assertEqual((request.status, request.reviewed_by_id), (RequestStatus.SUBMITTED, None))

    def test_database_refuses_rewrites_deletion_forged_decisions_and_foreign_items(self):
        proposal = self.submit()
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
        open_offering(stranger)
        subscription = paid_subscription(stranger, quantity=10)
        item = proposal.items[0]
        for items in (
            [],
            [instruction_item(issuance_request(stranger))],
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
        with self.assertRaises(RuntimeError), atomic():
            forged(proposal)
            raise RuntimeError("rollback")
        self.decide(proposal)
        with self.assertRaises(DatabaseError), atomic():
            RegisterInstruction.objects.filter(pk=proposal.pk).update(reviewed_at=timezone.now())
        self.assertEqual(RegisterInstruction.objects.count(), 1)

    def test_the_database_refuses_an_application_that_leaves_a_listed_request_unapproved(self):
        proposal = self.submit()
        with self.assertRaisesMessage(DatabaseError, "approve every listed issuance request"), atomic():
            RegisterInstruction.objects.filter(pk=proposal.pk).update(
                status="applied", reviewed_at=timezone.now(), reviewed_by=self.reviewer
            )
        with self.assertRaisesMessage(DatabaseError, "approve every listed issuance request"), atomic():
            ShareIssuanceRequest.objects.filter(pk=self.request.pk).delete()
            RegisterInstruction.objects.filter(pk=proposal.pk).update(
                status="applied", reviewed_at=timezone.now(), reviewed_by=self.reviewer
            )
        with self.assertRaises(RuntimeError), atomic():
            self.request.approve(self.reviewer)
            RegisterInstruction.objects.filter(pk=proposal.pk).update(
                status="applied", reviewed_at=timezone.now(), reviewed_by=self.reviewer
            )
            raise RuntimeError("rollback")
        self.assertEqual(RegisterInstruction.objects.get(pk=proposal.pk).status, "submitted")
        self.assertEqual(ShareIssuanceRequest.objects.get(pk=self.request.pk).status, RequestStatus.SUBMITTED)

    @override_settings(STORAGES=ADMIN_STORAGES)
    def test_admin_reviews_the_file_the_director_and_each_items_exact_terms_before_applying(self):
        proposal = self.submit()
        self.client.force_login(self.reviewer)
        url = reverse("admin:tokens_registerinstruction_review", args=[proposal.pk])
        response = self.client.get(url)
        for shown in (DIRECTOR, str(self.request.pk), self.tenant.wallet.address, "Rita Recipient", self.token.symbol):
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
        self.assertEqual(ShareIssuanceRequest.objects.get(pk=self.request.pk).reviewed_by_id, self.reviewer.pk)
        self.assertEqual(
            self.client.post(
                reverse("admin:tokens_registerinstruction_change", args=[proposal.pk]), {"reason": "rewrite"}
            ).status_code,
            405,
        )
        named = issuance_request(self.tenant, recipient_name="Another Name")
        pending = self.submit(operation_id=uuid4(), items=[instruction_item(named)])
        ShareIssuanceRequest.objects.filter(pk=named.pk).update(recipient_name=DIRECTOR)
        response = self.client.get(reverse("admin:tokens_registerinstruction_review", args=[pending.pk]))
        self.assertContains(response, "is the recipient")
        self.assertContains(response, str(named.pk))
        model_admin = admin.site._registry[RegisterInstruction]
        self.assertFalse(model_admin.has_delete_permission(None, proposal))
        self.assertFalse(model_admin.has_add_permission(None))
        self.assertTrue(
            set(field.name for field in RegisterInstruction._meta.fields) - {"file"} <= set(model_admin.readonly_fields)
        )


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
        approved = issuance_request(self.tenant)
        approved.approve(self.staff, "Operator notes")
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
            with self.subTest(changes=changes), self.assertRaisesMessage(
                DatabaseError, "Only operator review may decide an issuance request"
            ), atomic():
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

    def test_an_approval_needs_an_active_staff_reviewer_whoever_writes_it(self):
        inactive = make_tenant("review-guard-inactive", staff=True).user
        inactive.is_active = False
        inactive.save(update_fields=["is_active"])
        for reviewer in (None, self.tenant.user, inactive):
            with self.subTest(reviewer=reviewer), self.assertRaisesMessage(
                DatabaseError, "requires an active staff reviewer"
            ), atomic():
                ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(
                    status=RequestStatus.APPROVED, reviewed_by=reviewer, reviewed_at=timezone.now()
                )
        with self.assertRaisesMessage(DatabaseError, "requires an active staff reviewer"), atomic():
            issuance_request(self.tenant, status=RequestStatus.APPROVED, reviewed_by=self.tenant.user)
        self.request.start_review(self.tenant.user)
        self.request.approve(self.staff)
        self.request.refresh_from_db()
        self.assertEqual((self.request.status, self.request.reviewed_by_id), (RequestStatus.APPROVED, self.staff.pk))
        self.staff.is_active = False
        self.staff.save(update_fields=["is_active"])
        self.assertEqual(ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(updated_at=timezone.now()), 1)

    def test_a_disabled_guard_lets_the_app_role_approve_its_own_request(self):
        self.as_the_app_role()
        with self.assertRaises(RuntimeError), atomic():
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
            raise RuntimeError("rollback")
        self.restore_role()
        self.assertEqual(ShareIssuanceRequest.objects.get(pk=self.request.pk).status, RequestStatus.SUBMITTED)


class RegisterInstructionApiTest(APITransactionTestCase):
    def setUp(self):
        self.tenant, self.reviewer, self.document, self.request = instruction_fixture("instruction-api")
        self.client.force_authenticate(self.tenant.user)
        self.payload = instruction_payload(self.tenant.deployed_token, self.document, [self.request])
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
            self.tenant, self.reviewer, self.document, self.request = instruction_fixture("scoped-instruction")
            self.staff = make_tenant("scoped-instruction-staff", staff=True).user
            self.stranger = make_tenant("scoped-instruction-stranger")
        self.the_principal_the_middleware_would_set(self.tenant.user)
        self.proposal = submit_instruction(
            actor=self.tenant.user, **instruction_payload(self.tenant.deployed_token, self.document, [self.request])
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
        for changes in (
            {"status": RequestStatus.APPROVED, "reviewed_by_id": self.staff.pk, "reviewed_at": timezone.now()},
            {"reviewed_by_id": self.staff.pk},
            {"review_notes": "Forged notes"},
        ):
            with self.subTest(changes=changes), self.assertRaises(DatabaseError), atomic():
                ShareIssuanceRequest.objects.filter(pk=self.request.pk).update(**changes)
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
        request = ShareIssuanceRequest.objects.get(pk=self.request.pk)
        self.assertEqual((request.status, request.reviewed_by_id), (RequestStatus.APPROVED, self.reviewer.pk))


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
        request = ShareIssuanceRequest.objects.create(
            token=self.token, recipient_address=self.swap.buyer_address, amount=1, reason="Allotment"
        )
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


@override_settings(**SETTLEMENT)
class ScopedTransferInstructionTest(RunsOnTheScopedConnection, SettledTransferFixtures, APITransactionTestCase):
    def test_the_owner_instructs_a_settlement_it_cannot_see_and_only_the_operator_applies_it(self):
        self.open_register()
        self.complete()
        with use_operator():
            token = ShareToken.objects.get(pk=self.swap.share_token_id)
        self.signed_in_as(self.owner)
        self.assertFalse(SwapOrder.objects.filter(pk=self.swap.pk).exists())
        (effect,) = self.client.get(f"/api/v1/tokens/{token.uuid}/register/waiting/").json()["effects"]
        seller, buyer = effect["wallets"]
        response = self.client.post(
            reverse("tokens:register-instructions-list"),
            {
                "operation_id": str(uuid4()),
                "token_id": str(token.pk),
                "document_id": str(self.document.pk),
                "kind": "transfer",
                "items": [
                    {"settlement": effect["source"], "seller": seller, "buyer": buyer, "amount": effect["shares"]}
                ],
                "approving_director": DIRECTOR,
                "authority_reference": "SYNTHETIC-RESOLUTION-TRANSFER-1",
                "reason": "Register the settled transfer",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.the_principal_the_middleware_would_set(self.owner)
        proposal = RegisterInstruction.objects.get(pk=response.json()["uuid"])
        with self.assertRaises(PermissionDenied):
            prepare_instruction_review(proposal_id=proposal.pk, reviewer=self.reviewer)
        with self.assertRaises(PermissionDenied):
            decide_instruction(proposal_id=proposal.pk, reviewer=self.reviewer, confirmation="", decision="apply")
        with self.assertRaises(DatabaseError), atomic():
            RegisterInstruction.objects.filter(pk=proposal.pk).update(
                status="applied", reviewed_by=self.reviewer, reviewed_at=timezone.now()
            )
        with use_operator():
            _, _, confirmation = prepare_instruction_review(proposal_id=proposal.pk, reviewer=self.reviewer)
            applied = decide_instruction(
                proposal_id=proposal.pk, reviewer=self.reviewer, confirmation=confirmation, decision="apply"
            )
            entry = RegisterEntry.objects.get(operation_id=self.swap.pk)
        self.assertEqual(
            (applied.status, entry.kind, entry.recorded_by_id), ("applied", "transfer", self.fixture.seller.user.pk)
        )


class RegisterInstructionMigrationTest(TransactionTestCase):
    def test_the_migration_reverses_and_reapplies_on_an_empty_table(self):
        self.addCleanup(restore_every_migration)
        tenant = make_tenant("instruction-migration")
        staff = make_tenant("instruction-migration-staff", staff=True).user
        before = migrate_to([("tokens", "0072_register_import")])
        requests = before.get_model("tokens", "ShareIssuanceRequest").objects
        unguarded = requests.create(
            token_id=tenant.deployed_token.pk,
            company_id=tenant.company.pk,
            recipient_address=tenant.wallet.address,
            amount=5,
            reason="Approved before instructions",
            status="approved",
        )
        with connection.cursor() as cursor:
            cursor.execute("SELECT to_regclass('tokens_registerinstruction') IS NULL")
            self.assertTrue(cursor.fetchone()[0])
        after = migrate_to([("tokens", "0073_register_instructions")])
        self.assertEqual(
            after.get_model("tokens", "ShareIssuanceRequest").objects.get(pk=unguarded.pk).status, "approved"
        )
        with self.assertRaisesMessage(DatabaseError, "requires an active staff reviewer"), atomic():
            ShareIssuanceRequest.objects.create(
                token=tenant.deployed_token, recipient_address=tenant.wallet.address, amount=5, status="approved"
            )
        approved = ShareIssuanceRequest.objects.create(
            token=tenant.deployed_token,
            recipient_address=tenant.wallet.address,
            amount=5,
            status="approved",
            reviewed_by=staff,
        )
        self.assertEqual(ShareIssuanceRequest.objects.get(pk=approved.pk).reviewed_by_id, staff.pk)

    def test_transfer_instructions_are_refused_before_their_migration_and_kept_through_a_refused_downgrade(self):
        self.addCleanup(restore_every_migration)
        tenant, _, document, request = instruction_fixture("transfer-migration")
        issue = submit_instruction(actor=tenant.user, **instruction_payload(tenant.deployed_token, document, [request]))
        settlement = {
            "settlement": str(uuid4()),
            "seller": Web3.to_checksum_address("0x" + "5a" * 20),
            "buyer": Web3.to_checksum_address("0x" + "5b" * 20),
            "amount": "3",
        }
        before = migrate_to([("tokens", "0075_register_certificates")])
        with self.assertRaisesMessage(DatabaseError, "require exact current intent"), atomic():
            forged(issue, before.get_model("tokens", "RegisterInstruction"), kind="transfer", items=[settlement])
        after = migrate_to([("tokens", "0076_transfer_instructions")])
        transfer = forged(issue, after.get_model("tokens", "RegisterInstruction"), kind="transfer", items=[settlement])
        migration = importlib.import_module("tokens.migrations.0076_transfer_instructions")
        with self.assertRaisesRegex(RuntimeError, "Retain transfer instructions"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.restore_guard(None, editor)
        restore_every_migration()
        self.assertEqual(RegisterInstruction.objects.get(pk=transfer.pk).kind, "transfer")
        with self.assertRaisesMessage(DatabaseError, "require exact current intent"), atomic():
            forged(issue, kind="transfer", items=[{**settlement, "amount": "03"}])

    def test_downgrade_refuses_to_discard_instructions(self):
        tenant, _, document, request = instruction_fixture("instruction-downgrade")
        submit_instruction(actor=tenant.user, **instruction_payload(tenant.deployed_token, document, [request]))
        migration = importlib.import_module("tokens.migrations.0073_register_instructions")
        with self.assertRaisesRegex(RuntimeError, "Retain register instructions"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.remove_guards(None, editor)
        self.assertTrue(RegisterInstruction.objects.filter(company=tenant.company).exists())
