from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("offerings", "0006_trigger_follows_and_refuses"),
    ]

    operations = [
        migrations.AddField(
            model_name="subscription",
            name="accepted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="subscription",
            name="allotted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="subscription",
            name="closed_at",
            field=models.DateTimeField(blank=True, help_text="When it was rejected or withdrawn", null=True),
        ),
        migrations.AddField(
            model_name="subscription",
            name="submitted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
