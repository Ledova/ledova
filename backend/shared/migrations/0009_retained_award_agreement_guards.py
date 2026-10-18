from django.db import migrations

import tokens.database_award_agreement_guards


class Migration(migrations.Migration):
    dependencies = [
        ("shared", "0008_company_event_date_guards"),
        ("tokens", "0008_company_event_dates"),
    ]

    operations = [migrations.RunPython(tokens.database_award_agreement_guards.install)]
