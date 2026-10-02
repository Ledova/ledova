from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("compliance", "0006_pep_and_watchlist_match_alerts"),
    ]

    operations = [
        migrations.AlterField(
            model_name="customerriskassessment",
            name="pep_type",
            field=models.CharField(
                choices=[
                    ("none", "Not a PEP"),
                    ("unknown", "PEP category not provided"),
                    ("domestic", "Domestic PEP"),
                    ("foreign", "Foreign PEP"),
                    ("international_org", "International Organisation PEP"),
                    ("family", "PEP Family Member"),
                    ("associate", "PEP Associate"),
                ],
                default="none",
                max_length=20,
            ),
        ),
    ]
