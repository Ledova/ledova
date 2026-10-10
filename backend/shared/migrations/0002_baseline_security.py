from django.db import migrations

import shared.baseline


class Migration(migrations.Migration):

    replaces = [("shared", "0014_policies_without_notification_preferences")]

    initial = True

    dependencies = [
        ("admin", "0003_logentry_add_action_flag_choices"),
        ("assets", "0001_baseline"),
        ("auth", "0012_alter_user_first_name_max_length"),
        ("authentication", "0001_baseline"),
        ("blockchain", "0001_baseline"),
        ("companies", "0002_baseline"),
        ("compliance", "0001_baseline"),
        ("contenttypes", "0002_remove_content_type_name"),
        ("documents", "0001_baseline"),
        ("feature_flags", "0001_baseline"),
        ("offerings", "0002_baseline"),
        ("operators", "0001_baseline"),
        ("portfolios", "0001_baseline"),
        ("procrastinate", "0041_post_retry_failed_job"),
        ("sessions", "0001_initial"),
        ("shared", "0001_baseline"),
        ("shareholders", "0001_baseline"),
        ("token_blacklist", "0013_alter_blacklistedtoken_options_and_more"),
        ("tokens", "0002_baseline"),
        ("users", "0001_baseline"),
        ("wallets", "0001_baseline"),
        ("whitelist", "0001_baseline"),
    ]

    operations = [
        migrations.RunPython(
            code=shared.baseline.install,
        ),
    ]
