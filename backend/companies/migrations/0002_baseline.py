import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    replaces = [("companies", "0022_company_wallet_lock_order")]

    initial = True

    dependencies = [
        ("authentication", "__first__"),
        ("companies", "0001_baseline"),
        ("users", "0001_baseline"),
        ("wallets", "0001_baseline"),
    ]

    operations = [
        migrations.AddField(
            model_name="company",
            name="operator_wallet",
            field=models.ForeignKey(
                blank=True,
                help_text="The wallet used for signing token operations",
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="operated_companies",
                to="wallets.wallet",
            ),
        ),
        migrations.AddField(
            model_name="company",
            name="owner",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="owned_companies", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="company",
            name="rejected_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="rejected_companies",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="company",
            name="submitted_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="submitted_company_applications",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
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
        migrations.AddField(
            model_name="companyappointment",
            name="appointee",
            field=models.ForeignKey(
                editable=False,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="company_appointments",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="companyappointment",
            name="appointee_profile",
            field=models.ForeignKey(
                editable=False, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="users.userprofile"
            ),
        ),
        migrations.AddField(
            model_name="companyappointment",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="appointments", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="companyappointmentrevocation",
            name="appointment",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="revocation",
                to="companies.companyappointment",
            ),
        ),
        migrations.AddField(
            model_name="companyappointmentrevocation",
            name="revoked_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="companyauthorityrequest",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="authority_requests", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="companyauthorityrequest",
            name="requester",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="companyauthorityrequest",
            name="requester_profile",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="users.userprofile"
            ),
        ),
        migrations.AddField(
            model_name="companyappointment",
            name="request",
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="appointment",
                to="companies.companyauthorityrequest",
            ),
        ),
        migrations.AddField(
            model_name="companyauthorityrequestwithdrawal",
            name="request",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.PROTECT,
                related_name="withdrawal",
                to="companies.companyauthorityrequest",
            ),
        ),
        migrations.AddField(
            model_name="companyauthorityrequestwithdrawal",
            name="withdrawn_by",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="companydocument",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE, related_name="documents", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="companydocument",
            name="verified_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="verified_documents",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="companylegacyownersource",
            name="company",
            field=models.OneToOneField(
                editable=False,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="legacy_owner_source",
                to="companies.company",
            ),
        ),
        migrations.AddField(
            model_name="companylegacyownersource",
            name="owner",
            field=models.ForeignKey(
                editable=False,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="companylegacyownersource",
            name="owner_profile",
            field=models.ForeignKey(
                editable=False, on_delete=django.db.models.deletion.PROTECT, related_name="+", to="users.userprofile"
            ),
        ),
        migrations.AddField(
            model_name="companyappointment",
            name="legacy_owner",
            field=models.OneToOneField(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="appointment",
                to="companies.companylegacyownersource",
            ),
        ),
        migrations.AddField(
            model_name="companyregistrycheck",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.CASCADE, related_name="registry_checks", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="companyregistrycheck",
            name="initiated_by",
            field=models.ForeignKey(
                null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="companyregistrycheck",
            name="initiating_appointment",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="activation_checks",
                to="companies.companyappointment",
            ),
        ),
        migrations.AddField(
            model_name="companyappointment",
            name="registry_check",
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.companyregistrycheck",
            ),
        ),
        migrations.AddField(
            model_name="company",
            name="registry_check",
            field=models.ForeignKey(
                blank=True,
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="+",
                to="companies.companyregistrycheck",
            ),
        ),
        migrations.AddField(
            model_name="companyteaminvitation",
            name="company",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="team_invitations", to="companies.company"
            ),
        ),
        migrations.AddField(
            model_name="companyteaminvitation",
            name="inviter",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
            ),
        ),
        migrations.AddField(
            model_name="companyteaminvitation",
            name="inviter_appointment",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
            ),
        ),
        migrations.AddField(
            model_name="companyappointment",
            name="invitation",
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="appointment",
                to="companies.companyteaminvitation",
            ),
        ),
        migrations.AddConstraint(
            model_name="companyauthorityrequest",
            constraint=models.UniqueConstraint(
                fields=("requester", "idempotency_key"), name="company_authority_request_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="companyregistrycheck",
            constraint=models.UniqueConstraint(
                condition=models.Q(("idempotency_key__isnull", False)),
                fields=("initiated_by", "idempotency_key"),
                name="companies_activation_request_key",
            ),
        ),
        migrations.AddConstraint(
            model_name="companyregistrycheck",
            constraint=models.UniqueConstraint(
                condition=models.Q(("applied_at__isnull", False)),
                fields=("company",),
                name="companies_one_initial_activation_effect",
            ),
        ),
        migrations.AddConstraint(
            model_name="companyregistrycheck",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("applied_at__isnull", True),
                        ("declaration_text__isnull", True),
                        ("declaration_version__isnull", True),
                        ("idempotency_key__isnull", True),
                        ("initiating_appointment__isnull", True),
                        ("issuer_identity_required__isnull", True),
                        ("person_identity__isnull", True),
                    ),
                    models.Q(
                        ("declaration_text__isnull", False),
                        ("declaration_version__isnull", False),
                        ("idempotency_key__isnull", False),
                        ("initiating_appointment__isnull", False),
                        ("issuer_identity_required__isnull", False),
                        ("person_identity__isnull", False),
                        ("purpose", "activation"),
                    ),
                    _connector="OR",
                ),
                name="companies_activation_exact_provenance",
            ),
        ),
        migrations.AddConstraint(
            model_name="companyteaminvitation",
            constraint=models.UniqueConstraint(
                fields=("inviter", "idempotency_key"), name="companies_team_invitation_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="companyappointment",
            constraint=models.UniqueConstraint(
                condition=models.Q(("request__isnull", False), ("legacy_owner__isnull", False), _connector="OR"),
                fields=("company",),
                name="companies_one_initial_appointment_per_company",
            ),
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
                        ("registry_check__isnull", False),
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
    ]
