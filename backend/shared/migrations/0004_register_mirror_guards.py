from django.db import migrations

import tokens.database_mirror_guards


class Migration(migrations.Migration):
    dependencies = [
        ("shared", "0003_member_certificate_guards"),
        ("tokens", "0007_register_mirror_setup"),
        ("companies", "0004_signup_terms_acceptance"),
    ]

    operations = [migrations.RunPython(tokens.database_mirror_guards.install)]
