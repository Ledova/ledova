import importlib
import re
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, override_settings
from django.urls import clear_url_caches, reverse
from rest_framework.test import APITestCase

from companies.models import (
    Company,
    CompanyCapability,
    CompanyDocument,
    CompanyType,
    DocumentType,
)
from companies.services.authority import DECLARATION_VERSION, admit_authority_request
from companies.services.authority_requests import submit_authority_request
from companies.services.team import accept_team_invitation, issue_team_invitation
from companies.tests.registry_fixtures import matching_observation
from companies.tests.test_authority_requests import evidence
from shared.db import use_migrate
from shared.tests.schema import migrate_to, restore_every_migration
from shared.tests.upload_fixtures import (
    PrivateDocumentFileChecks,
    StubUploadDependencies,
    pdf_bytes,
)
from users.models import UserProfile

User = get_user_model()

DOCUMENT_BYTES = pdf_bytes()
EXTERNAL_URL = "https://docs.example.test/constitution.pdf"
ADMIN_STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


def make_company(label, acn):
    owner = User.objects.create_user(
        email=f"{label}@example.test", password="pw-12345678", is_active=True, is_email_verified=True
    )
    with use_migrate():
        company = Company.objects.create(
            owner=owner,
            name=f"{label} Pty Ltd",
            company_type=CompanyType.PROPRIETARY,
            acn=acn,
        )
    return owner, company


def make_document(company, **kwargs):
    with use_migrate():
        return CompanyDocument.objects.create(
            company=company,
            document_type=DocumentType.CONSTITUTION,
            name="Constitution",
            file_size=len(DOCUMENT_BYTES),
            mime_type="application/pdf",
            **kwargs,
        )


def attach_file(document, payload=DOCUMENT_BYTES):
    with use_migrate():
        document.file.save(f"{document.uuid}.pdf", ContentFile(payload), save=True)
    return document


def invite_company_administrator(company, appointment, actor):
    with use_migrate():
        UserProfile.objects.get_or_create(user=actor, defaults={"full_name": actor.email})
    invitation, code, _ = issue_team_invitation(
        requester=appointment.appointee,
        company_id=company.pk,
        inviter_appointment_id=appointment.pk,
        idempotency_key=uuid4(),
        capabilities=["admin"],
        delegatable_capabilities=[],
    )
    return accept_team_invitation(
        requester=actor, code=code, declaration_version=DECLARATION_VERSION, accept_declaration=True
    )


def admit_company_administrator(company, actor=None):
    with use_migrate():
        UserProfile.objects.get_or_create(user=company.owner, defaults={"full_name": company.owner.email})
    with (
        patch("shared.uploads.scan_upload"),
        patch("shared.upload_limits.reserve_request"),
        patch("shared.upload_limits.reserve_bytes"),
    ):
        proposal, _ = submit_authority_request(
            requester=company.owner,
            company_id=company.pk,
            idempotency_key=uuid4(),
            file=evidence(),
            requested_capabilities=["admin"],
            delegatable_capabilities=list(CompanyCapability.values),
        )
    with patch("companies.services.registry.lookup_company", return_value=matching_observation(company)):
        appointment = admit_authority_request(
            requester=company.owner,
            request_id=proposal.pk,
            declaration_version=DECLARATION_VERSION,
            accept_declaration=True,
        ).appointment
    return (
        invite_company_administrator(company, appointment, actor) if actor and actor != company.owner else appointment
    )


def legacy_company_administrators(*companies):
    with use_migrate():
        for company in companies:
            UserProfile.objects.get_or_create(user=company.owner, defaults={"full_name": company.owner.email})
    try:
        migrate_to([("companies", "0018_team_invitation_admission_guards")])
    finally:
        restore_every_migration()
    return [company.appointments.get(legacy_owner__isnull=False) for company in companies]


class CompanyDocumentFileUrlTest(StubUploadDependencies, APITestCase):

    def setUp(self):
        self.user, self.company = make_company("doc-file-url", "111222333")
        admit_company_administrator(self.company)
        self.client.force_authenticate(self.user)
        self.url = f"/api/v1/companies/{self.company.uuid}/documents/"

    def test_the_file_url_is_the_authenticated_route_not_media(self):
        response = self.client.post(
            self.url,
            {
                "document_type": DocumentType.ASIC_EXTRACT.value,
                "name": "Extract",
                "file": SimpleUploadedFile("extract.pdf", DOCUMENT_BYTES, content_type="application/pdf"),
            },
            format="multipart",
        )

        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertIn(f"/documents/{body['uuid']}/file/", body["fileUrl"])
        self.assertNotIn("/media/", body["fileUrl"])

    def test_an_external_url_document_still_reports_its_external_url(self):
        document = make_document(self.company, external_url=EXTERNAL_URL)

        response = self.client.get(f"/api/v1/companies/{self.company.uuid}/")

        self.assertEqual(response.status_code, 200)
        urls = {entry["uuid"]: entry["fileUrl"] for entry in response.json()["documents"]}
        self.assertEqual(urls[str(document.uuid)], EXTERNAL_URL)

    def test_the_company_detail_reports_the_same_route_for_its_documents(self):
        document = attach_file(make_document(self.company))

        response = self.client.get(f"/api/v1/companies/{self.company.uuid}/")

        self.assertEqual(response.status_code, 200)
        urls = [entry["fileUrl"] for entry in response.json()["documents"]]
        self.assertTrue(any(f"/documents/{document.uuid}/file/" in url for url in urls))
        self.assertFalse(any("/media/" in url for url in urls))

    def test_the_route_reverses_under_the_companies_namespace(self):
        document = attach_file(make_document(self.company))

        url = reverse(
            "companies:documents-file",
            kwargs={"company_uuid": self.company.uuid, "uuid": document.uuid},
        )

        self.assertEqual(url, f"/api/v1/companies/{self.company.uuid}/documents/{document.uuid}/file/")


class CompanyDocumentFileViewTest(APITestCase):

    def setUp(self):
        self.user, self.company = make_company("doc-file-owner", "333444555")
        self.other_user, self.other_company = make_company("doc-file-other", "444555666")
        self.staff = User.objects.create_superuser(email="doc-file-staff@example.test", password="pw-12345678")
        self.document = attach_file(make_document(self.company))
        admit_company_administrator(self.company)
        admit_company_administrator(self.other_company)
        self.url = f"/api/v1/companies/{self.company.uuid}/documents/{self.document.uuid}/file/"

    @staticmethod
    def _streamed(response):
        return b"".join(response.streaming_content)

    def test_the_owner_reads_the_bytes_through_the_api(self):
        self.client.force_authenticate(self.user)

        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.streaming)
        self.assertEqual(self._streamed(response), DOCUMENT_BYTES)
        self.assertEqual(response["Content-Type"], "application/pdf")
        self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_it_streams_rather_than_redirecting_to_media(self):
        self.client.force_authenticate(self.user)

        response = self.client.get(self.url)

        self.assertNotIn(response.status_code, (301, 302, 303, 307, 308))
        self.assertIsNone(response.headers.get("Location"))
        self.assertNotIn("/media/", response.headers.get("Content-Disposition", ""))

    def test_another_company_owner_gets_404(self):
        self.client.force_authenticate(self.other_user)

        self.assertEqual(self.client.get(self.url).status_code, 404)

    def test_a_document_reached_through_the_wrong_company_is_404(self):
        self.client.force_authenticate(self.other_user)
        mismatched = f"/api/v1/companies/{self.other_company.uuid}/documents/{self.document.uuid}/file/"

        self.assertEqual(self.client.get(mismatched).status_code, 404)

    def test_an_anonymous_caller_gets_401(self):
        self.assertEqual(self.client.get(self.url).status_code, 401)

    def test_a_staff_caller_who_does_not_own_the_company_gets_404(self):
        self.client.force_authenticate(self.staff)

        self.assertEqual(self.client.get(self.url).status_code, 404)

    def test_a_document_with_no_file_is_404(self):
        external = make_document(self.company, external_url=EXTERNAL_URL)
        self.client.force_authenticate(self.user)

        response = self.client.get(f"/api/v1/companies/{self.company.uuid}/documents/{external.uuid}/file/")

        self.assertEqual(response.status_code, 404)

    def test_staff_read_the_same_bytes_through_the_admin(self):
        self.client.force_authenticate(None)
        self.client.force_login(self.staff)

        response = self.client.get(reverse("admin:companies_companydocument_file", args=[self.document.uuid]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._streamed(response), DOCUMENT_BYTES)
        self.assertLessEqual({"private", "no-store"}, {part.strip() for part in response["Cache-Control"].split(",")})

    def test_the_admin_file_view_refuses_a_non_staff_caller(self):
        self.client.force_authenticate(None)
        self.client.force_login(self.user)

        response = self.client.get(reverse("admin:companies_companydocument_file", args=[self.document.uuid]))

        self.assertIn(response.status_code, (302, 403))


@override_settings(STORAGES=ADMIN_STORAGES)
class CompanyDocumentIsNotServedFromMediaTest(PrivateDocumentFileChecks, TestCase):

    def setUp(self):
        self.staff = User.objects.create_superuser(email="doc-media-staff@example.test", password="pw-12345678")
        _, self.company = make_company("doc-media-leak", "555666777")
        self.document = attach_file(make_document(self.company))

    @staticmethod
    def _reloaded_urlconf():
        import ledova_backend.urls

        importlib.reload(ledova_backend.urls)
        clear_url_caches()

    def test_an_anonymous_caller_cannot_fetch_the_document_from_media_under_debug(self):
        media_path = f"{settings.MEDIA_URL}{self.document.file.name}"

        with override_settings(DEBUG=True, ALLOWED_HOSTS=["*"]):
            self._reloaded_urlconf()
            try:
                response = Client().get(media_path)
            finally:
                self._reloaded_urlconf()

        self.assertEqual(response.status_code, 404)

    def test_the_document_admin_change_page_prints_no_media_href(self):
        self.client.force_login(self.staff)

        response = self.client.get(reverse("admin:companies_companydocument_change", args=[self.document.pk]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(re.findall(r'href="(/media/[^"]*)"', response.content.decode()), [])

    def test_the_company_admin_change_page_inline_prints_no_media_href(self):
        self.client.force_login(self.staff)

        response = self.client.get(reverse("admin:companies_company_change", args=[self.company.pk]))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(re.findall(r'href="(/media/[^"]*)"', response.content.decode()), [])
