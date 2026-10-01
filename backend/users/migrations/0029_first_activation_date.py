from django.db import migrations
from django.db.models import F, OuterRef, Subquery

ONCE_ACTIVE = ("active", "suspended", "terminated")
COMPLETED_GREEN = {"user_profile__review_result": "GREEN", "user_profile__verification_status": "completed"}

KEEP_FIRST_ACTIVATION = """
CREATE FUNCTION users_keep_first_activation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.activation_date := LEAST(OLD.activation_date, NEW.activation_date);
    RETURN NEW;
END;
$$;
CREATE TRIGGER users_keep_first_activation BEFORE UPDATE OF activation_date ON customer_accounts_account
FOR EACH ROW EXECUTE FUNCTION users_keep_first_activation();
"""


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
    checked = set(undated.filter(**COMPLETED_GREEN).values_list("pk", flat=True))
    for row in undated.annotate(assessed=Subquery(first_assessment), verified=F("user_profile__verified_at")):
        evidence = [moment for moment in (row.assessed, row.verified) if moment is not None and row.pk in checked]
        account._base_manager.using(alias).filter(pk=row.pk).update(
            activation_date=min(evidence) if evidence else row.created_at
        )


def keep_the_first_activation(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(KEEP_FIRST_ACTIVATION)


def let_it_move_again(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("DROP TRIGGER users_keep_first_activation ON customer_accounts_account")
        cursor.execute("DROP FUNCTION users_keep_first_activation()")


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0028_remove_theme_and_selected_portfolio"),
        ("compliance", "0005_remove_fiat_transaction_and_high_risk_country"),
    ]

    operations = [
        migrations.RunPython(date_each_activation, migrations.RunPython.noop),
        migrations.RunPython(keep_the_first_activation, let_it_move_again),
    ]
