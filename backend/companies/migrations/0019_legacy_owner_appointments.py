import json
import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

SOURCE_TABLE = "companies_companylegacyownersource"
PROVENANCE = "companies.0019_legacy_owner_appointments"
PERSONAL = ["admin"]
DELEGATABLE = ["admin", "apply", "approve", "finance", "prepare", "read_register"]
INVITED_ANCHOR = "    IF NEW.invitation_id IS NOT NULL THEN\n"
LEGACY_BRANCH = """    IF NEW.legacy_owner_id IS NOT NULL THEN
        RAISE EXCEPTION 'Legacy owner appointments can only be recorded by the upgrade'
            USING ERRCODE = '23514';
    END IF;
"""


def replace_once(body, old, new):
    if body.count(old) != 1:
        raise RuntimeError("The appointment guard no longer has the exact clause this migration changes.")
    return body.replace(old, new)


def lock_existing_owners(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE companies_company IN SHARE ROW EXCLUSIVE MODE")
        cursor.execute("SELECT uuid FROM companies_company ORDER BY uuid FOR UPDATE")
        cursor.fetchall()
        cursor.execute(
            "SELECT id FROM authentication_customuser WHERE id IN (SELECT owner_id FROM companies_company) "
            "ORDER BY id FOR UPDATE"
        )
        cursor.fetchall()
        cursor.execute(
            "SELECT uuid FROM users_userprofile WHERE user_id IN (SELECT owner_id FROM companies_company) "
            "ORDER BY user_id, uuid FOR UPDATE"
        )
        cursor.fetchall()
        cursor.execute("LOCK TABLE companies_companyappointment IN ACCESS EXCLUSIVE MODE")


def install_legacy_guards(apps, schema_editor):
    from shared.db.policy_sql import install_tables

    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT pg_get_functiondef('companies_guard_initial_appointment'::regproc)")
        cursor.execute(replace_once(cursor.fetchone()[0], INVITED_ANCHOR, LEGACY_BRANCH + INVITED_ANCHOR))
        cursor.execute("""
CREATE FUNCTION companies_guard_legacy_owner_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Retain immutable legacy owner sources' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER companies_legacy_owner_source_identity BEFORE INSERT OR UPDATE OR DELETE
ON companies_companylegacyownersource FOR EACH ROW EXECUTE FUNCTION companies_guard_legacy_owner_source();
""")
        for role in (settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]):
            cursor.execute("SELECT quote_ident(%s)", [role])
            cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {SOURCE_TABLE} TO {cursor.fetchone()[0]}")
    install_tables(schema_editor, (SOURCE_TABLE,))


def seed_legacy_owners(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT issuer.uuid, issuer.owner_id, profile.uuid "
            "FROM companies_company issuer LEFT JOIN users_userprofile profile ON profile.user_id = issuer.owner_id "
            "WHERE NOT EXISTS (SELECT 1 FROM companies_companyappointment appointment "
            "WHERE appointment.company_id = issuer.uuid "
            "AND (appointment.request_id IS NOT NULL OR appointment.legacy_owner_id IS NOT NULL)) "
            "ORDER BY issuer.uuid"
        )
        candidates = cursor.fetchall()
        if any(profile_id is None for _, _, profile_id in candidates):
            raise RuntimeError("Every legacy company owner must have their actual retained profile before upgrade.")
        cursor.execute(
            "ALTER TABLE companies_companyappointment DISABLE TRIGGER companies_initial_appointment_identity"
        )
        for company_id, owner_id, profile_id in candidates:
            source_id = uuid.uuid4()
            cursor.execute(
                f"INSERT INTO {SOURCE_TABLE} "
                "(uuid, created_at, updated_at, company_id, owner_id, owner_profile_id, provenance) "
                "VALUES (%s, clock_timestamp(), clock_timestamp(), %s, %s, %s, %s) RETURNING created_at",
                [source_id, company_id, owner_id, profile_id, PROVENANCE],
            )
            recorded_at = cursor.fetchone()[0]
            cursor.execute(
                "INSERT INTO companies_companyappointment "
                "(uuid, created_at, updated_at, company_id, appointee_id, appointee_profile_id, "
                "request_id, invitation_id, legacy_owner_id, registry_check_id, capabilities, "
                "delegatable_capabilities, expires_at, declaration_version, declaration_text) "
                "VALUES (%s, %s, %s, %s, %s, %s, NULL, NULL, %s, NULL, %s::jsonb, %s::jsonb, NULL, NULL, NULL)",
                [
                    uuid.uuid4(),
                    recorded_at,
                    recorded_at,
                    company_id,
                    owner_id,
                    profile_id,
                    source_id,
                    json.dumps(PERSONAL),
                    json.dumps(DELEGATABLE),
                ],
            )
        cursor.execute(
            f"SELECT count(*) FROM {SOURCE_TABLE} source "
            "JOIN companies_company issuer ON issuer.uuid = source.company_id "
            "JOIN users_userprofile profile ON profile.uuid = source.owner_profile_id "
            "JOIN companies_companyappointment appointment ON appointment.legacy_owner_id = source.uuid "
            "WHERE source.owner_id = issuer.owner_id AND profile.user_id = source.owner_id "
            "AND source.provenance = %s AND appointment.company_id = source.company_id "
            "AND appointment.appointee_id = source.owner_id AND appointment.appointee_profile_id = source.owner_profile_id "
            "AND appointment.request_id IS NULL AND appointment.invitation_id IS NULL "
            "AND appointment.registry_check_id IS NULL AND appointment.declaration_version IS NULL "
            "AND appointment.declaration_text IS NULL AND appointment.expires_at IS NULL "
            "AND appointment.capabilities = %s::jsonb AND appointment.delegatable_capabilities = %s::jsonb "
            "AND appointment.created_at = source.created_at",
            [PROVENANCE, json.dumps(PERSONAL), json.dumps(DELEGATABLE)],
        )
        if cursor.fetchone()[0] != len(candidates):
            raise RuntimeError("Legacy company appointments must match every exact retained owner source.")
        cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
        cursor.execute("ALTER TABLE companies_companyappointment ENABLE TRIGGER companies_initial_appointment_identity")
    install_legacy_guards(apps, schema_editor)


def remove_legacy_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE companies_company IN SHARE ROW EXCLUSIVE MODE")
        cursor.execute(
            f"LOCK TABLE {SOURCE_TABLE}, companies_companyappointment, companies_companyappointmentrevocation "
            "IN ACCESS EXCLUSIVE MODE"
        )
        cursor.execute(f"SELECT EXISTS (SELECT 1 FROM {SOURCE_TABLE})")
        sources_retained = cursor.fetchone()[0]
        cursor.execute("SELECT EXISTS (SELECT 1 FROM companies_companyappointment WHERE legacy_owner_id IS NOT NULL)")
        if sources_retained or cursor.fetchone()[0]:
            raise RuntimeError(
                "Retain legacy owner sources and appointments; downgrade would discard authority history."
            )
        cursor.execute("SELECT pg_get_functiondef('companies_guard_initial_appointment'::regproc)")
        cursor.execute(replace_once(cursor.fetchone()[0], LEGACY_BRANCH, ""))
        cursor.execute(f"DROP TRIGGER companies_legacy_owner_source_identity ON {SOURCE_TABLE}")
        cursor.execute("DROP FUNCTION companies_guard_legacy_owner_source()")


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0018_team_invitation_admission_guards"),
        ("users", "0031_protected_identity_results"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RunPython(lock_existing_owners, migrations.RunPython.noop),
        migrations.CreateModel(
            name="CompanyLegacyOwnerSource",
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
                ("provenance", models.CharField(editable=False, max_length=64)),
            ],
            options={
                "abstract": False,
            },
        ),
        migrations.RemoveConstraint(
            model_name="companyappointment",
            name="companies_one_initial_appointment_per_company",
        ),
        migrations.RemoveConstraint(
            model_name="companyappointment",
            name="companies_appointment_exact_source",
        ),
        migrations.AlterField(
            model_name="companyappointment",
            name="declaration_text",
            field=models.TextField(editable=False, null=True),
        ),
        migrations.AlterField(
            model_name="companyappointment",
            name="declaration_version",
            field=models.CharField(editable=False, max_length=10, null=True),
        ),
        migrations.AddField(
            model_name="companylegacyownersource",
            name="company",
            field=models.OneToOneField(
                editable=False,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="legacy_owner_source",
                to="companies.company",
            ),
        ),
        migrations.AddField(
            model_name="companylegacyownersource",
            name="owner",
            field=models.ForeignKey(
                editable=False,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="companylegacyownersource",
            name="owner_profile",
            field=models.ForeignKey(
                editable=False, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="users.userprofile"
            ),
        ),
        migrations.AddField(
            model_name="companyappointment",
            name="legacy_owner",
            field=models.OneToOneField(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="appointment",
                to="companies.companylegacyownersource",
            ),
        ),
        migrations.AddConstraint(
            model_name="companyappointment",
            constraint=models.UniqueConstraint(
                condition=models.Q(("request__isnull", False), ("legacy_owner__isnull", False), _connector="OR"),
                fields=("company",),
                name="companies_one_initial_appointment_per_company",
            ),
        ),
        migrations.AddConstraint(
            model_name="companyappointment",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("declaration_text__isnull", False),
                        ("declaration_version__isnull", False),
                        ("invitation__isnull", True),
                        ("legacy_owner__isnull", True),
                        ("registry_check__isnull", False),
                        ("request__isnull", False),
                    ),
                    models.Q(
                        ("declaration_text__isnull", False),
                        ("declaration_version__isnull", False),
                        ("invitation__isnull", False),
                        ("legacy_owner__isnull", True),
                        ("registry_check__isnull", True),
                        ("request__isnull", True),
                    ),
                    models.Q(
                        ("declaration_text__isnull", True),
                        ("declaration_version__isnull", True),
                        ("invitation__isnull", True),
                        ("legacy_owner__isnull", False),
                        ("registry_check__isnull", True),
                        ("request__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="companies_appointment_exact_source",
            ),
        ),
        migrations.RunPython(seed_legacy_owners, remove_legacy_guards),
    ]
