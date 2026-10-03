import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def install_guards(apps, schema_editor):
    from shared.db.policy_sql import install_tables

    install_tables(schema_editor, ["companies_companyauthorityrequestwithdrawal"])
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            """
CREATE FUNCTION companies_guard_authority_request_withdrawal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    actor authentication_customuser;
    proposal companies_companyauthorityrequest;
    principal bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain immutable authority request withdrawal history' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO actor FROM authentication_customuser WHERE id = NEW.withdrawn_by_id FOR KEY SHARE;
    SELECT * INTO proposal FROM companies_companyauthorityrequest WHERE uuid = NEW.request_id FOR UPDATE;
    IF current_user = %s OR principal IS DISTINCT FROM NEW.withdrawn_by_id
        OR actor.id IS NULL OR NOT actor.is_active OR NOT actor.is_email_verified
        OR proposal.uuid IS NULL OR proposal.requester_id IS DISTINCT FROM actor.id
    THEN
        RAISE EXCEPTION 'Only the exact active requester can withdraw an authority request'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER companies_authority_request_withdrawal_identity BEFORE INSERT OR UPDATE OR DELETE
ON companies_companyauthorityrequestwithdrawal FOR EACH ROW
EXECUTE FUNCTION companies_guard_authority_request_withdrawal();
""",
            [settings.RLS_ROLES["app"]],
        )
        for role in (settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]):
            cursor.execute("SELECT quote_ident(%s)", [role])
            quoted_role = cursor.fetchone()[0]
            cursor.execute(
                f"GRANT SELECT, INSERT, UPDATE, DELETE ON companies_companyauthorityrequestwithdrawal TO {quoted_role}"
            )


def remove_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE companies_companyauthorityrequestwithdrawal IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM companies_companyauthorityrequestwithdrawal)")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain authority request withdrawals; downgrade would discard cancellation history.")
        cursor.execute(
            "DROP TRIGGER companies_authority_request_withdrawal_identity ON companies_companyauthorityrequestwithdrawal"
        )
        cursor.execute("DROP FUNCTION companies_guard_authority_request_withdrawal()")


class Migration(migrations.Migration):
    dependencies = [
        ("companies", "0012_company_authority_request"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="CompanyAuthorityRequestWithdrawal",
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
                (
                    "request",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="withdrawal",
                        to="companies.companyauthorityrequest",
                    ),
                ),
                (
                    "withdrawn_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
        ),
        migrations.RunPython(install_guards, remove_guards),
    ]
