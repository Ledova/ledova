from decimal import Decimal

from django.conf import settings

from blockchain.database_guards import install as install_outgoing
from companies import (
    authority_guards,
    database_admission_guards,
    database_workflow_guards,
    signup_terms_guards,
)
from companies.database_guards import install as install_companies
from shared.db import atomic
from shared.db.policy_sql import grant_reachable_tables
from shared.db.policy_sql import install as install_policies
from tokens import (
    database_allotment_completion,
    database_award_agreement_guards,
    database_award_entitlement_guards,
    database_award_person_guards,
    database_class_documents,
    database_class_rights,
    database_event_date_guards,
    database_member_documents,
    database_member_name_guards,
    database_mirror_guards,
    database_people,
    database_transfer_completion,
    database_transfer_guards,
)
from tokens.database_guards import install as install_tokens
from users.database_guards import install as install_participants
from wallets.database_guards import install as install_wallets
from whitelist.database_guards import install as install_whitelist

UNBOUNDED_NUMERIC_COLUMNS = (
    ("tokens_registeraward", "shares"),
    ("tokens_registerawardvesting", "shares"),
    ("tokens_registerawardend", "unvested_shares"),
    ("tokens_registerawardend", "vested_shares"),
    ("tokens_registerawardvestingreversal", "reversed_shares"),
    ("tokens_registerallotment", "shares"),
    ("tokens_registerallotment", "consideration"),
    ("tokens_registercontribution", "amount"),
)

FAMILY_GUARDS = (
    authority_guards.install,
    signup_terms_guards.install,
    database_transfer_guards.install,
    database_mirror_guards.install,
    database_event_date_guards.install,
    database_award_agreement_guards.install,
    database_award_entitlement_guards.install,
    database_admission_guards.install,
    database_workflow_guards.install,
    database_member_name_guards.install,
    database_class_rights.install,
    database_award_person_guards.install,
    database_member_documents.install,
    database_mirror_guards.install_member_validation,
    database_class_documents.install,
    database_allotment_completion.install,
    database_people.install,
    database_transfer_completion.install,
)

CREATE_ROLES = """
DO $$
DECLARE
    app_role   text := %(app)s;
    oper_role  text := %(operator)s;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = app_role) THEN
        EXECUTE format('CREATE ROLE %%I LOGIN', app_role);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = oper_role) THEN
        EXECUTE format('CREATE ROLE %%I LOGIN', oper_role);
    END IF;

    EXECUTE format('ALTER ROLE %%I NOBYPASSRLS', app_role);
    EXECUTE format('ALTER ROLE %%I BYPASSRLS', oper_role);
    EXECUTE format('ALTER ROLE %%I BYPASSRLS', current_user);

    EXECUTE format('GRANT %%I, %%I TO %%I', app_role, oper_role, current_user);
    EXECUTE format('GRANT CONNECT ON DATABASE %%I TO %%I, %%I', current_database(), app_role, oper_role);
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %%I, %%I', app_role, oper_role);
    EXECUTE format(
        'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %%I, %%I', app_role, oper_role
    );
    EXECUTE format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %%I, %%I', app_role, oper_role);
    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %%I IN SCHEMA public '
        'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %%I, %%I',
        current_user, app_role, oper_role
    );
    EXECUTE format(
        'ALTER DEFAULT PRIVILEGES FOR ROLE %%I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %%I, %%I',
        current_user, app_role, oper_role
    );
END
$$;
"""


def seed_operations_group(apps, schema_editor):
    using = schema_editor.connection.alias
    group, _ = apps.get_model("auth", "Group").objects.using(using).get_or_create(name="Document operations")
    for label, model in (
        ("documents", "document"),
        ("documents", "documentextraction"),
        ("users", "investorclassification"),
    ):
        content_type, _ = (
            apps.get_model("contenttypes", "ContentType")
            .objects.using(using)
            .get_or_create(app_label=label, model=model)
        )
        permission, _ = (
            apps.get_model("auth", "Permission")
            .objects.using(using)
            .get_or_create(content_type=content_type, codename=f"view_{model}", defaults={"name": f"Can view {model}"})
        )
        group.permissions.through.objects.using(using).get_or_create(group_id=group.pk, permission_id=permission.pk)


def seed_reference_rows(apps, schema_editor):
    alias = schema_editor.connection.alias
    asset, _ = (
        apps.get_model("assets", "Asset")
        .objects.using(alias)
        .get_or_create(
            symbol="aAUD",
            defaults={
                "name": "Synthetic AUD Example Token",
                "asset_type": "stablecoin",
                "decimals": 2,
                "current_price": Decimal("1.00"),
                "price_currency": "USD",
                "price_source": None,
                "is_active": True,
            },
        )
    )
    apps.get_model("assets", "AssetChainDeployment").objects.using(alias).get_or_create(
        asset=asset, chain="ledova", defaults={"contract_address": None, "decimals": 2, "is_active": True}
    )
    apps.get_model("feature_flags", "FeatureFlag").objects.using(alias).update_or_create(
        name="trading_enabled",
        defaults={
            "description": "Enables P2P trading of share tokens (buy/sell orders, atomic swaps)",
            "enabled": True,
            "platform": "all",
        },
    )
    seed_operations_group(apps, schema_editor)


def install(apps, schema_editor):
    if schema_editor.connection.vendor == "postgresql":
        with schema_editor.connection.cursor() as cursor:
            cursor.execute(CREATE_ROLES, {"app": settings.RLS_ROLES["app"], "operator": settings.RLS_ROLES["operator"]})
            cursor.execute("SHOW check_function_bodies")
            previous = cursor.fetchone()[0]
        with atomic(using=schema_editor.connection.alias):
            with schema_editor.connection.cursor() as cursor:
                cursor.execute("SELECT set_config('check_function_bodies', 'off', true)")
                for table, column in UNBOUNDED_NUMERIC_COLUMNS:
                    cursor.execute(f"ALTER TABLE {table} ALTER COLUMN {column} TYPE numeric")
            install_policies(schema_editor)
            grant_reachable_tables(schema_editor)
            for installer in (
                install_outgoing,
                install_companies,
                install_participants,
                install_wallets,
                install_tokens,
                install_whitelist,
                *FAMILY_GUARDS,
            ):
                installer(apps, schema_editor)
            with schema_editor.connection.cursor() as cursor:
                cursor.execute("SELECT set_config('check_function_bodies', %s, true)", [previous])
    seed_reference_rows(apps, schema_editor)
