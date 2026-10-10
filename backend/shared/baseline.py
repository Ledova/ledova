from decimal import Decimal

from django.conf import settings

from blockchain.baseline import install as install_outgoing
from companies.baseline import install as install_companies
from offerings.baseline import install as install_offerings
from shared.db import atomic
from shared.db.policy_sql import grant_reachable_tables
from shared.db.policy_sql import install as install_policies
from shareholders.baseline import install as install_publications
from tokens.baseline import install as install_tokens
from users.baseline import install as install_participants
from wallets.baseline import install as install_wallets
from whitelist.baseline import install as install_whitelist

HISTORICAL_NAMES = """
ALTER TABLE public."tokens_mintrequest"
    RENAME CONSTRAINT "tokens_mintrequest_executed_by_id_0db7da18_fk_authentic"
    TO "tokens_stablecoinmin_executed_by_id_e4ace3cc_fk_authentic";
ALTER TABLE public."tokens_mintrequest"
    RENAME CONSTRAINT "tokens_mintrequest_requested_by_id_fd5c8227_fk_authentic"
    TO "tokens_stablecoinmin_requested_by_id_002dbf3c_fk_authentic";
ALTER TABLE public."tokens_mintrequest"
    RENAME CONSTRAINT "tokens_mintrequest_transaction_id_75e62b7b_fk_blockchai"
    TO "tokens_stablecoinmin_transaction_id_0ff2128b_fk_blockchai";
ALTER TABLE public."tokens_mintrequest"
    RENAME CONSTRAINT "tokens_mintrequest_pkey"
    TO "tokens_stablecoinmintrequest_pkey";
ALTER TABLE public."tokens_shareissuance"
    RENAME CONSTRAINT "tokens_shareissuance_block_number_check"
    TO "tokens_tokenissuance_block_number_check";
ALTER TABLE public."tokens_shareissuance"
    RENAME CONSTRAINT "tokens_shareissuance_gas_used_check"
    TO "tokens_tokenissuance_gas_used_check";
ALTER TABLE public."tokens_shareissuance"
    RENAME CONSTRAINT "tokens_shareissuance_idempotency_key_key"
    TO "tokens_tokenissuance_idempotency_key_key";
ALTER TABLE public."tokens_shareissuance"
    RENAME CONSTRAINT "tokens_shareissuance_initiated_by_id_f048d73b_fk_authentic"
    TO "tokens_tokenissuance_initiated_by_id_e42b1e17_fk_authentic";
ALTER TABLE public."tokens_shareissuance"
    RENAME CONSTRAINT "tokens_shareissuance_pkey"
    TO "tokens_tokenissuance_pkey";
ALTER TABLE public."tokens_shareissuance"
    RENAME CONSTRAINT "tokens_shareissuance_token_id_d8752bbe_fk_tokens_sh"
    TO "tokens_tokenissuance_token_id_29325496_fk_tokens_sh";
ALTER TABLE public."tokens_shareissuance"
    RENAME CONSTRAINT "tokens_shareissuance_transaction_id_c95ed32f_fk_blockchai"
    TO "tokens_tokenissuance_transaction_id_0f5d6b28_fk_blockchai";
ALTER INDEX public."tokens_mintrequest_executed_by_id_0db7da18"
    RENAME
    TO "tokens_stablecoinmintrequest_executed_by_id_e4ace3cc";
ALTER INDEX public."tokens_mintrequest_requested_by_id_fd5c8227"
    RENAME
    TO "tokens_stablecoinmintrequest_requested_by_id_002dbf3c";
ALTER INDEX public."tokens_mintrequest_transaction_id_75e62b7b"
    RENAME
    TO "tokens_stablecoinmintrequest_transaction_id_0ff2128b";
ALTER INDEX public."tokens_shareissuance_idempotency_key_9769293e_like"
    RENAME
    TO "tokens_tokenissuance_idempotency_key_4b1f5597_like";
ALTER INDEX public."tokens_shareissuance_initiated_by_id_f048d73b"
    RENAME
    TO "tokens_tokenissuance_initiated_by_id_e42b1e17";
ALTER INDEX public."tokens_shareissuance_token_id_d8752bbe"
    RENAME
    TO "tokens_tokenissuance_token_id_29325496";
ALTER INDEX public."tokens_shareissuance_transaction_id_c95ed32f"
    RENAME
    TO "tokens_tokenissuance_transaction_id_0f5d6b28";
"""

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
            cursor.execute(HISTORICAL_NAMES)
            cursor.execute(CREATE_ROLES, {"app": settings.RLS_ROLES["app"], "operator": settings.RLS_ROLES["operator"]})
            cursor.execute("SHOW check_function_bodies")
            previous = cursor.fetchone()[0]
        with atomic(using=schema_editor.connection.alias):
            with schema_editor.connection.cursor() as cursor:
                cursor.execute("SELECT set_config('check_function_bodies', 'off', true)")
            install_policies(schema_editor)
            grant_reachable_tables(schema_editor)
            for installer in (
                install_outgoing,
                install_companies,
                install_participants,
                install_wallets,
                install_tokens,
                install_whitelist,
                install_offerings,
                install_publications,
            ):
                installer(apps, schema_editor)
            with schema_editor.connection.cursor() as cursor:
                cursor.execute("SELECT set_config('check_function_bodies', %s, true)", [previous])
    seed_reference_rows(apps, schema_editor)
