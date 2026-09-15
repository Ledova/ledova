from django.conf import settings
from django.db import migrations

GUARD = """
CREATE FUNCTION protect_pause_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    operation blockchain_outgoingoperation%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Pause submission history cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' AND (NEW.operation_id IS NOT NULL OR NEW.observation IS NOT NULL
        OR NOT ((NEW.status = 'pending' AND NEW.completed_at IS NULL)
            OR (NEW.status = 'failed' AND NEW.completed_at IS NOT NULL))) THEN
        RAISE EXCEPTION 'Pause admission starts pending or with a completed unsigned refusal';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.uuid, NEW.created_at, NEW.token_id, NEW.company_id, NEW.initiated_by_id,
            NEW.authority, NEW.paused, NEW.chain_id, NEW.contract_address, NEW.intent)
            IS DISTINCT FROM ROW(OLD.uuid, OLD.created_at, OLD.token_id, OLD.company_id, OLD.initiated_by_id,
            OLD.authority, OLD.paused, OLD.chain_id, OLD.contract_address, OLD.intent) THEN
            RAISE EXCEPTION 'Pause identity, authority and intent are immutable';
        END IF;
        IF OLD.operation_id IS NOT NULL AND NEW.operation_id IS DISTINCT FROM OLD.operation_id THEN
            RAISE EXCEPTION 'Pause submissions retain their original operation';
        END IF;
        IF OLD.observation IS NOT NULL AND NEW.observation IS DISTINCT FROM OLD.observation THEN
            RAISE EXCEPTION 'Pause submissions retain their original observation';
        END IF;
        IF OLD.completed_at IS NOT NULL AND ROW(NEW.status, NEW.operation_id, NEW.observation, NEW.completed_at)
            IS DISTINCT FROM ROW(OLD.status, OLD.operation_id, OLD.observation, OLD.completed_at) THEN
            RAISE EXCEPTION 'Completed pause outcomes cannot be replaced';
        END IF;
        IF NEW.status <> OLD.status AND NOT (
            (OLD.status = 'pending' AND NEW.status IN ('executing', 'observed', 'failed'))
            OR (OLD.status = 'executing' AND NEW.status IN ('confirmed', 'failed'))
        ) THEN
            RAISE EXCEPTION 'A pause outcome cannot be reopened or replaced';
        END IF;
    END IF;
    IF jsonb_typeof(NEW.intent) IS DISTINCT FROM 'object'
        OR NEW.intent IS DISTINCT FROM jsonb_build_object(
            'chain_id', NEW.chain_id, 'sender', NEW.intent->'sender', 'to', NEW.contract_address,
            'value', '0', 'data', CASE WHEN NEW.paused THEN '0x8456cb59' ELSE '0x3f4ba83a' END
        ) OR coalesce(NEW.intent->>'sender', '') !~ '^0x[0-9a-f]{40}$' THEN
        RAISE EXCEPTION 'Pause admission requires its exact chain, signer, contract and action';
    END IF;
    IF NEW.operation_id IS NOT NULL THEN
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
        IF NOT FOUND OR operation.operation_key <> 'token-pause:' || NEW.uuid::text
            OR operation.intent IS DISTINCT FROM NEW.intent THEN
            RAISE EXCEPTION 'A pause submission must name its original outgoing operation';
        END IF;
        IF NEW.status IN ('pending', 'observed') THEN
            RAISE EXCEPTION 'A pause observation cannot replace signing admission';
        END IF;
        IF NEW.status = 'confirmed' AND (operation.status <> 'confirmed' OR operation.current_attempt_id IS NULL) THEN
            RAISE EXCEPTION 'Pause confirmation requires its original confirmed transaction';
        END IF;
        IF NEW.status = 'failed' AND operation.status NOT IN ('failed', 'reverted') THEN
            RAISE EXCEPTION 'A pause failure requires its original failed operation';
        END IF;
    ELSIF NEW.status = 'confirmed' OR (NEW.status = 'failed' AND (
        (TG_OP = 'UPDATE' AND OLD.status NOT IN ('pending', 'failed'))
        OR EXISTS (SELECT 1 FROM blockchain_outgoingoperation WHERE operation_key = 'token-pause:' || NEW.uuid::text)
    )) THEN
        RAISE EXCEPTION 'Signed pause outcomes require their original operation';
    END IF;
    IF NEW.status = 'observed' THEN
        IF NEW.observation IS NULL OR jsonb_typeof(NEW.observation) IS DISTINCT FROM 'object'
            OR NOT (NEW.observation ?& ARRAY['block_number', 'block_hash', 'observed_at'])
            OR coalesce(NEW.observation->>'block_number', '') !~ '^[0-9]+$'
            OR coalesce(NEW.observation->>'block_hash', '') !~ '^0x[0-9a-f]{64}$'
            OR coalesce(NEW.observation->>'observed_at', '') = ''
            OR EXISTS (SELECT 1 FROM blockchain_outgoingoperation
                WHERE operation_key = 'token-pause:' || NEW.uuid::text) THEN
            RAISE EXCEPTION 'Observed pause outcomes require initial evidence without an outgoing operation';
        END IF;
    ELSIF NEW.observation IS NOT NULL THEN
        RAISE EXCEPTION 'Only observed pause outcomes carry observation evidence';
    END IF;
    IF NEW.completed_at IS NOT NULL AND NEW.status NOT IN ('observed', 'confirmed', 'failed') THEN
        RAISE EXCEPTION 'Only resolved pause outcomes release the next submission';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_pause_change
BEFORE INSERT OR UPDATE OR DELETE ON tokens_pausechange
FOR EACH ROW EXECUTE FUNCTION protect_pause_change();

CREATE FUNCTION protect_pause_operation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    command tokens_pausechange%ROWTYPE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.operation_key LIKE 'token-pause:%' THEN
            SELECT * INTO command FROM tokens_pausechange
                WHERE 'token-pause:' || uuid::text = NEW.operation_key FOR UPDATE;
            IF NOT FOUND OR command.status <> 'executing' OR command.completed_at IS NOT NULL
                OR NEW.intent IS DISTINCT FROM command.intent THEN
                RAISE EXCEPTION 'Only an executing pause submission admits its original operation';
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.claim_id IS DISTINCT FROM OLD.claim_id AND EXISTS (
        SELECT 1 FROM tokens_pausechange WHERE 'token-pause:' || uuid::text = OLD.operation_key
    ) THEN
        RAISE EXCEPTION 'A new pause attempt requires a new submission';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_pause_operation BEFORE INSERT OR UPDATE ON blockchain_outgoingoperation
FOR EACH ROW EXECUTE FUNCTION protect_pause_operation();
"""

REVERSE = """
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM tokens_pausechange) THEN
        RAISE EXCEPTION 'Cannot remove pause submission or recovery history';
    END IF;
END $$;
DROP TRIGGER protect_pause_change ON tokens_pausechange;
DROP FUNCTION protect_pause_change();
DROP TRIGGER protect_pause_operation ON blockchain_outgoingoperation;
DROP FUNCTION protect_pause_operation();
"""


def restrict_journal(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_ident(%s), quote_ident(%s)", [settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]]
        )
        app_role, operator_role = cursor.fetchone()
        cursor.execute(f"REVOKE ALL ON tokens_pausechange FROM {app_role}")
        cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON tokens_pausechange TO {operator_role}")


class Migration(migrations.Migration):
    dependencies = [("tokens", "0051_pause_change")]
    operations = [
        migrations.RunSQL(GUARD, REVERSE),
        migrations.RunPython(restrict_journal, migrations.RunPython.noop),
    ]
