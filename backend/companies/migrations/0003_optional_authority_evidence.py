from django.db import migrations, models

import companies.authority_guards
import companies.models.authority_request
import shared.storage


class Migration(migrations.Migration):
    dependencies = [
        ("companies", "0002_initial"),
        ("shared", "0003_member_certificate_guards"),
    ]

    operations = [
        migrations.AlterField(
            model_name="companyauthorityrequest",
            name="file",
            field=models.FileField(
                blank=True,
                default="",
                max_length=255,
                storage=shared.storage.private_storage,
                upload_to=companies.models.authority_request.authority_evidence_path,
            ),
        ),
        migrations.AlterField(
            model_name="companyauthorityrequest",
            name="original_filename",
            field=models.CharField(blank=True, default="", editable=False, max_length=255),
        ),
        migrations.AlterField(
            model_name="companyauthorityrequest",
            name="file_size",
            field=models.PositiveIntegerField(default=0, editable=False),
        ),
        migrations.AlterField(
            model_name="companyauthorityrequest",
            name="mime_type",
            field=models.CharField(blank=True, default="", editable=False, max_length=100),
        ),
        migrations.AlterField(
            model_name="companyauthorityrequest",
            name="file_sha256",
            field=models.CharField(blank=True, default="", editable=False, max_length=64),
        ),
        migrations.RunPython(companies.authority_guards.install),
    ]
