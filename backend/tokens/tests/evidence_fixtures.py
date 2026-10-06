from uuid import uuid4

from django.contrib.auth import get_user_model

from companies.tests.test_document_file_access import DOCUMENT_BYTES
from shared.db import use_migrate
from shared.seeds.synthetic.authority import historical_owner_appointment
from tokens.services.register_evidence import retain_register_evidence
from users.models import UserProfile


def staff_user():
    with use_migrate():
        return get_user_model().objects.create_user(
            email=f"staff-{uuid4()}@example.test", is_active=True, is_staff=True
        )


def owner_appointment(company):
    with use_migrate():
        UserProfile.objects.get_or_create(user=company.owner, defaults={"full_name": "Synthetic register owner"})
    return historical_owner_appointment(company)


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
