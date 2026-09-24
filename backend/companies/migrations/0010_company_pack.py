from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0009_document_verification"),
    ]

    operations = [
        migrations.CreateModel(
            name="CompanyPack",
            fields=[],
            options={
                "verbose_name": "company pack",
                "verbose_name_plural": "company packs",
                "proxy": True,
                "indexes": [],
                "constraints": [],
            },
            bases=("companies.company",),
        ),
    ]
