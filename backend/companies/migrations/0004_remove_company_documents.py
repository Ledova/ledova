from functools import partial

from django.conf import settings
from django.db import migrations

from shared.db import on_commit
from shared.db.policy_sql import install as install_policies
from tokens import database_guards as tokens_guards
from tokens.database_mirror_guards import _function

REPLACED = (
    (tokens_guards.SQL, "tokens_guard_register_instruction"),
    (tokens_guards.SQL, "tokens_guard_company_issue"),
)

REMOVED = (
    "DROP TRIGGER IF EXISTS companies_identity_document_verification ON companies_company",
    "DROP TRIGGER IF EXISTS companies_document_verification ON companies_companydocument",
    "DROP TRIGGER IF EXISTS companies_document_administration ON companies_companydocument",
    "DROP TRIGGER IF EXISTS companies_document_command_locks ON companies_companydocument",
    "DROP FUNCTION IF EXISTS companies_revoke_document_verification()",
    "DROP FUNCTION IF EXISTS companies_guard_document_verification()",
    "DROP FUNCTION IF EXISTS companies_guard_document_administration()",
    "DROP FUNCTION IF EXISTS companies_lock_document_command()",
)


def remove_documents(apps, schema_editor):
    alias = schema_editor.connection.alias
    postgresql = schema_editor.connection.vendor == "postgresql"
    if postgresql:
        with schema_editor.connection.cursor() as cursor:
            cursor.execute("SET LOCAL row_security = off")
    documents = apps.get_model("companies", "CompanyDocument").objects.using(alias)
    for document in documents.exclude(file="").exclude(file__isnull=True).only("file"):
        on_commit(partial(document.file.storage.delete, document.file.name), using=alias)
    apps.get_model("contenttypes", "ContentType").objects.using(alias).filter(
        app_label="companies", model="companydocument"
    ).delete()
    if not postgresql:
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
        ("companies", "0003_remove_registry_checks"),
        ("contenttypes", "0002_remove_content_type_name"),
        ("shareholders", "0002_remove_publications"),
    ]

    operations = [
        migrations.RunPython(remove_documents),
        migrations.DeleteModel(
            name="CompanyDocument",
        ),
    ]
