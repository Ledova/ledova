import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import tokens.database_people


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0006_status_changes_require_change_permission"),
        ("tokens", "0019_atomic_allotment_completion"),
        ("shared", "0015_optional_mirror_beneficial_status"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="RegisterPersonRegistration",
            fields=[
                (
                    "uuid",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        help_text="Unique identifier (primary key)",
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("name", models.CharField(max_length=255)),
                ("residential_address", models.TextField()),
            ],
            options={
                "abstract": False,
            },
        ),
        migrations.RemoveConstraint(
            model_name="registermemberparticulars",
            name="register_member_particulars_one_source",
        ),
        migrations.AddField(
            model_name="registerpersonregistration",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="person_registrations", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="registerpersonregistration",
            name="member",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.PROTECT, related_name="registration", to="tokens.registermember"
            ),
        ),
        migrations.AddField(
            model_name="registerpersonregistration",
            name="preparing_appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="registerpersonregistration",
            name="submitted_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="registermemberparticulars",
            name="source_registration",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="particulars",
                to="tokens.registerpersonregistration",
            ),
        ),
        migrations.AddConstraint(
            model_name="registermemberparticulars",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", False),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", False),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", False),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", False),
                    ),
                    models.Q(
                        ("source_allotment__isnull", False),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", False),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", True),
                        ("source_transfer__isnull", True),
                    ),
                    models.Q(
                        ("source_allotment__isnull", True),
                        ("source_award__isnull", True),
                        ("source_change__isnull", True),
                        ("source_grant__isnull", True),
                        ("source_import__isnull", True),
                        ("source_registration__isnull", False),
                        ("source_transfer__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="register_member_particulars_one_source",
            ),
        ),
        migrations.RunPython(tokens.database_people.install, reverse_code=migrations.RunPython.noop),
    ]
