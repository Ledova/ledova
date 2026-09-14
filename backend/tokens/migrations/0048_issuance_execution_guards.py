from django.conf import settings
from django.db import migrations

GUARDS = """
CREATE FUNCTION protect_issuance_execution() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    request tokens_shareissuancerequest%ROWTYPE;
    token tokens_sharetoken%ROWTYPE;
    subscription offerings_subscription%ROWTYPE;
    issuance tokens_shareissuance%ROWTYPE;
    operation blockchain_outgoingoperation%ROWTYPE;
    attempt blockchain_signedattempt%ROWTYPE;
    projected blockchain_blockchaintransaction%ROWTYPE;
    previous blockchain_blockchaintransaction%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Admitted issuance history cannot be deleted';
    END IF;
    SELECT * INTO request FROM tokens_shareissuancerequest WHERE uuid = NEW.request_id;
    IF NOT FOUND OR request.dispatch_id IS DISTINCT FROM NEW.uuid
        OR request.token_id IS DISTINCT FROM NEW.token_id OR request.company_id IS DISTINCT FROM NEW.company_id THEN
        RAISE EXCEPTION 'Issuance execution must retain its original request identity';
    END IF;
    IF jsonb_typeof(NEW.intent) IS DISTINCT FROM 'object'
        OR NOT (NEW.intent ?& ARRAY['chain_id', 'sender', 'to', 'value', 'data', 'token_chain', 'recipient', 'amount'])
        OR NEW.intent->>'value' IS DISTINCT FROM '0'
        OR NEW.intent->>'amount' IS DISTINCT FROM request.amount::text
        OR NEW.intent->>'recipient' IS DISTINCT FROM lower(request.recipient_address)
        OR NEW.status NOT IN ('queued', 'executing', 'executed', 'failed', 'cancelled') THEN
        RAISE EXCEPTION 'Issuance admission requires immutable approved mint terms';
    END IF;
    IF NEW.subscription_id IS NOT NULL THEN
        SELECT * INTO subscription FROM offerings_subscription WHERE uuid = NEW.subscription_id;
        IF NOT FOUND OR subscription.issuance_request_id IS DISTINCT FROM request.uuid
            OR NEW.authority <> 'offerings.change_subscription' THEN
            RAISE EXCEPTION 'Allotment must retain its original subscription and authority';
        END IF;
    ELSIF NEW.authority <> 'tokens.change_shareissuancerequest' THEN
        RAISE EXCEPTION 'Issuance requires its original operator authority';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF request.status <> 'approved' OR NEW.status <> 'queued' OR NEW.issuance_id IS NOT NULL
            OR NEW.operation_id IS NOT NULL OR NEW.transaction_id IS NOT NULL OR NEW.retry_of IS NOT NULL THEN
            RAISE EXCEPTION 'Issuance admission requires an approved request without an execution outcome';
        END IF;
        IF NEW.subscription_id IS NOT NULL AND (
            subscription.status <> 'paid'
            OR COALESCE(subscription.allotted_quantity, subscription.quantity) IS DISTINCT FROM request.amount
            OR subscription.refunded_at IS NOT NULL
            OR subscription.company_id IS DISTINCT FROM NEW.company_id
        ) THEN
            RAISE EXCEPTION 'Allotment admission requires its original paid allocation';
        END IF;
        SELECT * INTO token FROM tokens_sharetoken WHERE uuid = NEW.token_id;
        IF NOT FOUND OR token.company_id IS DISTINCT FROM NEW.company_id
            OR NEW.intent->>'to' IS DISTINCT FROM lower(token.contract_address)
            OR NEW.intent->>'token_chain' IS DISTINCT FROM token.chain OR token.decimals <> 0 THEN
            RAISE EXCEPTION 'Issuance admission must capture the current token identity';
        END IF;
    ELSE
        IF ROW(NEW.uuid, NEW.created_at, NEW.request_id, NEW.token_id, NEW.company_id, NEW.subscription_id,
               NEW.executed_by_id, NEW.authority, NEW.intent)
            IS DISTINCT FROM
            ROW(OLD.uuid, OLD.created_at, OLD.request_id, OLD.token_id, OLD.company_id, OLD.subscription_id,
                OLD.executed_by_id, OLD.authority, OLD.intent) THEN
            RAISE EXCEPTION 'Issuance execution intent and authority are immutable';
        END IF;
        IF (OLD.operation_id IS NOT NULL AND NEW.operation_id IS DISTINCT FROM OLD.operation_id)
            OR (OLD.issuance_id IS NOT NULL AND NEW.issuance_id IS DISTINCT FROM OLD.issuance_id) THEN
            RAISE EXCEPTION 'Issuance execution retains its original operation and public issuance';
        END IF;
        IF OLD.transaction_id IS NOT NULL AND NEW.transaction_id IS DISTINCT FROM OLD.transaction_id THEN
            SELECT * INTO previous FROM blockchain_blockchaintransaction WHERE uuid = OLD.transaction_id;
            IF NEW.transaction_id IS NULL OR previous.status IS DISTINCT FROM 'reverted' THEN
                RAISE EXCEPTION 'An unresolved issuance transaction cannot be replaced';
            END IF;
        END IF;
        IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
            (OLD.status = 'queued' AND NEW.status IN ('executing', 'cancelled'))
            OR (OLD.status = 'executing' AND NEW.status IN ('executed', 'failed'))
            OR (OLD.status = 'failed' AND NEW.status IN ('queued', 'cancelled'))
        ) THEN
            RAISE EXCEPTION 'Issuance execution cannot reopen a cancelled or completed outcome';
        END IF;
    END IF;
    IF NEW.issuance_id IS NOT NULL THEN
        SELECT * INTO issuance FROM tokens_shareissuance WHERE uuid = NEW.issuance_id;
        IF NOT FOUND OR issuance.idempotency_key IS DISTINCT FROM 'issuance-request:' || NEW.request_id::text
            OR issuance.token_id IS DISTINCT FROM NEW.token_id OR issuance.mint_journal IS NOT NULL
            OR lower(issuance.recipient_address) IS DISTINCT FROM NEW.intent->>'recipient'
            OR issuance.amount IS DISTINCT FROM NEW.intent->>'amount' THEN
            RAISE EXCEPTION 'Issuance execution must retain its original public mint identity';
        END IF;
    ELSIF NEW.status IN ('executing', 'executed', 'failed') OR NEW.operation_id IS NOT NULL THEN
        RAISE EXCEPTION 'Claimed issuance must retain its public mint identity';
    END IF;
    IF NEW.operation_id IS NOT NULL THEN
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
        IF NOT FOUND OR operation.operation_key <> 'share-issuance:' || NEW.request_id::text || ':' || NEW.uuid::text
            OR operation.intent IS DISTINCT FROM jsonb_build_object(
                'chain_id', NEW.intent->'chain_id', 'sender', NEW.intent->'sender', 'to', NEW.intent->'to',
                'value', NEW.intent->'value', 'data', NEW.intent->'data'
            ) THEN
            RAISE EXCEPTION 'Issuance execution must reference its own immutable operation';
        END IF;
        IF NEW.transaction_id IS NOT NULL THEN
            SELECT * INTO projected FROM blockchain_blockchaintransaction WHERE uuid = NEW.transaction_id;
            IF NOT FOUND OR projected.related_model IS DISTINCT FROM 'tokens.ShareIssuanceRequest'
                OR projected.related_uuid IS DISTINCT FROM NEW.request_id OR projected.function_name <> 'mint'
                OR lower(projected.from_address) IS DISTINCT FROM NEW.intent->>'sender'
                OR lower(projected.to_address) IS DISTINCT FROM NEW.intent->>'to'
                OR projected.function_args IS DISTINCT FROM jsonb_build_object(
                    'recipient', NEW.intent->'recipient', 'amount', NEW.intent->'amount'
                ) THEN
                RAISE EXCEPTION 'Issuance transaction must identify its original request and approved mint';
            END IF;
            IF operation.current_attempt_id IS NOT NULL THEN
                SELECT * INTO attempt FROM blockchain_signedattempt WHERE uuid = operation.current_attempt_id;
                IF projected.tx_hash IS DISTINCT FROM attempt.tx_hash THEN
                    RAISE EXCEPTION 'Issuance transaction must identify the original signed attempt';
                END IF;
            ELSIF projected.status IS DISTINCT FROM 'reverted' THEN
                RAISE EXCEPTION 'Only a retained revert can precede an unsigned issuance retry';
            END IF;
        END IF;
        IF NEW.status = 'executed' AND (
            operation.status <> 'confirmed' OR projected.status IS DISTINCT FROM 'confirmed'
            OR NEW.retry_of IS NOT DISTINCT FROM operation.claim_id
        ) THEN
            RAISE EXCEPTION 'Completed issuance requires its original confirmed transaction';
        END IF;
        IF NEW.status IN ('failed', 'cancelled', 'queued') AND (
            operation.status NOT IN ('failed', 'reverted')
            OR (operation.status = 'reverted' AND projected.status IS DISTINCT FROM 'reverted')
            OR (NEW.status = 'failed' AND NEW.retry_of IS NOT DISTINCT FROM operation.claim_id)
        ) THEN
            RAISE EXCEPTION 'Unsigned or reverted issuance outcomes must precede release or retry';
        END IF;
    ELSIF NEW.transaction_id IS NOT NULL OR NEW.retry_of IS NOT NULL OR NEW.status IN ('executed', 'failed') THEN
        RAISE EXCEPTION 'Issuance outcomes require their original operation';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF NEW.retry_of IS DISTINCT FROM OLD.retry_of AND (
            NEW.retry_of IS DISTINCT FROM operation.claim_id OR operation.status NOT IN ('failed', 'reverted')
            OR OLD.status <> 'failed' OR NEW.status <> 'queued' OR request.status <> 'failed'
        ) THEN
            RAISE EXCEPTION 'An issuance retry must authorize the exact projected failed claim';
        END IF;
        IF OLD.status = 'failed' AND NEW.status = 'queued' AND NEW.retry_of IS NOT DISTINCT FROM OLD.retry_of THEN
            RAISE EXCEPTION 'A failed issuance requires explicit retry admission';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_issuance_execution BEFORE INSERT OR UPDATE OR DELETE ON tokens_shareissuanceexecution
FOR EACH ROW EXECUTE FUNCTION protect_issuance_execution();

CREATE FUNCTION protect_issuance_request() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    execution tokens_shareissuanceexecution%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.status NOT IN ('draft', 'submitted') THEN
            RAISE EXCEPTION 'Only unreviewed issuance requests can be deleted';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.uuid, NEW.created_at, NEW.dispatch_id, NEW.token_id, NEW.company_id)
            IS DISTINCT FROM ROW(OLD.uuid, OLD.created_at, OLD.dispatch_id, OLD.token_id, OLD.company_id) THEN
            RAISE EXCEPTION 'Issuance request identity cannot be changed or backfilled';
        END IF;
        IF OLD.status NOT IN ('draft', 'submitted') AND ROW(NEW.amount, NEW.recipient_address,
            NEW.recipient_name, NEW.issuance_type, NEW.reason)
            IS DISTINCT FROM ROW(OLD.amount, OLD.recipient_address, OLD.recipient_name, OLD.issuance_type, OLD.reason) THEN
            RAISE EXCEPTION 'Reviewed issuance terms cannot be edited';
        END IF;
        IF OLD.status NOT IN ('draft', 'submitted') AND NEW.status IN ('draft', 'submitted', 'under_review')
            AND NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'Reviewed issuance requests cannot return to review';
        END IF;
        IF OLD.status = 'rejected' AND NEW.status <> 'rejected' THEN
            RAISE EXCEPTION 'Rejected issuance requests cannot be reopened';
        END IF;
    END IF;
    IF NEW.dispatch_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF NEW.status <> 'executed' AND (NEW.executed_at IS NOT NULL OR NEW.executed_issuance_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Unexecuted issuance cannot claim a completed projection';
    END IF;
    IF TG_OP = 'INSERT' AND NEW.status NOT IN ('executing', 'executed', 'failed') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.status = OLD.status
        AND NEW.status NOT IN ('executing', 'executed', 'failed') THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status IN ('draft', 'submitted', 'under_review')
        AND NEW.status IN ('submitted', 'under_review', 'approved', 'rejected') THEN
        RETURN NEW;
    END IF;
    SELECT * INTO execution FROM tokens_shareissuanceexecution WHERE request_id = NEW.uuid;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'New issuance execution requires its admitted private record';
    END IF;
    IF NEW.status IS DISTINCT FROM (CASE execution.status
        WHEN 'queued' THEN 'approved' WHEN 'executing' THEN 'executing' WHEN 'executed' THEN 'executed'
        WHEN 'failed' THEN 'failed' WHEN 'cancelled' THEN 'rejected' END) THEN
        RAISE EXCEPTION 'Issuance request state must follow its original admitted execution';
    END IF;
    IF execution.status = 'executed' THEN
        IF NEW.executed_at IS NULL OR NEW.executed_issuance_id IS DISTINCT FROM execution.issuance_id THEN
            RAISE EXCEPTION 'Executed issuance retains its original public projection';
        END IF;
    ELSIF NEW.executed_at IS NOT NULL OR NEW.executed_issuance_id IS NOT NULL THEN
        RAISE EXCEPTION 'Unexecuted issuance cannot claim a completed projection';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_issuance_request BEFORE INSERT OR UPDATE OR DELETE ON tokens_shareissuancerequest
FOR EACH ROW EXECUTE FUNCTION protect_issuance_request();

CREATE FUNCTION protect_issuance_projection() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    request tokens_shareissuancerequest%ROWTYPE;
    execution tokens_shareissuanceexecution%ROWTYPE;
    projected blockchain_blockchaintransaction%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' AND to_jsonb(NEW) - 'initiated_by_id' - 'updated_at'
        IS NOT DISTINCT FROM to_jsonb(OLD) - 'initiated_by_id' - 'updated_at' THEN
        RETURN NEW;
    END IF;
    SELECT * INTO request FROM tokens_shareissuancerequest
        WHERE 'issuance-request:' || uuid::text = CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.idempotency_key
            ELSE NEW.idempotency_key END;
    IF NOT FOUND OR request.dispatch_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO execution FROM tokens_shareissuanceexecution WHERE request_id = request.uuid;
    IF NOT FOUND OR TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'New issuance must retain its admitted execution and public record';
    END IF;
    IF TG_OP = 'UPDATE' AND ROW(NEW.uuid, NEW.created_at, NEW.token_id, NEW.recipient_address,
        NEW.recipient_name, NEW.recipient_residential_address, NEW.identity_stamped_at,
        NEW.amount, NEW.issuance_type, NEW.reason, NEW.idempotency_key, NEW.mint_journal)
        IS DISTINCT FROM ROW(OLD.uuid, OLD.created_at, OLD.token_id, OLD.recipient_address,
        OLD.recipient_name, OLD.recipient_residential_address, OLD.identity_stamped_at,
        OLD.amount, OLD.issuance_type, OLD.reason, OLD.idempotency_key, OLD.mint_journal) THEN
        RAISE EXCEPTION 'Admitted issuance terms and stamped holder identity are immutable';
    END IF;
    IF NEW.token_id IS DISTINCT FROM execution.token_id OR NEW.amount IS DISTINCT FROM execution.intent->>'amount'
        OR lower(NEW.recipient_address) IS DISTINCT FROM execution.intent->>'recipient'
        OR NEW.mint_journal IS NOT NULL OR NEW.transaction_id IS DISTINCT FROM execution.transaction_id THEN
        RAISE EXCEPTION 'Issuance projection must identify its original admitted mint';
    END IF;
    IF NEW.transaction_id IS NOT NULL THEN
        SELECT * INTO projected FROM blockchain_blockchaintransaction WHERE uuid = NEW.transaction_id;
        IF NEW.tx_hash IS DISTINCT FROM projected.tx_hash THEN
            RAISE EXCEPTION 'Issuance retains its original transaction hash';
        END IF;
    ELSIF NEW.tx_hash IS NOT NULL THEN
        RAISE EXCEPTION 'A new issuance hash requires its original transaction association';
    END IF;
    IF NEW.status = 'completed' AND execution.status <> 'executed' THEN
        RAISE EXCEPTION 'Issuance completion requires its confirmed execution';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'completed' AND (
        NEW.status <> 'completed' OR ROW(NEW.completed_at, NEW.block_number, NEW.gas_used)
        IS DISTINCT FROM ROW(OLD.completed_at, OLD.block_number, OLD.gas_used)
    ) THEN
        RAISE EXCEPTION 'Completed issuance retains its original outcome';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_issuance_projection BEFORE INSERT OR UPDATE OR DELETE ON tokens_shareissuance
FOR EACH ROW EXECUTE FUNCTION protect_issuance_projection();

CREATE FUNCTION protect_issuance_subscription() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    request tokens_shareissuancerequest%ROWTYPE;
    execution tokens_shareissuanceexecution%ROWTYPE;
BEGIN
    IF TG_OP = 'INSERT' AND NEW.issuance_request_id IS NULL THEN
        RETURN NEW;
    END IF;
    IF (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.issuance_request_id IS NULL))
        AND NEW.issuance_request_id IS NOT NULL THEN
        SELECT * INTO request FROM tokens_shareissuancerequest WHERE uuid = NEW.issuance_request_id FOR UPDATE;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Allotment requires its original accessible request';
        END IF;
        IF request.dispatch_id IS NOT NULL THEN
            SELECT * INTO execution FROM tokens_shareissuanceexecution WHERE request_id = request.uuid;
            IF FOUND AND execution.subscription_id IS DISTINCT FROM NEW.uuid THEN
                RAISE EXCEPTION 'An admitted mint cannot acquire a different subscription';
            END IF;
            IF request.status <> 'approved' OR NEW.status <> 'paid'
                OR request.amount IS DISTINCT FROM COALESCE(NEW.allotted_quantity, NEW.quantity)
                OR request.token_id IS DISTINCT FROM (SELECT token_id FROM offerings_offering WHERE uuid = NEW.offering_id)
                OR lower(request.recipient_address) IS DISTINCT FROM (SELECT lower(address) FROM wallets WHERE uuid = NEW.wallet_id)
            THEN
                RAISE EXCEPTION 'Allotment requires the original paid subscription terms';
            END IF;
        END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO request FROM tokens_shareissuancerequest WHERE uuid = OLD.issuance_request_id;
    IF NOT FOUND OR request.dispatch_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Admitted allotment history cannot be deleted';
    END IF;
    IF ROW(NEW.uuid, NEW.created_at, NEW.offering_id, NEW.company_id, NEW.user_account_id, NEW.wallet_id,
        NEW.quantity, NEW.allotted_quantity, NEW.price_per_share, NEW.amount_due, NEW.amount_received,
        NEW.payment_received_on, NEW.payment_reference_seen, NEW.payment_tx_hash, NEW.issuance_request_id,
        NEW.settlement_rail, NEW.settlement_asset_id, NEW.settlement_amount, NEW.reference)
        IS DISTINCT FROM ROW(OLD.uuid, OLD.created_at, OLD.offering_id, OLD.company_id, OLD.user_account_id,
        OLD.wallet_id, OLD.quantity, OLD.allotted_quantity, OLD.price_per_share, OLD.amount_due, OLD.amount_received,
        OLD.payment_received_on, OLD.payment_reference_seen, OLD.payment_tx_hash, OLD.issuance_request_id,
        OLD.settlement_rail, OLD.settlement_asset_id, OLD.settlement_amount, OLD.reference) THEN
        RAISE EXCEPTION 'Admitted allotment retains its original subscription, payment and allocation';
    END IF;
    IF request.status IN ('approved', 'executing', 'failed') AND (NEW.status <> 'paid'
        OR ROW(NEW.refund_amount, NEW.refunded_at) IS DISTINCT FROM ROW(OLD.refund_amount, OLD.refunded_at)) THEN
        RAISE EXCEPTION 'An executing allotment must resolve before refund';
    END IF;
    IF request.status = 'rejected' AND NEW.status NOT IN ('refunded', 'rejected', 'withdrawn') THEN
        RAISE EXCEPTION 'Cancelled allotment cannot restore an allocation';
    END IF;
    IF OLD.refunded_at IS NOT NULL AND (
        NEW.refunded_at IS NULL OR NEW.refund_amount IS NULL OR NEW.refund_amount < OLD.refund_amount
    ) THEN
        RAISE EXCEPTION 'Recorded allotment refunds cannot be cleared or reduced';
    END IF;
    IF request.status <> 'executed' AND (
        NEW.status = 'allotted' OR (NEW.refunded_at IS DISTINCT FROM OLD.refunded_at AND request.status <> 'rejected')
    ) THEN
        RAISE EXCEPTION 'Allotment and refund must follow the original issuance outcome';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_issuance_subscription BEFORE INSERT OR UPDATE OR DELETE ON offerings_subscription
FOR EACH ROW EXECUTE FUNCTION protect_issuance_subscription();

CREATE FUNCTION protect_issuance_token() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF ROW(NEW.uuid, NEW.company_id, NEW.contract_address, NEW.chain, NEW.decimals)
        IS DISTINCT FROM ROW(OLD.uuid, OLD.company_id, OLD.contract_address, OLD.chain, OLD.decimals)
        AND EXISTS (SELECT 1 FROM tokens_shareissuancerequest
            WHERE token_id = OLD.uuid AND dispatch_id IS NOT NULL AND status IN ('approved', 'executing', 'failed')) THEN
        RAISE EXCEPTION 'A token retains its identity while admitted issuance can execute';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_issuance_token BEFORE UPDATE ON tokens_sharetoken
FOR EACH ROW EXECUTE FUNCTION protect_issuance_token();
"""

REVERSE = """
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM tokens_shareissuanceexecution) THEN
        RAISE EXCEPTION 'Cannot remove admitted issuance execution history';
    END IF;
END $$;
DROP TRIGGER protect_issuance_token ON tokens_sharetoken;
DROP FUNCTION protect_issuance_token();
DROP TRIGGER protect_issuance_subscription ON offerings_subscription;
DROP FUNCTION protect_issuance_subscription();
DROP TRIGGER protect_issuance_projection ON tokens_shareissuance;
DROP FUNCTION protect_issuance_projection();
DROP TRIGGER protect_issuance_request ON tokens_shareissuancerequest;
DROP FUNCTION protect_issuance_request();
DROP TRIGGER protect_issuance_execution ON tokens_shareissuanceexecution;
DROP FUNCTION protect_issuance_execution();
"""


def restrict_execution(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_ident(%s), quote_ident(%s)", [settings.RLS_ROLES["app"], settings.RLS_ROLES["operator"]]
        )
        app_role, operator_role = cursor.fetchone()
        cursor.execute(f"REVOKE ALL ON tokens_shareissuanceexecution FROM {app_role}")
        cursor.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON tokens_shareissuanceexecution TO {operator_role}")


class Migration(migrations.Migration):
    dependencies = [("tokens", "0047_issuance_execution"), ("offerings", "0006_trigger_follows_and_refuses")]
    operations = [
        migrations.RunSQL(GUARDS, REVERSE),
        migrations.RunPython(restrict_execution, migrations.RunPython.noop),
    ]
