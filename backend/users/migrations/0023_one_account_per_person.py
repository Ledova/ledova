import django.db.models.deletion
from django.db import migrations, models

ORPHANED = (
    "customer_accounts_account has {count} row(s) with no profile, which cannot exist once an "
    "account names the one person it belongs to. Delete them or attach a profile, then migrate."
)
SHARED = (
    "customer_accounts_account has {count} row(s) with more than one profile. Joint accounts are "
    "no longer supported; split them into one account per person, then migrate."
)


def take_the_single_profile(apps, schema_editor):
    account = apps.get_model("users", "UserAccount")
    alias = schema_editor.connection.alias
    rows = account._base_manager.using(alias)
    counted = list(rows.annotate(held=models.Count("user_profiles")))
    shared = [row.pk for row in counted if row.held > 1]
    if shared:
        raise RuntimeError(SHARED.format(count=len(shared)))
    orphaned = [row.pk for row in counted if row.held == 0]
    if orphaned:
        raise RuntimeError(ORPHANED.format(count=len(orphaned)))
    for row in rows.prefetch_related("user_profiles"):
        row.user_profile_id = row.user_profiles.all()[0].pk
        row.account_type = "individual"
        row.save(update_fields=["user_profile", "account_type"])


def give_the_profile_back(apps, schema_editor):
    account = apps.get_model("users", "UserAccount")
    alias = schema_editor.connection.alias
    for row in account._base_manager.using(alias):
        if row.user_profile_id:
            row.user_profiles.add(row.user_profile_id)


def reinstall_the_policies(apps, schema_editor):
    from shared.db.policy_sql import install

    install(schema_editor)


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0022_drop_the_owner_columns_no_policy_reads"),
    ]

    operations = [
        migrations.AddField(
            model_name="useraccount",
            name="user_profile",
            field=models.OneToOneField(
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="user_account",
                to="users.userprofile",
            ),
        ),
        migrations.RunPython(take_the_single_profile, give_the_profile_back),
        migrations.AlterField(
            model_name="useraccount",
            name="user_profile",
            field=models.OneToOneField(
                on_delete=django.db.models.deletion.CASCADE,
                related_name="user_account",
                to="users.userprofile",
            ),
        ),
        migrations.RunPython(reinstall_the_policies, reinstall_the_policies),
        migrations.RemoveField(model_name="useraccount", name="user_profiles"),
        migrations.RemoveField(model_name="userpreferences", name="selected_account"),
        migrations.AlterField(
            model_name="useraccount",
            name="account_type",
            field=models.CharField(choices=[("individual", "Individual")], default="individual", max_length=20),
        ),
    ]
