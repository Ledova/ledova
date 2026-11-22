from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("users", "0006_remove_identity_verification"),
    ]

    operations = [
        migrations.RemoveField(model_name="userprofile", name="phone_country_code"),
        migrations.RemoveField(model_name="userprofile", name="phone_number"),
        migrations.RemoveField(model_name="userprofile", name="date_of_birth"),
        migrations.RemoveField(model_name="userprofile", name="citizenship_country"),
        migrations.RemoveField(model_name="userprofile", name="residence_country"),
    ]
