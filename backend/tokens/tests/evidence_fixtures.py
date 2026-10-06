from uuid import uuid4

from django.contrib.auth import get_user_model

from companies.tests.test_document_file_access import DOCUMENT_BYTES
from shared.db import use_migrate
from tokens.services.register_evidence import retain_register_evidence


def staff_user():
    with use_migrate():
        return get_user_model().objects.create_user(
            email=f"staff-{uuid4()}@example.test", is_active=True, is_staff=True
        )


def upload_evidence(actor, appointment, kind, raw=DOCUMENT_BYTES):
    evidence, _ = retain_register_evidence(
        actor=actor,
        company_id=appointment.company_id,
        appointment=appointment.pk,
        kind=kind,
        idempotency_key=uuid4(),
        name=f"{kind}.pdf",
        raw=raw,
        mime_type="application/pdf",
    )
    return evidence
