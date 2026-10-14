import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

import companies.signup_terms_guards


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0003_optional_authority_evidence"),
        ("users", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="CompanySignupTermsAcceptance",
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
                ("declaration_version", models.CharField(editable=False, max_length=10)),
                ("declaration_text", models.TextField(editable=False)),
                (
                    "accepted_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "accepted_profile",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="users.userprofile"
                    ),
                ),
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.company"
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        fields=("appointment", "declaration_version"), name="company_signup_terms_appointment_version"
                    )
                ],
            },
        ),
        migrations.RunPython(companies.signup_terms_guards.install),
    ]
