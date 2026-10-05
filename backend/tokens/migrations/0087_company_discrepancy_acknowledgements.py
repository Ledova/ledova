from importlib import import_module

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

OPENING_IMPORT = import_module("tokens.migrations.0077_import_opening")
COMPANY_IMPORTS = import_module("tokens.migrations.0084_company_register_import_guards")

ACKNOWLEDGEMENT_GUARD_AS_0070_INSTALLED_IT = """
CREATE OR REPLACE FUNCTION tokens_guard_register_acknowledgement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    acknowledged tokens_registerreconciliation;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain register acknowledgements as recorded' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO acknowledged FROM tokens_registerreconciliation WHERE uuid = NEW.reconciliation_id;
    IF current_user = %s
        OR acknowledged.token_id IS DISTINCT FROM NEW.token_id
        OR COALESCE(NEW.discrepancy->>'kind', '') NOT IN ('unrecognised_transfer', 'member', 'unlinked', 'supply')
        OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(acknowledged.discrepancies) item
            WHERE item = NEW.discrepancy)
        OR length(btrim(NEW.reason)) = 0
        OR NOT EXISTS (SELECT 1 FROM authentication_customuser
            WHERE id = NEW.acknowledged_by_id AND is_active AND is_staff)
    THEN
        RAISE EXCEPTION 'Active staff acknowledge one exact discrepancy of a reconciliation, with a reason'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
"""

COMPANY_RUN = (
    (
        """CREATE OR REPLACE FUNCTION tokens_guard_register_acknowledgement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    acknowledged tokens_registerreconciliation;
""",
        """CREATE OR REPLACE FUNCTION tokens_guard_register_acknowledgement() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    acknowledged tokens_registerreconciliation;
    principal bigint;
    issuer uuid;
    at_time timestamptz;
""",
    ),
    (
        """    SELECT * INTO acknowledged FROM tokens_registerreconciliation WHERE uuid = NEW.reconciliation_id;
    IF current_user = %s
""",
        """    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    SELECT company_id INTO issuer FROM tokens_sharetoken WHERE uuid = NEW.token_id;
    PERFORM 1 FROM companies_company WHERE uuid = issuer FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = NEW.token_id FOR UPDATE;
    SELECT * INTO acknowledged FROM tokens_registerreconciliation WHERE uuid = NEW.reconciliation_id;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__)
        OR NEW.acknowledged_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_discrepancy_acknowledge'
        OR current_setting('app.company_id', true) IS DISTINCT FROM issuer::text
        OR NEW.idempotency_key IS NULL
        OR NOT tokens_register_appointment_current(NEW.appointment_id, issuer, principal, 'approve', at_time)
        OR EXISTS (SELECT 1 FROM tokens_registerreconciliation later
            WHERE later.token_id = acknowledged.token_id
                AND (later.created_at, later.uuid) > (acknowledged.created_at, acknowledged.uuid))
""",
    ),
    (
        """        OR length(btrim(NEW.reason)) = 0
        OR NOT EXISTS (SELECT 1 FROM authentication_customuser
            WHERE id = NEW.acknowledged_by_id AND is_active AND is_staff)
    THEN
        RAISE EXCEPTION 'Active staff acknowledge one exact discrepancy of a reconciliation, with a reason'
""",
        """        OR NEW.reason !~ '[^[:space:]]'
    THEN
        RAISE EXCEPTION 'A current company approver acknowledges one exact current discrepancy, with a reason'
""",
    ),
    (
        """            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
""",
        """            USING ERRCODE = '23514';
    END IF;
    NEW.created_at := at_time;
    NEW.updated_at := at_time;
    RETURN NEW;
""",
    ),
)
ACKNOWLEDGEMENT_GUARD = OPENING_IMPORT._replaced(ACKNOWLEDGEMENT_GUARD_AS_0070_INSTALLED_IT, COMPANY_RUN)
REFUSE_REVERSAL = """
DO $$ BEGIN
    LOCK TABLE tokens_registeracknowledgement IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM tokens_registeracknowledgement WHERE appointment_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Retain company acknowledgements of register discrepancies';
    END IF;
END $$;
"""


def install_company_acknowledgements(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(COMPANY_IMPORTS._with_roles(cursor, ACKNOWLEDGEMENT_GUARD))


def remove_company_acknowledgements(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(REFUSE_REVERSAL)
        cursor.execute(ACKNOWLEDGEMENT_GUARD_AS_0070_INSTALLED_IT, [settings.RLS_ROLES["app"]])


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0022_company_wallet_lock_order"),
        ("tokens", "0084_company_register_import_guards"),
    ]

    operations = [
        migrations.AddField(
            model_name="registeracknowledgement",
            name="appointment",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.companyappointment",
            ),
        ),
        migrations.AddField(
            model_name="registeracknowledgement",
            name="idempotency_key",
            field=models.UUIDField(editable=False, null=True),
        ),
        migrations.AddConstraint(
            model_name="registeracknowledgement",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("appointment__isnull", True), ("idempotency_key__isnull", True)),
                    models.Q(("appointment__isnull", False), ("idempotency_key__isnull", False)),
                    _connector="OR",
                ),
                name="register_acknowledgement_exact_provenance",
            ),
        ),
        migrations.AddConstraint(
            model_name="registeracknowledgement",
            constraint=models.UniqueConstraint(
                condition=models.Q(("idempotency_key__isnull", False)),
                fields=("acknowledged_by_id", "idempotency_key"),
                name="one_register_acknowledgement_per_key",
            ),
        ),
        migrations.RunPython(install_company_acknowledgements, remove_company_acknowledgements),
    ]
