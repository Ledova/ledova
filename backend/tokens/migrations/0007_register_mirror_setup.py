import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import shared.storage
import tokens.models.register_import


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0004_signup_terms_acceptance"),
        ("tokens", "0006_member_certificate_outputs"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="registerimport",
            name="one_applied_register_import_per_class",
        ),
        migrations.RemoveConstraint(
            model_name="registerimport",
            name="register_import_exact_provenance",
        ),
        migrations.AddField(
            model_name="registerimport",
            name="base_hash",
            field=models.CharField(blank=True, default="", editable=False, max_length=64),
        ),
        migrations.AddField(
            model_name="registerimport",
            name="base_sequence",
            field=models.PositiveBigIntegerField(editable=False, null=True),
        ),
        migrations.AddField(
            model_name="registerimport",
            name="correction_of",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="corrections",
                to="tokens.registerimport",
            ),
        ),
        migrations.AddField(
            model_name="registerimport",
            name="source_confirmed",
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name="registerimport",
            name="source_reference",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AlterField(
            model_name="registerentry",
            name="kind",
            field=models.CharField(
                choices=[
                    ("opening", "Opening state"),
                    ("issue", "Issue"),
                    ("transfer", "Transfer"),
                    ("cessation", "Cessation"),
                    ("correction", "Compensating correction"),
                    ("mirror_correction", "Mirror snapshot correction"),
                ],
                max_length=24,
            ),
        ),
        migrations.AlterField(
            model_name="registerimport",
            name="authority",
            field=models.CharField(
                choices=[
                    ("director_resolution", "Director resolution"),
                    ("court_order", "Court order"),
                    ("company_records", "Company records"),
                ],
                max_length=24,
            ),
        ),
        migrations.AlterField(
            model_name="registerimport",
            name="evidence_snapshot",
            field=models.JSONField(null=True),
        ),
        migrations.AlterField(
            model_name="registerimport",
            name="file",
            field=models.FileField(
                blank=True,
                max_length=255,
                storage=shared.storage.private_storage,
                upload_to=tokens.models.register_import.import_evidence_path,
            ),
        ),
        migrations.AddConstraint(
            model_name="registerimport",
            constraint=models.UniqueConstraint(
                condition=models.Q(("correction_of__isnull", True), ("status", "applied")),
                fields=("token",),
                name="one_applied_register_import_per_class",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerimport",
            constraint=models.UniqueConstraint(
                condition=models.Q(("correction_of__isnull", False), ("status", "applied")),
                fields=("correction_of",),
                name="one_applied_mirror_correction_per_snapshot",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerimport",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("asic_document__isnull", True),
                        ("authority", "company_records"),
                        ("preparing_appointment__isnull", False),
                        ("source_confirmed", True),
                        ("source_document__isnull", True),
                    ),
                    models.Q(
                        ("asic_document__isnull", False),
                        ("asic_evidence__isnull", True),
                        ("asic_file", ""),
                        ("asic_snapshot__isnull", True),
                        ("correction_of__isnull", True),
                        ("preparing_appointment__isnull", True),
                        ("register_evidence__isnull", True),
                        ("source_confirmed", False),
                        ("source_document__isnull", False),
                        ("source_reference", ""),
                    ),
                    models.Q(
                        ("asic_document__isnull", True),
                        ("asic_evidence__isnull", False),
                        ("asic_issued_total__isnull", False),
                        ("asic_member_count__isnull", False),
                        ("asic_snapshot__isnull", False),
                        ("preparing_appointment__isnull", False),
                        ("register_evidence__isnull", False),
                        ("source_document__isnull", True),
                        models.Q(("asic_file", ""), _negated=True),
                    ),
                    _connector="OR",
                ),
                name="register_import_exact_provenance",
            ),
        ),
        migrations.AddConstraint(
            model_name="registerimport",
            constraint=models.CheckConstraint(
                condition=(
                    models.Q(source_confirmed=True, authority="company_records")
                    & ~models.Q(source_reference__regex=r"^\s*$")
                    & (
                        models.Q(correction_of__isnull=True, base_sequence__isnull=True, base_hash="")
                        | models.Q(correction_of__isnull=False, base_sequence__gt=0, base_hash__regex="^[0-9a-f]{64}$")
                    )
                )
                | models.Q(
                    source_confirmed=False,
                    source_reference="",
                    correction_of__isnull=True,
                    base_sequence__isnull=True,
                    base_hash="",
                ),
                name="register_import_mirror_source",
            ),
        ),
    ]
