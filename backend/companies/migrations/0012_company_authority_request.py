import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import companies.models.authority_request
import shared.storage


def install_guards(apps, schema_editor):
    from shared.db.policy_sql import install_tables

    install_tables(schema_editor, ["companies_companyauthorityrequest"])
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            """
CREATE FUNCTION companies_guard_authority_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    actor authentication_customuser;
    representative users_userprofile;
    issuer companies_company;
    requested jsonb;
    delegated jsonb;
    principal bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain immutable company authority requests and their evidence' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO actor FROM authentication_customuser WHERE id = NEW.requester_id FOR KEY SHARE;
    SELECT * INTO representative FROM users_userprofile WHERE uuid = NEW.requester_profile_id FOR KEY SHARE;
    SELECT * INTO issuer FROM companies_company WHERE uuid = NEW.company_id FOR KEY SHARE;
    IF current_user = %s OR principal IS DISTINCT FROM NEW.requester_id
        OR actor.id IS NULL OR NOT actor.is_active OR NOT actor.is_email_verified
        OR representative.user_id IS DISTINCT FROM actor.id OR issuer.owner_id IS DISTINCT FROM actor.id
        OR issuer.status IS DISTINCT FROM 'draft' OR NEW.purpose <> 'bootstrap'
        OR NEW.company_identity_raw IS DISTINCT FROM jsonb_build_object(
            'name', issuer.name, 'acn', issuer.acn, 'abn', issuer.abn, 'company_type', issuer.company_type)
        OR NEW.person_identity_raw IS DISTINCT FROM jsonb_build_object(
            'user_id', actor.id, 'profile_uuid', representative.uuid::text,
            'email', actor.email, 'full_name', COALESCE(representative.full_name, ''))
        OR NEW.person_identity->>'user_id' IS DISTINCT FROM actor.id::text
        OR NEW.person_identity->>'profile_uuid' IS DISTINCT FROM representative.uuid::text
        OR NEW.company_identity->>'company_type' IS DISTINCT FROM issuer.company_type
        OR NEW.file_sha256 !~ '^[0-9a-f]{64}$' OR NEW.request_digest !~ '^[0-9a-f]{64}$'
        OR NEW.file_size <= 0 OR NEW.mime_type NOT IN ('application/pdf', 'image/png', 'image/jpeg')
        OR NEW.file !~ ('^companies/' || NEW.company_id || '/authority-requests/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
        OR length(NEW.original_filename) = 0 OR NEW.requested_expires_at <= statement_timestamp()
        OR jsonb_typeof(NEW.requested_capabilities) IS DISTINCT FROM 'array'
        OR jsonb_typeof(NEW.delegatable_capabilities) IS DISTINCT FROM 'array'
    THEN
        RAISE EXCEPTION 'Authority evidence requires the exact active requester and owned draft company'
            USING ERRCODE = '23514';
    END IF;
    SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb) INTO requested
        FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(NEW.requested_capabilities)) scope;
    SELECT COALESCE(jsonb_agg(value ORDER BY value), '[]'::jsonb) INTO delegated
        FROM (SELECT DISTINCT value FROM jsonb_array_elements_text(NEW.delegatable_capabilities)) scope;
    IF NEW.requested_capabilities IS DISTINCT FROM requested
        OR NEW.delegatable_capabilities IS DISTINCT FROM delegated
        OR jsonb_array_length(requested) + jsonb_array_length(delegated) = 0
        OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(requested || delegated) scope(value)
            WHERE value NOT IN ('admin', 'prepare', 'approve', 'apply', 'finance', 'read_register'))
    THEN
        RAISE EXCEPTION 'Request closed, canonical personal and delegation capability sets' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER companies_authority_request_identity BEFORE INSERT OR UPDATE OR DELETE
ON companies_companyauthorityrequest FOR EACH ROW EXECUTE FUNCTION companies_guard_authority_request();
""",
            [settings.RLS_ROLES["app"]],
        )
    with schema_editor.connection.cursor() as cursor:
        for role in (settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]):
            cursor.execute("SELECT quote_ident(%s)", [role])
            quoted_role = cursor.fetchone()[0]
            cursor.execute(
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON companies_companyauthorityrequest TO {quoted_role}"
            )


def remove_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE companies_companyauthorityrequest IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM companies_companyauthorityrequest)")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain company authority requests and private evidence; downgrade would discard them.")
        cursor.execute("DROP TRIGGER companies_authority_request_identity ON companies_companyauthorityrequest")
        cursor.execute("DROP FUNCTION companies_guard_authority_request()")


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0011_remove_company_api_key"),
        ("shared", "0003_rls_roles_and_grants"),
        ("users", "0030_join_activation_and_kyc_results"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="CompanyAuthorityRequest",
            fields=[
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
                ("idempotency_key", models.UUIDField()),
                ("purpose", models.CharField(default="bootstrap", editable=False, max_length=16)),
                ("company_identity_raw", models.JSONField(editable=False)),
                ("company_identity", models.JSONField(editable=False)),
                ("person_identity_raw", models.JSONField(editable=False)),
                ("person_identity", models.JSONField(editable=False)),
                ("requested_capabilities", models.JSONField(editable=False)),
                ("delegatable_capabilities", models.JSONField(editable=False)),
                ("requested_expires_at", models.DateTimeField(editable=False, null=True)),
                (
                    "file",
                    models.FileField(
                        max_length=255,
                        storage=shared.storage.private_storage,
                        upload_to=companies.models.authority_request.authority_evidence_path,
                    ),
                ),
                ("original_filename", models.CharField(editable=False, max_length=255)),
                ("file_size", models.PositiveIntegerField(editable=False)),
                ("mime_type", models.CharField(editable=False, max_length=100)),
                ("file_sha256", models.CharField(editable=False, max_length=64)),
                ("request_digest", models.CharField(editable=False, max_length=64)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="authority_requests",
                        to="companies.company",
                    ),
                ),
                (
                    "requester",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "requester_profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="users.userprofile"
                    ),
                ),
            ],
            options={
                "ordering": ["-created_at", "-uuid"],
                "constraints": [
                    models.UniqueConstraint(
                        fields=("requester", "idempotency_key"), name="company_authority_request_key"
                    )
                ],
            },
        ),
        migrations.RunPython(install_guards, remove_guards),
    ]
