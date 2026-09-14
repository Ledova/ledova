from django.conf import settings
from django.db import migrations

GUARD = """
CREATE FUNCTION protect_token_deployment() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    operation blockchain_outgoingoperation%ROWTYPE;
    attempt blockchain_signedattempt%ROWTYPE;
    projected blockchain_blockchaintransaction%ROWTYPE;
    previous blockchain_blockchaintransaction%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Admitted deployment history cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' AND (NEW.operation_id IS NOT NULL OR NEW.transaction_id IS NOT NULL
        OR NEW.contract_address <> '' OR NEW.projected_at IS NOT NULL OR NEW.attribution_required) THEN
        RAISE EXCEPTION 'A deployment admission must start without a recorded outcome';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.uuid, NEW.created_at, NEW.token_id, NEW.company_id, NEW.principal_id, NEW.intent)
            IS DISTINCT FROM ROW(OLD.uuid, OLD.created_at, OLD.token_id, OLD.company_id, OLD.principal_id, OLD.intent) THEN
            RAISE EXCEPTION 'Deployment submission identity, intent and authority are immutable';
        END IF;
        IF OLD.operation_id IS NOT NULL AND NEW.operation_id IS DISTINCT FROM OLD.operation_id THEN
            RAISE EXCEPTION 'A deployment retains its original outgoing operation';
        END IF;
        IF OLD.contract_address <> '' AND NEW.contract_address IS DISTINCT FROM OLD.contract_address THEN
            RAISE EXCEPTION 'A deployment retains its original contract outcome';
        END IF;
        IF OLD.projected_at IS NOT NULL AND NEW.projected_at IS DISTINCT FROM OLD.projected_at THEN
            RAISE EXCEPTION 'A deployment retains its projection outcome';
        END IF;
        IF OLD.attribution_required AND NOT NEW.attribution_required THEN
            RAISE EXCEPTION 'Unattributed deployments require an explicit attribution workflow';
        END IF;
        IF OLD.transaction_id IS NOT NULL AND NEW.transaction_id IS DISTINCT FROM OLD.transaction_id THEN
            SELECT * INTO previous FROM blockchain_blockchaintransaction WHERE uuid = OLD.transaction_id;
            IF NEW.transaction_id IS NULL OR previous.status IS DISTINCT FROM 'reverted' THEN
                RAISE EXCEPTION 'An unresolved deployment transaction cannot be replaced';
            END IF;
        END IF;
    END IF;
    IF jsonb_typeof(NEW.intent) <> 'object'
        OR NOT (NEW.intent ?& ARRAY['chain_id', 'sender', 'to', 'value', 'data', 'name', 'symbol',
                                   'identifier', 'authorized_shares', 'issuer_wallet', 'decimals'])
        OR NEW.intent->>'value' IS DISTINCT FROM '0' THEN
        RAISE EXCEPTION 'Deployment admission requires immutable factory call terms';
    END IF;
    IF NEW.operation_id IS NOT NULL THEN
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
        IF NOT FOUND OR operation.operation_key <> 'token-deployment:' || NEW.uuid::text
            OR operation.intent IS DISTINCT FROM jsonb_build_object(
                'chain_id', NEW.intent->'chain_id', 'sender', NEW.intent->'sender', 'to', NEW.intent->'to',
                'value', NEW.intent->'value', 'data', NEW.intent->'data'
            ) THEN
            RAISE EXCEPTION 'A deployment must reference its own immutable outgoing operation';
        END IF;
        IF NEW.transaction_id IS NOT NULL THEN
            SELECT * INTO projected FROM blockchain_blockchaintransaction WHERE uuid = NEW.transaction_id;
            IF projected.related_model IS DISTINCT FROM 'tokens.ShareToken'
                OR projected.related_uuid IS DISTINCT FROM NEW.token_id
                OR projected.tx_type IS DISTINCT FROM 'share_token_deploy' THEN
                RAISE EXCEPTION 'Deployment projection must name its original token';
            END IF;
            IF operation.current_attempt_id IS NOT NULL THEN
                SELECT * INTO attempt FROM blockchain_signedattempt WHERE uuid = operation.current_attempt_id;
                IF projected.tx_hash IS DISTINCT FROM attempt.tx_hash THEN
                    RAISE EXCEPTION 'Deployment projection must name its current signed attempt';
                END IF;
            ELSIF projected.status IS DISTINCT FROM 'reverted' THEN
                RAISE EXCEPTION 'Only a reverted deployment can precede an unsigned retry';
            END IF;
        END IF;
        IF NEW.contract_address <> '' AND (operation.status <> 'confirmed' OR NEW.transaction_id IS NULL) THEN
            RAISE EXCEPTION 'Deployment completion requires its confirmed original transaction';
        END IF;
    ELSIF NEW.transaction_id IS NOT NULL OR NEW.contract_address <> '' THEN
        RAISE EXCEPTION 'Deployment outcomes require their durable operation';
    END IF;
    IF NEW.projected_at IS NOT NULL AND NEW.contract_address = '' THEN
        RAISE EXCEPTION 'Deployment projection requires its attributed contract';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_token_deployment
BEFORE INSERT OR UPDATE OR DELETE ON tokens_tokendeployment
FOR EACH ROW EXECUTE FUNCTION protect_token_deployment();
CREATE FUNCTION protect_token_deployment_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.deployment_id IS NOT NULL AND NEW.deployment_id IS DISTINCT FROM OLD.deployment_id THEN
        RAISE EXCEPTION 'The deployment submission identity cannot be replaced';
    END IF;
    IF OLD.deployment_id IS NULL AND NEW.deployment_id IS NOT NULL AND (
        OLD.status <> 'draft' OR NEW.status <> 'deploying'
        OR coalesce(OLD.deployment_tx_hash, '') <> '' OR OLD.deployment_transaction_id IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'Historical deployments cannot acquire new submission authority';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_token_deployment_identity BEFORE UPDATE ON tokens_sharetoken
FOR EACH ROW EXECUTE FUNCTION protect_token_deployment_identity();
"""

REVERSE = """
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM tokens_tokendeployment)
        OR EXISTS (SELECT 1 FROM tokens_sharetoken WHERE deployment_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Cannot remove deployment submission or recovery history';
    END IF;
END $$;
DROP TRIGGER protect_token_deployment ON tokens_tokendeployment;
DROP FUNCTION protect_token_deployment();
DROP TRIGGER protect_token_deployment_identity ON tokens_sharetoken;
DROP FUNCTION protect_token_deployment_identity();
"""


def restrict_journal(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_ident(%s), quote_ident(%s)", [settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]]
        )
        app_role, operator_role = cursor.fetchone()
        cursor.execute(f"REVOKE ALL ON tokens_tokendeployment FROM {app_role}")
        cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON tokens_tokendeployment TO {operator_role}")


class Migration(migrations.Migration):
    dependencies = [("tokens", "0043_token_deployment")]
    operations = [
        migrations.RunSQL(GUARD, REVERSE),
        migrations.RunPython(restrict_journal, migrations.RunPython.noop),
    ]
