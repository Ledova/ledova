from django.db import migrations, models

ISSUANCE_GUARD = """
CREATE FUNCTION tokens_guard_issuance_finalized_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    journal blockchain_blockchaintransaction%ROWTYPE;
    evidence jsonb;
    policy jsonb;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.finalized_receipt IS NOT NULL THEN
            RAISE EXCEPTION 'Fresh issuance executions cannot claim finalized receipt evidence';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.finalized_receipt IS NOT NULL OR OLD.status = 'executed' THEN
        IF NEW.finalized_receipt IS DISTINCT FROM OLD.finalized_receipt THEN
            RAISE EXCEPTION 'Completed issuances retain their recorded finality evidence';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.status <> 'executed' THEN
        IF NEW.finalized_receipt IS NOT NULL THEN
            RAISE EXCEPTION 'Issuance finality evidence belongs to its completion';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.finalized_receipt IS NULL THEN
        RAISE EXCEPTION 'A completed issuance requires finalized receipt evidence';
    END IF;
    evidence := NEW.finalized_receipt;
    IF jsonb_typeof(evidence) IS DISTINCT FROM 'object'
        OR NOT (evidence ?& ARRAY['block_number', 'block_hash', 'gas_used', 'policy'])
        OR evidence - ARRAY['block_number', 'block_hash', 'gas_used', 'policy'] <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Issuance finality evidence requires its exact block, gas and policy';
    END IF;
    IF jsonb_typeof(evidence->'block_number') IS DISTINCT FROM 'number'
        OR evidence->>'block_number' !~ '^(0|[1-9][0-9]*)$'
        OR jsonb_typeof(evidence->'gas_used') IS DISTINCT FROM 'number'
        OR evidence->>'gas_used' !~ '^(0|[1-9][0-9]*)$'
        OR jsonb_typeof(evidence->'block_hash') IS DISTINCT FROM 'string'
        OR evidence->>'block_hash' !~ '^0x[0-9a-f]{64}$'
        OR (evidence->>'block_number')::numeric > 9223372036854775807
        OR (evidence->>'gas_used')::numeric > 9223372036854775807 THEN
        RAISE EXCEPTION 'Issuance finality evidence requires exact nonnegative quantities and a block hash';
    END IF;
    policy := evidence->'policy';
    IF jsonb_typeof(policy) IS DISTINCT FROM 'object' OR policy->'version' IS DISTINCT FROM '1'::jsonb
        OR NOT (policy ? 'mode') THEN
        RAISE EXCEPTION 'Issuance finality evidence requires an approved policy shape';
    END IF;
    IF policy->>'mode' = 'finalized' THEN
        IF policy - ARRAY['version', 'mode'] <> '{}'::jsonb THEN
            RAISE EXCEPTION 'Issuance finality evidence requires an exact finalized policy';
        END IF;
    ELSIF policy->>'mode' = 'depth' THEN
        IF jsonb_typeof(policy->'depth') IS DISTINCT FROM 'number'
            OR policy->>'depth' !~ '^[1-9][0-9]*$'
            OR policy - ARRAY['version', 'mode', 'depth'] <> '{}'::jsonb
            OR (policy->>'depth')::numeric > 9223372036854775807 THEN
            RAISE EXCEPTION 'Issuance finality evidence requires an exact positive depth policy';
        END IF;
    ELSE
        RAISE EXCEPTION 'Issuance finality evidence requires an approved policy mode';
    END IF;
    SELECT * INTO journal FROM blockchain_blockchaintransaction WHERE uuid = NEW.transaction_id;
    IF OLD.status <> 'executing' OR NEW.transaction_id IS NULL OR journal.uuid IS NULL
        OR journal.related_model <> 'tokens.ShareIssuanceRequest'
        OR journal.related_uuid IS DISTINCT FROM NEW.request_id
        OR journal.tx_type <> 'token_mint' OR journal.status <> 'confirmed'
        OR coalesce(journal.tx_hash, '') = ''
        OR journal.block_number IS DISTINCT FROM (evidence->>'block_number')::bigint
        OR journal.gas_used IS DISTINCT FROM (evidence->>'gas_used')::bigint
        OR lower(coalesce(journal.block_hash, '')) IS DISTINCT FROM evidence->>'block_hash' THEN
        RAISE EXCEPTION 'Finality evidence belongs to the original confirmed mint journal';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_guard_issuance_finalized_receipt
    BEFORE INSERT OR UPDATE ON tokens_shareissuanceexecution
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_issuance_finalized_receipt();
"""

ISSUANCE_REVERSE = """
DO $$ BEGIN
    LOCK TABLE tokens_shareissuanceexecution IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM tokens_shareissuanceexecution WHERE finalized_receipt IS NOT NULL) THEN
        RAISE EXCEPTION 'Cannot remove recorded issuance finality evidence';
    END IF;
END $$;
DROP TRIGGER tokens_guard_issuance_finalized_receipt ON tokens_shareissuanceexecution;
DROP FUNCTION tokens_guard_issuance_finalized_receipt();
"""

HISTORY_GUARD = """
CREATE FUNCTION tokens_guard_register_opening_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    history jsonb;
    entries bigint;
BEGIN
    IF TG_OP <> 'UPDATE' OR OLD.boundary IS NOT NULL OR NEW.boundary IS NULL THEN
        RETURN NEW;
    END IF;
    history := NEW.boundary->'history';
    IF jsonb_typeof(history) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'The captured boundary requires its canonical transfer history' USING ERRCODE = '23514';
    END IF;
    SELECT count(*) INTO entries FROM jsonb_array_elements(history);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(history) item
            WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
            OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 3
            OR jsonb_typeof(item->'block') IS DISTINCT FROM 'number'
            OR item->>'block' !~ '^(0|[1-9][0-9]*)$'
            OR jsonb_typeof(item->'block_hash') IS DISTINCT FROM 'string'
            OR item->>'block_hash' !~ '^0x[0-9a-f]{64}$'
            OR jsonb_typeof(item->'transaction') IS DISTINCT FROM 'string'
            OR item->>'transaction' !~ '^0x[0-9a-f]{64}$'
            OR (item->>'block')::numeric < (NEW.boundary->>'deployment_block')::numeric
            OR (item->>'block')::numeric > (NEW.boundary->'block'->>'number')::numeric)
        OR entries <> (SELECT count(DISTINCT (item->>'block') || ':' || (item->>'transaction'))
            FROM jsonb_array_elements(history) item)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(history) item
            GROUP BY item->>'block' HAVING count(DISTINCT item->>'block_hash') > 1)
    THEN
        RAISE EXCEPTION 'The captured boundary history requires exact canonical blocks and transactions'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_opening_history
    BEFORE INSERT OR UPDATE ON tokens_registeropening
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_opening_history();
"""

HISTORY_REVERSE = """
DROP TRIGGER tokens_register_opening_history ON tokens_registeropening;
DROP FUNCTION tokens_guard_register_opening_history();
"""


class Migration(migrations.Migration):
    dependencies = [("tokens", "0065_register_opening")]

    operations = [
        migrations.AddField(
            model_name="shareissuanceexecution",
            name="finalized_receipt",
            field=models.JSONField(editable=False, null=True),
        ),
        migrations.RunSQL(ISSUANCE_GUARD, ISSUANCE_REVERSE),
        migrations.RunSQL(HISTORY_GUARD, HISTORY_REVERSE),
    ]
