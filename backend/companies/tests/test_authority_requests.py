import hashlib
import tempfile
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import DatabaseError, connections
from django.db.models import ProtectedError
from django.test import override_settings
from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.test import APITransactionTestCase

from companies.exceptions import AuthorityRequestConflictException
from companies.models import Company, CompanyAuthorityRequest
from companies.services.authority_requests import submit_authority_request
from shared.db import (
    atomic,
    current_alias,
    principal_of,
    reset_principal,
    set_principal,
    use_app,
    use_operator,
)
from shared.db.principal import give_the_role_back, take_the_app_role
from shared.services.orphaned_files import orphaned_files
from shared.tests.upload_fixtures import StubUploadDependencies, image_bytes, pdf_bytes
from users.models import UserProfile

URL = "/api/v1/company-authority/requests/"
PDF = pdf_bytes()
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "private": {"BACKEND": "shared.storage.PrivateMediaStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


def authority_fixture(label="authority", acn="123456789"):
    user = get_user_model().objects.create_user(
        email=f"{label}@example.test", password="pw-12345678", is_active=True, is_email_verified=True
    )
    profile = UserProfile.objects.create(user=user, full_name=f"{label} representative")
    company = Company.objects.create(owner=user, name=f"{label} Pty Ltd", acn=acn)
    return user, profile, company


def evidence(raw=PDF, name="authority.pdf", mime="application/pdf"):
    return SimpleUploadedFile(name, raw, content_type=mime)


class AuthorityRequestCases:
    def setUp(self):
        super().setUp()
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        with use_operator():
            self.user, self.profile, self.company = authority_fixture()
            self.other, self.other_profile, self.other_company = authority_fixture("other-authority", "987654321")
        self.client.force_authenticate(self.user)
        self.key = uuid4()

    def payload(self, **changes):
        return {
            "company": str(self.company.pk),
            "idempotency_key": str(self.key),
            "file": evidence(),
            "requested_capabilities": ["prepare", "admin"],
            "delegatable_capabilities": ["approve"],
            **changes,
        }

    def submit(self, **changes):
        return self.client.post(URL, self.payload(**changes), format="multipart")

    def service_submit(self, **changes):
        return submit_authority_request(
            requester=self.user,
            company_id=self.company.pk,
            idempotency_key=self.key,
            file=evidence(),
            requested_capabilities=["admin", "prepare"],
            delegatable_capabilities=["approve"],
            **changes,
        )

    def stored(self, response):
        with use_operator():
            return CompanyAuthorityRequest.objects.get(pk=response.json()["uuid"])

    def private_files(self):
        return sorted(path for path in self.root.rglob("*") if path.is_file())

    @contextmanager
    def app_as(self, user):
        with use_app():
            previous = principal_of()
            set_principal(user.pk)
            take_the_app_role()
            try:
                yield
            finally:
                give_the_role_back()
                if previous:
                    set_principal(previous)
                else:
                    reset_principal()

    def test_fresh_unverified_identity_submits_real_private_pending_evidence(self):
        self.assertFalse(self.profile.is_id_verified)
        response = self.submit()
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(
            (body["status"], body["verificationStatus"], body["purpose"]), ("pending", "unavailable", "bootstrap")
        )
        self.assertIn("grants no company authority", body["verificationMessage"])
        self.assertEqual(body["requestedCapabilities"], ["admin", "prepare"])
        self.assertEqual(body["delegatableCapabilities"], ["approve"])
        self.assertEqual(body["requesterProfile"], str(self.profile.pk))
        self.assertEqual(body["companyIdentityRaw"]["name"], self.company.name)
        self.assertEqual(body["personIdentityRaw"]["email"], self.user.email)
        self.assertEqual(body["fileSha256"], hashlib.sha256(PDF).hexdigest())
        self.assertEqual((body["fileSize"], body["mimeType"]), (len(PDF), "application/pdf"))
        self.assertEqual(len(body["requestDigest"]), 64)
        proposal = self.stored(response)
        with proposal.file.open("rb") as source:
            self.assertEqual(source.read(), PDF)
        with self.assertRaises(ValueError):
            proposal.file.url
        self.assertNotIn("file", body)
        self.assertNotIn("/media/", body["fileUrl"])
        download = self.client.get(body["fileUrl"])
        self.assertEqual(download.status_code, 200)
        self.assertEqual(download["Cache-Control"], "private, no-store")
        self.assertIn("attachment", download["Content-Disposition"])
        self.assertEqual(b"".join(download.streaming_content), PDF)
        with use_operator():
            self.company.refresh_from_db()
            self.profile.refresh_from_db()
            self.assertEqual(self.company.status, "draft")
            self.assertIsNone(self.company.registry_check_id)
            self.assertIsNone(self.company.officeholder_attested_by_id)
            self.assertFalse(self.profile.is_id_verified)
            self.assertEqual(orphaned_files(moment=timezone.now() + timedelta(days=2)), [])

    def test_delegation_only_is_a_proposal_and_empty_scope_is_refused(self):
        response = self.submit(requested_capabilities=[], delegatable_capabilities=["approve"])
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["requestedCapabilities"], [])
        self.assertEqual(response.json()["delegatableCapabilities"], ["approve"])
        empty = self.submit(idempotency_key=str(uuid4()), requested_capabilities=[], delegatable_capabilities=[])
        self.assertEqual(empty.status_code, 400, empty.content)

    def test_unknown_duplicate_capabilities_and_unwritable_claims_are_refused(self):
        for change in (
            {"requested_capabilities": ["director"]},
            {"requested_capabilities": ["admin", "admin"]},
            {"delegatable_capabilities": ["admin", "admin"]},
            {"is_verified": True},
            {"status": "verified"},
            {"verification_status": "passed"},
            {"requester": self.other.pk},
            {"representative": self.other.pk},
            {"requester_profile": str(self.other_profile.pk)},
            {"applicant_id": "forged"},
            {"company_identity_raw": "forged"},
            {"file_sha256": "a" * 64},
            {"purpose": "recovery"},
        ):
            with self.subTest(change=change):
                refused = self.submit(**change)
                self.assertEqual(refused.status_code, 400, refused.content)
        self.assertEqual(self.private_files(), [])

    def test_email_verification_active_account_and_owner_are_required(self):
        for field in ("is_email_verified", "is_active"):
            with use_operator():
                get_user_model().objects.filter(pk=self.user.pk).update(**{field: False})
                self.user.refresh_from_db()
            self.client.force_authenticate(self.user)
            self.assertEqual(self.submit().status_code, 403)
            with use_operator():
                get_user_model().objects.filter(pk=self.user.pk).update(**{field: True})
                self.user.refresh_from_db()
        self.client.force_authenticate(None)
        self.assertEqual(self.submit().status_code, 401)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.submit().status_code, 404)
        self.assertEqual(self.private_files(), [])

    def test_only_a_currently_owned_draft_company_accepts_a_request(self):
        with use_operator():
            Company.objects.filter(pk=self.company.pk).update(status="submitted")
        self.assertEqual(self.submit().status_code, 400)
        with use_operator():
            Company.objects.filter(pk=self.company.pk).update(status="draft", owner=self.other)
        self.assertEqual(self.submit().status_code, 404)
        self.assertEqual(self.private_files(), [])

    def test_equal_length_changing_stream_cannot_replace_scanned_bytes(self):
        class ChangingUpload(SimpleUploadedFile):
            def __init__(self):
                super().__init__("authority.pdf", PDF, content_type="application/pdf")
                self.passes = 0

            def read(self, size=-1):
                if self.tell() == 0:
                    self.passes += 1
                raw = super().read(size)
                return b"x" * len(raw) if self.passes > 1 else raw

        upload = ChangingUpload()
        upload.seek(7)
        proposal, created = submit_authority_request(
            requester=self.user,
            company_id=self.company.pk,
            idempotency_key=self.key,
            file=upload,
            requested_capabilities=["admin"],
        )
        self.assertTrue(created)
        self.assertEqual(upload.passes, 1)
        with proposal.file.open("rb") as retained:
            self.assertEqual(retained.read(), PDF)
        self.assertEqual(proposal.file_sha256, hashlib.sha256(PDF).hexdigest())

    def test_real_upload_type_size_and_content_validation_are_required(self):
        for upload in (
            evidence(b"not a pdf"),
            evidence(PDF, "authority.txt", "text/plain"),
            evidence(image_bytes(), "authority.pdf", "application/pdf"),
        ):
            with self.subTest(filename=upload.name):
                refused = self.submit(file=upload)
                self.assertEqual(refused.status_code, 400, refused.content)
        with override_settings(UPLOAD_MAX_BYTES=10):
            self.assertEqual(self.submit().status_code, 400)
        self.assertEqual(self.private_files(), [])

    def test_snapshot_size_limit_uses_actual_bytes_despite_incorrect_reported_size(self):
        upload = evidence()
        upload.size = 1
        with override_settings(UPLOAD_MAX_BYTES=10), self.assertRaises(ValidationError) as refused:
            submit_authority_request(
                requester=self.user,
                company_id=self.company.pk,
                idempotency_key=self.key,
                file=upload,
                requested_capabilities=["admin"],
            )
        self.assertIn("File size must not exceed", str(refused.exception.detail["file"]))
        self.assertEqual(self.private_files(), [])

    def test_external_url_or_storage_path_cannot_replace_the_upload(self):
        for change in ({"file": "companies/foreign/private.bin"}, {"external_url": "https://example.test/proof.pdf"}):
            refused = self.submit(**change)
            self.assertEqual(refused.status_code, 400, refused.content)
        self.assertEqual(self.private_files(), [])

    def test_identical_retries_and_reordered_sets_reuse_the_retained_row_and_file(self):
        created = self.submit()
        repeated = self.submit(requested_capabilities=["admin", "prepare"])
        self.assertEqual((created.status_code, repeated.status_code), (201, 200), repeated.content)
        self.assertEqual(created.json(), repeated.json())
        self.assertEqual(len(self.private_files()), 1)

    def test_changed_company_file_scope_and_expiry_conflict_under_one_key(self):
        self.assertEqual(self.submit().status_code, 201)
        with use_operator():
            another = Company.objects.create(owner=self.user, name="Another Pty Ltd", acn="333444555")
        for change in (
            {"company": str(another.pk)},
            {"file": evidence(pdf_bytes(pages=2))},
            {"requested_capabilities": ["finance"]},
            {"delegatable_capabilities": ["finance"]},
            {"requested_expires_at": (timezone.now() + timedelta(days=1)).isoformat()},
        ):
            with self.subTest(change=list(change)):
                refused = self.submit(**change)
                self.assertEqual(refused.status_code, 409, refused.content)
        self.assertEqual(len(self.private_files()), 1)

    def test_frozen_company_and_person_identity_changes_require_a_new_key(self):
        created = self.submit()
        for model, pk, change in (
            (Company, self.company.pk, {"name": "Changed Pty Ltd"}),
            (UserProfile, self.profile.pk, {"full_name": "Changed representative"}),
            (get_user_model(), self.user.pk, {"email": "changed-authority@example.test"}),
        ):
            with self.subTest(model=model.__name__), use_operator():
                model.objects.filter(pk=pk).update(**change)
            self.assertEqual(self.submit().status_code, 409)
        proposal = self.stored(created)
        self.assertEqual(proposal.company_identity_raw["name"], "authority Pty Ltd")
        self.assertEqual(proposal.person_identity_raw["email"], "authority@example.test")
        self.assertEqual(self.submit(idempotency_key=str(uuid4())).status_code, 201)

    def test_expiry_is_future_for_new_requests_but_does_not_mutate_an_existing_retry(self):
        expiry = timezone.now() + timedelta(days=1)
        created = self.submit(requested_expires_at=expiry.isoformat())
        self.assertEqual(created.status_code, 201, created.content)
        with patch("companies.services.authority_requests.timezone.now", return_value=expiry + timedelta(days=1)):
            self.assertEqual(self.submit(requested_expires_at=expiry.isoformat()).status_code, 200)
            self.assertEqual(
                self.submit(idempotency_key=str(uuid4()), requested_expires_at=expiry.isoformat()).status_code, 400
            )

    def test_owned_history_filters_by_company_and_remains_after_company_ownership_changes(self):
        created = self.submit()
        with use_operator():
            another = Company.objects.create(owner=self.user, name="History Pty Ltd", acn="333444555")
        second = self.submit(company=str(another.pk), idempotency_key=str(uuid4()))
        self.assertEqual(second.status_code, 201)
        listing = self.client.get(URL, {"company": str(self.company.pk)})
        self.assertEqual([row["uuid"] for row in listing.json()["results"]], [created.json()["uuid"]])
        with use_operator():
            Company.objects.filter(pk=self.company.pk).update(owner=self.other)
        self.assertEqual(self.client.get(created.json()["fileUrl"]).status_code, 200)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(URL).json()["results"], [])
        self.assertEqual(self.client.get(created.json()["fileUrl"]).status_code, 404)

    def test_raw_app_insert_and_mutations_and_operator_history_rewrites_are_refused(self):
        proposal = self.stored(self.submit())
        with self.app_as(self.user):
            self.assertEqual(list(CompanyAuthorityRequest.objects.values_list("pk", flat=True)), [proposal.pk])
            with self.assertRaises(DatabaseError), atomic():
                CompanyAuthorityRequest.objects.filter(pk=proposal.pk).update(request_digest="a" * 64)
            with connections[current_alias()].cursor() as cursor:
                cursor.execute("DELETE FROM companies_companyauthorityrequest WHERE uuid = %s", [proposal.pk])
                self.assertEqual(cursor.rowcount, 0)
            values = {field.attname: getattr(proposal, field.attname) for field in proposal._meta.fields}
            values.update(uuid=uuid4(), idempotency_key=uuid4())
            with self.assertRaises(DatabaseError), atomic():
                CompanyAuthorityRequest.objects.create(**values)
        with use_operator():
            for change in ({"request_digest": "b" * 64}, {"company_identity_raw": {}}, {"requester_id": self.other.pk}):
                with self.subTest(change=change), self.assertRaises(DatabaseError), atomic():
                    CompanyAuthorityRequest.objects.filter(pk=proposal.pk).update(**change)
            for statement in (
                "UPDATE companies_companyauthorityrequest SET request_digest = request_digest WHERE uuid = %s",
                "DELETE FROM companies_companyauthorityrequest WHERE uuid = %s",
            ):
                with self.subTest(statement=statement), self.assertRaises(DatabaseError), atomic():
                    with connections[current_alias()].cursor() as cursor:
                        cursor.execute(statement, [proposal.pk])
            with self.assertRaises(DatabaseError), atomic():
                CompanyAuthorityRequest.objects.filter(pk=proposal.pk).delete()
            with self.assertRaises(ProtectedError):
                self.company.delete()
            self.assertEqual(CompanyAuthorityRequest.objects.count(), 1)
        self.assertEqual(len(self.private_files()), 1)

    def test_a_database_insert_failure_cleans_the_uncommitted_private_upload(self):
        with patch.object(CompanyAuthorityRequest, "save", side_effect=DatabaseError("synthetic insert failure")):
            with self.assertRaises(DatabaseError):
                self.service_submit()
        with use_operator():
            self.assertFalse(CompanyAuthorityRequest.objects.exists())
        self.assertEqual(self.private_files(), [])

    def test_failed_immediate_cleanup_leaves_an_unreferenced_upload_for_the_orphan_sweep(self):
        from shared.storage import private_storage

        with patch.object(
            CompanyAuthorityRequest, "save", side_effect=DatabaseError("synthetic insert failure")
        ), patch.object(type(private_storage()), "delete", side_effect=OSError("synthetic cleanup outage")):
            with self.assertRaises(DatabaseError):
                self.service_submit()
        self.assertEqual(len(self.private_files()), 1)
        with use_operator():
            self.assertEqual(len(orphaned_files(moment=timezone.now() + timedelta(days=2))), 1)

    def test_service_restores_prior_principals_after_success_and_failure(self):
        with use_app():
            set_principal(self.other.pk)
            app_before = principal_of()
        with use_operator():
            set_principal(self.other.pk)
            operator_before = principal_of()
        self.service_submit()
        with use_app():
            self.assertEqual(principal_of(), app_before)
        with use_operator():
            self.assertEqual(principal_of(), operator_before)
        with patch.object(CompanyAuthorityRequest, "save", side_effect=DatabaseError("synthetic insert failure")):
            with self.assertRaises(DatabaseError):
                submit_authority_request(
                    requester=self.user,
                    company_id=self.company.pk,
                    idempotency_key=uuid4(),
                    file=evidence(),
                    requested_capabilities=["admin"],
                )
        with use_app():
            self.assertEqual(principal_of(), app_before)
        with use_operator():
            self.assertEqual(principal_of(), operator_before)

    def test_simultaneous_identical_requests_keep_one_row_and_one_file(self):
        def submit():
            try:
                result, created = self.service_submit()
                return result.pk, created
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            first, second = [job.result(timeout=30) for job in (pool.submit(submit), pool.submit(submit))]
        self.assertEqual(first[0], second[0])
        self.assertEqual(sorted([first[1], second[1]]), [False, True])
        self.assertEqual(len(self.private_files()), 1)

    def test_simultaneous_changed_requests_keep_one_exact_intent(self):
        def submit(scope):
            try:
                result, created = submit_authority_request(
                    requester=self.user,
                    company_id=self.company.pk,
                    idempotency_key=self.key,
                    file=evidence(),
                    requested_capabilities=[scope],
                )
                return result.pk, created
            except AuthorityRequestConflictException:
                return "conflict", False
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = [job.result(timeout=30) for job in (pool.submit(submit, "admin"), pool.submit(submit, "finance"))]
        self.assertEqual(sum(created for _, created in results), 1)
        self.assertEqual(sum(result == "conflict" for result, _ in results), 1)
        self.assertEqual(len(self.private_files()), 1)


class AuthorityRequestApiTest(StubUploadDependencies, AuthorityRequestCases, APITransactionTestCase):
    pass
