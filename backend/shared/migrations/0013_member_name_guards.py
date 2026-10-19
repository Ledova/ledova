from django.db import migrations

import tokens.database_member_name_guards


class Migration(migrations.Migration):
    dependencies = [
        ("shared", "0012_remove_unused_app_grants"),
        ("tokens", "0011_required_signing_challenge_wallet"),
    ]

    operations = [migrations.RunPython(tokens.database_member_name_guards.install)]
