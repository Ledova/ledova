from django.db import migrations

import tokens.database_output_guards


class Migration(migrations.Migration):
    dependencies = [
        ("shared", "0002_database_guards"),
        ("tokens", "0006_member_certificate_outputs"),
    ]

    operations = [migrations.RunPython(tokens.database_output_guards.install)]
