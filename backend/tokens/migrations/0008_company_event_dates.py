from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("tokens", "0007_register_mirror_setup")]

    operations = [
        migrations.AddField(model_name="registergrant", name="company_event_on", field=models.DateField(null=True)),
        migrations.AddField(model_name="registerallotment", name="company_event_on", field=models.DateField(null=True)),
        migrations.AddField(model_name="registertransfer", name="company_event_on", field=models.DateField(null=True)),
    ]
