from django.db import migrations, models

REFRESH = "whitelist.tasks.refresh.refresh_whitelist_targets"


def remove_decision_refreshes(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "DELETE FROM procrastinate_jobs WHERE status = 'todo' AND task_name = %s "
            "AND args->>'decision_id' IS NOT NULL",
            [REFRESH],
        )
        cursor.execute(
            "UPDATE procrastinate_jobs SET args = args - 'decision_id' "
            "WHERE status = 'todo' AND task_name = %s AND args ? 'decision_id'",
            [REFRESH],
        )


class Migration(migrations.Migration):

    dependencies = [
        ("shareholders", "0002_remove_publications"),
        ("users", "0002_eligibility_participant_name"),
        ("whitelist", "0001_initial"),
    ]

    operations = [
        migrations.RunPython(remove_decision_refreshes),
        migrations.RemoveField(
            model_name="companywalletnomination",
            name="decision",
        ),
        migrations.RemoveField(
            model_name="companywalletnomination",
            name="request",
        ),
        migrations.RemoveField(
            model_name="whitelistchange",
            name="eligibility_decision",
        ),
        migrations.AlterField(
            model_name="whitelistchange",
            name="authority",
            field=models.CharField(
                choices=[
                    ("operator_api", "Operator API"),
                    ("whitelist_admin", "Whitelist administration"),
                    ("refresh", "Automatic invalidation"),
                    ("company", "Company instruction"),
                ],
                editable=False,
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name="whitelistchange",
            name="invalidation_cause",
            field=models.CharField(
                blank=True,
                choices=[
                    ("standing_loss", "Account standing lost"),
                    ("identity_loss", "Configured identity lost"),
                    ("wallet_removal", "Wallet removed or verification lost"),
                ],
                editable=False,
                max_length=32,
            ),
        ),
        migrations.AlterField(
            model_name="whitelisteligibilityinvalidation",
            name="cause",
            field=models.CharField(
                choices=[
                    ("standing_loss", "Account standing lost"),
                    ("identity_loss", "Configured identity lost"),
                    ("wallet_removal", "Wallet removed or verification lost"),
                ],
                editable=False,
                max_length=32,
            ),
        ),
    ]
