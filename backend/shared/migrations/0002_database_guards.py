from django.db import migrations

import shared.database_setup


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("admin", "0003_logentry_add_action_flag_choices"),
        ("assets", "0001_initial"),
        ("auth", "0012_alter_user_first_name_max_length"),
        ("authentication", "0001_initial"),
        ("blockchain", "0001_initial"),
        ("companies", "0002_initial"),
        ("compliance", "0002_initial"),
        ("contenttypes", "0002_remove_content_type_name"),
        ("documents", "0002_initial"),
        ("feature_flags", "0001_initial"),
        ("offerings", "0002_initial"),
        ("operators", "0001_initial"),
        ("portfolios", "0002_initial"),
        ("procrastinate", "0041_post_retry_failed_job"),
        ("sessions", "0001_initial"),
        ("shared", "0001_initial"),
        ("shareholders", "0002_initial"),
        ("token_blacklist", "0013_alter_blacklistedtoken_options_and_more"),
        ("tokens", "0005_member_access"),
        ("users", "0001_initial"),
        ("wallets", "0001_initial"),
        ("whitelist", "0001_initial"),
    ]

    operations = [migrations.RunPython(shared.database_setup.install)]
