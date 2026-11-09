from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [("users", "0004_account_erasure")]

    operations = [
        migrations.RemoveField(model_name="userprofile", name="confirmed_over_18"),
        migrations.RemoveField(model_name="userprofile", name="confirmed_australian_resident"),
        migrations.RemoveField(model_name="userprofile", name="confirmed_individual_account"),
    ]
