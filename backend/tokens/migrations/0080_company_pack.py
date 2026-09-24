from django.db import migrations, models

PREIMAGE = """
CREATE FUNCTION tokens_register_entry_preimage(entry tokens_registerentry) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT jsonb_build_array(
        'ledova-register-v1', entry.uuid, entry.register_id, entry.operation_id,
        entry.sequence, entry.kind, to_char(entry.effective_on, 'YYYY-MM-DD'),
        entry.changes, entry.corrects_id, entry.recorded_by_id, entry.previous_hash,
        to_char(entry.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
    )::text;
$$;
"""


def install_preimage(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(PREIMAGE)


def remove_preimage(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE tokens_registerexport IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM tokens_registerexport WHERE kind = 'company_pack')")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain company pack records; downgrade would discard their manifest digests.")
        cursor.execute("DROP FUNCTION tokens_register_entry_preimage(tokens_registerentry)")


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0079_order_submission_eligibility_refusal"),
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
                    ("notice_figures", "Notice figures"),
                    ("company_pack", "Company pack"),
                ],
                editable=False,
                max_length=24,
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("kind", "company_pack"), _negated=True),
                    models.Q(
                        ("digest__regex", "^[0-9a-f]{64}$"),
                        ("late__isnull", True),
                        ("requested_on__isnull", True),
                        models.Q(("instruction__regex", "^\\s*$"), _negated=True),
                        models.Q(("recipient__regex", "^\\s*$"), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="register_export_company_pack_shape",
            ),
        ),
        migrations.RunPython(install_preimage, remove_preimage),
    ]
