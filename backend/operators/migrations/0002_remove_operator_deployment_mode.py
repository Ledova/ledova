from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [("operators", "0001_initial")]

    operations = [
        migrations.RemoveField(model_name="operator", name="deployment_mode"),
    ]
