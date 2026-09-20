from django.db import migrations, models

GUARD = """
CREATE FUNCTION protect_swap_finalized_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    journal blockchain_blockchaintransaction%ROWTYPE;
    evidence jsonb;
    policy jsonb;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.finalized_receipt IS NOT NULL THEN
            RAISE EXCEPTION 'Fresh swaps cannot claim finalized receipt evidence';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.status IN ('completed', 'failed') OR OLD.finalized_receipt IS NOT NULL THEN
        IF NEW.finalized_receipt IS DISTINCT FROM OLD.finalized_receipt THEN
            RAISE EXCEPTION 'Settled swaps retain their recorded finality evidence';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.finalized_receipt IS NULL AND (
        OLD.status <> 'executing' OR NEW.status NOT IN ('completed', 'failed') OR NEW.transaction_id IS NULL
    ) THEN
        RETURN NEW;
    END IF;
    SELECT * INTO journal FROM blockchain_blockchaintransaction WHERE uuid = NEW.transaction_id;
    IF NEW.finalized_receipt IS NULL THEN
        IF OLD.status = 'executing' AND NEW.status IN ('completed', 'failed')
            AND coalesce(journal.function_args ? 'admission', false)
            AND journal.status IN ('confirmed', 'reverted') THEN
            RAISE EXCEPTION 'Signed settlement requires finalized receipt evidence';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.status <> 'executing' OR NEW.status NOT IN ('completed', 'failed')
        OR journal.uuid IS NULL OR NOT coalesce(journal.function_args ? 'admission', false)
        OR journal.related_uuid IS DISTINCT FROM NEW.uuid
        OR journal.tx_hash IS DISTINCT FROM NEW.tx_hash
        OR (NEW.status = 'completed' AND journal.status <> 'confirmed')
        OR (NEW.status = 'failed' AND journal.status <> 'reverted') THEN
        RAISE EXCEPTION 'Finality evidence belongs to the original signed settlement transition';
    END IF;
    evidence := NEW.finalized_receipt;
    IF jsonb_typeof(evidence) IS DISTINCT FROM 'object'
        OR NOT (evidence ?& ARRAY['block_number', 'block_hash', 'gas_used', 'policy'])
        OR evidence - ARRAY['block_number', 'block_hash', 'gas_used', 'policy'] <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Finalized receipt evidence requires its exact block, gas and policy';
    END IF;
    IF jsonb_typeof(evidence->'block_number') IS DISTINCT FROM 'number'
        OR evidence->>'block_number' !~ '^(0|[1-9][0-9]*)$'
        OR jsonb_typeof(evidence->'gas_used') IS DISTINCT FROM 'number'
        OR evidence->>'gas_used' !~ '^(0|[1-9][0-9]*)$'
        OR jsonb_typeof(evidence->'block_hash') IS DISTINCT FROM 'string'
        OR evidence->>'block_hash' !~ '^0x[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'Finalized receipt evidence requires exact nonnegative quantities and a block hash';
    END IF;
    IF (evidence->>'block_number')::numeric > 2147483647 OR (evidence->>'gas_used')::numeric > 2147483647 THEN
        RAISE EXCEPTION 'Finalized receipt quantities exceed the supported range';
    END IF;
    policy := evidence->'policy';
    IF jsonb_typeof(policy) IS DISTINCT FROM 'object' OR policy->'version' IS DISTINCT FROM '1'::jsonb
        OR NOT (policy ? 'mode') THEN
        RAISE EXCEPTION 'Finalized receipt evidence requires an approved policy shape';
    END IF;
    IF policy->>'mode' = 'finalized' THEN
        IF policy - ARRAY['version', 'mode'] <> '{}'::jsonb THEN
            RAISE EXCEPTION 'Finalized receipt evidence requires an exact finalized policy';
        END IF;
    ELSIF policy->>'mode' = 'depth' THEN
        IF jsonb_typeof(policy->'depth') IS DISTINCT FROM 'number'
            OR policy->>'depth' !~ '^[1-9][0-9]*$'
            OR policy - ARRAY['version', 'mode', 'depth'] <> '{}'::jsonb THEN
            RAISE EXCEPTION 'Finalized receipt evidence requires an exact positive depth policy';
        END IF;
        IF (policy->>'depth')::numeric > 2147483647 THEN
            RAISE EXCEPTION 'Finalized receipt depth exceeds the supported range';
        END IF;
    ELSE
        RAISE EXCEPTION 'Finalized receipt evidence requires an approved policy mode';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_swap_finalized_receipt BEFORE INSERT OR UPDATE ON tokens_swaporder
FOR EACH ROW EXECUTE FUNCTION protect_swap_finalized_receipt();
"""

REVERSE = """
DO $$ BEGIN
    LOCK TABLE tokens_swaporder IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM tokens_swaporder WHERE finalized_receipt IS NOT NULL) THEN
        RAISE EXCEPTION 'Cannot remove recorded swap finality evidence';
    END IF;
END $$;
DROP TRIGGER protect_swap_finalized_receipt ON tokens_swaporder;
DROP FUNCTION protect_swap_finalized_receipt();
"""


class Migration(migrations.Migration):
    dependencies = [("tokens", "0062_register_foundation")]

    operations = [
        migrations.AddField(
            model_name="swaporder", name="finalized_receipt", field=models.JSONField(editable=False, null=True)
        ),
        migrations.RunSQL(GUARD, REVERSE),
    ]
