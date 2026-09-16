from django.db import migrations

GUARDS = """
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM blockchain_outgoingoperation WHERE operation_key LIKE 'swap-execution:%')
        OR EXISTS (SELECT 1 FROM blockchain_blockchaintransaction WHERE outgoing_operation_id IS NOT NULL
            OR ((tx_type = 'atomic_swap' OR related_model = 'tokens.SwapOrder')
                AND function_args ? 'admission')) THEN
        RAISE EXCEPTION 'Existing swap execution admission cannot be adopted by migration';
    END IF;
END $$;

CREATE FUNCTION tokens_swap_execution_intent(candidate blockchain_blockchaintransaction)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
    arguments jsonb := candidate.function_args;
    calldata text := '0xe420d7b5';
    field text;
    value text;
BEGIN
    FOREACH field IN ARRAY ARRAY['seller', 'buyer', 'shareToken', 'paymentToken'] LOOP
        value := arguments->>field;
        IF coalesce(value, '') !~ '^0x[0-9A-Fa-f]{40}$' THEN
            RAISE EXCEPTION 'Swap execution requires an exact address';
        END IF;
        calldata := calldata || lpad(lower(substr(value, 3)), 64, '0');
    END LOOP;
    FOREACH field IN ARRAY ARRAY['shareAmount', 'paymentAmount', 'nonce', 'deadline'] LOOP
        value := arguments->>field;
        IF coalesce(value, '') !~ '^(0|[1-9][0-9]*)$' OR length(value) > 19 THEN
            RAISE EXCEPTION 'Swap execution requires a supported exact integer';
        END IF;
        calldata := calldata || lpad(to_hex(value::bigint), 64, '0');
    END LOOP;
    calldata := calldata || lpad('140', 64, '0') || lpad('1c0', 64, '0');
    FOREACH field IN ARRAY ARRAY['sellerSignature', 'buyerSignature'] LOOP
        value := arguments->>field;
        IF coalesce(value, '') !~ '^(0x)?[0-9A-Fa-f]{130}$' THEN
            RAISE EXCEPTION 'Swap execution requires both original 65-byte signatures';
        END IF;
        calldata := calldata || lpad('41', 64, '0') || rpad(lower(regexp_replace(value, '^0x', '')), 192, '0');
    END LOOP;
    value := arguments->'settlement'->'domain'->>'chainId';
    IF coalesce(value, '') !~ '^[1-9][0-9]*$' OR length(value) > 19 THEN
        RAISE EXCEPTION 'Swap execution requires a supported exact chain';
    END IF;
    RETURN jsonb_build_object('chain_id', value::bigint, 'sender', lower(candidate.from_address),
        'to', lower(candidate.to_address), 'value', '0', 'data', calldata);
END;
$$;

CREATE FUNCTION protect_swap_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    selected boolean;
    admitted boolean;
    swap tokens_swaporder%ROWTYPE;
    operation blockchain_outgoingoperation%ROWTYPE;
    attempt blockchain_signedattempt%ROWTYPE;
    expected jsonb;
    admission jsonb;
    party jsonb;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.tx_type = 'atomic_swap' OR OLD.related_model = 'tokens.SwapOrder'
            OR OLD.outgoing_operation_id IS NOT NULL THEN
            RAISE EXCEPTION 'Swap transaction history cannot be deleted';
        END IF;
        RETURN OLD;
    END IF;
    selected := NEW.tx_type = 'atomic_swap' OR coalesce(NEW.related_model = 'tokens.SwapOrder', false)
        OR NEW.outgoing_operation_id IS NOT NULL;
    IF TG_OP = 'UPDATE' THEN
        selected := selected OR OLD.tx_type = 'atomic_swap' OR coalesce(OLD.related_model = 'tokens.SwapOrder', false)
            OR OLD.outgoing_operation_id IS NOT NULL;
    END IF;
    IF NOT selected THEN
        RETURN NEW;
    END IF;
    admitted := coalesce(NEW.function_args ? 'admission', false);
    IF TG_OP = 'UPDATE' THEN
        IF ROW(NEW.uuid, NEW.created_at, NEW.tx_type, NEW.from_address, NEW.to_address, NEW.value,
            NEW.function_name, NEW.function_args, NEW.related_model, NEW.related_uuid, NEW.gas_limit, NEW.gas_price)
            IS DISTINCT FROM ROW(OLD.uuid, OLD.created_at, OLD.tx_type, OLD.from_address, OLD.to_address, OLD.value,
            OLD.function_name, OLD.function_args, OLD.related_model, OLD.related_uuid, OLD.gas_limit, OLD.gas_price) THEN
            RAISE EXCEPTION 'Swap transaction identity, admission and arguments are immutable';
        END IF;
        IF OLD.outgoing_operation_id IS NOT NULL
            AND NEW.outgoing_operation_id IS DISTINCT FROM OLD.outgoing_operation_id THEN
            RAISE EXCEPTION 'Swap transactions retain their original outgoing operation';
        END IF;
        IF OLD.tx_hash IS NOT NULL AND NEW.tx_hash IS DISTINCT FROM OLD.tx_hash THEN
            RAISE EXCEPTION 'Swap transactions retain their original hash';
        END IF;
        IF OLD.status IN ('confirmed', 'reverted', 'failed') AND NEW.status IS DISTINCT FROM OLD.status THEN
            RAISE EXCEPTION 'Swap transaction outcomes cannot restart';
        END IF;
        IF (OLD.status IN ('confirmed', 'reverted') OR OLD.block_number IS NOT NULL
            OR OLD.block_hash IS NOT NULL OR OLD.gas_used IS NOT NULL OR OLD.confirmed_at IS NOT NULL)
            AND ROW(NEW.block_number, NEW.block_hash, NEW.gas_used, NEW.confirmed_at)
            IS DISTINCT FROM ROW(OLD.block_number, OLD.block_hash, OLD.gas_used, OLD.confirmed_at) THEN
            RAISE EXCEPTION 'Swap transactions retain their first receipt summary';
        END IF;
        IF OLD.submitted_at IS NOT NULL AND NEW.submitted_at IS DISTINCT FROM OLD.submitted_at THEN
            RAISE EXCEPTION 'Swap transactions retain their first submission time';
        END IF;
        IF OLD.nonce IS NOT NULL AND NEW.nonce IS DISTINCT FROM OLD.nonce THEN
            RAISE EXCEPTION 'Swap transactions retain their original nonce';
        END IF;
        IF NOT admitted THEN
            IF NEW.outgoing_operation_id IS NOT NULL OR NEW.tx_hash IS DISTINCT FROM OLD.tx_hash
                OR (NEW.status IS DISTINCT FROM OLD.status AND NOT (
                    OLD.status IN ('pending', 'submitted') AND OLD.tx_hash IS NOT NULL
                    AND NEW.status IN ('confirmed', 'reverted'))) THEN
                RAISE EXCEPTION 'Historical swap transactions have no new signing authority';
            END IF;
            RETURN NEW;
        END IF;
        IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
            (OLD.status = 'pending' AND NEW.status IN ('submitted', 'failed'))
            OR (OLD.status = 'submitted' AND NEW.status IN ('confirmed', 'reverted'))
        ) THEN
            RAISE EXCEPTION 'Swap transaction projections cannot skip or reverse signing';
        END IF;
    END IF;
    IF NOT admitted OR NEW.tx_type <> 'atomic_swap' OR NEW.function_name IS DISTINCT FROM 'executeSwap'
        OR NEW.related_model IS DISTINCT FROM 'tokens.SwapOrder' OR NEW.related_uuid IS NULL
        OR NEW.value <> 0 OR NEW.retry_count <> 0
        OR coalesce(NEW.from_address, '') !~ '^0x[0-9A-Fa-f]{40}$'
        OR coalesce(NEW.to_address, '') !~ '^0x[0-9A-Fa-f]{40}$' THEN
        RAISE EXCEPTION 'Fresh swap transactions require exact execution admission';
    END IF;
    admission := NEW.function_args->'admission';
    IF jsonb_typeof(admission) IS DISTINCT FROM 'object'
        OR admission IS DISTINCT FROM jsonb_build_object('version', 1, 'actor_id', admission->'actor_id',
            'participant', admission->'participant')
        OR jsonb_typeof(admission->'actor_id') IS DISTINCT FROM 'string'
        OR coalesce(admission->>'actor_id', '') !~ '^[1-9][0-9]{0,18}$'
        OR (admission->>'actor_id')::numeric > 9223372036854775807
        OR coalesce(admission->>'participant', '') NOT IN ('seller', 'buyer') THEN
        RAISE EXCEPTION 'Swap admission requires its original actor and participant';
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT * INTO swap FROM tokens_swaporder WHERE uuid = NEW.related_uuid FOR UPDATE;
    ELSE
        SELECT * INTO swap FROM tokens_swaporder WHERE uuid = NEW.related_uuid;
    END IF;
    IF NOT FOUND OR swap.settlement_protocol_version <> 1 THEN
        RAISE EXCEPTION 'Swap execution requires its original V1 order';
    END IF;
    expected := swap.settlement_context->'typed_data'->'message' || jsonb_build_object(
        'sellerSignature', swap.seller_signature, 'buyerSignature', swap.buyer_signature,
        'settlement', jsonb_build_object('protocol_version', 1, 'swap_uuid', swap.uuid::text,
            'digest', swap.settlement_digest, 'domain', swap.settlement_context->'typed_data'->'domain'),
        'admission', admission);
    IF NEW.function_args IS DISTINCT FROM expected
        OR lower(NEW.to_address) IS DISTINCT FROM lower(swap.settlement_context->'typed_data'->'domain'->>'verifyingContract')
        OR coalesce(swap.seller_signature, '') !~ '^(0x)?[0-9A-Fa-f]{130}$'
        OR coalesce(swap.buyer_signature, '') !~ '^(0x)?[0-9A-Fa-f]{130}$' THEN
        RAISE EXCEPTION 'Swap execution arguments must equal the original settlement and signatures';
    END IF;
    PERFORM tokens_swap_execution_intent(NEW);
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'pending' OR NEW.tx_hash IS NOT NULL OR NEW.outgoing_operation_id IS NOT NULL
            OR NEW.nonce IS NOT NULL OR NEW.block_number IS NOT NULL OR NEW.block_hash IS NOT NULL
            OR NEW.gas_used IS NOT NULL OR NEW.gas_limit IS NOT NULL OR NEW.gas_price IS NOT NULL
            OR NEW.submitted_at IS NOT NULL OR NEW.confirmed_at IS NOT NULL
            OR swap.status <> 'ready' OR swap.transaction_id IS NOT NULL OR swap.tx_hash <> ''
            OR swap.completed_at IS NOT NULL OR swap.expiry_release_eligible
            OR EXISTS (SELECT 1 FROM blockchain_blockchaintransaction
                WHERE (related_model = 'tokens.SwapOrder' OR tx_type = 'atomic_swap') AND related_uuid = swap.uuid)
            OR EXISTS (SELECT 1 FROM blockchain_outgoingoperation
                WHERE operation_key = 'swap-execution:' || NEW.uuid::text) THEN
            RAISE EXCEPTION 'Swap admission requires an unclaimed ready order and an empty journal';
        END IF;
        party := swap.settlement_context->(admission->>'participant');
        IF NOT EXISTS (
            SELECT 1 FROM customer_accounts_account account
            JOIN users_userprofile profile ON profile.uuid = account.user_profile_id
            JOIN wallets held ON held.user_account_id = account.uuid
            WHERE account.uuid::text = party->>'owner_account_uuid'
                AND held.uuid::text = party->>'wallet_uuid'
                AND profile.user_id::text = admission->>'actor_id'
                AND lower(held.address) = lower(party->>'address')
                AND held.verification_status = 'VERIFIED' AND held.chain IN ('ethereum', 'base')
        ) THEN
            RAISE EXCEPTION 'Swap admission requires the original current participant';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.outgoing_operation_id IS NULL THEN
        IF NEW.status <> 'pending' OR NEW.tx_hash IS NOT NULL OR NEW.nonce IS NOT NULL
            OR NEW.submitted_at IS NOT NULL THEN
            RAISE EXCEPTION 'Swap signing and failure require the original outgoing operation';
        END IF;
    ELSE
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.outgoing_operation_id;
        IF NOT FOUND OR operation.operation_key <> 'swap-execution:' || NEW.uuid::text
            OR operation.intent IS DISTINCT FROM tokens_swap_execution_intent(NEW) THEN
            RAISE EXCEPTION 'Swap transactions bind only their original operation and full intent';
        END IF;
        IF NEW.status = 'failed' THEN
            IF operation.status <> 'failed' OR operation.current_attempt_id IS NOT NULL OR NEW.tx_hash IS NOT NULL
                OR NEW.nonce IS NOT NULL OR NEW.submitted_at IS NOT NULL THEN
                RAISE EXCEPTION 'Swap failure requires proof that the original operation never signed';
            END IF;
        ELSIF NEW.status = 'pending' THEN
            IF NEW.tx_hash IS NOT NULL OR NEW.nonce IS NOT NULL OR NEW.submitted_at IS NOT NULL THEN
                RAISE EXCEPTION 'Pending swap transactions cannot claim signed evidence';
            END IF;
        ELSIF NEW.status IN ('submitted', 'confirmed', 'reverted') THEN
            SELECT * INTO attempt FROM blockchain_signedattempt WHERE uuid = operation.current_attempt_id;
            IF NOT FOUND OR attempt.operation_id <> operation.uuid OR attempt.claim_id <> operation.claim_id
                OR NEW.tx_hash IS DISTINCT FROM attempt.tx_hash OR NEW.submitted_at IS NULL
                OR (NEW.nonce IS NOT NULL AND NEW.nonce IS DISTINCT FROM attempt.nonce)
                OR operation.status NOT IN ('signed', 'confirmed', 'reverted') THEN
                RAISE EXCEPTION 'Swap submission requires its original signed attempt';
            END IF;
        ELSE
            RAISE EXCEPTION 'Unknown admitted swap transaction state';
        END IF;
    END IF;
    IF NEW.status IN ('confirmed', 'reverted') THEN
        IF operation.status IS DISTINCT FROM NEW.status OR NEW.confirmed_at IS NULL
            OR ROW(NEW.block_number::bigint, NEW.block_hash, NEW.gas_used::bigint)
                IS DISTINCT FROM ROW(operation.block_number, operation.block_hash, operation.gas_used) THEN
            RAISE EXCEPTION 'Swap receipts must project the original outgoing summary';
        END IF;
    ELSIF NEW.block_number IS NOT NULL OR NEW.block_hash IS NOT NULL OR NEW.gas_used IS NOT NULL
        OR NEW.confirmed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Unresolved swap transactions cannot claim receipt evidence';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_swap_transaction BEFORE INSERT OR UPDATE OR DELETE ON blockchain_blockchaintransaction
FOR EACH ROW EXECUTE FUNCTION protect_swap_transaction();

CREATE FUNCTION protect_swap_execution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    journal blockchain_blockchaintransaction%ROWTYPE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'created' OR NEW.seller_signature <> '' OR NEW.buyer_signature <> ''
            OR NEW.transaction_id IS NOT NULL OR NEW.tx_hash <> '' OR NEW.completed_at IS NOT NULL
            OR NEW.expiry_release_eligible THEN
            RAISE EXCEPTION 'Fresh swaps start without signatures or execution claims';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.transaction_id IS NOT NULL AND ROW(NEW.transaction_id, NEW.seller_signature, NEW.buyer_signature)
        IS DISTINCT FROM ROW(OLD.transaction_id, OLD.seller_signature, OLD.buyer_signature) THEN
        RAISE EXCEPTION 'Claimed swaps retain their original journal and signatures';
    END IF;
    IF OLD.tx_hash <> '' AND NEW.tx_hash IS DISTINCT FROM OLD.tx_hash THEN
        RAISE EXCEPTION 'Swaps retain their original execution hash';
    END IF;
    IF NEW.transaction_id IS NULL THEN
        IF ROW(NEW.status, NEW.tx_hash, NEW.completed_at, NEW.expiry_release_eligible)
            IS DISTINCT FROM ROW(OLD.status, OLD.tx_hash, OLD.completed_at, OLD.expiry_release_eligible)
            AND (NEW.status IN ('executing', 'completed') OR NEW.tx_hash <> '' OR NEW.completed_at IS NOT NULL) THEN
            RAISE EXCEPTION 'Swap execution requires an admitted journal';
        END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO journal FROM blockchain_blockchaintransaction WHERE uuid = NEW.transaction_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Swap execution requires its original transaction';
    END IF;
    IF NOT coalesce(journal.function_args ? 'admission', false) THEN
        IF OLD.transaction_id IS DISTINCT FROM NEW.transaction_id
            OR ROW(NEW.status, NEW.tx_hash, NEW.completed_at, NEW.expiry_release_eligible)
                IS DISTINCT FROM ROW(OLD.status, OLD.tx_hash, OLD.completed_at, OLD.expiry_release_eligible) THEN
            RAISE EXCEPTION 'Historical swap execution cannot be adopted or released';
        END IF;
        RETURN NEW;
    END IF;
    IF journal.related_uuid IS DISTINCT FROM NEW.uuid OR journal.related_model <> 'tokens.SwapOrder'
        OR NEW.completed_at IS NOT NULL OR NEW.expiry_release_eligible
        OR NEW.tx_hash IS DISTINCT FROM coalesce(journal.tx_hash, '')
        OR NEW.seller_signature IS DISTINCT FROM journal.function_args->>'sellerSignature'
        OR NEW.buyer_signature IS DISTINCT FROM journal.function_args->>'buyerSignature'
        OR (OLD.transaction_id IS NULL AND (OLD.status <> 'ready' OR NEW.status <> 'executing')) THEN
        RAISE EXCEPTION 'Swap execution must retain its exact admitted state';
    END IF;
    IF NEW.status NOT IN ('executing', 'failed')
        OR (OLD.status = 'failed' AND NEW.status <> 'failed')
        OR (NEW.status = 'failed' AND (journal.status <> 'failed' OR journal.tx_hash IS NOT NULL)) THEN
        RAISE EXCEPTION 'Signed swaps remain held until finality; only unsigned failure releases';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_swap_execution BEFORE INSERT OR UPDATE ON tokens_swaporder
FOR EACH ROW EXECUTE FUNCTION protect_swap_execution();

CREATE FUNCTION protect_swap_outgoing() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    journal blockchain_blockchaintransaction%ROWTYPE;
    swap tokens_swaporder%ROWTYPE;
BEGIN
    IF NEW.operation_key NOT LIKE 'swap-execution:%' THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF EXISTS (SELECT 1 FROM blockchain_outgoingoperation
            WHERE operation_key = NEW.operation_key AND intent = NEW.intent) THEN
            RETURN NEW;
        END IF;
        SELECT * INTO journal FROM blockchain_blockchaintransaction
            WHERE 'swap-execution:' || uuid::text = NEW.operation_key FOR UPDATE;
        IF EXISTS (SELECT 1 FROM blockchain_outgoingoperation
            WHERE operation_key = NEW.operation_key AND intent = NEW.intent) THEN
            RETURN NEW;
        END IF;
    ELSE
        SELECT * INTO journal FROM blockchain_blockchaintransaction
            WHERE 'swap-execution:' || uuid::text = NEW.operation_key;
    END IF;
    IF NOT FOUND OR NOT coalesce(journal.function_args ? 'admission', false)
        OR NEW.intent IS DISTINCT FROM tokens_swap_execution_intent(journal) THEN
        RAISE EXCEPTION 'Swap operations require their original admitted transaction and full intent';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF journal.status <> 'pending' OR journal.outgoing_operation_id IS NOT NULL OR journal.tx_hash IS NOT NULL
            OR NEW.status <> 'preparing' OR NEW.current_attempt_id IS NOT NULL OR NEW.acknowledged_at IS NOT NULL
            OR NEW.block_number IS NOT NULL OR NEW.block_hash <> '' OR NEW.gas_used IS NOT NULL THEN
            RAISE EXCEPTION 'Swap operations start preparing before any signature or outcome';
        END IF;
    ELSE
        IF NEW.claim_id IS DISTINCT FROM OLD.claim_id OR NEW.uuid IS DISTINCT FROM OLD.uuid
            OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'A swap execution operation cannot restart or replace its identity';
        END IF;
        IF OLD.status IN ('confirmed', 'reverted')
            AND ROW(NEW.status, NEW.block_number, NEW.block_hash, NEW.gas_used)
                IS DISTINCT FROM ROW(OLD.status, OLD.block_number, OLD.block_hash, OLD.gas_used) THEN
            RAISE EXCEPTION 'Swap operations retain their first receipt summary';
        END IF;
    END IF;
    IF NEW.status IN ('confirmed', 'reverted') THEN
        IF NEW.block_number IS NULL OR NEW.gas_used IS NULL OR NEW.block_hash !~ '^0x[0-9a-f]{64}$' THEN
            RAISE EXCEPTION 'Swap receipt outcomes require a complete original summary';
        END IF;
    ELSIF NEW.block_number IS NOT NULL OR NEW.gas_used IS NOT NULL OR NEW.block_hash <> '' THEN
        RAISE EXCEPTION 'Unresolved swap operations cannot claim receipt evidence';
    END IF;
    IF TG_OP = 'INSERT' OR (OLD.status = 'preparing' AND NEW.status = 'signed') THEN
        SELECT * INTO swap FROM tokens_swaporder WHERE uuid = journal.related_uuid;
        IF NOT FOUND OR swap.transaction_id IS DISTINCT FROM journal.uuid OR swap.status <> 'executing'
            OR (TG_OP = 'UPDATE' AND journal.outgoing_operation_id IS DISTINCT FROM NEW.uuid) THEN
            RAISE EXCEPTION 'Swap signing requires the original admitted public association';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_swap_outgoing BEFORE INSERT OR UPDATE ON blockchain_outgoingoperation
FOR EACH ROW EXECUTE FUNCTION protect_swap_outgoing();
"""

REVERSE = """
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM blockchain_blockchaintransaction WHERE outgoing_operation_id IS NOT NULL
        OR ((tx_type = 'atomic_swap' OR related_model = 'tokens.SwapOrder') AND function_args ? 'admission'))
        OR EXISTS (SELECT 1 FROM blockchain_outgoingoperation WHERE operation_key LIKE 'swap-execution:%') THEN
        RAISE EXCEPTION 'Cannot remove admitted swap execution history';
    END IF;
END $$;
DROP TRIGGER protect_swap_outgoing ON blockchain_outgoingoperation;
DROP FUNCTION protect_swap_outgoing();
DROP TRIGGER protect_swap_execution ON tokens_swaporder;
DROP FUNCTION protect_swap_execution();
DROP TRIGGER protect_swap_transaction ON blockchain_blockchaintransaction;
DROP FUNCTION protect_swap_transaction();
DROP FUNCTION tokens_swap_execution_intent(blockchain_blockchaintransaction);
"""


class Migration(migrations.Migration):
    dependencies = [
        ("blockchain", "0007_transaction_outgoing_operation"),
        ("tokens", "0056_hold_legacy_swaps"),
    ]
    operations = [migrations.RunSQL(GUARDS, REVERSE)]
