import django.db.models.deletion
import django.db.models.functions.text
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    replaces = [("offerings", "0010_company_eligibility_admission")]

    initial = True

    dependencies = [
        ("assets", "0001_baseline"),
        ("authentication", "__first__"),
        ("companies", "0002_baseline"),
        ("offerings", "0001_baseline"),
        ("tokens", "0001_baseline"),
        ("users", "0001_baseline"),
        ("wallets", "0001_baseline"),
    ]

    operations = [
        migrations.AddField(
            model_name="offering",
            name="token",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="offerings", to="tokens.sharetoken"
            ),
        ),
        migrations.AddField(
            model_name="subscription",
            name="company",
            field=models.ForeignKey(
                help_text="Owner, derived from offering.company and held directly so a row-level security policy can read it",
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="companies.company",
            ),
        ),
        migrations.AddField(
            model_name="subscription",
            name="eligibility_decision",
            field=models.ForeignKey(
                blank=True,
                editable=False,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="users.companyeligibilitydecision",
            ),
        ),
        migrations.AddField(
            model_name="subscription",
            name="issuance_request",
            field=models.OneToOneField(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="subscription",
                to="tokens.shareissuancerequest",
            ),
        ),
        migrations.AddField(
            model_name="subscription",
            name="offering",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="subscriptions", to="offerings.offering"
            ),
        ),
        migrations.AddField(
            model_name="subscription",
            name="payment_confirmed_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="confirmed_subscriptions",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="subscription",
            name="settlement_asset",
            field=models.ForeignKey(
                blank=True,
                limit_choices_to={"asset_type": "stablecoin"},
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="subscriptions",
                to="assets.asset",
            ),
        ),
        migrations.AddField(
            model_name="subscription",
            name="submitted_by",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name="submitted_subscriptions",
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="subscription",
            name="user_account",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="subscriptions", to="users.useraccount"
            ),
        ),
        migrations.AddField(
            model_name="subscription",
            name="wallet",
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT, related_name="subscriptions", to="wallets.wallet"
            ),
        ),
        migrations.AddIndex(
            model_name="offering",
            index=models.Index(fields=["status", "opens_at"], name="offerings_o_status_80961f_idx"),
        ),
        migrations.AddConstraint(
            model_name="offering",
            constraint=models.UniqueConstraint(
                condition=models.Q(("status__in", ["submitted", "under_review", "approved"])),
                fields=("token",),
                name="offering_one_live_per_token",
            ),
        ),
        migrations.AddConstraint(
            model_name="offering",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("minimum_shares__gte", 1),
                    ("target_shares__gte", models.F("minimum_shares")),
                    ("cap_shares__gte", models.F("target_shares")),
                ),
                name="offering_bounds_ordered",
                violation_error_message="Minimum, target and cap must be at least one share and ordered minimum <= target <= cap.",
            ),
        ),
        migrations.AddConstraint(
            model_name="offering",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("closes_at__isnull", True), ("closes_at__gt", models.F("opens_at")), _connector="OR"
                ),
                name="offering_window_ordered",
                violation_error_message="An offering must close after it opens.",
            ),
        ),
        migrations.AddIndex(
            model_name="subscription",
            index=models.Index(fields=["offering", "status"], name="offerings_s_offerin_897ac7_idx"),
        ),
        migrations.AddIndex(
            model_name="subscription",
            index=models.Index(fields=["status"], name="offerings_s_status_c64bbb_idx"),
        ),
        migrations.AddIndex(
            model_name="subscription",
            index=models.Index(fields=["reference"], name="offerings_s_referen_83a6e8_idx"),
        ),
        migrations.AddConstraint(
            model_name="subscription",
            constraint=models.UniqueConstraint(
                condition=models.Q(("reference", ""), _negated=True),
                fields=("reference",),
                name="subscription_reference_unique",
            ),
        ),
        migrations.AddConstraint(
            model_name="subscription",
            constraint=models.UniqueConstraint(
                django.db.models.functions.text.Lower("payment_tx_hash"),
                condition=models.Q(("payment_tx_hash", ""), _negated=True),
                name="subscription_payment_tx_hash_unique",
            ),
        ),
        migrations.AddConstraint(
            model_name="subscription",
            constraint=models.CheckConstraint(
                condition=models.Q(("quantity__gt", 0)),
                name="subscription_quantity_positive",
                violation_error_message="A subscription must ask for at least one share.",
            ),
        ),
        migrations.AddConstraint(
            model_name="subscription",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    ("allotted_quantity__isnull", True),
                    ("allotted_quantity__lte", models.F("quantity")),
                    _connector="OR",
                ),
                name="subscription_allotted_within_quantity",
                violation_error_message="A subscription cannot be allotted more shares than it asked for.",
            ),
        ),
        migrations.AddConstraint(
            model_name="subscription",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(("settlement_asset__isnull", True), ("settlement_rail", "bank_transfer")),
                    models.Q(("settlement_asset__isnull", False), ("settlement_rail", "stablecoin")),
                    _connector="OR",
                ),
                name="subscription_rail_matches_settlement_asset",
                violation_error_message="A bank transfer carries no settlement asset, and a stablecoin settlement must name one.",
            ),
        ),
    ]
