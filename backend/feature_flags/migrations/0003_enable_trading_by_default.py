from django.db import migrations


def enable_trading(apps, schema_editor):
    FeatureFlag = apps.get_model("feature_flags", "FeatureFlag")
    FeatureFlag.objects.update_or_create(
        name="trading_enabled",
        defaults={
            "description": "Enables P2P trading of share tokens (buy/sell orders, atomic swaps)",
            "enabled": True,
            "platform": "all",
        },
    )


def disable_trading(apps, schema_editor):
    FeatureFlag = apps.get_model("feature_flags", "FeatureFlag")
    FeatureFlag.objects.filter(name="trading_enabled").update(enabled=False)


class Migration(migrations.Migration):

    dependencies = [
        ("feature_flags", "0002_add_trading_enabled_flag"),
    ]

    operations = [
        migrations.RunPython(enable_trading, disable_trading),
    ]
