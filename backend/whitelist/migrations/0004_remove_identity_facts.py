from django.db import migrations

TABLE = "whitelist_whitelisteligibilityinvalidation"
HISTORY_GUARD = "whitelist_eligibility_invalidation_history"
IDENTITY_FACTS = [
    "identity_verified",
    "kyc_required",
    "identity_provider",
    "identity_status",
    "identity_review",
    "identity_observed_at",
]
IDENTITY_REASONS = ["pep_policy", "fatf_blacklist"]


def remove_identity_facts(apps, schema_editor):
    if schema_editor.connection.vendor != "postgresql":
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(f"ALTER TABLE {TABLE} DISABLE TRIGGER {HISTORY_GUARD}")
        cursor.execute(
            f"UPDATE {TABLE} SET facts = facts - %s::text[] WHERE facts ?| %s::text[]",
            [IDENTITY_FACTS, IDENTITY_FACTS],
        )
        cursor.execute(
            f"UPDATE {TABLE} SET facts = jsonb_set(facts, '{{standing_reason}}', '\"\"') "
            "WHERE facts->>'standing_reason' = ANY(%s)",
            [IDENTITY_REASONS],
        )
        cursor.execute("SET CONSTRAINTS ALL IMMEDIATE")
        cursor.execute(f"ALTER TABLE {TABLE} ENABLE TRIGGER {HISTORY_GUARD}")


class Migration(migrations.Migration):

    dependencies = [("whitelist", "0003_remove_identity_loss")]

    operations = [migrations.RunPython(remove_identity_facts, migrations.RunPython.noop)]
