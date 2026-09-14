from django.conf import settings
from django.db import migrations

GUARDS = """
CREATE FUNCTION protect_capital_execution() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    request tokens_capitalincreaserequest%ROWTYPE;
    token tokens_sharetoken%ROWTYPE;
    operation blockchain_outgoingoperation%ROWTYPE;
    attempt blockchain_signedattempt%ROWTYPE;
    projected blockchain_blockchaintransaction%ROWTYPE;
    previous blockchain_blockchaintransaction%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Admitted capital execution history cannot be deleted';
    END IF;
    SELECT * INTO request FROM tokens_capitalincreaserequest WHERE uuid = NEW.request_id;
    IF NOT FOUND OR request.dispatch_id IS DISTINCT FROM NEW.uuid
        OR request.token_id IS DISTINCT FROM NEW.token_id OR request.company_id IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION 'Capital execution must retain its original request identity';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF request.status <> 'approved' OR NEW.operation_id IS NOT NULL OR NEW.transaction_id IS NOT NULL
            OR NEW.retry_of IS NOT NULL OR NEW.attribution_evidence IS NOT NULL OR NEW.projected_at IS NOT NULL THEN
            RAISE EXCEPTION 'Capital admission requires an approved request without an execution outcome';
        END IF;
        SELECT * INTO token FROM tokens_sharetoken WHERE uuid = NEW.token_id;
        IF NOT FOUND OR token.company_id IS DISTINCT FROM NEW.company_id
            OR NEW.intent->>'to' IS DISTINCT FROM lower(token.contract_address)
            OR NEW.intent->>'token_chain' IS DISTINCT FROM token.chain
            OR NEW.intent->>'prior_authorized_total' IS DISTINCT FROM token.total_supply::numeric::text THEN
            RAISE EXCEPTION 'Capital admission must capture the current token identity and cap';
        END IF;
    END IF;
    IF jsonb_typeof(NEW.intent) IS DISTINCT FROM 'object'
        OR NOT (NEW.intent ?& ARRAY['chain_id', 'sender', 'to', 'value', 'data', 'token_chain',
                                   'prior_authorized_total', 'new_authorized_total', 'additional_shares'])
        OR NEW.intent->>'value' IS DISTINCT FROM '0'
        OR NEW.intent->>'new_authorized_total' IS DISTINCT FROM request.new_authorized_total::text
        OR NEW.intent->>'additional_shares' IS DISTINCT FROM request.additional_shares::text THEN
        RAISE EXCEPTION 'Capital admission requires immutable approved cap terms';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.uuid, NEW.created_at, NEW.request_id, NEW.token_id, NEW.company_id, NEW.executed_by_id, NEW.intent)
            IS DISTINCT FROM
            ROW(OLD.uuid, OLD.created_at, OLD.request_id, OLD.token_id, OLD.company_id, OLD.executed_by_id, OLD.intent) THEN
            RAISE EXCEPTION 'Capital execution intent and authority are immutable';
        END IF;
        IF OLD.operation_id IS NOT NULL AND NEW.operation_id IS DISTINCT FROM OLD.operation_id THEN
            RAISE EXCEPTION 'Capital execution retains its original outgoing operation';
        END IF;
        IF OLD.attribution_evidence IS NOT NULL
            AND NEW.attribution_evidence IS DISTINCT FROM OLD.attribution_evidence THEN
            RAISE EXCEPTION 'Capital attribution evidence cannot be cleared or replaced';
        END IF;
        IF OLD.transaction_id IS NOT NULL AND NEW.transaction_id IS DISTINCT FROM OLD.transaction_id THEN
            SELECT * INTO previous FROM blockchain_blockchaintransaction WHERE uuid = OLD.transaction_id;
            IF NEW.transaction_id IS NULL OR previous.status IS DISTINCT FROM 'reverted' THEN
                RAISE EXCEPTION 'An unresolved capital transaction cannot be replaced';
            END IF;
        END IF;
    END IF;
    IF NEW.attribution_evidence IS NOT NULL AND (
        jsonb_typeof(NEW.attribution_evidence) IS DISTINCT FROM 'object'
        OR NOT (NEW.attribution_evidence ?& ARRAY['reason', 'source', 'expected', 'observed', 'observed_at'])
        OR NEW.projected_at IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'A capital attribution hold requires retained structured evidence';
    END IF;
    IF NEW.operation_id IS NOT NULL THEN
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
        IF NOT FOUND OR operation.operation_key <> 'capital-increase:' || NEW.request_id::text || ':' || NEW.uuid::text
            OR operation.intent IS DISTINCT FROM jsonb_build_object(
                'chain_id', NEW.intent->'chain_id', 'sender', NEW.intent->'sender', 'to', NEW.intent->'to',
                'value', NEW.intent->'value', 'data', NEW.intent->'data'
            ) THEN
            RAISE EXCEPTION 'Capital execution must reference its own immutable operation';
        END IF;
        IF NEW.transaction_id IS NOT NULL THEN
            SELECT * INTO projected FROM blockchain_blockchaintransaction WHERE uuid = NEW.transaction_id;
            IF NOT FOUND OR projected.related_model IS DISTINCT FROM 'tokens.CapitalIncreaseRequest'
                OR projected.related_uuid IS DISTINCT FROM NEW.request_id
                OR projected.function_name IS DISTINCT FROM 'setAuthorizedShares'
                OR lower(projected.from_address) IS DISTINCT FROM NEW.intent->>'sender'
                OR lower(projected.to_address) IS DISTINCT FROM NEW.intent->>'to'
                OR projected.function_args->>'newAuthorizedShares' IS DISTINCT FROM NEW.intent->>'new_authorized_total'
            THEN
                RAISE EXCEPTION 'Capital projection must identify its original request and approved terms';
            END IF;
            IF operation.current_attempt_id IS NOT NULL THEN
                SELECT * INTO attempt FROM blockchain_signedattempt WHERE uuid = operation.current_attempt_id;
                IF projected.tx_hash IS DISTINCT FROM attempt.tx_hash THEN
                    RAISE EXCEPTION 'Capital projection must identify the original signed attempt';
                END IF;
            ELSIF projected.status IS DISTINCT FROM 'reverted' THEN
                RAISE EXCEPTION 'Only a retained revert can precede an unsigned capital retry';
            END IF;
        END IF;
        IF NEW.projected_at IS NOT NULL AND (
            operation.status NOT IN ('confirmed', 'failed', 'reverted')
            OR NEW.retry_of IS NOT DISTINCT FROM operation.claim_id
            OR (operation.status = 'confirmed' AND projected.status IS DISTINCT FROM 'confirmed')
            OR (operation.status = 'reverted' AND projected.status IS DISTINCT FROM 'reverted')
        ) THEN
            RAISE EXCEPTION 'Capital projection requires an attributable terminal operation without a pending retry';
        END IF;
    ELSIF NEW.transaction_id IS NOT NULL OR NEW.retry_of IS NOT NULL OR (
        NEW.projected_at IS NOT NULL AND (
            (NEW.intent->>'new_authorized_total')::numeric > (NEW.intent->>'prior_authorized_total')::numeric
            OR NEW.attribution_evidence IS NOT NULL
        )
    ) THEN
        RAISE EXCEPTION 'Capital execution outcomes require their original operation';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.retry_of IS DISTINCT FROM OLD.retry_of AND (
            NEW.retry_of IS DISTINCT FROM operation.claim_id OR operation.status NOT IN ('failed', 'reverted')
            OR OLD.projected_at IS NULL OR NEW.projected_at IS NOT NULL OR request.status <> 'failed'
            OR NEW.attribution_evidence IS NOT NULL
        ) THEN
            RAISE EXCEPTION 'A capital retry must authorize the exact projected failed claim';
        END IF;
        IF OLD.projected_at IS NOT NULL AND NEW.projected_at IS DISTINCT FROM OLD.projected_at AND (
            NEW.projected_at IS NOT NULL OR NEW.retry_of IS NOT DISTINCT FROM OLD.retry_of
        ) THEN
            RAISE EXCEPTION 'A capital projection can reopen only with explicit retry admission';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_capital_execution BEFORE INSERT OR UPDATE OR DELETE ON tokens_capitalincreaseexecution
FOR EACH ROW EXECUTE FUNCTION protect_capital_execution();

CREATE FUNCTION protect_capital_request() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    execution tokens_capitalincreaseexecution%ROWTYPE;
    operation blockchain_outgoingoperation%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'Only draft capital requests can be deleted';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.uuid, NEW.created_at, NEW.dispatch_id, NEW.token_id, NEW.company_id)
            IS DISTINCT FROM ROW(OLD.uuid, OLD.created_at, OLD.dispatch_id, OLD.token_id, OLD.company_id) THEN
            RAISE EXCEPTION 'Capital request identity cannot be changed or backfilled';
        END IF;
        IF OLD.status <> 'draft' AND ROW(NEW.additional_shares, NEW.new_authorized_total, NEW.purpose,
            NEW.board_resolution_reference, NEW.shareholder_approval_reference)
            IS DISTINCT FROM ROW(OLD.additional_shares, OLD.new_authorized_total, OLD.purpose,
            OLD.board_resolution_reference, OLD.shareholder_approval_reference) THEN
            RAISE EXCEPTION 'Only draft capital request terms can be edited';
        END IF;
        IF NEW.status = 'draft' AND OLD.status <> 'draft' THEN
            RAISE EXCEPTION 'Submitted capital requests cannot return to draft';
        END IF;
    END IF;
    IF NEW.dispatch_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status NOT IN ('executing', 'executed', 'failed') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status NOT IN ('executing', 'executed', 'failed', 'superseded')
        AND NEW.status NOT IN ('executing', 'executed', 'failed', 'superseded') THEN
        RETURN NEW;
    END IF;
    SELECT * INTO execution FROM tokens_capitalincreaseexecution WHERE request_id = NEW.uuid;
    IF NOT FOUND THEN
        IF NEW.status IN ('executing', 'executed', 'failed') THEN
            RAISE EXCEPTION 'New capital execution requires its admitted private record';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.dispatch_id IS DISTINCT FROM execution.uuid THEN
        RAISE EXCEPTION 'A capital request retains its original execution identity';
    END IF;
    IF execution.projected_at IS NULL THEN
        IF NEW.status <> 'executing' OR NEW.executed_at IS NOT NULL THEN
            RAISE EXCEPTION 'Unresolved capital execution must retain its in-flight slot';
        END IF;
    ELSE
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = execution.operation_id;
        IF execution.operation_id IS NULL THEN
            IF NEW.status <> 'superseded' OR NEW.executed_at IS NOT NULL THEN
                RAISE EXCEPTION 'Unsigned capital retirement must retain its superseded outcome';
            END IF;
        ELSIF operation.status = 'confirmed' THEN
            IF NEW.status <> 'executed' OR NEW.executed_at IS NULL THEN
                RAISE EXCEPTION 'Confirmed capital execution retains its completed outcome';
            END IF;
        ELSIF operation.status IN ('failed', 'reverted') THEN
            IF NEW.status NOT IN ('failed', 'superseded') OR NEW.executed_at IS NOT NULL THEN
                RAISE EXCEPTION 'Failed capital execution requires explicit retry admission';
            END IF;
        ELSE
            RAISE EXCEPTION 'Capital execution cannot release unresolved signed work';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_capital_request BEFORE INSERT OR UPDATE OR DELETE ON tokens_capitalincreaserequest
FOR EACH ROW EXECUTE FUNCTION protect_capital_request();

CREATE FUNCTION protect_capital_token() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.uuid, NEW.company_id, NEW.contract_address, NEW.chain, NEW.total_supply, NEW.decimals)
        IS DISTINCT FROM ROW(OLD.uuid, OLD.company_id, OLD.contract_address, OLD.chain, OLD.total_supply, OLD.decimals)
        AND EXISTS (
            SELECT 1 FROM tokens_capitalincreaserequest
            WHERE token_id = OLD.uuid AND dispatch_id IS NOT NULL AND status = 'executing'
        ) THEN
        RAISE EXCEPTION 'A token retains its identity and cap while capital execution is unresolved';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_capital_token BEFORE UPDATE ON tokens_sharetoken
FOR EACH ROW EXECUTE FUNCTION protect_capital_token();
"""

REVERSE = """
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM tokens_capitalincreaseexecution) THEN
        RAISE EXCEPTION 'Cannot remove admitted capital execution history';
    END IF;
END $$;
DROP TRIGGER protect_capital_token ON tokens_sharetoken;
DROP FUNCTION protect_capital_token();
DROP TRIGGER protect_capital_request ON tokens_capitalincreaserequest;
DROP FUNCTION protect_capital_request();
DROP TRIGGER protect_capital_execution ON tokens_capitalincreaseexecution;
DROP FUNCTION protect_capital_execution();
"""


def restrict_execution(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_ident(%s), quote_ident(%s)", [settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]]
        )
        app_role, operator_role = cursor.fetchone()
        cursor.execute(f"REVOKE ALL ON tokens_capitalincreaseexecution FROM {app_role}")
        cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON tokens_capitalincreaseexecution TO {operator_role}")


class Migration(migrations.Migration):
    dependencies = [("tokens", "0045_capital_increase_execution")]
    operations = [
        migrations.RunSQL(GUARDS, REVERSE),
        migrations.RunPython(restrict_execution, migrations.RunPython.noop),
    ]
