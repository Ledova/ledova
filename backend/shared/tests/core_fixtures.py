import tempfile
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import pymupdf
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone

from companies.models import Company, CompanyCapability
from companies.services.authority import DECLARATION_VERSION, admit_authority_request
from companies.services.authority_requests import submit_authority_request
from integrations.abr.client import RegistryObservation
from shared.db import use_migrate, use_operator
from tokens.models import RegisterEvidenceKind, RegisterMember, ShareToken
from tokens.services.register_evidence import retain_register_evidence
from tokens.services.register_imports import (
    decide_import,
    prepare_import,
    preview_import_decision,
)
from users.services.setup import ensure_defaults

PASSWORD = "synthetic-core-password-123"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "private": {"BACKEND": "shared.storage.PrivateMediaStorage"},
    "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
}


def pdf_bytes():
    with pymupdf.open() as document:
        document.new_page()
        return document.tobytes()


def person(label):
    with use_operator():
        user = get_user_model().objects.create_user(
            email=f"{label}@example.test", password=PASSWORD, is_active=True, is_email_verified=True
        )
        profile, _, _, _ = ensure_defaults(user)
        profile.full_name = f"Synthetic {label}"
        profile.is_id_verified = True
        profile.is_signup_completed = True
        profile.save(update_fields=["full_name", "is_id_verified", "is_signup_completed"])
    return user, profile


def matching_observation(company):
    return RegistryObservation(
        acn=company.acn,
        abn="99123456780",
        entity_name=company.name,
        entity_type="PRV",
        entity_status="Active",
    )


def company_for(owner, name, acn):
    with use_migrate():
        company = Company.objects.create(owner=owner, name=name, acn=acn)
    proposal, _ = submit_authority_request(
        requester=owner,
        company_id=company.pk,
        idempotency_key=uuid4(),
        file=SimpleUploadedFile("authority.pdf", pdf_bytes(), content_type="application/pdf"),
        requested_capabilities=[CompanyCapability.ADMIN],
        delegatable_capabilities=list(CompanyCapability.values),
    )
    with patch("companies.services.registry.lookup_company", return_value=matching_observation(company)):
        appointment = admit_authority_request(
            requester=owner,
            request_id=proposal.pk,
            declaration_version=DECLARATION_VERSION,
            accept_declaration=True,
        ).appointment
    return company, appointment


def retained_evidence(owner, appointment, kind):
    return retain_register_evidence(
        actor=owner,
        company_id=appointment.company_id,
        appointment=appointment.pk,
        kind=kind,
        idempotency_key=uuid4(),
        name=f"{kind}.pdf",
        raw=pdf_bytes(),
        mime_type="application/pdf",
    )[0]


def import_payload(owner, appointment, token, member_id=None):
    register_copy = retained_evidence(owner, appointment, RegisterEvidenceKind.SHARE_REGISTER)
    asic = retained_evidence(owner, appointment, RegisterEvidenceKind.ASIC_EXTRACT)
    return {
        "operation_id": str(uuid4()),
        "appointment": str(appointment.pk),
        "token_id": str(token.pk),
        "register_evidence": str(register_copy.pk),
        "asic_evidence": str(asic.pk),
        "as_at": timezone.now().date().isoformat(),
        "asic_issued_total": "100",
        "asic_member_count": 1,
        "members": [
            {
                "member": str(member_id or uuid4()),
                "name": "Synthetic Member",
                "residential_address": "1 Example Street, Sydney NSW 2000",
                "shares": "100",
                "entered_on": "2020-01-01",
                "amount_paid": "100.00",
            }
        ],
        "former_members": [],
        "authority": "director_resolution",
        "approving_director": "Synthetic Independent Director",
        "authority_reference": "SYNTHETIC-CORE-IMPORT",
        "reason": "Import the company-provided register",
    }


def populated_register(owner, company, appointment, symbol="CORE"):
    with use_operator():
        token = ShareToken.objects.create(
            company=company, name="Synthetic ordinary shares", symbol=symbol, total_supply="1000"
        )
    payload = import_payload(owner, appointment, token)
    proposal = prepare_import(actor=owner, **payload)[0]
    for kind in ("approve", "apply"):
        preview = preview_import_decision(actor=owner, import_id=proposal.pk, appointment=appointment.pk, kind=kind)[1]
        decide_import(
            actor=owner,
            import_id=proposal.pk,
            appointment=appointment.pk,
            kind=kind,
            idempotency_key=uuid4(),
            preview_digest=preview["preview_digest"],
            confirmation=True,
        )
    with use_operator():
        member = RegisterMember.objects.get(pk=payload["members"][0]["member"])
    return token, member


class CoreFixtures:
    def setUp(self):
        super().setUp()
        cache.clear()
        self.addCleanup(cache.clear)
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.enterContext(override_settings(PRIVATE_MEDIA_ROOT=directory.name, STORAGES=STORAGES))
        self.scanner = self.enterContext(patch("shared.uploads.scan_upload"))
        self.enterContext(patch("shared.upload_limits.reserve_request"))
        self.enterContext(patch("shared.upload_limits.reserve_bytes"))
        self.owner, self.profile = person("core-owner")
        self.foreign, self.foreign_profile = person("core-foreign")
        self.company, self.appointment = company_for(self.owner, "Synthetic Core Pty Ltd", "111222333")
        self.foreign_company, self.foreign_appointment = company_for(
            self.foreign, "Synthetic Foreign Pty Ltd", "444555666"
        )
        self.token, self.member = populated_register(self.owner, self.company, self.appointment)
        self.client.force_authenticate(self.owner)

    def decision(self, endpoint, identifier, kind, appointment=None, **changes):
        appointment = appointment or self.appointment
        fields = {"appointment": str(appointment.pk), "kind": kind}
        preview = self.client.post(f"{endpoint}{identifier}/decision-preview/", fields, format="json")
        self.assertEqual(preview.status_code, 200, preview.content)
        payload = {
            **fields,
            "idempotency_key": str(uuid4()),
            "preview_digest": preview.json()["previewDigest"],
            "confirmation": True,
            **changes,
        }
        response = self.client.post(f"{endpoint}{identifier}/decide/", payload, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        return response, payload

    def grant_payload(self, **changes):
        authority = retained_evidence(self.owner, self.appointment, RegisterEvidenceKind.AUTHORITY)
        terms = retained_evidence(self.owner, self.appointment, RegisterEvidenceKind.SUPPORTING)
        return {
            "operation_id": str(uuid4()),
            "appointment": str(self.appointment.pk),
            "token_id": str(self.token.pk),
            "member": str(uuid4()),
            "new_member": True,
            "name": "Synthetic Employee",
            "residential_address": "2 Example Street, Sydney NSW 2000",
            "shares": "25",
            "terms_on": timezone.now().date().isoformat(),
            "approving_director": "Synthetic Independent Director",
            "terms": "Outright non-paid employee grant",
            "authority_reference": "SYNTHETIC-CORE-GRANT",
            "reason": "Record the company's employee grant",
            "authority_evidence": str(authority.pk),
            "terms_evidence": str(terms.pk),
            "acceptance_required": False,
            **changes,
        }

    def prepare_grant(self, **changes):
        response = self.client.post("/api/v1/tokens/register-grants/", self.grant_payload(**changes), format="json")
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()["uuid"]
