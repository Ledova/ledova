import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

DECLARATION = (
    "I am authorised to act for this company. The company is responsible for the company and share information "
    "it provides, its ASIC filings and legal obligations."
)
WITHDRAWAL_CHECK = """
    IF EXISTS (SELECT 1 FROM companies_companyappointment WHERE request_id = NEW.request_id) THEN
        RAISE EXCEPTION 'An admitted appointment must be revoked instead of withdrawn' USING ERRCODE = '23514';
    END IF;
"""


def install_guards(apps, schema_editor):
    from shared.db.policy_sql import install_tables

    tables = ("companies_companyappointment", "companies_companyappointmentrevocation")
    install_tables(schema_editor, tables)
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            """
CREATE FUNCTION companies_guard_initial_appointment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    actor authentication_customuser;
    representative users_userprofile;
    issuer companies_company;
    proposal companies_companyauthorityrequest;
    provider_check companies_companyregistrycheck;
    principal bigint;
    requires_identity boolean;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain immutable company appointments and declarations' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO proposal FROM companies_companyauthorityrequest WHERE uuid = NEW.request_id;
    SELECT * INTO actor FROM authentication_customuser WHERE id = proposal.requester_id FOR UPDATE;
    SELECT * INTO representative FROM users_userprofile WHERE uuid = proposal.requester_profile_id FOR UPDATE;
    SELECT * INTO issuer FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    SELECT * INTO proposal FROM companies_companyauthorityrequest WHERE uuid = NEW.request_id FOR UPDATE;
    SELECT * INTO provider_check FROM companies_companyregistrycheck WHERE uuid = NEW.registry_check_id FOR SHARE;
    SELECT issuer_kyc_required INTO requires_identity FROM operators_operator WHERE id = 1 FOR SHARE;
    IF current_user = %s OR principal IS DISTINCT FROM actor.id
        OR actor.id IS NULL OR NOT actor.is_active OR NOT actor.is_email_verified
        OR representative.user_id IS DISTINCT FROM actor.id
        OR issuer.uuid IS NULL OR issuer.owner_id IS DISTINCT FROM actor.id OR issuer.status IS DISTINCT FROM 'draft'
        OR proposal.company_id IS DISTINCT FROM issuer.uuid OR proposal.purpose IS DISTINCT FROM 'bootstrap'
        OR EXISTS (SELECT 1 FROM companies_companyauthorityrequestwithdrawal WHERE request_id = proposal.uuid)
        OR NEW.capabilities IS DISTINCT FROM proposal.requested_capabilities
        OR NEW.delegatable_capabilities IS DISTINCT FROM proposal.delegatable_capabilities
        OR NOT NEW.capabilities @> '["admin"]'::jsonb
        OR NEW.expires_at IS DISTINCT FROM proposal.requested_expires_at
        OR NEW.expires_at <= statement_timestamp()
        OR NEW.declaration_version IS DISTINCT FROM '2026-10-04' OR NEW.declaration_text IS DISTINCT FROM %s
        OR proposal.company_identity_raw IS DISTINCT FROM jsonb_build_object(
            'name', issuer.name, 'acn', issuer.acn, 'abn', issuer.abn, 'company_type', issuer.company_type)
        OR proposal.person_identity_raw IS DISTINCT FROM jsonb_build_object(
            'user_id', actor.id, 'profile_uuid', representative.uuid::text,
            'email', actor.email, 'full_name', COALESCE(representative.full_name, ''))
        OR COALESCE(requires_identity, false) AND NOT representative.is_id_verified
        OR provider_check.uuid IS NULL OR provider_check.company_id IS DISTINCT FROM issuer.uuid
        OR provider_check.initiated_by_id IS DISTINCT FROM actor.id
        OR provider_check.purpose IS DISTINCT FROM 'authority' OR provider_check.status IS DISTINCT FROM 'passed'
        OR provider_check.completed_at IS NULL OR provider_check.lifecycle_revision IS DISTINCT FROM issuer.lifecycle_revision
        OR provider_check.identity IS DISTINCT FROM proposal.company_identity
        OR provider_check.requested_name IS DISTINCT FROM issuer.name
        OR provider_check.requested_acn IS DISTINCT FROM issuer.acn OR provider_check.requested_abn IS DISTINCT FROM issuer.abn
    THEN
        RAISE EXCEPTION 'Initial company authority requires the exact current declaration, requester and ABR result'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER companies_initial_appointment_identity BEFORE INSERT OR UPDATE OR DELETE
ON companies_companyappointment FOR EACH ROW EXECUTE FUNCTION companies_guard_initial_appointment();
CREATE FUNCTION companies_guard_appointment_revocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    actor authentication_customuser;
    appointment companies_companyappointment;
    proposal companies_companyauthorityrequest;
    principal bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain immutable company appointment revocations' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO actor FROM authentication_customuser WHERE id = NEW.revoked_by_id FOR UPDATE;
    SELECT * INTO appointment FROM companies_companyappointment WHERE uuid = NEW.appointment_id FOR UPDATE;
    SELECT * INTO proposal FROM companies_companyauthorityrequest WHERE uuid = appointment.request_id FOR SHARE;
    IF current_user = %s OR principal IS DISTINCT FROM actor.id
        OR actor.id IS NULL OR NOT actor.is_active OR NOT actor.is_email_verified
        OR appointment.uuid IS NULL OR proposal.requester_id IS DISTINCT FROM actor.id
    THEN
        RAISE EXCEPTION 'Only the exact active appointee can revoke their appointment' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER companies_appointment_revocation_identity BEFORE INSERT OR UPDATE OR DELETE
ON companies_companyappointmentrevocation FOR EACH ROW EXECUTE FUNCTION companies_guard_appointment_revocation();
""",
            [settings.RLS_ROLES["app"], DECLARATION, settings.RLS_ROLES["app"]],
        )
        cursor.execute("SELECT pg_get_functiondef('companies_guard_authority_request_withdrawal'::regproc)")
        guard = cursor.fetchone()[0]
        cursor.execute(guard.replace("    RETURN NEW;", WITHDRAWAL_CHECK + "    RETURN NEW;"))
        for role in (settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]):
            cursor.execute("SELECT quote_ident(%s)", [role])
            quoted_role = cursor.fetchone()[0]
            for table in tables:
                cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO {quoted_role}")


def remove_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "LOCK TABLE companies_companyappointment, companies_companyappointmentrevocation IN ACCESS EXCLUSIVE MODE"
        )
        cursor.execute("SELECT EXISTS (SELECT 1 FROM companies_companyappointment)")
        if cursor.fetchone()[0]:
            raise RuntimeError(
                "Retain company appointments, declarations and revocations; downgrade would discard authority history."
            )
        cursor.execute("SELECT pg_get_functiondef('companies_guard_authority_request_withdrawal'::regproc)")
        guard = cursor.fetchone()[0]
        if guard.count(WITHDRAWAL_CHECK) != 1:
            raise RuntimeError(
                "The authority withdrawal guard no longer has the admission check this migration removes."
            )
        cursor.execute(guard.replace(WITHDRAWAL_CHECK, ""))
        cursor.execute(
            "DROP TRIGGER companies_appointment_revocation_identity ON companies_companyappointmentrevocation"
        )
        cursor.execute("DROP FUNCTION companies_guard_appointment_revocation()")
        cursor.execute("DROP TRIGGER companies_initial_appointment_identity ON companies_companyappointment")
        cursor.execute("DROP FUNCTION companies_guard_initial_appointment()")


def identity_fields():
    return [
        (
            "uuid",
            models.UUIDField(
                default=uuid.uuid4,
                editable=False,
                help_text="Unique identifier (primary key)",
                primary_key=True,
                serialize=False,
            ),
        ),
        ("created_at", models.DateTimeField(auto_now_add=True)),
        ("updated_at", models.DateTimeField(auto_now=True)),
    ]


class Migration(migrations.Migration):
    dependencies = [
        ("companies", "0014_authority_request_capabilities_refuse_null"),
        ("users", "0031_protected_identity_results"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AlterField(
            model_name="companyregistrycheck",
            name="purpose",
            field=models.CharField(
                choices=[
                    ("authority", "Representative authority"),
                    ("review", "Start review"),
                    ("retry", "Retry"),
                    ("activation", "Activation"),
                ],
                max_length=16,
            ),
        ),
        migrations.CreateModel(
            name="CompanyAppointment",
            fields=identity_fields()
            + [
                ("capabilities", models.JSONField(editable=False)),
                ("delegatable_capabilities", models.JSONField(editable=False)),
                ("expires_at", models.DateTimeField(editable=False, null=True)),
                ("declaration_version", models.CharField(editable=False, max_length=10)),
                ("declaration_text", models.TextField(editable=False)),
                (
                    "company",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="initial_appointment",
                        to="companies.company",
                    ),
                ),
                (
                    "request",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="appointment",
                        to="companies.companyauthorityrequest",
                    ),
                ),
                (
                    "registry_check",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="+",
                        to="companies.companyregistrycheck",
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="CompanyAppointmentRevocation",
            fields=identity_fields()
            + [
                (
                    "appointment",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="revocation",
                        to="companies.companyappointment",
                    ),
                ),
                (
                    "revoked_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
        ),
        migrations.RunPython(install_guards, remove_guards),
    ]
