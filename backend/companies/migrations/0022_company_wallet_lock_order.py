from django.db import migrations

OLD_ACTOR_LOCK = """
    SELECT * INTO actor FROM authentication_customuser WHERE id = principal FOR SHARE;
"""

NEW_ACTOR_LOCK = """
    IF TG_OP = 'UPDATE' AND operation = 'edit'
        AND NEW.operator_wallet_id IS DISTINCT FROM OLD.operator_wallet_id AND NEW.operator_wallet_id IS NOT NULL
    THEN
        SELECT * INTO wallet FROM wallets WHERE uuid = NEW.operator_wallet_id FOR NO KEY UPDATE;
        SELECT * INTO wallet_account FROM customer_accounts_account WHERE uuid = wallet.user_account_id FOR NO KEY UPDATE;
        SELECT * INTO wallet_profile FROM users_userprofile WHERE uuid = wallet_account.user_profile_id;
        IF wallet.uuid IS NULL OR wallet.verification_status <> 'VERIFIED' OR wallet.chain NOT IN ('base', 'ethereum')
            OR wallet_account.uuid IS NULL OR wallet_profile.uuid IS NULL OR wallet_profile.user_id IS DISTINCT FROM principal
        THEN RAISE EXCEPTION 'Select the actors current verified EVM wallet' USING ERRCODE = '23514'; END IF;
    END IF;
    SELECT * INTO actor FROM authentication_customuser WHERE id = principal FOR SHARE;
    IF TG_OP = 'UPDATE' AND operation = 'edit'
        AND NEW.operator_wallet_id IS DISTINCT FROM OLD.operator_wallet_id AND NEW.operator_wallet_id IS NOT NULL
    THEN
        SELECT * INTO wallet_profile FROM users_userprofile WHERE uuid = wallet_account.user_profile_id FOR SHARE;
        IF wallet_profile.uuid IS NULL OR wallet_profile.user_id IS DISTINCT FROM principal
        THEN RAISE EXCEPTION 'Select the actors current verified EVM wallet' USING ERRCODE = '23514'; END IF;
    END IF;
"""

OLD_WALLET_LOCKS = """
            SELECT * INTO wallet FROM wallets WHERE uuid = NEW.operator_wallet_id FOR SHARE;
            SELECT * INTO wallet_account FROM customer_accounts_account WHERE uuid = wallet.user_account_id FOR SHARE;
            SELECT * INTO wallet_profile FROM users_userprofile WHERE uuid = wallet_account.user_profile_id FOR SHARE;
"""

OLD_WALLET_STATUS = "wallet.verification_status <> 'verified'"
NEW_WALLET_STATUS = "wallet.verification_status <> 'VERIFIED'"


def replace_locks(schema_editor, replacements):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE companies_company IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT pg_get_functiondef('companies_guard_administration'::regproc)")
        guard = cursor.fetchone()[0]
        for old, new in replacements:
            if guard.count(old) != 1:
                raise RuntimeError("The company administration guard differs from this wallet lock prerequisite.")
            guard = guard.replace(old, new)
        cursor.execute(guard)


def install_locks(apps, schema_editor):
    replace_locks(
        schema_editor,
        (
            (OLD_ACTOR_LOCK, NEW_ACTOR_LOCK),
            (OLD_WALLET_LOCKS.lstrip("\n"), ""),
            (OLD_WALLET_STATUS, NEW_WALLET_STATUS),
        ),
    )


def restore_locks(apps, schema_editor):
    wallet_validation = "            IF wallet.uuid IS NULL OR wallet.verification_status <> 'verified' OR wallet.chain NOT IN ('base', 'ethereum')"
    replace_locks(
        schema_editor,
        (
            (NEW_ACTOR_LOCK, OLD_ACTOR_LOCK),
            (NEW_WALLET_STATUS, OLD_WALLET_STATUS),
            (wallet_validation, OLD_WALLET_LOCKS.lstrip("\n") + wallet_validation),
        ),
    )


class Migration(migrations.Migration):
    dependencies = [("companies", "0021_company_activation")]
    operations = [migrations.RunPython(install_locks, restore_locks)]
