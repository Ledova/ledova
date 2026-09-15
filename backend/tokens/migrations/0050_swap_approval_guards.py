from django.db import migrations

GUARDS = """
CREATE FUNCTION protect_swap_approval() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    operation blockchain_outgoingoperation%ROWTYPE;
    attempt blockchain_signedattempt%ROWTYPE;
    projected blockchain_blockchaintransaction%ROWTYPE;
    previous blockchain_blockchaintransaction%ROWTYPE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.approval_outcome <> '' OR NEW.approval_intent IS NOT NULL
            OR NEW.approval_operation_id IS NOT NULL OR NEW.approval_transaction_id IS NOT NULL
            OR NEW.approval_retry_of IS NOT NULL OR NEW.approval_observation IS NOT NULL THEN
            RAISE EXCEPTION 'Swap approval can only be admitted with deployment projection';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.approval_outcome = '' AND NEW.approval_outcome <> '' THEN
        IF OLD.projected_at IS NOT NULL OR NEW.projected_at IS NULL
            OR NEW.approval_outcome NOT IN ('pending', 'not_configured') THEN
            RAISE EXCEPTION 'Historical deployments cannot acquire approval authority';
        END IF;
    ELSIF ROW(NEW.approval_intent, NEW.approval_observation)
        IS DISTINCT FROM ROW(OLD.approval_intent, OLD.approval_observation)
        AND NOT (OLD.approval_outcome = 'pending' AND NEW.approval_outcome = 'observed_approved'
            AND NEW.approval_intent IS NOT DISTINCT FROM OLD.approval_intent) THEN
        RAISE EXCEPTION 'Admitted approval intent and observation are immutable';
    END IF;
    IF OLD.projected_at IS NULL AND NEW.projected_at IS NOT NULL AND NEW.approval_outcome = '' THEN
        RAISE EXCEPTION 'Deployment completion must retain its approval disposition';
    END IF;
    IF NEW.approval_outcome = '' OR NEW.approval_outcome = 'not_configured' THEN
        IF NEW.approval_intent IS NOT NULL OR NEW.approval_operation_id IS NOT NULL
            OR NEW.approval_transaction_id IS NOT NULL OR NEW.approval_retry_of IS NOT NULL
            OR NEW.approval_observation IS NOT NULL THEN
            RAISE EXCEPTION 'Unadmitted approval cannot retain execution authority';
        END IF;
    ELSE
        IF NEW.projected_at IS NULL OR NEW.attribution_required
            OR jsonb_typeof(NEW.approval_intent) IS DISTINCT FROM 'object'
            OR NOT (NEW.approval_intent ?& ARRAY['chain_id', 'sender', 'to', 'value', 'data', 'token'])
            OR NEW.approval_intent->'chain_id' IS DISTINCT FROM NEW.intent->'chain_id'
            OR NEW.approval_intent->'sender' IS DISTINCT FROM NEW.intent->'sender'
            OR NEW.approval_intent->>'value' IS DISTINCT FROM '0'
            OR NEW.approval_intent->>'token' IS DISTINCT FROM lower(NEW.contract_address)
            OR jsonb_typeof(NEW.approval_intent->'to') IS DISTINCT FROM 'string'
            OR NEW.approval_intent->>'to' !~ '^0x[0-9a-f]{40}$'
            OR NEW.approval_intent->>'to' = '0x0000000000000000000000000000000000000000'
            OR NEW.approval_intent->>'data' IS DISTINCT FROM '0xebbb1961' || repeat('0', 24)
                || substring(lower(NEW.contract_address) from 3) || repeat('0', 63) || '1' THEN
            RAISE EXCEPTION 'Swap approval requires the original deployed token and immutable call';
        END IF;
    END IF;
    IF NEW.approval_outcome IS DISTINCT FROM OLD.approval_outcome AND NOT (
        (OLD.approval_outcome = '' AND NEW.approval_outcome IN ('pending', 'not_configured'))
        OR (OLD.approval_outcome = 'pending' AND NEW.approval_outcome IN ('executing', 'observed_approved'))
        OR (OLD.approval_outcome = 'executing' AND NEW.approval_outcome IN ('confirmed', 'failed'))
        OR (OLD.approval_outcome = 'failed' AND NEW.approval_outcome = 'executing')
    ) THEN
        RAISE EXCEPTION 'Approval cannot replace a completed disposition';
    END IF;
    IF OLD.approval_operation_id IS NOT NULL
        AND NEW.approval_operation_id IS DISTINCT FROM OLD.approval_operation_id THEN
        RAISE EXCEPTION 'Approval retains its original outgoing operation';
    END IF;
    IF OLD.approval_transaction_id IS NOT NULL
        AND NEW.approval_transaction_id IS DISTINCT FROM OLD.approval_transaction_id THEN
        SELECT * INTO previous FROM blockchain_blockchaintransaction WHERE uuid = OLD.approval_transaction_id;
        IF NEW.approval_transaction_id IS NULL OR previous.status IS DISTINCT FROM 'reverted'
            OR previous.block_number IS NULL OR previous.block_hash = '' OR previous.gas_used IS NULL THEN
            RAISE EXCEPTION 'Approval must retain the previous reverted receipt before replacement';
        END IF;
    END IF;
    IF NEW.approval_outcome = 'observed_approved' THEN
        IF NEW.approval_operation_id IS NOT NULL OR NEW.approval_transaction_id IS NOT NULL
            OR NEW.approval_retry_of IS NOT NULL
            OR EXISTS (SELECT 1 FROM blockchain_outgoingoperation WHERE operation_key = 'swap-approval:' || NEW.uuid::text)
            OR jsonb_typeof(NEW.approval_observation) IS DISTINCT FROM 'object'
            OR NOT (NEW.approval_observation ?& ARRAY['block_number', 'block_hash', 'observed_at'])
            OR jsonb_typeof(NEW.approval_observation->'block_number') IS DISTINCT FROM 'number'
            OR NEW.approval_observation->>'block_number' !~ '^(0|[1-9][0-9]*)$'
            OR jsonb_typeof(NEW.approval_observation->'block_hash') IS DISTINCT FROM 'string'
            OR NEW.approval_observation->>'block_hash' !~ '^0x[0-9a-f]{64}$'
            OR jsonb_typeof(NEW.approval_observation->'observed_at') IS DISTINCT FROM 'string' THEN
            RAISE EXCEPTION 'Observed approval requires its evidence and no outgoing operation';
        END IF;
    ELSIF NEW.approval_observation IS NOT NULL THEN
        RAISE EXCEPTION 'A transaction outcome cannot be replaced by an observation';
    END IF;
    IF NEW.approval_operation_id IS NOT NULL THEN
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.approval_operation_id;
        IF NOT FOUND OR operation.operation_key <> 'swap-approval:' || NEW.uuid::text
            OR NEW.approval_outcome NOT IN ('executing', 'confirmed', 'failed')
            OR operation.intent IS DISTINCT FROM NEW.approval_intent - 'token' THEN
            RAISE EXCEPTION 'Approval must reference its own original operation';
        END IF;
        IF NEW.approval_transaction_id IS NOT NULL THEN
            SELECT * INTO projected FROM blockchain_blockchaintransaction WHERE uuid = NEW.approval_transaction_id;
            IF NOT FOUND OR projected.related_model IS DISTINCT FROM 'tokens.TokenDeployment'
                OR projected.related_uuid IS DISTINCT FROM NEW.uuid
                OR projected.function_name IS DISTINCT FROM 'setShareTokenApproval'
                OR lower(projected.from_address) IS DISTINCT FROM NEW.approval_intent->>'sender'
                OR lower(projected.to_address) IS DISTINCT FROM NEW.approval_intent->>'to'
                OR projected.function_args IS DISTINCT FROM jsonb_build_object(
                    'token', NEW.approval_intent->'token', 'approved', true
                ) THEN
                RAISE EXCEPTION 'Approval transaction must identify the original approval call';
            END IF;
            IF operation.current_attempt_id IS NOT NULL THEN
                SELECT * INTO attempt FROM blockchain_signedattempt WHERE uuid = operation.current_attempt_id;
                IF projected.tx_hash IS DISTINCT FROM attempt.tx_hash THEN
                    RAISE EXCEPTION 'Approval transaction must identify its current signed attempt';
                END IF;
            ELSIF projected.status IS DISTINCT FROM 'reverted' THEN
                RAISE EXCEPTION 'Only a retained reverted approval can precede an unsigned retry';
            END IF;
        ELSIF operation.current_attempt_id IS NOT NULL THEN
            RAISE EXCEPTION 'A signed approval requires its transaction association';
        END IF;
        IF NEW.approval_outcome = 'confirmed' AND (
            operation.status <> 'confirmed' OR projected.status IS DISTINCT FROM 'confirmed'
            OR NEW.approval_retry_of IS NOT DISTINCT FROM operation.claim_id
        ) THEN
            RAISE EXCEPTION 'Approval completion requires its original confirmed transaction';
        END IF;
        IF NEW.approval_outcome = 'failed' AND (
            operation.status NOT IN ('failed', 'reverted')
            OR (operation.status = 'reverted' AND (projected.status IS DISTINCT FROM 'reverted'
                OR projected.block_hash IS DISTINCT FROM operation.block_hash
                OR projected.block_number IS DISTINCT FROM operation.block_number
                OR projected.gas_used IS DISTINCT FROM operation.gas_used))
            OR NEW.approval_retry_of IS NOT DISTINCT FROM operation.claim_id
        ) THEN
            RAISE EXCEPTION 'Approval failure requires its retained terminal outcome';
        END IF;
    ELSIF NEW.approval_transaction_id IS NOT NULL OR NEW.approval_retry_of IS NOT NULL
        OR NEW.approval_outcome IN ('confirmed', 'failed') THEN
        RAISE EXCEPTION 'Approval outcomes require their original operation';
    END IF;
    IF NEW.approval_retry_of IS DISTINCT FROM OLD.approval_retry_of AND (
        OLD.approval_outcome <> 'failed' OR NEW.approval_outcome <> 'executing'
        OR NEW.approval_retry_of IS DISTINCT FROM operation.claim_id OR operation.status NOT IN ('failed', 'reverted')
    ) THEN
        RAISE EXCEPTION 'Approval retry must authorize the exact completed failed claim';
    END IF;
    IF OLD.approval_outcome = 'failed' AND NEW.approval_outcome = 'executing'
        AND NEW.approval_retry_of IS NOT DISTINCT FROM OLD.approval_retry_of THEN
        RAISE EXCEPTION 'Failed approval requires explicit retry admission';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_swap_approval BEFORE INSERT OR UPDATE ON tokens_tokendeployment
FOR EACH ROW EXECUTE FUNCTION protect_swap_approval();
"""

REVERSE = """
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM tokens_tokendeployment WHERE approval_outcome <> '') THEN
        RAISE EXCEPTION 'Cannot remove admitted swap approval history';
    END IF;
END $$;
DROP TRIGGER protect_swap_approval ON tokens_tokendeployment;
DROP FUNCTION protect_swap_approval();
"""


class Migration(migrations.Migration):
    dependencies = [("tokens", "0049_swap_approval_phase")]
    operations = [migrations.RunSQL(GUARDS, REVERSE)]
