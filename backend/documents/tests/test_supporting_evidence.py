import tempfile
from datetime import timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.core.files.base import ContentFile
from django.db.models import ProtectedError
from django.test import TestCase, TransactionTestCase, override_settings
from django.urls import NoReverseMatch, reverse
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

from documents.models import Document, DocumentExtraction, DocumentRead
from documents.services.document import attach_document, create_document
from documents.services.extraction import render_first_page, run_extraction
from documents.services.retention import purge_expired_documents
from documents.tasks.extract import extract_document
from operators.models import Operator
from shared.db import atomic, use_migrate
from shared.services.orphaned_files import orphaned_files
from shared.tests.evidence_retention import installed_evidence_retention_policy
from shared.tests.upload_fixtures import StubUploadDependencies, pdf_bytes
from users.models import InvestorClassification, UserAccount, UserProfile
from users.models.investor_classification import RETENTION_CLOCK

PDF = pdf_bytes()
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "private": {"BACKEND": "shared.storage.PrivateMediaStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


def evidence_owner(label):
    user = get_user_model().objects.create_user(email=f"{label}@example.test", password="pw-12345678")
    profile = UserProfile.objects.create(user=user)
    account = UserAccount.objects.create(user_profile=profile)
    return SimpleNamespace(user=user, profile=profile, account=account)


class EvidenceCase(StubUploadDependencies):
    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        settings = override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES)
        settings.enable()
        self.addCleanup(settings.disable)
        self.enterContext(installed_evidence_retention_policy())
        self.owner = evidence_owner("payslip-owner")
        self.other = evidence_owner("payslip-other")
        with use_migrate():
            self.claim = InvestorClassification.objects.create(
                user_account=self.owner.account,
                category="professional_investor",
                declaration_accepted=True,
                declaration_text="Synthetic declaration",
                submitted_at=timezone.now(),
            )
            self.document = Document.objects.create(
                uploaded_by=self.owner.user,
                original_filename="support.pdf",
                file=ContentFile(PDF, name="support.pdf"),
                mime_type="application/pdf",
            )

    def attach(self):
        with self.captureOnCommitCallbacks(execute=True):
            self.document = attach_document(self.document, self.claim.pk)
        return self.document

    def extraction(self):
        return DocumentExtraction.objects.create(
            document=self.document,
            status="succeeded",
            raw_output="synthetic private raw response",
            parsed_json={"gross_pay": "1234.00"},
        )

    def operations_user(self, label="payslip-ops"):
        user = get_user_model().objects.create_user(
            email=f"{label}@example.test", password="pw-12345678", is_staff=True, is_active=True, is_email_verified=True
        )
        group, _ = Group.objects.get_or_create(name="Document operations")
        group.permissions.add(
            *Permission.objects.filter(content_type__app_label="documents", codename__startswith="view_")
        )
        group.permissions.add(
            Permission.objects.get(content_type__app_label="users", codename="view_investorclassification")
        )
        user.groups.add(group)
        return user


class SupportingPayslipApiTest(EvidenceCase, APITestCase):
    def setUp(self):
        super().setUp()
        self.client.force_authenticate(self.owner.user)
        self.url = f"/api/v1/documents/{self.document.pk}/"

    def test_attaching_keeps_the_bytes_and_extraction_without_reviewing_the_claim(self):
        extraction = self.extraction()
        original_name = self.document.file.name
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(self.url + "attach/", {"classification": str(self.claim.pk)}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["classification"], str(self.claim.pk))
        self.assertTrue(response.json()["attachedAt"])
        self.document.refresh_from_db()
        self.claim.refresh_from_db()
        extraction.refresh_from_db()
        self.assertEqual(self.claim.status, "submitted")
        self.assertIsNone(self.claim.reviewed_at)
        self.assertFalse(self.claim.is_live)
        self.assertTrue(self.document.file.name.startswith("users/supporting-documents/"))
        self.assertFalse((self.root / original_name).exists())
        self.assertEqual((self.root / self.document.file.name).read_bytes(), PDF)
        self.assertEqual(extraction.raw_output, "synthetic private raw response")
        self.assertEqual(orphaned_files(moment=timezone.now() + timedelta(days=3650)), [])

    @patch("documents.services.document.extract_document.defer")
    def test_upload_can_attach_to_an_existing_claim(self, defer):
        with self.captureOnCommitCallbacks(execute=True):
            response = self.client.post(
                "/api/v1/documents/",
                {"file": ContentFile(PDF, name="another.pdf"), "classification": str(self.claim.pk)},
                format="multipart",
            )
        self.assertEqual(response.status_code, 202, response.content)
        self.assertEqual(response.json()["classification"], str(self.claim.pk))
        self.assertIsNone(response.json()["latestExtraction"])
        defer.assert_called_once_with(document_uuid=response.json()["uuid"], principal_id=self.owner.user.pk)

    def test_neither_a_foreign_document_nor_a_foreign_claim_can_be_attached(self):
        self.client.force_authenticate(self.other.user)
        response = self.client.post(self.url + "attach/", {"classification": str(self.claim.pk)}, format="json")
        self.assertEqual(response.status_code, 404)
        self.client.force_authenticate(self.owner.user)
        with use_migrate():
            foreign = InvestorClassification.objects.create(
                user_account=self.other.account, category="professional_investor"
            )
        response = self.client.post(self.url + "attach/", {"classification": str(foreign.pk)}, format="json")
        self.assertEqual(response.status_code, 404)
        self.document.refresh_from_db()
        self.assertIsNone(self.document.classification_id)

    def test_a_reviewed_or_withdrawn_claim_does_not_accept_new_evidence(self):
        for status in RETENTION_CLOCK:
            with self.subTest(status=status):
                with use_migrate():
                    InvestorClassification.objects.filter(pk=self.claim.pk).update(status=status)
                response = self.client.post(self.url + "attach/", {"classification": str(self.claim.pk)}, format="json")
                self.assertEqual(response.status_code, 400, response.content)

    def test_attached_evidence_cannot_be_retargeted_or_deleted(self):
        self.attach()
        self.assertEqual(self.client.delete(self.url).status_code, 400)
        with use_migrate():
            other_claim = InvestorClassification.objects.create(
                user_account=self.owner.account, category="professional_investor", status="withdrawn"
            )
        response = self.client.post(self.url + "attach/", {"classification": str(other_claim.pk)}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("already attached", str(response.json()))
        self.document.refresh_from_db()
        self.assertEqual(self.document.classification_id, self.claim.pk)
        self.assertEqual(
            self.client.post(self.url + "attach/", {"classification": str(self.claim.pk)}, format="json").status_code,
            200,
        )

    def test_user_and_document_cascades_cannot_remove_retained_content(self):
        self.attach()
        for target in (self.document, self.owner.user, self.claim):
            with self.subTest(target=type(target).__name__), self.assertRaises(ProtectedError), atomic():
                target.delete()
        self.assertEqual((self.root / self.document.file.name).read_bytes(), PDF)

    def test_a_failed_copy_preserves_the_original_unattached_file(self):
        with patch.object(type(self.document.file.storage), "save", side_effect=OSError("copy unavailable")):
            with self.assertRaises(OSError):
                self.attach()
        self.document.refresh_from_db()
        self.assertIsNone(self.document.classification_id)
        self.assertEqual((self.root / self.document.file.name).read_bytes(), PDF)

    def test_attachment_between_start_and_render_keeps_the_extraction_input_available(self):
        original_name = self.document.file.name
        render = render_first_page

        def attach_then_render(raw):
            self.attach()
            self.assertFalse((self.root / original_name).exists())
            return render(raw)

        import fitz

        pdf = fitz.open()
        pdf.new_page().insert_text((72, 72), "Synthetic supporting payslip")
        with use_migrate():
            self.document.file.save("synthetic.pdf", ContentFile(pdf.tobytes()), save=True)
        pdf.close()
        original_name = self.document.file.name
        with (
            patch("documents.services.extraction.render_first_page", side_effect=attach_then_render),
            patch("documents.services.extraction.LlmExtractClient") as llm,
        ):
            llm.return_value.extract.return_value = SimpleNamespace(
                parsed=SimpleNamespace(model_dump=lambda **kwargs: {"gross_pay": "1"}),
                raw_output="synthetic extraction",
                duration_ms=1,
                model_used="synthetic",
            )
            result = run_extraction(self.document)
        self.assertEqual(result.status, "succeeded", result.error)
        self.assertTrue(llm.return_value.extract.call_args.kwargs["image_bytes"].startswith(b"\x89PNG"))

    @patch("documents.services.document.extract_document.defer")
    def test_document_routes_work_without_reading_operator_configuration(self, defer):
        operator = Operator.get()
        self.assertEqual(operator.pk, 1)
        with patch.object(Operator.objects, "values_list", side_effect=AssertionError("Operator lookup")):
            listing = self.client.get("/api/v1/documents/")
            detail = self.client.get(self.url)
            self.assertEqual((listing.status_code, detail.status_code), (200, 200))
            self.assertEqual(detail.json()["uuid"], str(self.document.pk))
            self.assertEqual(listing.json()["results"][0]["uuid"], str(self.document.pk))
            uploaded = self.client.post(
                "/api/v1/documents/",
                {"file": ContentFile(PDF, name="new.pdf")},
                format="multipart",
            )
            self.assertEqual(uploaded.status_code, 202, uploaded.content)
            uploaded_url = f"/api/v1/documents/{uploaded.json()['uuid']}/"
            self.assertEqual(self.client.delete(uploaded_url).status_code, 204)
            self.assertEqual(
                self.client.post(
                    self.url + "attach/", {"classification": str(self.claim.pk)}, format="json"
                ).status_code,
                200,
            )
        defer.assert_called_once_with(document_uuid=uploaded.json()["uuid"], principal_id=self.owner.user.pk)
        self.document.refresh_from_db()
        self.assertEqual(self.document.classification_id, self.claim.pk)
        self.assertEqual((self.root / self.document.file.name).read_bytes(), PDF)


class SupportingPayslipAdminTest(EvidenceCase, TestCase):
    def test_document_view_permission_does_not_grant_raw_extraction_access(self):
        extraction = self.extraction()
        reviewer = get_user_model().objects.create_user(
            email="document-only@example.test",
            password="pw-12345678",
            is_staff=True,
            is_active=True,
            is_email_verified=True,
        )
        reviewer.user_permissions.add(
            Permission.objects.get(content_type__app_label="documents", codename="view_document")
        )
        client = APIClient()
        client.force_login(reviewer)
        self.assertEqual(
            client.get(reverse("admin:documents_document_change", args=[self.document.pk])).status_code, 200
        )
        for url in (
            reverse("admin:documents_documentextraction_change", args=[extraction.pk]),
            reverse("admin:documents_documentextraction_changelist"),
        ):
            response = client.get(url)
            self.assertEqual(response.status_code, 403)
            self.assertNotContains(response, "synthetic private raw response", status_code=403)
        self.assertFalse(DocumentRead.objects.filter(actor_id=reviewer.pk, kind="extraction").exists())

    def test_the_claim_links_to_an_audited_worklist_without_granting_a_review_decision(self):
        self.attach()
        reviewer = self.operations_user()
        self.client.force_login(reviewer)
        response = self.client.get(reverse("admin:users_investorclassification_change", args=[self.claim.pk]))
        self.assertEqual(response.status_code, 200)
        worklist = reverse("admin:documents_document_changelist") + f"?classification__exact={self.claim.pk}"
        self.assertContains(response, worklist)
        self.assertFalse(DocumentRead.objects.exists())
        response = self.client.get(worklist)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertContains(response, self.document.original_filename)
        self.assertTrue(
            DocumentRead.objects.filter(actor_id=reviewer.pk, document_uuid=self.document.pk, kind="document").exists()
        )
        with self.assertRaises(NoReverseMatch):
            reverse("admin:users_investorclassification_transition", args=[self.claim.pk, "verify"])
        denied = self.client.post(
            reverse("admin:users_investorclassification_change", args=[self.claim.pk]), {"status": "verified"}
        )
        self.assertEqual(denied.status_code, 403)
        self.claim.refresh_from_db()
        self.assertEqual(self.claim.status, "submitted")
        self.assertIsNone(self.claim.reviewed_by_id)
        self.assertIsNone(self.claim.reviewed_at)
        self.assertEqual((self.root / self.document.file.name).read_bytes(), PDF)

    def test_operations_reads_of_metadata_file_and_raw_extraction_are_recorded(self):
        self.attach()
        extraction = self.extraction()
        reviewer = self.operations_user()
        self.client.force_login(reviewer)
        paths = [
            ("document", "admin:documents_document_change", self.document.pk),
            ("file", "admin:documents_document_file", self.document.pk),
            ("extraction", "admin:documents_documentextraction_change", extraction.pk),
        ]
        for kind, name, pk in paths:
            response = self.client.get(reverse(name, args=[pk]))
            self.assertEqual(response.status_code, 200, getattr(response, "content", b""))
            self.assertTrue(
                DocumentRead.objects.filter(
                    actor_id=reviewer.pk, document_uuid=self.document.pk, classification_uuid=self.claim.pk, kind=kind
                ).exists()
            )
            if kind == "extraction":
                self.assertContains(response, "synthetic private raw response")
            if kind == "file":
                self.assertEqual(b"".join(response.streaming_content), PDF)
        self.assertEqual(DocumentRead.objects.count(), 3)

    def test_issuers_and_staff_without_permission_cannot_read_other_peoples_evidence(self):
        extraction = self.extraction()
        issuer = self.owner.user
        issuer.is_staff = True
        issuer.is_active = True
        issuer.is_email_verified = True
        issuer.save(update_fields=["is_staff", "is_active", "is_email_verified"])
        self.owner.account.role = "company"
        self.owner.account.save(update_fields=["role"])
        group_user = self.operations_user()
        issuer.groups.add(*group_user.groups.all())
        unpermitted = get_user_model().objects.create_user(
            email="no-doc-permission@example.test",
            password="pw-12345678",
            is_staff=True,
            is_active=True,
            is_email_verified=True,
        )
        for user in (issuer, unpermitted):
            self.client.force_login(user)
            for name, pk in (
                ("admin:documents_document_change", self.document.pk),
                ("admin:documents_document_file", self.document.pk),
                ("admin:documents_documentextraction_change", extraction.pk),
            ):
                response = self.client.get(reverse(name, args=[pk]))
                self.assertEqual(response.status_code, 403)
                self.assertNotIn(b"synthetic private", response.content)
        self.assertFalse(DocumentRead.objects.exists())

    def test_a_failed_audit_write_prevents_the_file_read(self):
        reviewer = self.operations_user()
        self.client.force_login(reviewer)
        with patch(
            "documents.services.access.DocumentRead.objects.create", side_effect=RuntimeError("audit unavailable")
        ):
            with self.assertRaises(RuntimeError):
                self.client.get(reverse("admin:documents_document_file", args=[self.document.pk]))

    def test_review_and_extraction_work_without_reading_operator_configuration(self):
        reviewer = self.operations_user()
        previous_extraction = self.extraction()
        self.client.force_login(reviewer)
        with (
            patch.object(Operator.objects, "values_list", side_effect=AssertionError("Operator lookup")),
            patch("documents.services.extraction.render_first_page", return_value=b"synthetic image"),
            patch("documents.services.extraction.LlmExtractClient") as llm,
        ):
            for name, pk in (
                ("admin:documents_document_change", self.document.pk),
                ("admin:documents_document_file", self.document.pk),
                ("admin:documents_documentextraction_change", previous_extraction.pk),
            ):
                response = self.client.get(reverse(name, args=[pk]))
                self.assertEqual(response.status_code, 200)
                if getattr(response, "streaming", False):
                    self.assertEqual(b"".join(response.streaming_content), PDF)
            llm.return_value.extract.return_value = SimpleNamespace(
                parsed=SimpleNamespace(model_dump=lambda **kwargs: {"gross_pay": "1"}),
                raw_output="synthetic extraction",
                duration_ms=1,
                model_used="synthetic",
            )
            result = extract_document(document_uuid=str(self.document.pk), principal_id=self.document.uploaded_by_id)
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(DocumentExtraction.objects.count(), 2)
        previous_extraction.refresh_from_db()
        self.assertEqual(previous_extraction.raw_output, "synthetic private raw response")
        self.assertEqual(DocumentRead.objects.count(), 3)


@override_settings(CLASSIFICATION_EVIDENCE_RETENTION_DAYS=30, UNATTACHED_DOCUMENT_RETENTION_DAYS=7)
class SupportingPayslipRetentionTest(EvidenceCase, TestCase):
    def test_file_and_extraction_reads_stop_at_the_horizon_before_the_sweep(self):
        self.attach()
        self.extraction()
        horizon = timezone.now()
        with use_migrate():
            InvestorClassification.objects.filter(pk=self.claim.pk).update(
                status="withdrawn", reviewed_at=horizon - timedelta(days=30)
            )
        client = APIClient()
        client.force_authenticate(self.owner.user)
        with patch("django.utils.timezone.now", return_value=horizon):
            self.assertFalse(Document.objects.with_available_content().filter(pk=self.document.pk).exists())
            self.document.refresh_from_db()
            self.assertFalse(self.document.content_available)
            self.assertEqual(client.get(f"/api/v1/documents/{self.document.pk}/").status_code, 404)
        self.assertTrue(self.document.file.storage.exists(self.document.file.name))
        self.assertEqual(self.document.extractions.count(), 1)

    def test_every_terminal_clock_purges_file_and_all_extracted_content_but_keeps_the_link_and_audit(self):
        self.attach()
        extraction = self.extraction()
        audit = DocumentRead.objects.create(
            actor_id=self.owner.user.pk,
            document_uuid=self.document.pk,
            classification_uuid=self.claim.pk,
            kind="extraction",
        )
        for status, clock in RETENTION_CLOCK.items():
            with self.subTest(status=status):
                with use_migrate():
                    InvestorClassification.objects.filter(pk=self.claim.pk).update(
                        status=status, **{clock: timezone.now() - timedelta(days=31)}
                    )
                self.assertTrue(Document.objects.retention_due(timezone.now()).filter(pk=self.document.pk).exists())
        result = purge_expired_documents(timezone.now())
        self.assertEqual(result, {"purged": 1, "failed": 0})
        self.document.refresh_from_db()
        self.assertEqual(self.document.classification_id, self.claim.pk)
        self.assertFalse(self.document.file)
        self.assertEqual((self.document.note, self.document.original_filename), ("", ""))
        self.assertFalse(DocumentExtraction.objects.filter(pk=extraction.pk).exists())
        self.assertTrue(DocumentRead.objects.filter(pk=audit.pk).exists())
        self.assertEqual([path for path in self.root.rglob("*") if path.is_file()], [])
        self.assertEqual(purge_expired_documents(timezone.now()), {"purged": 0, "failed": 0})

    def test_submitted_and_undated_verified_claims_keep_supporting_evidence(self):
        self.attach()
        for status in ("submitted", "verified"):
            with use_migrate():
                InvestorClassification.objects.filter(pk=self.claim.pk).update(status=status, expires_at=None)
            self.assertEqual(purge_expired_documents(timezone.now() + timedelta(days=3650))["purged"], 0)
        with override_settings(CLASSIFICATION_EVIDENCE_RETENTION_DAYS=0), installed_evidence_retention_policy():
            with use_migrate():
                InvestorClassification.objects.filter(pk=self.claim.pk).update(
                    status="withdrawn", reviewed_at=timezone.now() - timedelta(days=3650)
                )
            self.assertEqual(purge_expired_documents(timezone.now())["purged"], 0)
        self.assertEqual((self.root / self.document.file.name).read_bytes(), PDF)

    def test_unattached_evidence_has_a_shorter_clock_and_storage_failure_is_retryable(self):
        self.extraction()
        self.assertEqual(purge_expired_documents(timezone.now() + timedelta(days=6))["purged"], 0)
        self.assertEqual(purge_expired_documents(timezone.now() + timedelta(days=8)), {"purged": 0, "failed": 0})
        with use_migrate():
            Document.objects.filter(pk=self.document.pk).update(created_at=timezone.now() - timedelta(days=8))
        with patch.object(type(self.document.file.storage), "delete", side_effect=OSError("storage unavailable")):
            self.assertEqual(purge_expired_documents(timezone.now()), {"purged": 0, "failed": 1})
        self.document.refresh_from_db()
        self.assertTrue(self.document.file)
        self.assertEqual(self.document.extractions.count(), 1)
        self.assertEqual(purge_expired_documents(timezone.now()), {"purged": 1, "failed": 0})

    def test_a_late_extraction_cannot_recreate_content_after_purge(self):
        def complete_after_purge(**kwargs):
            with use_migrate():
                Document.objects.filter(pk=self.document.pk).update(created_at=timezone.now() - timedelta(days=8))
            self.assertEqual(purge_expired_documents(timezone.now())["purged"], 1)
            return SimpleNamespace(
                parsed=SimpleNamespace(model_dump=lambda **kwargs: {"gross_pay": "9999"}),
                raw_output="late private data",
                duration_ms=1,
                model_used="synthetic",
            )

        with (
            patch("documents.services.extraction.render_first_page", return_value=b"synthetic image"),
            patch("documents.services.extraction.LlmExtractClient") as llm,
        ):
            llm.return_value.extract.side_effect = complete_after_purge
            self.assertIsNone(run_extraction(self.document))
        self.assertFalse(DocumentExtraction.objects.exists())


class EvidenceCommitFailureTest(EvidenceCase, TransactionTestCase):
    def test_failure_to_delete_the_old_file_preserves_committed_evidence_on_both_attach_paths(self):
        storage = self.document.file.storage
        delete = type(storage).delete

        def fail_old_delete(instance, name):
            if name.startswith("documents/"):
                raise OSError("Synthetic old object cleanup outage")
            return delete(instance, name)

        with (
            patch.object(type(storage), "delete", autospec=True, side_effect=fail_old_delete),
            patch("documents.services.document.extract_document.defer"),
        ):
            for uploading in (False, True):
                with self.subTest(uploading=uploading):
                    failure = None
                    try:
                        if uploading:
                            result = create_document(
                                self.owner.user,
                                {
                                    "file": ContentFile(PDF, name="new.pdf"),
                                    "mime_type": "application/pdf",
                                    "classification": self.claim.pk,
                                },
                            )
                        else:
                            result = attach_document(self.document, self.claim.pk)
                    except OSError as exc:
                        failure = exc
                        result = Document.objects.filter(classification=self.claim).latest("created_at")
                    result.refresh_from_db()
                    self.assertEqual(result.classification_id, self.claim.pk)
                    self.assertTrue(storage.exists(result.file.name))
                    with result.file.open("rb") as retained:
                        self.assertEqual(retained.read(), PDF)
                    self.assertIsNone(failure)
