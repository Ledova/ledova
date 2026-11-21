from django.conf import settings
from django.db import migrations, models

from tokens.database_mirror_guards import _function
from users import database_guards as users_guards

IDENTITY_REJECTIONS = ("pep_policy", "fatf_blacklist")


def remove_identity_guard(apps, schema_editor):
    alias = schema_editor.connection.alias
    apps.get_model("contenttypes", "ContentType").objects.using(alias).filter(
        app_label="users", model="accounterasureworkitem"
    ).delete()
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT quote_literal(%s)", [settings.RLS_ROLES["app"]])
        (app,) = cursor.fetchone()
        cursor.execute("DROP TRIGGER IF EXISTS users_provider_identity ON users_userprofile")
        cursor.execute("DROP FUNCTION IF EXISTS users_guard_provider_identity()")
        cursor.execute(_function(users_guards.SQL, "users_guard_profile_save").replace("@APP_ROLE@", app))
        cursor.execute("DROP TRIGGER IF EXISTS users_profile_save ON users_userprofile")
        cursor.execute(
            "CREATE TRIGGER users_profile_save BEFORE INSERT OR UPDATE ON users_userprofile "
            "FOR EACH ROW EXECUTE FUNCTION users_guard_profile_save()"
        )
        cursor.execute(
            "UPDATE customer_accounts_account SET account_status = 'pending', rejection_reason = '' "
            "WHERE account_status = 'rejected' AND rejection_reason = ANY(%s)",
            [list(IDENTITY_REJECTIONS)],
        )


class Migration(migrations.Migration):

    dependencies = [
        ("contenttypes", "0002_remove_content_type_name"),
        ("users", "0005_remove_eligibility_answers"),
    ]

    operations = [
        migrations.RunPython(remove_identity_guard, migrations.RunPython.noop),
        migrations.RemoveConstraint(
            model_name="accounterasureworkitem",
            name="users_pending_provider_erasure",
        ),
        migrations.RemoveConstraint(
            model_name="accounterasureworkitem",
            name="users_provider_erasure_completion",
        ),
        migrations.RemoveConstraint(
            model_name="accounterasureworkitem",
            name="users_provider_erasure_hold",
        ),
        migrations.RemoveField(
            model_name="userprofile",
            name="id_document_country",
        ),
        migrations.RemoveField(
            model_name="userprofile",
            name="id_document_type",
        ),
        migrations.RemoveField(
            model_name="userprofile",
            name="is_id_verified",
        ),
        migrations.RemoveField(
            model_name="userprofile",
            name="kyc_provider",
        ),
        migrations.RemoveField(
            model_name="userprofile",
            name="kycaid_applicant_id",
        ),
        migrations.RemoveField(
            model_name="userprofile",
            name="rejection_labels",
        ),
        migrations.RemoveField(
            model_name="userprofile",
            name="review_result",
        ),
        migrations.RemoveField(
            model_name="userprofile",
            name="sumsub_applicant_id",
        ),
        migrations.RemoveField(
            model_name="userprofile",
            name="sumsub_verification_status",
        ),
        migrations.RemoveField(
            model_name="userprofile",
            name="verification_status",
        ),
        migrations.RemoveField(
            model_name="userprofile",
            name="verified_at",
        ),
        migrations.AlterField(
            model_name="useraccount",
            name="account_status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"),
                    ("active", "Active"),
                    ("rejected", "Rejected"),
                    ("suspended", "Suspended"),
                    ("terminated", "Terminated"),
                ],
                default="pending",
                max_length=20,
            ),
        ),
        migrations.DeleteModel(
            name="AccountErasureWorkItem",
        ),
    ]
