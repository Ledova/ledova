import importlib
from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.db import DatabaseError, connections
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.test import APITestCase

from companies.models import Company, CompanyDocument
from companies.services.document_review import prepare_document_review, verify_document
from companies.tests.test_document_file_access import (
    ADMIN_STORAGES,
    attach_file,
    make_document,
)
from shared.db import atomic, current_alias
from shared.tests.schema import migrate_to, restore_every_migration
from tokens.exceptions import RegisterChangeConflict
from tokens.models import RegisterCorrection, RegisterEntry
from tokens.services.register_corrections import (
    decide_correction,
    prepare_correction_review,
    submit_correction,
)
from tokens.services.register_events import record_entry, verify_register
from tokens.tests.test_register_events import DAY, register_fixture


def correction_fixture():
    owner, company, token, member, other, opening = register_fixture()
    owner.is_staff = False
    owner.save(update_fields=["is_staff"])
    reviewer = get_user_model().objects.create_user(
        email=f"correction-{uuid4()}@example.test", is_active=True, is_staff=True
    )
    reviewer.user_permissions.add(
        *Permission.objects.filter(
            codename__in=["change_companydocument", "change_registercorrection", "view_registercorrection"]
        )
    )
    document = attach_file(make_document(company))
    _, confirmation = prepare_document_review(document_id=document.pk, reviewer=reviewer)
    verify_document(document_id=document.pk, reviewer=reviewer, confirmation=confirmation)
    issue = record_entry(
        register_id=opening.register_id,
        operation_id=uuid4(),
        kind="issue",
        changes=[{"member": str(member.pk), "shares": "5"}],
        effective_on=DAY,
        recorded_by=reviewer,
    )
    return owner, reviewer, document, issue


def correction_payload(document, issue):
    return {
        "operation_id": uuid4(),
        "corrects_id": issue.pk,
        "document_id": document.pk,
        "effective_on": DAY,
        "authority": "director_resolution",
        "approving_director": "Synthetic Director",
        "authority_reference": "SYNTHETIC-RESOLUTION-1",
        "reason": "Duplicate allotment recorded in the synthetic register",
    }


class RegisterCorrectionTest(TestCase):
    def setUp(self):
        self.owner, self.reviewer, self.document, self.issue = correction_fixture()
        self.payload = correction_payload(self.document, self.issue)

    def submit(self, **changes):
        return submit_correction(actor=self.owner, **{**self.payload, **changes})

    def review(self, proposal):
        return prepare_correction_review(proposal_id=proposal.pk, reviewer=self.reviewer)[1]

    def apply(self, proposal, **changes):
        return decide_correction(
            **{
                "proposal_id": proposal.pk,
                "reviewer": self.reviewer,
                "confirmation": self.review(proposal),
                "decision": "apply",
                **changes,
            }
        )

    def test_exact_evidence_and_inverse_apply_atomically_and_retry_once(self):
        proposal = self.submit()
        self.assertEqual(proposal.changes, [{"member": self.issue.changes[0]["member"], "shares": "-5"}])
        self.assertNotEqual(proposal.file.name, self.document.file.name)
        with proposal.file.open("rb") as saved, self.document.file.open("rb") as original:
            self.assertEqual(saved.read(), original.read())
        self.assertEqual(self.submit().pk, proposal.pk)
        confirmation = self.review(proposal)
        applied = self.apply(proposal, confirmation=confirmation)
        self.assertEqual(applied.status, "applied")
        self.assertEqual(applied.applied_entry.corrects_id, self.issue.pk)
        self.assertEqual(applied.applied_entry.operation_id, proposal.pk)
        self.assertEqual(applied.applied_entry.previous_hash, proposal.base_hash)
        self.assertEqual(applied.reviewed_by, self.reviewer)
        again = decide_correction(
            proposal_id=proposal.pk, reviewer=self.reviewer, confirmation=confirmation, decision="apply"
        )
        self.assertEqual(again.applied_entry_id, applied.applied_entry_id)
        self.assertEqual(verify_register(proposal.register_id)["issued_supply"], "100")
        self.assertEqual(RegisterEntry.objects.filter(register_id=proposal.register_id).count(), 3)

    def test_conflicting_uuid_reuse_and_second_correction_refused(self):
        proposal = self.submit()
        for change in (
            {"reason": "Other intent"},
            {"effective_on": DAY + timedelta(days=1)},
            {"approving_director": "Other Director"},
        ):
            with self.subTest(change=change), self.assertRaises(RegisterChangeConflict):
                self.submit(**change)
        self.apply(proposal)
        with self.assertRaises(ValidationError):
            self.submit(operation_id=uuid4())

    def test_court_authority_is_distinct_and_resolution_requires_director(self):
        with self.assertRaises(ValidationError):
            self.submit(approving_director="")
        with self.assertRaises(ValidationError):
            self.submit(authority="court_order")
        proposal = self.submit(authority="court_order", approving_director="", authority_reference="SYNTHETIC-COURT-1")
        self.assertEqual(self.apply(proposal).authority, "court_order")

    def test_raw_updates_deletes_and_fabricated_decisions_are_refused(self):
        proposal = self.submit()
        for changes in (
            {"reason": "Rewritten"},
            {"changes": []},
            {"file": "elsewhere"},
            {
                "status": "applied",
                "reviewed_at": timezone.now(),
                "reviewed_by": self.reviewer,
                "applied_entry": self.issue,
            },
            {"status": "rejected", "reviewed_at": timezone.now(), "reviewed_by": self.owner, "rejection_reason": "x"},
        ):
            with self.subTest(changes=changes), self.assertRaises(DatabaseError), atomic():
                RegisterCorrection.objects.filter(pk=proposal.pk).update(**changes)
        with self.assertRaises(DatabaseError), atomic():
            proposal.delete()
        self.assertTrue(proposal.file.storage.exists(proposal.file.name))
        applied = self.apply(proposal)
        with self.assertRaises(DatabaseError), atomic():
            RegisterCorrection.objects.filter(pk=proposal.pk).update(reviewed_at=timezone.now())
        self.assertEqual(applied.status, "applied")

    def test_raw_submission_requires_current_revision_exact_inverse_and_verified_company(self):
        proposal = self.submit()
        for changes in (
            {"changes": []},
            {"base_hash": "0" * 64},
            {"status": "applied"},
            {"evidence_fingerprint": "0" * 64},
            {"submitted_by": self.reviewer},
        ):
            clone = RegisterCorrection.objects.get(pk=proposal.pk)
            clone.pk = uuid4()
            clone.file.name = f"companies/{clone.company_id}/register-corrections/{clone.pk}/{uuid4()}.bin"
            for key, value in changes.items():
                setattr(clone, key, value)
            with self.subTest(changes=changes), self.assertRaises(DatabaseError), atomic():
                clone.save(force_insert=True)

    def test_new_register_entry_invalidates_a_preview_without_applying(self):
        proposal = self.submit()
        confirmation = self.review(proposal)
        record_entry(
            register_id=proposal.register_id,
            operation_id=uuid4(),
            kind="issue",
            changes=self.issue.changes,
            effective_on=DAY,
            recorded_by=self.reviewer,
        )
        with self.assertRaisesMessage(ValidationError, "register changed"):
            decide_correction(
                proposal_id=proposal.pk, reviewer=self.reviewer, confirmation=confirmation, decision="apply"
            )
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, "submitted")
        self.assertEqual(verify_register(proposal.register_id)["issued_supply"], "110")

    def test_changed_source_and_retained_bytes_cannot_authorize_application(self):
        proposal = self.submit()
        confirmation = self.review(proposal)
        for field in (self.document.file, proposal.file):
            with field.open("rb") as source:
                original = source.read()
            with field.storage.open(field.name, "wb") as target:
                target.write(original[:-1] + b"X")
            with self.assertRaises(ValidationError):
                decide_correction(
                    proposal_id=proposal.pk, reviewer=self.reviewer, confirmation=confirmation, decision="apply"
                )
            with field.storage.open(field.name, "wb") as target:
                target.write(original)
        self.assertEqual(self.apply(proposal).status, "applied")

    def test_company_and_document_metadata_changes_invalidate_review(self):
        proposal = self.submit()
        confirmation = self.review(proposal)
        Company.objects.filter(pk=proposal.company_id).update(name="Changed identity")
        with self.assertRaises(ValidationError):
            decide_correction(
                proposal_id=proposal.pk, reviewer=self.reviewer, confirmation=confirmation, decision="apply"
            )
        self.document.refresh_from_db()
        _, fresh = prepare_document_review(document_id=self.document.pk, reviewer=self.reviewer)
        verify_document(document_id=self.document.pk, reviewer=self.reviewer, confirmation=fresh)
        with self.assertRaises(ValidationError):
            self.review(proposal)

    def test_deleted_source_retains_proposal_but_requires_rejection(self):
        proposal = self.submit()
        with self.captureOnCommitCallbacks(execute=True):
            self.document.delete()
        self.assertTrue(proposal.file.storage.exists(proposal.file.name))
        with self.assertRaises(ValidationError):
            self.review(proposal)
        result = decide_correction(
            proposal_id=proposal.pk,
            reviewer=self.reviewer,
            confirmation="",
            decision="reject",
            rejection_reason="Source withdrawn",
        )
        self.assertEqual(result.status, "rejected")
        self.assertIsNone(result.applied_entry_id)
        self.assertEqual(verify_register(result.register_id)["issued_supply"], "105")

    def test_legacy_unverified_expired_wrong_company_and_missing_files_refused(self):
        CompanyDocument.objects.filter(pk=self.document.pk).update(is_verified=False)
        with self.assertRaises(ValidationError):
            self.submit()
        with self.assertRaises(NotFound):
            self.submit(document_id=uuid4())
        self.document.file.delete(save=False)
        with self.assertRaises(ValidationError):
            self.submit()
        _, _, foreign_doc, _ = correction_fixture()
        with self.assertRaises(NotFound):
            self.submit(document_id=foreign_doc.pk)

    def test_actor_permission_revocation_wrong_reviewer_and_expired_confirmation(self):
        proposal = self.submit()
        confirmation = self.review(proposal)
        with self.assertRaises(PermissionDenied):
            prepare_correction_review(proposal_id=proposal.pk, reviewer=self.owner)
        self.reviewer.user_permissions.clear()
        with self.assertRaises(PermissionDenied):
            decide_correction(
                proposal_id=proposal.pk, reviewer=self.reviewer, confirmation=confirmation, decision="apply"
            )
        self.reviewer.user_permissions.add(Permission.objects.get(codename="change_registercorrection"))
        for token in ("forged",):
            with self.assertRaises(ValidationError):
                decide_correction(proposal_id=proposal.pk, reviewer=self.reviewer, confirmation=token, decision="apply")
        with patch("django.core.signing.time.time", return_value=timezone.now().timestamp() + 901), self.assertRaises(
            ValidationError
        ):
            decide_correction(
                proposal_id=proposal.pk, reviewer=self.reviewer, confirmation=confirmation, decision="apply"
            )

    def test_confirmation_cannot_be_used_by_another_permitted_reviewer_or_for_another_proposal(self):
        proposal = self.submit()
        confirmation = self.review(proposal)
        other = get_user_model().objects.create_user(email="other-reviewer@example.test", is_active=True, is_staff=True)
        other.user_permissions.add(Permission.objects.get(codename="change_registercorrection"))
        with self.assertRaisesMessage(ValidationError, "another proposal or reviewer"):
            decide_correction(proposal_id=proposal.pk, reviewer=other, confirmation=confirmation, decision="apply")
        another = self.submit(operation_id=uuid4())
        with self.assertRaisesMessage(ValidationError, "another proposal or reviewer"):
            decide_correction(
                proposal_id=another.pk, reviewer=self.reviewer, confirmation=confirmation, decision="apply"
            )

    def test_validity_expiry_and_deleted_reviewer_invalidate_pending_authority(self):
        self.document.valid_until = timezone.localdate() + timedelta(days=1)
        self.document.save(update_fields=["valid_until"])
        _, token = prepare_document_review(document_id=self.document.pk, reviewer=self.reviewer)
        verify_document(document_id=self.document.pk, reviewer=self.reviewer, confirmation=token)
        proposal = self.submit()
        with patch(
            "companies.services.document_review.timezone.localdate",
            return_value=timezone.localdate() + timedelta(days=2),
        ):
            with self.assertRaises(ValidationError):
                self.review(proposal)
        CompanyDocument.objects.filter(pk=self.document.pk).update(verified_by=None)
        with self.assertRaises(ValidationError):
            self.review(proposal)

    def test_approval_write_failure_rolls_back_event_and_projection(self):
        proposal = self.submit()
        confirmation = self.review(proposal)
        with patch.object(RegisterCorrection, "save", side_effect=RuntimeError("write failed")), self.assertRaises(
            RuntimeError
        ):
            decide_correction(
                proposal_id=proposal.pk, reviewer=self.reviewer, confirmation=confirmation, decision="apply"
            )
        self.assertEqual(verify_register(proposal.register_id)["issued_supply"], "105")
        self.assertFalse(RegisterEntry.objects.filter(operation_id=proposal.pk).exists())
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, "submitted")

    @override_settings(STORAGES=ADMIN_STORAGES)
    def test_admin_confirms_authority_and_has_no_mutable_record_or_delete_action(self):
        proposal = self.submit()
        self.client.force_login(self.reviewer)
        url = reverse("admin:tokens_registercorrection_review", args=[proposal.pk])
        response = self.client.get(url)
        self.assertContains(response, "Synthetic Director")
        token = response.context["form"].initial["confirmation"]
        self.assertEqual(self.client.put(url).status_code, 405)
        response = self.client.post(url, {"confirmation": token, "decision": "apply"})
        self.assertContains(response, "explicit authority confirmation")
        response = self.client.post(url, {"confirmation": token, "decision": "apply", "reviewed": True})
        self.assertEqual(response.status_code, 302)
        self.assertEqual(
            self.client.post(
                reverse("admin:tokens_registercorrection_change", args=[proposal.pk]), {"reason": "rewrite"}
            ).status_code,
            405,
        )
        proposal.refresh_from_db()
        self.assertEqual(proposal.status, "applied")
        model_admin = admin.site._registry[RegisterCorrection]
        self.assertFalse(model_admin.has_delete_permission(None, proposal))
        self.assertFalse(model_admin.has_add_permission(None))
        self.assertTrue(
            set(field.name for field in RegisterCorrection._meta.fields) - {"file"} <= set(model_admin.readonly_fields)
        )


class RegisterCorrectionApiTest(APITestCase):
    def setUp(self):
        self.owner, self.reviewer, self.document, self.issue = correction_fixture()
        self.client.force_authenticate(self.owner)
        self.payload = correction_payload(self.document, self.issue)
        self.url = reverse("tokens:register-corrections-list")

    def test_external_issuer_submission_and_private_read_contract(self):
        response = self.client.post(self.url, self.payload, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        row = response.json()
        self.assertEqual(row["status"], "submitted")
        self.assertNotIn("file", row)
        detail = reverse("tokens:register-corrections-detail", args=[row["uuid"]])
        self.assertEqual(self.client.get(detail).status_code, 200)
        self.assertEqual(self.client.patch(detail, {"reason": "rewrite"}).status_code, 405)
        self.assertEqual(self.client.delete(detail).status_code, 405)
        self.assertEqual(
            self.client.post(self.url, {**self.payload, "reason": "other"}, format="json").status_code, 409
        )
        self.client.force_authenticate(None)
        self.assertEqual(self.client.get(detail).status_code, 401)
        self.assertEqual(self.client.post(self.url, self.payload, format="json").status_code, 401)


class RegisterCorrectionMigrationTest(TransactionTestCase):
    def test_upgrade_preserves_register_history_without_fabricated_proposals(self):
        try:
            migrate_to([("tokens", "0063_swap_finalized_receipt")])
            owner, company, token, member, other, opening = register_fixture()
            original_hash = opening.entry_hash
            restore_every_migration()
            self.assertEqual(RegisterEntry.objects.get(pk=opening.pk).entry_hash, original_hash)
            self.assertFalse(RegisterCorrection.objects.exists())
        finally:
            restore_every_migration()

    def test_downgrade_refuses_to_discard_existing_proposals(self):
        owner, reviewer, document, issue = correction_fixture()
        proposal = submit_correction(actor=owner, **correction_payload(document, issue))
        migration = importlib.import_module("tokens.migrations.0064_reviewed_register_corrections")
        with self.assertRaisesRegex(RuntimeError, "Retain correction"), atomic():
            with connections[current_alias()].schema_editor() as editor:
                migration.remove_guards(None, editor)
        self.assertTrue(RegisterCorrection.objects.filter(pk=proposal.pk).exists())
