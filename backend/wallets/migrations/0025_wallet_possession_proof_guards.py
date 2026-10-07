from django.conf import settings
from django.db import migrations

SQL = """
CREATE FUNCTION wallets_possession_proof_current(proof_uuid uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    SELECT EXISTS (SELECT 1 FROM wallets_walletpossessionproof proof
        JOIN wallets wallet ON wallet.uuid = proof.wallet_id
        JOIN customer_accounts_account account ON account.uuid = wallet.user_account_id
        JOIN users_userprofile profile ON profile.uuid = account.user_profile_id
        WHERE proof.uuid = proof_uuid AND proof.account_id = account.uuid AND proof.profile_id = profile.uuid
            AND proof.verified_by_id = profile.user_id AND proof.address = wallet.address AND proof.chain = wallet.chain
            AND wallet.verification_status = 'VERIFIED' AND wallet.verification_signature = proof.signature
            AND wallet.verified_at = proof.completed_at);
$$;
CREATE FUNCTION wallets_guard_possession_proof() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE principal bigint; retained_wallet wallets; at_time timestamptz;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Retain successful wallet possession proofs' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    SELECT * INTO retained_wallet FROM wallets WHERE uuid = NEW.wallet_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
        OR current_setting('app.wallet_proof_operation', true) IS DISTINCT FROM 'complete'
        OR NEW.verified_by_id IS DISTINCT FROM principal OR retained_wallet.uuid IS NULL
        OR NOT EXISTS (SELECT 1 FROM customer_accounts_account account JOIN users_userprofile profile
            ON profile.uuid = account.user_profile_id WHERE account.uuid = retained_wallet.user_account_id
            AND account.uuid = NEW.account_id AND profile.uuid = NEW.profile_id AND profile.user_id = principal)
        OR NEW.address IS DISTINCT FROM retained_wallet.address OR NEW.chain IS DISTINCT FROM retained_wallet.chain
        OR NEW.challenge IS DISTINCT FROM retained_wallet.verification_challenge
        OR NEW.challenge_issued_at IS DISTINCT FROM retained_wallet.verification_challenge_issued_at
        OR NEW.challenge_expires_at IS DISTINCT FROM NEW.challenge_issued_at + interval '__MINUTES__ minutes'
        OR NOT COALESCE(NEW.challenge ~ 'Nonce: [0-9a-f]{32}', false)
        OR NOT COALESCE(length(NEW.signature) > 0, false)
        OR NEW.challenge_issued_at > at_time OR NEW.challenge_expires_at <= at_time
    THEN RAISE EXCEPTION 'A proof must come from the actual owned current challenge producer' USING ERRCODE = '23514'; END IF;
    NEW.completed_at := at_time; NEW.created_at := at_time; NEW.updated_at := at_time;
    NEW.digest := encode(sha256(convert_to((to_jsonb(NEW) - ARRAY['uuid', 'created_at', 'updated_at', 'digest'])::text, 'UTF8')), 'hex');
    RETURN NEW;
END;
$$;
CREATE TRIGGER wallets_possession_proof_source BEFORE INSERT OR UPDATE OR DELETE ON wallets_walletpossessionproof
FOR EACH ROW EXECUTE FUNCTION wallets_guard_possession_proof();
CREATE FUNCTION wallets_check_possession_proof() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NEW.challenge_expires_at <= clock_timestamp() OR NOT wallets_possession_proof_current(NEW.uuid)
        OR EXISTS (SELECT 1 FROM wallets WHERE uuid = NEW.wallet_id
            AND (verification_challenge IS NOT NULL OR verification_challenge_issued_at IS NOT NULL)) THEN
        RAISE EXCEPTION 'Successful proof and wallet completion commit together within the actual challenge lifetime' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER wallets_possession_proof_effect AFTER INSERT ON wallets_walletpossessionproof
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION wallets_check_possession_proof();
"""


def install(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT quote_literal(%s), quote_literal(current_user)", [settings.RLS_ROLES["operator"]])
        operator, migrate = cursor.fetchone()
        cursor.execute(
            SQL.replace("__OPERATOR__", operator)
            .replace("__MIGRATE__", migrate)
            .replace("__MINUTES__", str(settings.WALLET_VERIFICATION_CHALLENGE_MINUTES))
        )


def reverse(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT EXISTS (SELECT 1 FROM wallets_walletpossessionproof)")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retained wallet possession proofs prevent reversing their guards.")
        cursor.execute("""
            DROP TRIGGER wallets_possession_proof_effect ON wallets_walletpossessionproof;
            DROP TRIGGER wallets_possession_proof_source ON wallets_walletpossessionproof;
            DROP FUNCTION wallets_check_possession_proof();
            DROP FUNCTION wallets_guard_possession_proof();
            DROP FUNCTION wallets_possession_proof_current(uuid);
        """)


class Migration(migrations.Migration):
    dependencies = [("wallets", "0024_wallet_possession_proof")]
    operations = [migrations.RunPython(install, reverse)]
