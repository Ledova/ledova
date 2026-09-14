from django.conf import settings
from django.db import migrations

GUARD = """
CREATE FUNCTION protect_whitelist_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    operation blockchain_outgoingoperation%ROWTYPE;
    attempt blockchain_signedattempt%ROWTYPE;
    projected blockchain_blockchaintransaction%ROWTYPE;
    selector text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Admitted whitelist history cannot be deleted';
    END IF;
    IF TG_OP = 'INSERT' AND (NEW.status <> 'pending' OR NEW.operation_id IS NOT NULL
        OR NEW.transaction_id IS NOT NULL OR NEW.completed_at IS NOT NULL OR NEW.failure_code <> '') THEN
        RAISE EXCEPTION 'A whitelist command must start with an unresolved membership decision';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.uuid, NEW.created_at, NEW.action, NEW.address, NEW.chain_id, NEW.registry_address,
               NEW.intent, NEW.initiated_by_id, NEW.authority, NEW.requested_wallet_id, NEW.entry_id)
           IS DISTINCT FROM
           ROW(OLD.uuid, OLD.created_at, OLD.action, OLD.address, OLD.chain_id, OLD.registry_address,
               OLD.intent, OLD.initiated_by_id, OLD.authority, OLD.requested_wallet_id, OLD.entry_id) THEN
            RAISE EXCEPTION 'Whitelist submission identity, intent and authority are immutable';
        END IF;
        IF OLD.operation_id IS NOT NULL AND NEW.operation_id IS DISTINCT FROM OLD.operation_id THEN
            RAISE EXCEPTION 'Whitelist commands retain their original outgoing operation';
        END IF;
        IF OLD.transaction_id IS NOT NULL AND NEW.transaction_id IS DISTINCT FROM OLD.transaction_id THEN
            RAISE EXCEPTION 'Whitelist commands retain their original transaction';
        END IF;
        IF OLD.status IN ('confirmed', 'unchanged', 'failed') AND
            ROW(NEW.status, NEW.operation_id, NEW.transaction_id, NEW.completed_at, NEW.failure_code)
            IS DISTINCT FROM ROW(OLD.status, OLD.operation_id, OLD.transaction_id, OLD.completed_at, OLD.failure_code) THEN
            RAISE EXCEPTION 'A completed whitelist submission cannot authorize another attempt';
        END IF;
        IF OLD.status <> NEW.status AND NOT (
            (OLD.status = 'pending' AND NEW.status IN ('executing', 'unchanged'))
            OR (OLD.status = 'executing' AND NEW.status IN ('confirmed', 'failed'))
        ) THEN
            RAISE EXCEPTION 'Invalid whitelist command transition';
        END IF;
    END IF;
    selector := CASE NEW.action WHEN 'add' THEN '0xe43252d7' WHEN 'remove' THEN '0x8ab1d681' END;
    IF jsonb_typeof(NEW.intent) <> 'object'
       OR NEW.intent->'chain_id' IS DISTINCT FROM to_jsonb(NEW.chain_id)
       OR NEW.intent->>'to' IS DISTINCT FROM NEW.registry_address
       OR NEW.intent->>'value' IS DISTINCT FROM '0'
       OR NEW.intent->>'data' IS DISTINCT FROM selector || repeat('0', 24) || substring(NEW.address from 3)
       OR NOT coalesce(NEW.intent->>'sender' ~ '^0x[0-9a-f]{40}$', false) THEN
        RAISE EXCEPTION 'A whitelist command must bind its exact registry call';
    END IF;
    IF (NEW.status IN ('confirmed', 'unchanged', 'failed')) IS DISTINCT FROM (NEW.completed_at IS NOT NULL) THEN
        RAISE EXCEPTION 'Whitelist completion time must agree with its outcome';
    END IF;
    IF NEW.operation_id IS NOT NULL THEN
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
        IF NOT FOUND OR operation.operation_key <> 'whitelist-change:' || NEW.uuid::text
           OR operation.intent IS DISTINCT FROM NEW.intent THEN
            RAISE EXCEPTION 'A whitelist command must reference its original outgoing intent';
        END IF;
        IF NEW.status IN ('pending', 'unchanged') THEN
            RAISE EXCEPTION 'A sending whitelist command cannot discard its outcome';
        END IF;
        IF NEW.status = 'confirmed' AND (operation.status <> 'confirmed' OR NEW.transaction_id IS NULL) THEN
            RAISE EXCEPTION 'Whitelist confirmation requires its confirmed original operation';
        END IF;
        IF NEW.status = 'failed' AND operation.status NOT IN ('failed', 'reverted') THEN
            RAISE EXCEPTION 'An uncertain whitelist command cannot be marked failed';
        END IF;
        IF NEW.transaction_id IS NOT NULL THEN
            SELECT * INTO attempt FROM blockchain_signedattempt WHERE uuid = operation.current_attempt_id;
            SELECT * INTO projected FROM blockchain_blockchaintransaction WHERE uuid = NEW.transaction_id;
            IF projected.tx_hash IS DISTINCT FROM attempt.tx_hash
               OR projected.related_model IS DISTINCT FROM 'whitelist.WhitelistChange'
               OR projected.related_uuid IS DISTINCT FROM NEW.uuid THEN
                RAISE EXCEPTION 'Whitelist projection must name the original signed attempt';
            END IF;
        END IF;
    ELSIF NEW.status IN ('confirmed', 'failed') OR NEW.transaction_id IS NOT NULL THEN
        RAISE EXCEPTION 'A sent whitelist command requires its durable operation';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_whitelist_change
BEFORE INSERT OR UPDATE OR DELETE ON whitelist_whitelistchange
FOR EACH ROW EXECUTE FUNCTION protect_whitelist_change();
"""

REVERSE = """
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM whitelist_whitelistchange) THEN
        RAISE EXCEPTION 'Cannot remove admitted whitelist recovery history';
    END IF;
END $$;
DROP TRIGGER protect_whitelist_change ON whitelist_whitelistchange;
DROP FUNCTION protect_whitelist_change();
"""


def restrict_journal(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_ident(%s), quote_ident(%s)", [settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]]
        )
        app_role, operator_role = cursor.fetchone()
        cursor.execute(f"REVOKE ALL ON whitelist_whitelistchange FROM {app_role}")
        cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON whitelist_whitelistchange TO {operator_role}")


class Migration(migrations.Migration):
    dependencies = [("whitelist", "0005_whitelist_change")]
    operations = [
        migrations.RunSQL(GUARD, REVERSE),
        migrations.RunPython(restrict_journal, migrations.RunPython.noop),
    ]
