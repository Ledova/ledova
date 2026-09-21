import importlib
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from unittest.mock import patch
from uuid import UUID, uuid4

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.db import DatabaseError, connections
from django.test import TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.test import APITransactionTestCase
from web3 import Web3

from companies.models import CompanyDocument
from companies.services.document_review import prepare_document_review, verify_document
from companies.tests.test_document_file_access import (
    ADMIN_STORAGES,
    attach_file,
    make_document,
)
from shared.db import atomic, current_alias
from tokens.exceptions import RegisterChangeConflict
from tokens.models import RegisterMember, RegisterMemberWallet, RegisterWalletLink
from tokens.services.register_events import create_member
from tokens.services.register_openings import (
    decide_link,
    prepare_link_review,
    submit_link,
)
from tokens.tests.test_register_events import register_fixture

CAROL = Web3.to_checksum_address("0x" + "3c" * 20)
DAVE = Web3.to_checksum_address("0x" + "4d" * 20)


def link_fixture():
    owner, company, _, member, _, _ = register_fixture()
    owner.is_staff = False
    owner.save(update_fields=["is_staff"])
    reviewer = get_user_model().objects.create_user(email=f"link-{uuid4()}@example.test", is_active=True, is_staff=True)
    reviewer.user_permissions.add(
        *Permission.objects.filter(
            codename__in=["change_companydocument", "change_registerwalletlink", "view_registerwalletlink"]
        )
    )
    document = attach_file(make_document(company))
    _, confirmation = prepare_document_review(document_id=document.pk, reviewer=reviewer)
    verify_document(document_id=document.pk, reviewer=reviewer, confirmation=confirmation)
    return owner, company, member, reviewer, document


def link_payload(company, document, *, mapping=None, operation_id=None):
    return {
        "operation_id": operation_id or uuid4(),
        "company_id": company.pk,
        "document_id": document.pk,
        "mapping": mapping if mapping is not None else [{"address": CAROL.lower(), "member": str(uuid4())}],
        "authority": "director_resolution",
        "approving_director": "Synthetic Director",
        "authority_reference": "SYNTHETIC-RESOLUTION-LINK-1",
        "reason": "Link a holder's wallet to their member record",
    }


class RegisterWalletLinkTest(TransactionTestCase):
    def setUp(self):
        self.owner, self.company, self.member, self.reviewer, self.document = link_fixture()
        self.payload = link_payload(self.company, self.document)

    def submit(self, **changes):
        return submit_link(actor=self.owner, **{**self.payload, **changes})

    def review(self, proposal, reviewer=None):
        return prepare_link_review(proposal_id=proposal.pk, reviewer=reviewer or self.reviewer)[1]

    def decide(self, proposal, decision="apply", confirmation=None, rejection_reason=""):
        return decide_link(
            proposal_id=proposal.pk,
            reviewer=self.reviewer,
            confirmation=self.review(proposal) if confirmation is None and decision == "apply" else confirmation or "",
            decision=decision,
            rejection_reason=rejection_reason,
        )

    def forged(self, proposal, **changes):
        forged_id = uuid4()
        return RegisterWalletLink.objects.create(
            **{
                "uuid": forged_id,
                "company": self.company,
                "mapping": proposal.mapping,
                "authority": proposal.authority,
                "approving_director": proposal.approving_director,
                "authority_reference": proposal.authority_reference,
                "reason": proposal.reason,
                "source_document": proposal.source_document,
                "evidence_fingerprint": proposal.evidence_fingerprint,
                "evidence_snapshot": proposal.evidence_snapshot,
                "file": f"companies/{self.company.pk}/register-links/{forged_id}/{uuid4()}.bin",
                "submitted_by": self.owner,
                **changes,
            }
        )

    def test_submission_binds_verified_evidence_and_a_retained_copy(self):
        proposal = self.submit()
        self.assertEqual((proposal.status, proposal.company_id), ("submitted", self.company.pk))
        self.assertEqual(proposal.mapping, [{"address": CAROL, "member": self.payload["mapping"][0]["member"]}])
        document = CompanyDocument.objects.get(pk=self.document.pk)
        self.assertEqual(proposal.evidence_fingerprint, document.verified_fingerprint)
        self.assertEqual(proposal.evidence_snapshot["document"], str(document.pk))
        self.assertNotEqual(proposal.file.name, document.file.name)
        with proposal.file.open("rb") as retained, document.file.open("rb") as source:
            self.assertEqual(retained.read(), source.read())
        self.assertEqual(self.submit().pk, proposal.pk)
        with self.assertRaises(RegisterChangeConflict):
            self.submit(reason="Another reason")
        self.assertEqual(RegisterWalletLink.objects.count(), 1)
        self.assertFalse(RegisterMemberWallet.objects.exists())

    def test_submission_refuses_strangers_unverified_evidence_and_unusable_mappings(self):
        stranger, _, _, stranger_member, _, _ = register_fixture()
        with self.assertRaises(NotFound):
            submit_link(actor=stranger, **self.payload)
        unverified = attach_file(make_document(self.company))
        with self.assertRaises(ValidationError):
            self.submit(operation_id=uuid4(), document_id=unverified.pk)
        with self.assertRaises(ValidationError):
            self.submit(operation_id=uuid4(), approving_director="")
        for mapping in (
            [],
            [{"address": CAROL, "member": str(uuid4())}, {"address": CAROL.lower(), "member": str(uuid4())}],
            [{"address": "not-an-address", "member": str(uuid4())}],
            [{"address": CAROL, "member": str(stranger_member.pk)}],
        ):
            with self.subTest(mapping=mapping), self.assertRaises(ValidationError):
                self.submit(operation_id=uuid4(), mapping=mapping)
        RegisterMemberWallet.objects.create(company=self.company, member=self.member, address=DAVE)
        with self.assertRaisesMessage(ValidationError, "already linked"):
            self.submit(operation_id=uuid4(), mapping=[{"address": DAVE.lower(), "member": str(self.member.pk)}])
        self.assertFalse(RegisterWalletLink.objects.exists())

    def test_application_links_new_and_existing_members_exactly_once(self):
        new_member = str(uuid4())
        proposal = self.submit(
            mapping=[{"address": CAROL, "member": new_member}, {"address": DAVE, "member": str(self.member.pk)}]
        )
        confirmation = self.review(proposal)
        applied = self.decide(proposal, confirmation=confirmation)
        self.assertEqual((applied.status, applied.reviewed_by_id), ("applied", self.reviewer.pk))
        self.assertEqual(RegisterMember.objects.get(pk=new_member).company_id, self.company.pk)
        self.assertEqual(
            {(link.address, str(link.member_id)) for link in RegisterMemberWallet.objects.filter(company=self.company)},
            {(CAROL, new_member), (DAVE, str(self.member.pk))},
        )
        with patch("django.core.signing.time.time", return_value=timezone.now().timestamp() + 901):
            self.assertEqual(self.decide(proposal, confirmation=confirmation).status, "applied")
        self.assertEqual(RegisterMemberWallet.objects.filter(company=self.company).count(), 2)
        with self.assertRaises(RegisterChangeConflict):
            self.decide(proposal, "reject", rejection_reason="Too late")
        with self.assertRaisesMessage(ValidationError, "already has a decision"):
            self.review(proposal)
        with self.assertRaisesMessage(ValidationError, "already linked"):
            self.submit(operation_id=uuid4(), mapping=[{"address": CAROL, "member": str(uuid4())}])

    def test_a_wallet_linked_after_submission_refuses_review_and_application_but_not_rejection(self):
        first = self.submit()
        second = self.submit(operation_id=uuid4(), mapping=[{"address": CAROL, "member": str(uuid4())}])
        confirmation = self.review(second)
        self.decide(first)
        with self.assertRaisesMessage(ValidationError, "already linked"):
            self.review(second)
        with self.assertRaisesMessage(ValidationError, "already linked"):
            self.decide(second, confirmation=confirmation)
        self.assertEqual(RegisterWalletLink.objects.get(pk=second.pk).status, "submitted")
        for _ in range(2):
            rejected = self.decide(second, "reject", rejection_reason="The wallet is already linked")
            self.assertEqual((rejected.status, rejected.rejection_reason), ("rejected", "The wallet is already linked"))
        self.assertEqual(
            RegisterMemberWallet.objects.get(company=self.company, address=CAROL).member_id,
            UUID(first.mapping[0]["member"]),
        )

    def test_deleted_authority_evidence_refuses_application_and_keeps_the_retained_copy(self):
        proposal = self.submit()
        confirmation = self.review(proposal)
        CompanyDocument.objects.get(pk=self.document.pk).delete()
        with self.assertRaisesMessage(ValidationError, "Submit a fresh register wallet link"):
            self.review(proposal)
        with self.assertRaisesMessage(ValidationError, "Submit a fresh register wallet link"):
            self.decide(proposal, confirmation=confirmation)
        self.assertTrue(proposal.file.storage.exists(proposal.file.name))
        self.assertFalse(RegisterMemberWallet.objects.exists())
        self.assertEqual(self.decide(proposal, "reject", rejection_reason="Evidence withdrawn").status, "rejected")

    def test_decisions_need_a_permitted_reviewer_a_reason_and_this_reviewers_confirmation(self):
        proposal = self.submit()
        with self.assertRaisesMessage(ValidationError, "Open a fresh review"):
            self.decide(proposal, confirmation="forged")
        with self.assertRaises(ValidationError):
            self.decide(proposal, "reject")
        confirmation = self.review(proposal)
        other = get_user_model().objects.create_user(
            email=f"other-link-{uuid4()}@example.test", is_active=True, is_staff=True
        )
        other.user_permissions.add(Permission.objects.get(codename="change_registerwalletlink"))
        with self.assertRaisesMessage(ValidationError, "another proposal, reviewer or evidence"):
            decide_link(proposal_id=proposal.pk, reviewer=other, confirmation=confirmation, decision="apply")
        opening_reviewer = get_user_model().objects.create_user(
            email=f"opening-only-{uuid4()}@example.test", is_active=True, is_staff=True
        )
        opening_reviewer.user_permissions.add(Permission.objects.get(codename="change_registeropening"))
        with self.assertRaises(PermissionDenied):
            self.review(proposal, reviewer=opening_reviewer)
        with patch("django.core.signing.time.time", return_value=timezone.now().timestamp() + 901):
            with self.assertRaisesMessage(ValidationError, "invalid or expired"):
                self.decide(proposal, confirmation=confirmation)
        self.reviewer.is_active = False
        self.reviewer.save(update_fields=["is_active"])
        with self.assertRaises(PermissionDenied):
            self.decide(proposal, confirmation=confirmation)
        self.assertEqual(RegisterWalletLink.objects.get(pk=proposal.pk).status, "submitted")
        self.assertFalse(RegisterMemberWallet.objects.exists())

    def test_database_refuses_rewrites_deletion_forged_decisions_and_linked_submissions(self):
        proposal = self.submit()
        decided = {"reviewed_at": timezone.now(), "reviewed_by": self.reviewer}
        for changes in (
            {"reason": "Rewritten"},
            {"mapping": [{"address": DAVE, "member": proposal.mapping[0]["member"]}]},
            {"status": "applied", **decided},
            {"status": "rejected", "rejection_reason": " ", **decided},
            {"status": "applied"},
        ):
            with self.subTest(changes=changes), self.assertRaises(DatabaseError), atomic():
                RegisterWalletLink.objects.filter(pk=proposal.pk).update(**changes)
        with self.assertRaises(DatabaseError), atomic():
            proposal.delete()
        with self.assertRaises(RuntimeError), atomic():
            create_member(company_id=self.company.pk, member_id=UUID(proposal.mapping[0]["member"]))
            RegisterMemberWallet.objects.create(
                company=self.company, member_id=UUID(proposal.mapping[0]["member"]), address=CAROL
            )
            RegisterWalletLink.objects.filter(pk=proposal.pk).update(status="applied", **decided)
            raise RuntimeError("rollback")
        with self.assertRaises(DatabaseError), atomic():
            self.forged(proposal, mapping=[])
        with self.assertRaises(RuntimeError), atomic():
            self.forged(proposal)
            raise RuntimeError("rollback")
        self.decide(proposal)
        with self.assertRaises(DatabaseError), atomic():
            RegisterWalletLink.objects.filter(pk=proposal.pk).update(reviewed_at=timezone.now())
        with self.assertRaises(DatabaseError), atomic():
            self.forged(proposal)
        self.assertEqual(RegisterWalletLink.objects.count(), 1)

    def test_a_disabled_guard_admits_a_decision_that_links_nothing(self):
        proposal = self.submit()
        with self.assertRaises(RuntimeError), atomic(), connections[current_alias()].cursor() as cursor:
            cursor.execute("DROP TRIGGER tokens_register_wallet_link_identity ON tokens_registerwalletlink")
            RegisterWalletLink.objects.filter(pk=proposal.pk).update(
                status="applied", reviewed_at=timezone.now(), reviewed_by=self.reviewer
            )
            self.assertEqual(RegisterWalletLink.objects.get(pk=proposal.pk).status, "applied")
            self.assertFalse(RegisterMemberWallet.objects.exists())
            raise RuntimeError("rollback")
        self.assertEqual(RegisterWalletLink.objects.get(pk=proposal.pk).status, "submitted")

    def test_competing_requests_for_one_wallet_link_it_once(self):
        proposals = [
            self.submit(operation_id=uuid4(), mapping=[{"address": CAROL, "member": str(uuid4())}]) for _ in range(2)
        ]
        confirmations = [self.review(proposal) for proposal in proposals]
        start = Barrier(2)

        def apply(index):
            try:
                start.wait(timeout=10)
                decide_link(
                    proposal_id=proposals[index].pk,
                    reviewer=self.reviewer,
                    confirmation=confirmations[index],
                    decision="apply",
                )
                return "applied"
            except (ValidationError, RegisterChangeConflict, DatabaseError):
                return "refused"
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = sorted(future.result(timeout=30) for future in [pool.submit(apply, index) for index in (0, 1)])
        self.assertEqual(outcomes, ["applied", "refused"])
        self.assertEqual(RegisterMemberWallet.objects.filter(company=self.company, address__iexact=CAROL).count(), 1)
        self.assertEqual(sorted(RegisterWalletLink.objects.values_list("status", flat=True)), ["applied", "submitted"])

    def test_a_failed_decision_write_rolls_back_members_and_links(self):
        proposal = self.submit()
        confirmation = self.review(proposal)
        with patch.object(RegisterWalletLink, "save", side_effect=RuntimeError("write failed")):
            with self.assertRaises(RuntimeError):
                self.decide(proposal, confirmation=confirmation)
        self.assertEqual(RegisterWalletLink.objects.get(pk=proposal.pk).status, "submitted")
        self.assertFalse(RegisterMember.objects.filter(pk=proposal.mapping[0]["member"]).exists())
        self.assertFalse(RegisterMemberWallet.objects.exists())

    @override_settings(STORAGES=ADMIN_STORAGES)
    def test_admin_reviews_the_links_and_authority_before_applying(self):
        proposal = self.submit()
        other = self.submit(operation_id=uuid4(), mapping=[{"address": CAROL, "member": str(uuid4())}])
        self.client.force_login(self.reviewer)
        url = reverse("admin:tokens_registerwalletlink_review", args=[proposal.pk])
        response = self.client.get(url)
        self.assertContains(response, "Synthetic Director")
        self.assertContains(response, CAROL)
        self.assertContains(response, proposal.mapping[0]["member"])
        token = response.context["form"].initial["confirmation"]
        self.assertEqual(self.client.put(url).status_code, 405)
        response = self.client.post(url, {"confirmation": token, "decision": "apply"})
        self.assertContains(response, "explicit authority confirmation")
        response = self.client.post(url, {"confirmation": token, "decision": "apply", "reviewed": True})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(RegisterWalletLink.objects.get(pk=proposal.pk).status, "applied")
        self.assertTrue(RegisterMemberWallet.objects.filter(company=self.company, address=CAROL).exists())
        self.assertEqual(
            self.client.post(
                reverse("admin:tokens_registerwalletlink_change", args=[proposal.pk]), {"reason": "rewrite"}
            ).status_code,
            405,
        )
        response = self.client.get(reverse("admin:tokens_registerwalletlink_review", args=[other.pk]))
        self.assertContains(response, "already linked")
        model_admin = admin.site._registry[RegisterWalletLink]
        self.assertFalse(model_admin.has_delete_permission(None, proposal))
        self.assertFalse(model_admin.has_add_permission(None))
        self.assertTrue(
            set(field.name for field in RegisterWalletLink._meta.fields) - {"file"} <= set(model_admin.readonly_fields)
        )


class RegisterWalletLinkApiTest(APITransactionTestCase):
    def setUp(self):
        self.owner, self.company, _, self.reviewer, self.document = link_fixture()
        self.client.force_authenticate(self.owner)
        self.payload = link_payload(self.company, self.document)
        self.url = reverse("tokens:register-links-list")

    def test_external_issuer_submission_and_private_read_contract(self):
        response = self.client.post(self.url, self.payload, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        row = response.json()
        self.assertEqual((row["status"], row["mapping"][0]["address"]), ("submitted", CAROL))
        self.assertNotIn("file", row)
        detail = reverse("tokens:register-links-detail", args=[row["uuid"]])
        self.assertEqual(self.client.get(detail).status_code, 200)
        self.assertEqual(self.client.get(reverse("tokens:register-links-file", args=[row["uuid"]])).status_code, 200)
        self.assertEqual(self.client.patch(detail, {"reason": "rewrite"}).status_code, 405)
        self.assertEqual(self.client.delete(detail).status_code, 405)
        self.assertEqual(
            self.client.post(self.url, {**self.payload, "reason": "other"}, format="json").status_code, 409
        )
        self.assertEqual(
            self.client.post(
                self.url, {**self.payload, "operation_id": uuid4(), "mapping": []}, format="json"
            ).status_code,
            400,
        )
        stranger, _, _, _, _, _ = register_fixture()
        self.client.force_authenticate(stranger)
        self.assertEqual(self.client.get(detail).status_code, 404)
        self.assertEqual(self.client.get(self.url).json()["results"], [])
        self.assertEqual(
            self.client.post(self.url, {**self.payload, "operation_id": uuid4()}, format="json").status_code, 404
        )
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(detail).status_code, 401)
        self.assertEqual(self.client.post(self.url, self.payload, format="json").status_code, 401)


class RegisterWalletLinkMigrationTest(TransactionTestCase):
    def test_downgrade_refuses_to_discard_link_requests(self):
        owner, company, _, _, document = link_fixture()
        submit_link(actor=owner, **link_payload(company, document))
        migration = importlib.import_module("tokens.migrations.0067_register_wallet_links")
        with self.assertRaisesRegex(RuntimeError, "Retain wallet link requests"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.remove_guards(None, editor)
        self.assertTrue(RegisterWalletLink.objects.filter(company=company).exists())
