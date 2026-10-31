from django.db import migrations

from shared.db.policy_sql import install as install_policies
from tokens import database_guards, database_mirror_guards
from tokens.database_mirror_guards import _function

REPLACED = (
    (database_guards.SQL, "tokens_register_particulars_approved"),
    (database_guards.ALLOTMENT_SQL, "tokens_register_particulars_decision_digest"),
    (database_guards.MEMBER_SQL, "tokens_check_member_source"),
    (database_mirror_guards.SQL, "tokens_mirror_correction_ready"),
)

REMOVED = (
    "DROP TRIGGER IF EXISTS tokens_member_particulars_request_identity ON tokens_memberparticularsrequest",
    "DROP TRIGGER IF EXISTS tokens_member_particulars_request_commit ON tokens_memberparticularsrequest",
    "DROP TRIGGER IF EXISTS tokens_member_requested_change_source ON tokens_registerparticularschange",
    "DROP TRIGGER IF EXISTS tokens_member_requested_decision_source ON tokens_registerparticularschangedecision",
    "DROP TRIGGER IF EXISTS tokens_member_requested_decision_commit ON tokens_registerparticularschangedecision",
    "DROP FUNCTION IF EXISTS tokens_guard_member_particulars_request()",
    "DROP FUNCTION IF EXISTS tokens_guard_member_requested_change()",
    "DROP FUNCTION IF EXISTS tokens_guard_member_requested_decision()",
    "DROP FUNCTION IF EXISTS tokens_check_member_requested_decision()",
    "DROP FUNCTION IF EXISTS tokens_member_requested_change_ready(tokens_registerparticularschange, boolean)",
)


def remove_request_guards(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    install_policies(schema_editor)
    with schema_editor.connection.cursor() as cursor:
        for source, name in REPLACED:
            cursor.execute(_function(source, name))
        for statement in REMOVED:
            cursor.execute(statement)


class Migration(migrations.Migration):

    dependencies = [
        ("shared", "0002_database_guards"),
        ("tokens", "0002_registerexport_produced_through"),
    ]

    operations = [
        migrations.RunPython(remove_request_guards),
        migrations.RemoveField(
            model_name="registerparticularschange",
            name="member_request",
        ),
        migrations.DeleteModel(
            name="MemberParticularsRequest",
        ),
    ]
