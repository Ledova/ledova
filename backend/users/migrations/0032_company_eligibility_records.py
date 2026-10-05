import uuid
from decimal import Decimal

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

TABLES = (
    "users_companyeligibilityrequest",
    "users_companyeligibilitydecision",
    "users_companyeligibilityrequestwithdrawal",
    "users_companyeligibilityrevocation",
)


def install_read_policies(apps, schema_editor):
    from shared.db.policies import ELIGIBILITY_COMPANIES, HELPERS
    from shared.db.policy_sql import install_tables

    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            f"CREATE FUNCTION {ELIGIBILITY_COMPANIES}() RETURNS SETOF uuid LANGUAGE sql STABLE "
            f"SECURITY DEFINER SET search_path = pg_catalog, public AS $${HELPERS[ELIGIBILITY_COMPANIES]}$$"
        )
        cursor.execute("SELECT quote_ident(%s)", [settings.RLS_ROLES["app"]])
        role = cursor.fetchone()[0]
        for table in TABLES:
            cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO {role}")
    install_tables(schema_editor, TABLES)


def remove_read_policies(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE " + ", ".join(TABLES) + ", users_investorclassification IN ACCESS EXCLUSIVE MODE")
        for table in TABLES:
            cursor.execute(f"SELECT EXISTS (SELECT 1 FROM {table})")
            if cursor.fetchone()[0]:
                raise RuntimeError("Retain company eligibility history; downgrade would discard recorded decisions.")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM users_investorclassification WHERE withdrawn_by_id IS NOT NULL)")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain the actual participant's classification withdrawal attribution.")
        for table in reversed(TABLES):
            for suffix in ("read", "insert", "update", "delete"):
                cursor.execute(f"DROP POLICY {table}_{suffix} ON {table}")
            cursor.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
            cursor.execute(f"ALTER TABLE {table} DISABLE ROW LEVEL SECURITY")
        cursor.execute("DROP FUNCTION app_company_eligibility_ids()")


class Migration(migrations.Migration):

    dependencies = [
        ("companies", "0022_company_wallet_lock_order"),
        ("documents", "0003_documentread_document_attached_at_and_more"),
        ("offerings", "0009_published_documents_stay"),
        ("tokens", "0081_held_orders_and_retired_statuses"),
        ("users", "0031_protected_identity_results"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name="investorclassification",
            name="withdrawn_by",
            field=models.ForeignKey(
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.CreateModel(
            name="CompanyEligibilityRequest",
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
                ("idempotency_key", models.UUIDField(editable=False)),
                ("version", models.CharField(default="1", editable=False, max_length=10)),
                (
                    "category",
                    models.CharField(
                        choices=[
                            ("product_value", "Product value of at least AUD 500,000 (s708(8)(a))"),
                            ("accountant_certificate", "Qualified accountant's certificate (s708(8)(c))"),
                            ("professional_investor", "Professional investor (s708(11) / s761G(7)(d))"),
                            ("associated_person", "Person associated with the issuer (s708(12))"),
                        ],
                        editable=False,
                        max_length=30,
                    ),
                ),
                ("shared_summary", models.JSONField(editable=False)),
                ("source_fingerprint", models.CharField(editable=False, max_length=64)),
                ("evidence_hash", models.CharField(editable=False, max_length=64)),
                ("digest", models.CharField(editable=False, max_length=64)),
                ("requested_expires_at", models.DateTimeField(editable=False)),
                ("submitted_at", models.DateTimeField(editable=False)),
                ("sharing_accepted", models.BooleanField(editable=False)),
                ("declaration_accepted", models.BooleanField(editable=False)),
                ("quantity", models.PositiveIntegerField(editable=False, null=True)),
                ("price_per_share", models.DecimalField(decimal_places=2, editable=False, max_digits=18, null=True)),
                ("price_currency", models.CharField(editable=False, max_length=16, null=True)),
                ("amount_aud", models.DecimalField(decimal_places=2, editable=False, max_digits=18, null=True)),
                ("offering_terms", models.JSONField(editable=False, null=True)),
                ("offering_terms_digest", models.CharField(editable=False, max_length=64, null=True)),
                (
                    "company",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="eligibility_requests",
                        to="companies.company",
                    ),
                ),
                (
                    "offering",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="eligibility_requests",
                        to="offerings.offering",
                    ),
                ),
                (
                    "source",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="company_requests",
                        to="users.investorclassification",
                    ),
                ),
                (
                    "submitted_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "token",
                    models.ForeignKey(
                        editable=False,
                        null=True,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="eligibility_requests",
                        to="tokens.sharetoken",
                    ),
                ),
                (
                    "user_account",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="eligibility_requests",
                        to="users.useraccount",
                    ),
                ),
            ],
            options={
                "ordering": ["-submitted_at", "-uuid"],
            },
        ),
        migrations.CreateModel(
            name="CompanyEligibilityDecision",
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
                ("idempotency_key", models.UUIDField(editable=False)),
                ("request_digest", models.CharField(editable=False, max_length=64)),
                ("digest", models.CharField(editable=False, max_length=64)),
                (
                    "outcome",
                    models.CharField(
                        choices=[("accepted", "Accepted by the company"), ("refused", "Refused by the company")],
                        editable=False,
                        max_length=12,
                    ),
                ),
                ("decided_at", models.DateTimeField(editable=False)),
                ("expires_at", models.DateTimeField(editable=False, null=True)),
                ("reason", models.CharField(blank=True, editable=False, max_length=500)),
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "decided_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
                (
                    "request",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="decision",
                        to="users.companyeligibilityrequest",
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="CompanyEligibilityRequestWithdrawal",
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
                ("idempotency_key", models.UUIDField(editable=False)),
                ("digest", models.CharField(editable=False, max_length=64)),
                ("withdrawn_at", models.DateTimeField(editable=False)),
                (
                    "request",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="withdrawal",
                        to="users.companyeligibilityrequest",
                    ),
                ),
                (
                    "withdrawn_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
        ),
        migrations.CreateModel(
            name="CompanyEligibilityRevocation",
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
                ("idempotency_key", models.UUIDField(editable=False)),
                ("digest", models.CharField(editable=False, max_length=64)),
                ("reason", models.CharField(editable=False, max_length=500)),
                ("revoked_at", models.DateTimeField(editable=False)),
                (
                    "appointment",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to="companies.companyappointment"
                    ),
                ),
                (
                    "decision",
                    models.OneToOneField(
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="revocation",
                        to="users.companyeligibilitydecision",
                    ),
                ),
                (
                    "revoked_by",
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.PROTECT, related_name="+", to=settings.AUTH_USER_MODEL
                    ),
                ),
            ],
        ),
        migrations.AddIndex(
            model_name="companyeligibilityrequest",
            index=models.Index(fields=["company", "submitted_at"], name="users_compa_company_b2e28c_idx"),
        ),
        migrations.AddIndex(
            model_name="companyeligibilityrequest",
            index=models.Index(fields=["user_account", "submitted_at"], name="users_compa_user_ac_70f7e2_idx"),
        ),
        migrations.AddConstraint(
            model_name="companyeligibilityrequest",
            constraint=models.UniqueConstraint(
                fields=("submitted_by", "idempotency_key"), name="users_eligibility_request_actor_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="companyeligibilityrequest",
            constraint=models.CheckConstraint(
                condition=models.Q(("declaration_accepted", True), ("sharing_accepted", True)),
                name="users_eligibility_request_confirmations",
            ),
        ),
        migrations.AddConstraint(
            model_name="companyeligibilityrequest",
            constraint=models.CheckConstraint(
                condition=models.Q(("requested_expires_at__gt", models.F("submitted_at"))),
                name="users_eligibility_request_future_expiry",
            ),
        ),
        migrations.AddConstraint(
            model_name="companyeligibilityrequest",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("amount_aud__gte", Decimal("500000.00")),
                        ("amount_aud__isnull", False),
                        ("category", "product_value"),
                        ("offering__isnull", False),
                        ("offering_terms__isnull", False),
                        ("offering_terms_digest__isnull", False),
                        ("price_currency", "AUD"),
                        ("price_currency__isnull", False),
                        ("price_per_share__gt", 0),
                        ("price_per_share__isnull", False),
                        ("quantity__gt", 0),
                        ("quantity__isnull", False),
                        ("token__isnull", False),
                    ),
                    models.Q(
                        models.Q(("category", "product_value"), _negated=True),
                        ("amount_aud__isnull", True),
                        ("offering__isnull", True),
                        ("offering_terms__isnull", True),
                        ("offering_terms_digest__isnull", True),
                        ("price_currency__isnull", True),
                        ("price_per_share__isnull", True),
                        ("quantity__isnull", True),
                        ("token__isnull", True),
                    ),
                    _connector="OR",
                ),
                name="users_eligibility_request_exact_product_scope",
            ),
        ),
        migrations.AddConstraint(
            model_name="companyeligibilitydecision",
            constraint=models.UniqueConstraint(
                fields=("decided_by", "idempotency_key"), name="users_eligibility_decision_actor_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="companyeligibilitydecision",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("expires_at__gt", models.F("decided_at")),
                        ("expires_at__isnull", False),
                        ("outcome", "accepted"),
                        ("reason", ""),
                    ),
                    models.Q(
                        ("expires_at__isnull", True), ("outcome", "refused"), models.Q(("reason", ""), _negated=True)
                    ),
                    _connector="OR",
                ),
                name="users_eligibility_decision_exact_outcome",
            ),
        ),
        migrations.AddConstraint(
            model_name="companyeligibilityrequestwithdrawal",
            constraint=models.UniqueConstraint(
                fields=("withdrawn_by", "idempotency_key"), name="users_eligibility_withdrawal_actor_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="companyeligibilityrevocation",
            constraint=models.UniqueConstraint(
                fields=("revoked_by", "idempotency_key"), name="users_eligibility_revocation_actor_key"
            ),
        ),
        migrations.AddConstraint(
            model_name="companyeligibilityrevocation",
            constraint=models.CheckConstraint(
                condition=models.Q(("reason", ""), _negated=True), name="users_eligibility_revocation_reason"
            ),
        ),
        migrations.RunPython(install_read_policies, remove_read_policies),
    ]
