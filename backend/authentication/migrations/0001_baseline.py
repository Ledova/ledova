import django.utils.timezone
from django.db import migrations, models

import authentication.email


class Migration(migrations.Migration):

    replaces = [
        ("authentication", "0001_initial"),
        ("authentication", "0002_authsession_refreshcredential"),
        ("authentication", "0003_customuser_v2_email_constraints"),
        ("authentication", "0004_v2_challenge_schema"),
        ("authentication", "0005_auth_del_superseded_proof_shapes"),
        ("authentication", "0006_delete_v2_challenge_models"),
        ("authentication", "0007_delete_authsession_refreshcredential"),
        ("authentication", "0008_delete_usertoken"),
        ("authentication", "0009_otp_attempts_drop_unused_columns"),
    ]

    initial = True

    dependencies = [
        ("auth", "0012_alter_user_first_name_max_length"),
    ]

    operations = [
        migrations.CreateModel(
            name="CustomUser",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("password", models.CharField(max_length=128, verbose_name="password")),
                (
                    "is_superuser",
                    models.BooleanField(
                        default=False,
                        help_text="Designates that this user has all permissions without explicitly assigning them.",
                        verbose_name="superuser status",
                    ),
                ),
                ("email", models.EmailField(max_length=254, unique=True)),
                ("is_active", models.BooleanField(default=False)),
                ("is_staff", models.BooleanField(default=False)),
                ("date_joined", models.DateTimeField(default=django.utils.timezone.now)),
                ("last_login", models.DateTimeField(blank=True, null=True)),
                ("email_verification_token", models.CharField(blank=True, max_length=100, null=True)),
                ("email_verification_sent_at", models.DateTimeField(blank=True, null=True)),
                ("email_verification_attempts", models.PositiveSmallIntegerField(default=0)),
                ("is_email_verified", models.BooleanField(default=False)),
                (
                    "groups",
                    models.ManyToManyField(
                        blank=True,
                        help_text="The groups this user belongs to. A user will get all permissions granted to each of their groups.",
                        related_name="user_set",
                        related_query_name="user",
                        to="auth.group",
                        verbose_name="groups",
                    ),
                ),
                (
                    "user_permissions",
                    models.ManyToManyField(
                        blank=True,
                        help_text="Specific permissions for this user.",
                        related_name="user_set",
                        related_query_name="user",
                        to="auth.permission",
                        verbose_name="user permissions",
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.CheckConstraint(
                        condition=authentication.email.EmailIsPrintableASCII(models.F("email")),
                        name="auth_user_email_v2_ascii_ck",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("email", authentication.email.EmailDestinationKey(models.F("email")))),
                        name="auth_user_email_v2_canon_ck",
                    ),
                    models.UniqueConstraint(
                        authentication.email.EmailDestinationKey(models.F("email")), name="auth_user_email_v2_key_uniq"
                    ),
                ],
            },
        ),
    ]
