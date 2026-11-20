from django.db import migrations, models

from companies.disposal_guards import install, widen_delete_gates


def no_staff_receipts(apps, schema_editor):
    if apps.get_model("companies", "CompanyDisposal").objects.using(schema_editor.connection.alias).exists():
        raise RuntimeError("Staff company-exit receipts exist; review them before removing their references.")


class Migration(migrations.Migration):
    dependencies = [
        ("companies", "0009_remove_retired_review"),
        ("tokens", "0014_empty_class_rights"),
    ]

    operations = [
        migrations.RunPython(no_staff_receipts, migrations.RunPython.noop),
        *(
            migrations.RemoveField(model_name="companydisposal", name=name)
            for name in (
                "digest",
                "authorisation_reference",
                "export_digest",
                "handover_reference",
                "purpose_review_reference",
                "pending_files",
                "completed_at",
            )
        ),
        migrations.AddField(
            model_name="companydisposal",
            name="actor_id",
            field=models.BigIntegerField(),
        ),
        migrations.AddField(
            model_name="companydisposal",
            name="appointment_id",
            field=models.UUIDField(null=True),
        ),
        migrations.RunPython(widen_delete_gates, migrations.RunPython.noop),
        migrations.RunPython(install, migrations.RunPython.noop),
    ]
