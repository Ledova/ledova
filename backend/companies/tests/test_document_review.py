from datetime import timedelta
from unittest.mock import patch

from django.contrib import admin
from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core import signing
from django.db import connections
from django.http import Http404
from django.test import RequestFactory, TestCase, TransactionTestCase, override_settings
from django.urls import reverse
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from companies.admin.document import CompanyDocumentAdmin
from companies.models import Company, CompanyDocument
from companies.services.document_review import prepare_document_review, verify_document
from companies.tests.test_document_file_access import (
    ADMIN_STORAGES,
    attach_file,
    make_company,
    make_document,
)
from shared.db import atomic, current_alias
from shared.tests.schema import migrate_to, restore_every_migration


def review_fixture():
    owner, company = make_company("content-owner", "123456780")
    reviewer = get_user_model().objects.create_user(email="reviewer@example.test", is_staff=True, is_active=True)
    reviewer.user_permissions.add(Permission.objects.get(codename="change_companydocument"))
    return owner, company, reviewer, attach_file(make_document(company))


class CompanyDocumentReviewTest(TestCase):
    def setUp(self):
        self.owner, self.company, self.reviewer, self.document = review_fixture()

    def preview(self):
        return prepare_document_review(document_id=self.document.pk, reviewer=self.reviewer)[1]

    def verify(self, confirmation=None):
        return verify_document(
            document_id=self.document.pk, reviewer=self.reviewer, confirmation=confirmation or self.preview()
        )

    def test_verification_records_the_reviewed_content_company_and_actor(self):
        confirmation = self.preview()
        before = timezone.now()
        document = self.verify(confirmation)
        self.assertTrue(document.is_verified)
        self.assertEqual(document.verified_by_id, self.reviewer.pk)
        self.assertGreaterEqual(document.verified_at, before)
        self.assertEqual(
            document.verified_fingerprint,
            signing.loads(confirmation, salt="companies.document-review")["fingerprint"],
        )
        self.assertEqual(len(document.verified_fingerprint), 64)

    def test_same_size_replaced_bytes_refuse_the_old_confirmation(self):
        confirmation = self.preview()
        with self.document.file.open("rb") as source:
            original = source.read()
        with self.document.file.storage.open(self.document.file.name, "wb") as target:
            target.write(original[:-1] + (b"X" if original[-1:] != b"X" else b"Y"))
        with self.assertRaisesMessage(ValidationError, "changed"):
            self.verify(confirmation)
        self.document.refresh_from_db()
        self.assertFalse(self.document.is_verified)
        self.assertTrue(self.verify().is_verified)

    def test_relevant_metadata_changes_invalidate_verification_and_stale_reviews(self):
        _, other = make_company("content-other", "987654320")
        changes = {
            "company_id": other.pk,
            "document_type": "other",
            "name": "Different instrument",
            "mime_type": "application/octet-stream",
            "external_url": "https://example.test/revised.pdf",
            "valid_from": timezone.localdate() - timedelta(days=1),
            "valid_until": timezone.localdate() + timedelta(days=1),
        }
        for field, value in changes.items():
            with self.subTest(field=field):
                self.verify()
                confirmation = self.preview()
                CompanyDocument.objects.filter(pk=self.document.pk).update(**{field: value})
                self.document.refresh_from_db()
                self.assertFalse(self.document.is_verified)
                self.assertEqual(self.document.verified_fingerprint, "")
                self.assertIsNone(self.document.verified_by_id)
                self.assertIsNone(self.document.verified_at)
                with self.assertRaisesMessage(ValidationError, "changed"):
                    self.verify(confirmation)
                self.assertTrue(self.verify().is_verified)

    def test_notes_do_not_revoke_verification_but_rejection_does(self):
        self.verify()
        CompanyDocument.objects.filter(pk=self.document.pk).update(notes="Staff follow-up")
        self.document.refresh_from_db()
        self.assertTrue(self.document.is_verified)
        CompanyDocument.objects.filter(pk=self.document.pk).update(rejection_reason="Authority not established")
        self.document.refresh_from_db()
        self.assertFalse(self.document.is_verified)
        with self.assertRaises(ValidationError):
            self.preview()

    def test_company_identity_changes_revoke_verification_and_refuse_old_confirmation(self):
        for field, value in {
            "name": "Changed Company Pty Ltd",
            "acn": "987654320",
            "abn": "51987654320",
            "company_type": "public",
            "owner_id": self.reviewer.pk,
        }.items():
            with self.subTest(field=field):
                self.verify()
                confirmation = self.preview()
                Company.objects.filter(pk=self.company.pk).update(**{field: value})
                self.document.refresh_from_db()
                self.assertFalse(self.document.is_verified)
                self.assertEqual(self.document.verified_fingerprint, "")
                with self.assertRaisesMessage(ValidationError, "changed"):
                    self.verify(confirmation)
                self.assertTrue(self.verify().is_verified)

    def test_legacy_null_reviewer_verification_survives_a_notes_only_update(self):
        historical = make_document(self.company, is_verified=True, verified_at=timezone.now())
        self.assertIsNone(historical.verified_by_id)
        CompanyDocument.objects.filter(pk=historical.pk).update(notes="Historical review remains unattributed")
        historical.refresh_from_db()
        self.assertTrue(historical.is_verified)
        self.assertIsNotNone(historical.verified_at)
        self.assertEqual(historical.verified_fingerprint, "")

    def test_missing_empty_mismatched_or_external_only_files_cannot_be_verified(self):
        self.verify()
        confirmation = self.preview()
        self.document.file.storage.delete(self.document.file.name)
        with self.assertRaises(ValidationError):
            self.verify(confirmation)
        for fields in ({"file": ""}, {"file_size": 1}, {"file_size": 0}):
            with self.subTest(fields=fields):
                document = attach_file(make_document(self.company))
                CompanyDocument.objects.filter(pk=document.pk).update(**fields)
                with self.assertRaises(ValidationError):
                    prepare_document_review(document_id=document.pk, reviewer=self.reviewer)

    def test_validity_is_rechecked_when_confirmed(self):
        today = timezone.localdate()
        self.document.valid_until = today
        self.document.save()
        confirmation = self.preview()
        with patch("companies.services.document_review.timezone.localdate", return_value=today + timedelta(days=1)):
            with self.assertRaises(ValidationError):
                self.verify(confirmation)

    def test_permission_revocation_and_inactive_or_nonstaff_reviewers_are_refused(self):
        confirmation = self.preview()
        self.reviewer.user_permissions.clear()
        with self.assertRaises(PermissionDenied):
            self.verify(confirmation)
        self.reviewer.user_permissions.add(Permission.objects.get(codename="change_companydocument"))
        for fields in ({"is_staff": False}, {"is_staff": True, "is_active": False}):
            get_user_model().objects.filter(pk=self.reviewer.pk).update(**fields)
            with self.assertRaises(PermissionDenied):
                self.verify(confirmation)

    def test_signed_confirmation_is_bound_to_reviewer_document_and_expiry(self):
        confirmation = self.preview()
        other = get_user_model().objects.create_superuser(email="other-reviewer@example.test", password="synthetic")
        with self.assertRaises(ValidationError):
            verify_document(document_id=self.document.pk, reviewer=other, confirmation=confirmation)
        other_document = attach_file(make_document(self.company))
        with self.assertRaises(ValidationError):
            verify_document(document_id=other_document.pk, reviewer=self.reviewer, confirmation=confirmation)
        with self.assertRaises(ValidationError):
            self.verify(confirmation + "tampered")
        with patch("companies.services.document_review.DOCUMENT_REVIEW_MAX_AGE", -1):
            with self.assertRaises(ValidationError):
                self.verify(confirmation)
        self.assertTrue(self.verify(confirmation).is_verified)

    def test_verification_rolls_back_with_its_transaction(self):
        with self.assertRaises(RuntimeError), atomic():
            self.verify()
            raise RuntimeError("rollback")
        self.document.refresh_from_db()
        self.assertFalse(self.document.is_verified)
        self.assertEqual(self.document.verified_fingerprint, "")


@override_settings(STORAGES=ADMIN_STORAGES)
class CompanyDocumentReviewAdminTest(TestCase):
    def setUp(self):
        self.owner, self.company, self.reviewer, self.document = review_fixture()
        self.url = reverse("admin:companies_companydocument_verify", args=[self.document.pk])
        self.client.force_login(self.reviewer)

    def test_staff_review_get_is_readonly_and_post_records_confirmation(self):
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertContains(response, "It does not approve a register change")
        self.document.refresh_from_db()
        self.assertFalse(self.document.is_verified)
        confirmation = response.context["form"].initial["confirmation"]
        self.assertEqual(self.client.post(self.url, {"confirmation": confirmation}).status_code, 200)
        self.document.refresh_from_db()
        self.assertFalse(self.document.is_verified)
        response = self.client.post(self.url, {"confirmation": confirmation, "reviewed": "on"})
        self.assertEqual(response.status_code, 302)
        self.document.refresh_from_db()
        self.assertTrue(self.document.is_verified)
        self.assertTrue(self.document.verified_fingerprint)
        self.assertEqual(self.client.put(self.url).status_code, 405)

    def test_anonymous_owner_and_staff_without_permission_cannot_review(self):
        self.client.logout()
        self.assertEqual(self.client.get(self.url).status_code, 302)
        other_owner, _ = make_company("unauthorised-other", "456789012")
        staff = get_user_model().objects.create_user(email="unprivileged@example.test", is_staff=True, is_active=True)
        for actor in (self.owner, other_owner, staff):
            self.client.force_login(actor)
            for method in (self.client.get, self.client.post):
                with self.subTest(actor=actor.pk, method=method):
                    self.assertIn(method(self.url).status_code, (302, 403))
        self.document.refresh_from_db()
        self.assertFalse(self.document.is_verified)

    def test_object_permission_and_admin_queryset_are_enforced(self):
        with patch.object(
            CompanyDocumentAdmin, "has_change_permission", side_effect=lambda request, obj=None: obj is None
        ):
            self.assertEqual(self.client.post(self.url).status_code, 403)
        with patch.object(CompanyDocumentAdmin, "get_queryset", return_value=CompanyDocument.objects.none()):
            request = RequestFactory().get(self.url)
            request.user = self.reviewer
            model_admin = CompanyDocumentAdmin(CompanyDocument, admin.site)
            action = next(url for url in model_admin.get_urls() if url.name == "companies_companydocument_verify")
            with self.assertRaises(Http404):
                action.callback(request, uuid=self.document.pk)
        self.assertEqual(self.client.get(self.url).status_code, 200)

    def test_the_old_bulk_action_and_editable_verification_fields_are_removed(self):
        response = self.client.post(
            reverse("admin:companies_companydocument_change", args=[self.document.pk]),
            {
                "company": str(self.company.pk),
                "document_type": self.document.document_type,
                "name": self.document.name,
                "file_size": self.document.file_size,
                "mime_type": self.document.mime_type,
                "is_verified": "on",
                "verified_by": self.reviewer.pk,
                "verified_fingerprint": "a" * 64,
                "_save": "Save",
            },
        )
        self.assertEqual(response.status_code, 302)
        self.client.post(
            reverse("admin:companies_companydocument_changelist"),
            {"action": "verify_documents", "_selected_action": str(self.document.pk)},
        )
        self.document.refresh_from_db()
        self.assertFalse(self.document.is_verified)
        self.assertEqual(self.document.verified_fingerprint, "")
        self.assertIsNone(self.document.verified_by_id)
        self.assertIsNone(self.document.verified_at)

    def test_changed_evidence_redirects_with_no_verification(self):
        confirmation = self.client.get(self.url).context["form"].initial["confirmation"]
        CompanyDocument.objects.filter(pk=self.document.pk).update(name="Changed")
        response = self.client.post(self.url, {"confirmation": confirmation, "reviewed": "on"}, follow=True)
        self.assertContains(response, "changed after review began")
        self.document.refresh_from_db()
        self.assertFalse(self.document.is_verified)


class CompanyDocumentReviewMigrationTest(TransactionTestCase):
    def setUp(self):
        self.addCleanup(restore_every_migration)

    def test_upgrade_does_not_invent_verification_and_downgrade_refuses_bound_evidence(self):
        owner, company, reviewer, document = review_fixture()
        previous = [("companies", "0008_company_registry_verification")]
        historical = migrate_to(previous)
        old_document = historical.get_model("companies", "CompanyDocument")
        old_document.objects.filter(pk=document.pk).update(is_verified=True, verified_by_id=reviewer.pk)
        restore_every_migration()
        document.refresh_from_db()
        self.assertTrue(document.is_verified)
        self.assertEqual(document.verified_fingerprint, "")
        _, confirmation = prepare_document_review(document_id=document.pk, reviewer=reviewer)
        verify_document(document_id=document.pk, reviewer=reviewer, confirmation=confirmation)
        with self.assertRaisesMessage(RuntimeError, "Retain document verification"):
            migrate_to(previous)
        with connections[current_alias()].cursor() as cursor:
            cursor.execute("SELECT verified_fingerprint FROM companies_companydocument WHERE uuid = %s", [document.pk])
            self.assertTrue(cursor.fetchone()[0])
