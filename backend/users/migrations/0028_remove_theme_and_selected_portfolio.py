from django.db import migrations


def select_each_accounts_first_portfolio(apps, schema_editor):
    alias = schema_editor.connection.alias
    preferences = apps.get_model("users", "UserPreferences")._base_manager.using(alias)
    portfolios = apps.get_model("portfolios", "Portfolio")._base_manager.using(alias)
    for pk, account_id in preferences.values_list("pk", "user_profile__user_account"):
        first = (
            portfolios.filter(user_account_id=account_id).order_by("created_at", "uuid").values_list("pk", flat=True)
        ).first()
        if first is not None:
            preferences.filter(pk=pk).update(selected_portfolio_id=first)


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0027_transaction_alerts_on_user_preferences"),
        ("portfolios", "0005_delete_portfoliosnapshot"),
    ]

    operations = [
        migrations.RunPython(migrations.RunPython.noop, select_each_accounts_first_portfolio),
        migrations.RemoveField(model_name="userpreferences", name="selected_portfolio"),
        migrations.RemoveField(model_name="userpreferences", name="theme"),
    ]
