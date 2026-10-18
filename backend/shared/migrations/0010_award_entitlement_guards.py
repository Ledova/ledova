from django.db import migrations

import tokens.database_award_entitlement_guards


class Migration(migrations.Migration):
    dependencies = [
        ("shared", "0009_retained_award_agreement_guards"),
        ("tokens", "0009_award_entitlement_records"),
    ]

    operations = [migrations.RunPython(tokens.database_award_entitlement_guards.install)]
