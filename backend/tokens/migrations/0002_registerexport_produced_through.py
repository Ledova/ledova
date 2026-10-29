from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0001_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="registerexport",
            name="produced_through",
            field=models.CharField(
                blank=True,
                choices=[("company", "Company pages"), ("admin", "Platform admin")],
                default="",
                editable=False,
                max_length=8,
            ),
        ),
        migrations.AddConstraint(
            model_name="registerexport",
            constraint=models.CheckConstraint(
                condition=models.Q(("produced_through__in", ["", "company", "admin"])),
                name="register_export_produced_through",
            ),
        ),
    ]
