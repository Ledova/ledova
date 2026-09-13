from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0023_one_account_per_person"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunSQL(
                    "ALTER TABLE customer_accounts_account DROP COLUMN IF EXISTS director_id",
                    "ALTER TABLE customer_accounts_account ADD COLUMN IF NOT EXISTS director_id uuid NULL",
                )
            ],
            state_operations=[migrations.RemoveField(model_name="useraccount", name="director")],
        )
    ]
