from django.db import migrations, models


def carry_each_switch_across(apps, schema_editor):
    notification_preferences = apps.get_model("users", "NotificationPreferences")
    user_preferences = apps.get_model("users", "UserPreferences")
    alias = schema_editor.connection.alias
    for row in notification_preferences._base_manager.using(alias).iterator():
        user_preferences._base_manager.using(alias).update_or_create(
            user_profile_id=row.user_profile_id, defaults={"transaction_alerts": row.transaction_alerts}
        )


class Migration(migrations.Migration):
    dependencies = [("users", "0026_delete_favouriteasset")]

    operations = [
        migrations.AddField(
            model_name="userpreferences",
            name="transaction_alerts",
            field=models.BooleanField(default=True, help_text="Notifications for transaction status changes"),
        ),
        migrations.RunPython(carry_each_switch_across, migrations.RunPython.noop),
        migrations.DeleteModel(name="NotificationPreferences"),
    ]
