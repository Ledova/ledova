from functools import partial
from pathlib import Path

from django.conf import settings
from django.db import migrations
from django.db.models import Q

from companies.disposal_guards import install as install_disposal
from shared.db import on_commit
from tokens.database_mirror_guards import _function
from tokens.database_mirror_guards import install as install_mirror

GUARDS = ("tokens_guard_register_correction", "tokens_guard_register_correction_decision")
OBSOLETE_TRIGGERS = (
    ("tokens_register_correction_decision_effect", "tokens_registercorrectiondecision"),
    ("tokens_register_correction_entry", "tokens_registerentry"),
    ("tokens_register_correction_entry_effect", "tokens_registerentry"),
)
OBSOLETE_FUNCTIONS = (
    "tokens_check_correction_register_entry()",
    "tokens_check_register_correction_decision()",
    "tokens_guard_correction_register_entry()",
    "tokens_register_correction_approved(uuid, timestamp with time zone)",
    "tokens_register_correction_decision_digest(uuid, text, bigint, uuid, text)",
)


def drop_unapplied_corrections(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    from companies.models import DeletionScope
    from companies.services.company_deletion import discard, follow_ups, remove
    from tokens.models import RegisterCorrection, RegisterCorrectionDecision

    install_disposal(apps, schema_editor)
    alias = schema_editor.connection.alias
    for correction in RegisterCorrection.objects.using(alias).exclude(status="applied").order_by("pk"):
        with schema_editor.connection.cursor() as cursor:
            cursor.execute(
                "SELECT set_config('app.user_id', %s, true), set_config('app.company_id', %s, true), "
                "set_config('app.company_operation', 'schema_migration', true)",
                [str(correction.submitted_by_id), str(correction.company_id)],
            )
        rows = {
            RegisterCorrection: list(RegisterCorrection.objects.using(alias).filter(pk=correction.pk).values()),
            RegisterCorrectionDecision: list(
                RegisterCorrectionDecision.objects.using(alias)
                .filter(register_correction_id=correction.pk)
                .order_by("pk")
                .values()
            ),
        }
        files = [row["file"] for row in rows[RegisterCorrection] if row["file"]]
        remove(
            company_id=correction.company_id,
            actor_id=correction.submitted_by_id,
            appointment_id=None,
            scope=DeletionScope.PROPOSAL,
            rows=follow_ups(rows, lambda data: Q(pk__in=[]), alias),
            alias=alias,
        )
        on_commit(partial(discard, files), using=alias)
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT set_config('app.user_id', '', true), set_config('app.company_id', '', true), "
            "set_config('app.company_operation', '', true), set_config('app.company_disposal', '', true)"
        )


def retire_correction_guards(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    source = (Path(__file__).resolve().parents[1] / "database_guards.sql").read_text()
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"], settings.RLS_ROLES["app"]],
        )
        operator, migrate, app = cursor.fetchone()
        for name in GUARDS:
            statement = _function(source, name)
            cursor.execute(
                statement.replace("__OPERATOR__", operator).replace("__MIGRATE__", migrate).replace("__APP__", app)
            )
        for trigger, table in OBSOLETE_TRIGGERS:
            cursor.execute(f"DROP TRIGGER IF EXISTS {trigger} ON {table}")
        for function in OBSOLETE_FUNCTIONS:
            cursor.execute(f"DROP FUNCTION IF EXISTS public.{function}")
    install_mirror(apps, schema_editor)


class Migration(migrations.Migration):
    dependencies = [
        ("companies", "0015_entry_deletion_scope"),
        ("tokens", "0015_hard_delete_classes"),
    ]

    operations = [
        migrations.RunPython(drop_unapplied_corrections, migrations.RunPython.noop),
        migrations.RunPython(retire_correction_guards, migrations.RunPython.noop),
    ]
