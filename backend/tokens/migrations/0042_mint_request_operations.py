import uuid

import django.db.models.deletion
from django.db import migrations, models

GUARD = """
CREATE FUNCTION protect_mint_request_operation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    operation blockchain_outgoingoperation%ROWTYPE;
    attempt blockchain_signedattempt%ROWTYPE;
    projected blockchain_blockchaintransaction%ROWTYPE;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.execution_intent IS NOT NULL THEN
            RAISE EXCEPTION 'Admitted mint requests cannot be deleted';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD.dispatch_id IS DISTINCT FROM NEW.dispatch_id THEN
            RAISE EXCEPTION 'Mint dispatch identity cannot be changed or backfilled';
        END IF;
        IF OLD.execution_intent IS NOT NULL THEN
            IF ROW(NEW.uuid, NEW.execution_intent, NEW.settlement_asset_id, NEW.yield_token_id,
                   NEW.recipient_address, NEW.recipient_name, NEW.amount, NEW.deposit_reference,
                   NEW.deposit_date, NEW.requested_by_id, NEW.executed_by_id)
               IS DISTINCT FROM
               ROW(OLD.uuid, OLD.execution_intent, OLD.settlement_asset_id, OLD.yield_token_id,
                   OLD.recipient_address, OLD.recipient_name, OLD.amount, OLD.deposit_reference,
                   OLD.deposit_date, OLD.requested_by_id, OLD.executed_by_id) THEN
                RAISE EXCEPTION 'Admitted mint intent and authority are immutable';
            END IF;
            IF NEW.status NOT IN ('executing', 'failed', 'executed')
                OR (OLD.status = 'executed' AND NEW.status <> 'executed') THEN
                RAISE EXCEPTION 'The admitted mint outcome cannot be discarded';
            END IF;
        END IF;
        IF OLD.operation_id IS NOT NULL AND OLD.operation_id IS DISTINCT FROM NEW.operation_id THEN
            RAISE EXCEPTION 'A mint operation association is immutable';
        END IF;
    END IF;
    IF NEW.execution_intent IS NOT NULL AND (
        NEW.dispatch_id IS NULL OR NEW.executed_by_id IS NULL
        OR jsonb_typeof(NEW.execution_intent) <> 'object'
        OR NOT (NEW.execution_intent ?& ARRAY['chain_id', 'sender', 'to', 'value', 'data', 'recipient', 'amount'])
        OR NEW.execution_intent->>'recipient' IS DISTINCT FROM lower(NEW.recipient_address)
        OR NEW.execution_intent->>'amount' IS DISTINCT FROM NEW.amount::text
    ) THEN
        RAISE EXCEPTION 'A mint admission requires attributable request intent and authority';
    END IF;
    IF NEW.operation_id IS NOT NULL THEN
        SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
        IF NOT FOUND OR NEW.execution_intent IS NULL
            OR operation.operation_key <> 'mint-request:' || NEW.uuid::text || ':' || NEW.dispatch_id::text
            OR operation.intent IS DISTINCT FROM jsonb_build_object(
                'chain_id', NEW.execution_intent->'chain_id', 'sender', NEW.execution_intent->'sender',
                'to', NEW.execution_intent->'to', 'value', NEW.execution_intent->'value',
                'data', NEW.execution_intent->'data'
            ) THEN
            RAISE EXCEPTION 'A mint must reference its own immutable outgoing operation';
        END IF;
        IF NEW.status = 'executed' AND (operation.status <> 'confirmed' OR NEW.transaction_id IS NULL) THEN
            RAISE EXCEPTION 'A mint requires a confirmed original operation before completion';
        END IF;
        IF NEW.status = 'failed' AND operation.status NOT IN ('failed', 'reverted') THEN
            RAISE EXCEPTION 'An uncertain signed mint cannot be recorded as failed';
        END IF;
        IF NEW.transaction_id IS NOT NULL AND NEW.status = 'executed' THEN
            SELECT * INTO attempt FROM blockchain_signedattempt WHERE uuid = operation.current_attempt_id;
            SELECT * INTO projected FROM blockchain_blockchaintransaction WHERE uuid = NEW.transaction_id;
            IF projected.tx_hash IS DISTINCT FROM attempt.tx_hash
                OR projected.related_uuid IS DISTINCT FROM NEW.uuid
                OR projected.related_model IS DISTINCT FROM 'tokens.MintRequest' THEN
                RAISE EXCEPTION 'Mint completion must name the original signed transaction';
            END IF;
        END IF;
    ELSIF NEW.dispatch_id IS NOT NULL AND NEW.status = 'executed' THEN
        RAISE EXCEPTION 'A new mint requires a durable operation before completion';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_mint_request_operation
BEFORE INSERT OR UPDATE OR DELETE ON tokens_mintrequest
FOR EACH ROW EXECUTE FUNCTION protect_mint_request_operation();
"""

REVERSE = """
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM tokens_mintrequest WHERE execution_intent IS NOT NULL) THEN
        RAISE EXCEPTION 'Cannot remove admitted mint recovery history';
    END IF;
END $$;
DROP TRIGGER protect_mint_request_operation ON tokens_mintrequest;
DROP FUNCTION protect_mint_request_operation();
"""


class Migration(migrations.Migration):
    dependencies = [
        ("tokens", "0041_drop_the_token_owner_no_policy_reads"),
        ("blockchain", "0006_signer_admission"),
    ]

    operations = [
        migrations.AddField(
            model_name="mintrequest", name="dispatch_id", field=models.UUIDField(null=True, editable=False)
        ),
        migrations.AlterField(
            model_name="mintrequest",
            name="dispatch_id",
            field=models.UUIDField(default=uuid.uuid4, null=True, editable=False),
        ),
        migrations.AddField(
            model_name="mintrequest", name="execution_intent", field=models.JSONField(null=True, editable=False)
        ),
        migrations.AddField(
            model_name="mintrequest",
            name="operation",
            field=models.OneToOneField(
                to="blockchain.outgoingoperation",
                on_delete=django.db.models.deletion.PROTECT,
                null=True,
                editable=False,
                related_name="mint_request",
            ),
        ),
        migrations.AlterField(
            model_name="mintrequest",
            name="status",
            field=models.CharField(
                max_length=20,
                default="pending",
                choices=[
                    ("pending", "Pending"),
                    ("approved", "Approved"),
                    ("executing", "Outcome unresolved"),
                    ("executed", "Executed"),
                    ("failed", "Failed"),
                    ("rejected", "Rejected"),
                ],
            ),
        ),
        migrations.RunSQL(GUARD, REVERSE),
    ]
