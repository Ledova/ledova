from django.db import migrations, models


def refuse_reversal(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE tokens_registerexport IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM tokens_registerexport WHERE kind = 'notice_figures')")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain notice figures records; downgrade would discard their digests and periods.")


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0077_import_opening"),
    ]

    operations = [
        migrations.AddField(
            model_name="registerexport",
            name="period_from",
            field=models.DateField(editable=False, null=True),
        ),
        migrations.AlterField(
            model_name="registerexport",
            name="kind",
            field=models.CharField(
                choices=[
                    ("register_csv", "Register CSV"),
                    ("inspection_copy", "Inspection copy"),
                    ("certificate", "Certificate"),
                    ("notice_figures", "Notice figures"),
                ],
                editable=False,
                max_length=24,
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("kind", "notice_figures"), _negated=True),
                    models.Q(
                        ("digest__regex", "^[0-9a-f]{64}$"),
                        ("former_rows", 0),
                        ("late__isnull", True),
                        ("period_from__isnull", False),
                        ("recipient", ""),
                        ("requested_on__isnull", True),
                        models.Q(("instruction__regex", "^\\s*$"), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="register_export_notice_figures_shape",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(("kind", "notice_figures"), ("period_from__isnull", True), _connector="OR"),
                name="register_export_period_only_for_notice_figures",
            ),
        ),
        migrations.RunPython(migrations.RunPython.noop, refuse_reversal),
    ]
