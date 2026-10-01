from django.db import migrations
from django.db.models import F, OuterRef, Subquery

ONCE_ACTIVE = ("active", "suspended", "terminated")


def date_each_activation(apps, schema_editor):
    account = apps.get_model("users", "UserAccount")
    assessment = apps.get_model("compliance", "CustomerRiskAssessment")
    alias = schema_editor.connection.alias
    first_assessment = (
        assessment._base_manager.using(alias)
        .filter(
            user_account=OuterRef("pk"),
            assessment_status="complete",
            is_automated=True,
            valid_from__isnull=False,
        )
        .order_by("valid_from")
        .values("valid_from")[:1]
    )
    undated = account._base_manager.using(alias).filter(activation_date__isnull=True, account_status__in=ONCE_ACTIVE)
    for row in undated.annotate(assessed=Subquery(first_assessment), verified=F("user_profile__verified_at")):
        evidence = [moment for moment in (row.assessed, row.verified) if moment is not None]
        account._base_manager.using(alias).filter(pk=row.pk).update(
            activation_date=min(evidence) if evidence else row.created_at
        )


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0028_remove_theme_and_selected_portfolio"),
        ("compliance", "0005_remove_fiat_transaction_and_high_risk_country"),
    ]

    operations = [migrations.RunPython(date_each_activation, migrations.RunPython.noop)]
