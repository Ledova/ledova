from django.conf import settings
from django.db import migrations, models


def retire_review(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT quote_literal(%s)", [settings.RLS_ROLES["operator"]])
        operator = cursor.fetchone()[0]
        cursor.execute(f"""
CREATE FUNCTION users_refuse_retired_classification_review() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
    IF current_user = {operator}
        AND current_setting('app.classification_evidence_operation', true) = 'review' THEN
        RAISE EXCEPTION 'Staff source review is retired; retain the source and record the company decision'
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER aaa_users_classification_review_retired BEFORE UPDATE ON users_investorclassification
FOR EACH STATEMENT EXECUTE FUNCTION users_refuse_retired_classification_review();
""")


def restore_review(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT EXISTS (SELECT user_account_id FROM users_investorclassification "
            "WHERE status = 'submitted' GROUP BY user_account_id HAVING count(*) > 1)"
        )
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain all private submitted sources; the retired one-open constraint cannot return.")
        cursor.execute("DROP TRIGGER aaa_users_classification_review_retired ON users_investorclassification")
        cursor.execute("DROP FUNCTION users_refuse_retired_classification_review()")


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0034_company_eligibility_consumption"),
        ("shared", "0015_scoped_grants_queue_prerequisite"),
    ]
    operations = [
        migrations.RemoveConstraint(
            model_name="investorclassification",
            name="investor_classification_one_open_submission",
        ),
        migrations.AlterField(
            model_name="investorclassification",
            name="company",
            field=models.ForeignKey(
                blank=True,
                help_text="Source issuer for an associated person. Company eligibility requires a separate retained decision.",
                null=True,
                on_delete=models.SET_NULL,
                related_name="investor_classifications",
                to="companies.company",
            ),
        ),
        migrations.RunPython(retire_review, restore_review),
    ]
