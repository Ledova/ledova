from functools import partial

from django.db import migrations

from shared.db import on_commit

MODELS = ("document", "documentextraction", "documentread")
TASKS = ("documents.tasks.extract.extract_document", "documents.tasks.retention.purge_document_evidence")


def remove_documents(apps, schema_editor):
    alias = schema_editor.connection.alias
    for document in apps.get_model("documents", "Document").objects.using(alias).exclude(file="").only("file"):
        on_commit(partial(document.file.storage.delete, document.file.name), using=alias)
    apps.get_model("contenttypes", "ContentType").objects.using(alias).filter(
        app_label="documents", model__in=MODELS
    ).delete()
    if schema_editor.connection.vendor == "postgresql":
        with schema_editor.connection.cursor() as cursor:
            cursor.execute(
                "DELETE FROM procrastinate_jobs WHERE status = 'todo' AND task_name = ANY(%s)", [list(TASKS)]
            )


class Migration(migrations.Migration):

    dependencies = [
        ("contenttypes", "0002_remove_content_type_name"),
        ("documents", "0001_initial"),
        ("shared", "0002_database_guards"),
        ("shareholders", "0002_remove_publications"),
    ]

    operations = [
        migrations.RunPython(remove_documents),
        migrations.DeleteModel(
            name="DocumentRead",
        ),
        migrations.DeleteModel(
            name="DocumentExtraction",
        ),
        migrations.DeleteModel(
            name="Document",
        ),
    ]
