from django.conf import settings
from django.db import connections
from django.db.models import Q

from companies.models import (
    CompanyAppointment,
    CompanyCapability,
    CompanyLegacyOwnerSource,
)
from shared.db import atomic, current_alias, use_migrate

OWNER_PROVENANCE = "synthetic historical company owner"


def historical_owner_appointment(company, *, provenance=OWNER_PROVENANCE):
    with use_migrate(), atomic(durable=True):
        existing = (
            CompanyAppointment.objects.filter(company=company, appointee=company.owner)
            .filter(Q(request__isnull=False) | Q(legacy_owner__isnull=False))
            .first()
        )
        if existing is not None:
            return existing
        selected_db = connections[current_alias()]
        with selected_db.cursor() as cursor:
            cursor.execute("SELECT current_user")
            if cursor.fetchone()[0] != settings.RLS_ROLES["migrate"]:
                raise RuntimeError("Synthetic historical owner sources require the configured migration role.")
            cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
            cursor.execute(
                "ALTER TABLE companies_companylegacyownersource DISABLE TRIGGER companies_legacy_owner_source_identity"
            )
            cursor.execute(
                "ALTER TABLE companies_companyappointment DISABLE TRIGGER companies_initial_appointment_identity"
            )
        try:
            with atomic():
                profile = company.owner.userprofile
                source = CompanyLegacyOwnerSource.objects.create(
                    company=company,
                    owner=company.owner,
                    owner_profile=profile,
                    provenance=provenance,
                )
                appointment = CompanyAppointment.objects.create(
                    company=company,
                    appointee=company.owner,
                    appointee_profile=profile,
                    legacy_owner=source,
                    capabilities=[CompanyCapability.ADMIN],
                    delegatable_capabilities=sorted(CompanyCapability.values),
                )
                with selected_db.cursor() as cursor:
                    cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
        finally:
            with selected_db.cursor() as cursor:
                cursor.execute(
                    "ALTER TABLE companies_companylegacyownersource "
                    "ENABLE TRIGGER companies_legacy_owner_source_identity"
                )
                cursor.execute(
                    "ALTER TABLE companies_companyappointment ENABLE TRIGGER companies_initial_appointment_identity"
                )
        return appointment
