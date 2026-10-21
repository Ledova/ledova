from django.db import migrations

import tokens.database_mirror_guards


class Migration(migrations.Migration):
    dependencies = [("shared", "0014_award_person_records")]

    operations = [migrations.RunPython(tokens.database_mirror_guards.install_member_validation)]
