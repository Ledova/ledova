from functools import partial

from django.conf import settings
from django.db import migrations

from shared.db import on_commit
from shared.db.policy_sql import install as install_policies
from tokens import database_guards
from tokens.database_mirror_guards import _function

REPLACED = ((database_guards.MEMBER_SQL, "tokens_check_member_source"),)

REMOVED = (
    "DROP TRIGGER IF EXISTS tokens_member_certificate_fulfilment_identity ON tokens_membercertificatefulfilment",
    "DROP TRIGGER IF EXISTS tokens_member_certificate_fulfilment_commit ON tokens_membercertificatefulfilment",
    "DROP TRIGGER IF EXISTS tokens_member_certificate_withdrawal_identity ON tokens_membercertificatewithdrawal",
    "DROP TRIGGER IF EXISTS tokens_member_certificate_withdrawal_commit ON tokens_membercertificatewithdrawal",
    "DROP TRIGGER IF EXISTS tokens_member_certificate_request_identity ON tokens_membercertificaterequest",
    "DROP TRIGGER IF EXISTS tokens_member_certificate_request_commit ON tokens_membercertificaterequest",
    "DROP FUNCTION IF EXISTS tokens_guard_member_certificate_fulfilment()",
    "DROP FUNCTION IF EXISTS tokens_check_member_certificate_fulfilment()",
    "DROP FUNCTION IF EXISTS tokens_member_certificate_source_digest(uuid)",
    "DROP FUNCTION IF EXISTS tokens_member_certificate_source(uuid)",
    "DROP FUNCTION IF EXISTS tokens_member_certificate_producer_current(uuid, uuid, bigint)",
    "DROP FUNCTION IF EXISTS tokens_guard_member_certificate_withdrawal()",
    "DROP FUNCTION IF EXISTS tokens_guard_member_certificate_request()",
    "DROP FUNCTION IF EXISTS tokens_member_certificate_entry(uuid, uuid)",
)


def remove_certificate_requests(apps, schema_editor):
    alias = schema_editor.connection.alias
    for output in apps.get_model("tokens", "MemberCertificateFulfilment").objects.using(alias).only("file"):
        on_commit(partial(output.file.storage.delete, output.file.name), using=alias)
    if schema_editor.connection.vendor != "postgresql":
        return
    install_policies(schema_editor)
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
        for statement in REMOVED:
            cursor.execute(statement)


class Migration(migrations.Migration):

    dependencies = [
        ("shared", "0002_database_guards"),
        ("tokens", "0004_one_step_particulars_edit"),
    ]

    operations = [
        migrations.RunPython(remove_certificate_requests),
        migrations.DeleteModel(
            name="MemberCertificateFulfilment",
        ),
        migrations.DeleteModel(
            name="MemberCertificateWithdrawal",
        ),
        migrations.DeleteModel(
            name="MemberCertificateRequest",
        ),
    ]
