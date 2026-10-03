from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("operators", "0001_initial"),
        ("tokens", "0015_fold_stablecoin_into_asset"),
    ]

    operations = [
        migrations.RemoveField(model_name="operator", name="deployment_mode"),
    ]
