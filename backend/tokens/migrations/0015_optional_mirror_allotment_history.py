from django.db import migrations

import tokens.database_mirror_guards


class Migration(migrations.Migration):
    dependencies = [("tokens", "0014_member_documents")]

    operations = [migrations.RunPython(tokens.database_mirror_guards.install_member_validation)]
