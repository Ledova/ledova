from django.db import migrations

import tokens.database_event_date_guards


class Migration(migrations.Migration):
    dependencies = [
        ("shared", "0007_register_award_identity_guards"),
        ("tokens", "0008_company_event_dates"),
    ]

    operations = [migrations.RunPython(tokens.database_event_date_guards.install)]
