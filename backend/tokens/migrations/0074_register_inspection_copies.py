from django.db import migrations, models


def refuse_reversal(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE tokens_registerexport IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM tokens_registerexport WHERE kind = 'inspection_copy')")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain inspection copy records; downgrade would discard their digests and requests.")


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0073_register_instructions"),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterOutput",
            fields=[],
            options={
                "verbose_name": "register outputs",
                "verbose_name_plural": "register outputs",
                "proxy": True,
                "indexes": [],
                "constraints": [],
            },
            bases=("tokens.sharetoken",),
        ),
        migrations.AddField(
            model_name="registerexport",
            name="digest",
            field=models.CharField(blank=True, editable=False, max_length=64),
        ),
        migrations.AddField(
            model_name="registerexport",
            name="instruction",
            field=models.CharField(blank=True, editable=False, max_length=255),
        ),
        migrations.AddField(
            model_name="registerexport",
            name="late",
            field=models.BooleanField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="registerexport",
            name="recipient",
            field=models.CharField(blank=True, editable=False, max_length=255),
        ),
        migrations.AddField(
            model_name="registerexport",
            name="requested_on",
            field=models.DateField(editable=False, null=True),
        ),
        migrations.AlterField(
            model_name="registerexport",
            name="kind",
            field=models.CharField(
                choices=[("register_csv", "Register CSV"), ("inspection_copy", "Inspection copy")],
                editable=False,
                max_length=24,
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("kind", "inspection_copy"), _negated=True),
                    models.Q(
                        ("digest__regex", "^[0-9a-f]{64}$"),
                        ("late__isnull", False),
                        ("requested_on__isnull", False),
                        models.Q(("instruction__regex", "^\\s*$"), _negated=True),
                        models.Q(("recipient__regex", "^\\s*$"), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="register_export_inspection_copy_request",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("kind", "register_csv"), _negated=True),
                    models.Q(
                        ("digest", ""),
                        ("instruction", ""),
                        ("late__isnull", True),
                        ("recipient", ""),
                        ("requested_on__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="register_export_csv_carries_no_request",
            ),
        ),
        migrations.RunPython(migrations.RunPython.noop, refuse_reversal),
    ]
