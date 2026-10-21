from django.db import migrations

import tokens.database_award_person_guards


class Migration(migrations.Migration):
    dependencies = [
        ("shared", "0013_member_name_guards"),
        ("tokens", "0013_award_person_records"),
    ]

    operations = [migrations.RunPython(tokens.database_award_person_guards.install)]
