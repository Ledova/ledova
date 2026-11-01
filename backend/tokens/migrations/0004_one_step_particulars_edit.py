import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

from tokens import database_guards
from tokens.database_mirror_guards import _function

REPLACED = (
    (database_guards.SQL, "tokens_guard_register_particulars_change"),
    (database_guards.SQL, "tokens_check_register_particulars_edit"),
    (database_guards.SQL, "tokens_guard_register_particulars_decision"),
    (database_guards.ALLOTMENT_SQL, "tokens_guard_register_member_particulars"),
)

TRIGGERS = (
    "DROP TRIGGER IF EXISTS tokens_register_particulars_decision_effect ON tokens_registerparticularschangedecision",
    "DROP FUNCTION IF EXISTS tokens_check_register_particulars_decision()",
    "DROP TRIGGER IF EXISTS tokens_register_particulars_edit_commit ON tokens_registerparticularschange",
    "CREATE CONSTRAINT TRIGGER tokens_register_particulars_edit_commit AFTER INSERT ON tokens_registerparticularschange "
    "DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_register_particulars_edit()",
)


def install_edit_guards(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"], settings.RLS_ROLES["app"]],
        )
        operator, migrate, app = cursor.fetchone()
        for source, name in REPLACED:
            cursor.execute(
                _function(source, name)
                .replace("__OPERATOR__", operator)
                .replace("__MIGRATE__", migrate)
                .replace("__APP__", app)
            )
        for statement in TRIGGERS:
            cursor.execute(statement)


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0003_remove_member_particulars_requests"),
    ]

    operations = [
        migrations.AddField(
            model_name="registerparticularschange",
            name="previous_particulars",
            field=models.JSONField(editable=False, null=True),
        ),
        migrations.AlterField(
            model_name="registerparticularschange",
            name="reason",
            field=models.CharField(blank=True, max_length=1000),
        ),
        migrations.AlterField(
            model_name="registerparticularschange",
            name="supporting_evidence",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="tokens.registerevidence",
            ),
        ),
        migrations.RunPython(install_edit_guards),
    ]
