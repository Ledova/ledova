from django.db import migrations, models


def refuse_reversal(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE tokens_registerexport IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM tokens_registerexport WHERE kind = 'certificate')")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain certificate records; downgrade would discard their digests and instructions.")


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0074_register_inspection_copies"),
    ]

    operations = [
        migrations.AlterField(
            model_name="registerexport",
            name="kind",
            field=models.CharField(
                choices=[
                    ("register_csv", "Register CSV"),
                    ("inspection_copy", "Inspection copy"),
                    ("certificate", "Certificate"),
                ],
                editable=False,
                max_length=24,
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("kind", "certificate"), _negated=True),
                    models.Q(
                        ("digest__regex", "^[0-9a-f]{64}$"),
                        ("former_rows", 0),
                        ("late__isnull", True),
                        ("member_rows__gte", 1),
                        ("member_rows__lte", 2),
                        ("recipient", ""),
                        ("requested_on__isnull", True),
                        models.Q(("instruction__regex", "^\\s*$"), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="register_export_certificate_shape",
            ),
        ),
        migrations.RunPython(migrations.RunPython.noop, refuse_reversal),
    ]
