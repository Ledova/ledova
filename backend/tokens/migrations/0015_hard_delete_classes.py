from pathlib import Path

from django.db import migrations, models

from tokens.database_class_details import install as install_class_guards

GATE = (
    "    IF TG_OP = 'DELETE' THEN\n"
    "        IF companies_disposal_allows(TG_TABLE_NAME, OLD.uuid) THEN RETURN OLD; END IF;\n"
    "    END IF;\n"
)


def detach_particulars(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    source = (Path(__file__).resolve().parents[1] / "database_allotment_guards.sql").read_text()
    start = source.index("CREATE OR REPLACE FUNCTION public.tokens_guard_register_member_particulars()")
    begin = source.index(GATE, start) + len(GATE)
    branch = source[begin : source.index("    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) THEN", begin)]
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT pg_get_functiondef('public.tokens_guard_register_member_particulars()'::regprocedure)")
        definition = cursor.fetchone()[0]
        if "particulars#detach" in definition:
            return
        if definition.count(GATE) != 1:
            raise RuntimeError("The member particulars guard no longer has its single delete gate.")
        cursor.execute(definition.replace(GATE, GATE + branch))


def purge_deleted_classes(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    from companies.models import DeletionScope
    from companies.services.company_deletion import remove
    from tokens.models import ShareToken
    from tokens.services.class_lifecycle import share_class_rows

    alias = schema_editor.connection.alias
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT uuid, company_id, deleted_by_id FROM tokens_sharetoken WHERE deleted_at IS NOT NULL ORDER BY uuid"
        )
        retired = cursor.fetchall()
    for token_id, company_id, actor_id in retired:
        with schema_editor.connection.cursor() as cursor:
            cursor.execute(
                "SELECT set_config('app.user_id', %s, true), set_config('app.company_id', %s, true), "
                "set_config('app.company_operation', 'schema_migration', true)",
                [str(actor_id), str(company_id)],
            )
        rows, detached = share_class_rows(ShareToken.objects.using(alias).get(pk=token_id), alias)
        remove(
            company_id=company_id,
            actor_id=actor_id,
            appointment_id=None,
            scope=DeletionScope.SHARE_CLASS,
            rows=rows,
            detached=detached,
            alias=alias,
        )
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT set_config('app.user_id', '', true), set_config('app.company_id', '', true), "
            "set_config('app.company_operation', '', true), set_config('app.company_disposal', '', true)"
        )


class Migration(migrations.Migration):
    dependencies = [
        ("companies", "0011_deletion_scope"),
        ("tokens", "0014_empty_class_rights"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="registermemberparticulars",
            name="register_member_particulars_one_source",
        ),
        migrations.AddConstraint(
            model_name="registermemberparticulars",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", False),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", False),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", False),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", False),
                    ),
                    models.Q(
                        ("source_allotment__isnull", False),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", False),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", False),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="register_member_particulars_at_most_one_source",
            ),
        ),
        migrations.RunPython(install_class_guards, migrations.RunPython.noop),
        migrations.RunPython(detach_particulars, migrations.RunPython.noop),
        migrations.RunPython(purge_deleted_classes, migrations.RunPython.noop),
        migrations.RemoveConstraint(
            model_name="sharetoken",
            name="share_class_deletion_attribution",
        ),
        migrations.RemoveConstraint(
            model_name="sharetoken",
            name="unique_company_symbol",
        ),
        migrations.AddConstraint(
            model_name="sharetoken",
            constraint=models.UniqueConstraint(fields=("company", "symbol"), name="unique_company_symbol"),
        ),
        migrations.RemoveField(
            model_name="sharetoken",
            name="deleted_at",
        ),
        migrations.RemoveField(
            model_name="sharetoken",
            name="deleted_by",
        ),
        migrations.AlterModelOptions(
            name="sharetoken",
            options={"ordering": ["-created_at"], "verbose_name": "Share Token", "verbose_name_plural": "Share Tokens"},
        ),
        migrations.AlterModelManagers(
            name="sharetoken",
            managers=[],
        ),
    ]
