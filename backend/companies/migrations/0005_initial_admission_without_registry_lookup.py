from django.db import migrations, models

import companies.database_admission_guards


class Migration(migrations.Migration):
    dependencies = [
        ("companies", "0004_signup_terms_acceptance"),
        ("shared", "0012_remove_unused_app_grants"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="companyappointment",
            name="companies_appointment_exact_source",
        ),
        migrations.AddConstraint(
            model_name="companyappointment",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("declaration_text__isnull", False),
                        ("declaration_version__isnull", False),
                        ("invitation__isnull", True),
                        ("legacy_owner__isnull", True),
                        ("request__isnull", False),
                    ),
                    models.Q(
                        ("declaration_text__isnull", False),
                        ("declaration_version__isnull", False),
                        ("invitation__isnull", False),
                        ("legacy_owner__isnull", True),
                        ("registry_check__isnull", True),
                        ("request__isnull", True),
                    ),
                    models.Q(
                        ("declaration_text__isnull", True),
                        ("declaration_version__isnull", True),
                        ("invitation__isnull", True),
                        ("legacy_owner__isnull", False),
                        ("registry_check__isnull", True),
                        ("request__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="companies_appointment_exact_source",
            ),
        ),
        migrations.RunPython(companies.database_admission_guards.install),
    ]
