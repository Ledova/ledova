from importlib import import_module

from django.db import migrations

COMPLETION = """
CREATE OR REPLACE FUNCTION protect_swap_execution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    journal blockchain_blockchaintransaction%ROWTYPE;
    operation blockchain_outgoingoperation%ROWTYPE;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'created' OR NEW.seller_signature <> '' OR NEW.buyer_signature <> ''
            OR NEW.transaction_id IS NOT NULL OR NEW.tx_hash <> '' OR NEW.completed_at IS NOT NULL THEN
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
        OR (NEW.completed_at IS NOT NULL) <> (NEW.status = 'completed')
        OR NEW.tx_hash IS DISTINCT FROM coalesce(journal.tx_hash, '')
        OR NEW.seller_signature IS DISTINCT FROM journal.function_args->>'sellerSignature'
        OR NEW.buyer_signature IS DISTINCT FROM journal.function_args->>'buyerSignature'
        OR (OLD.transaction_id IS NULL AND (OLD.status <> 'ready' OR NEW.status <> 'executing')) THEN
        RAISE EXCEPTION 'Swap execution must retain its exact admitted state';
    END IF;
    IF OLD.status IN ('completed', 'failed') THEN
        IF ROW(NEW.status, NEW.completed_at) IS DISTINCT FROM ROW(OLD.status, OLD.completed_at) THEN
            RAISE EXCEPTION 'Settled swaps are terminal';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.status = 'completed' THEN
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = journal.outgoing_operation_id;
        IF NOT FOUND OR journal.status <> 'confirmed' OR journal.tx_hash IS NULL
            OR operation.status <> 'confirmed' OR NEW.tx_hash <> journal.tx_hash THEN
            RAISE EXCEPTION 'Swap completion requires its confirmed original receipt';
        END IF;
    ELSIF NEW.status = 'failed' THEN
        IF NOT (journal.status = 'reverted' OR (journal.status = 'failed' AND journal.tx_hash IS NULL)) THEN
            RAISE EXCEPTION 'Signed swaps remain held until finality; only unsigned failure or a reverted receipt releases';
        END IF;
    ELSIF NEW.status <> 'executing' THEN
        RAISE EXCEPTION 'Admitted swaps move only from executing to completed or failed';
    END IF;
    RETURN NEW;
END;
$$;
"""

PREVIOUS = import_module("tokens.migrations.0057_swap_execution_guards").GUARDS
START = PREVIOUS.index("CREATE FUNCTION protect_swap_execution()")
REVERSE = PREVIOUS[START : PREVIOUS.index("$$;", START) + 3].replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1)


class Migration(migrations.Migration):
    dependencies = [("tokens", "0057_swap_execution_guards")]
    operations = [migrations.RunSQL(COMPLETION, REVERSE)]
