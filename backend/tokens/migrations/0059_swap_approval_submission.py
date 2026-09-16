import uuid

import django.db.models.deletion
from django.db import migrations, models

GUARD = """
CREATE FUNCTION protect_swap_approval_submission() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    swap tokens_swaporder%ROWTYPE;
    party jsonb;
    token text;
    mutable text[] := ARRAY['last_attempt_at', 'acknowledged_at', 'last_error', 'outcome',
        'block_number', 'block_hash', 'gas_used', 'confirmed_at', 'updated_at'];
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Participant approval submissions cannot be deleted';
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF to_jsonb(NEW) - mutable IS DISTINCT FROM to_jsonb(OLD) - mutable THEN
            RAISE EXCEPTION 'Participant approval submission identity cannot be changed';
        END IF;
        IF OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at THEN
            RAISE EXCEPTION 'A participant approval acknowledgement cannot be changed';
        END IF;
        IF OLD.last_attempt_at IS NOT NULL
            AND (NEW.last_attempt_at IS NULL OR NEW.last_attempt_at < OLD.last_attempt_at) THEN
            RAISE EXCEPTION 'A participant approval attempt cannot be rewound';
        END IF;
        IF OLD.outcome <> 'pending'
            AND ROW(NEW.outcome, NEW.block_number, NEW.block_hash, NEW.gas_used, NEW.confirmed_at)
            IS DISTINCT FROM ROW(OLD.outcome, OLD.block_number, OLD.block_hash, OLD.gas_used, OLD.confirmed_at) THEN
            RAISE EXCEPTION 'A participant approval outcome is written once';
        END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO swap FROM tokens_swaporder WHERE uuid = NEW.swap_id FOR UPDATE;
    IF NOT FOUND OR swap.settlement_protocol_version <> 1 THEN
        RAISE EXCEPTION 'Participant approval requires its V1 swap';
    END IF;
    IF swap.status NOT IN ('created', 'seller_signed', 'buyer_signed', 'ready')
        OR swap.transaction_id IS NOT NULL OR swap.tx_hash <> '' THEN
        RAISE EXCEPTION 'Participant approval requires a pending swap';
    END IF;
    party := swap.settlement_context->NEW.participant;
    IF NEW.participant = 'seller' THEN
        token := swap.settlement_context->'share_token'->>'address';
    ELSE
        token := swap.settlement_context->'payment_asset'->>'deployment_address';
    END IF;
    IF NEW.outcome <> 'pending' OR NEW.acknowledged_at IS NOT NULL OR NEW.last_attempt_at IS NOT NULL
        OR NEW.settlement_digest IS DISTINCT FROM swap.settlement_digest
        OR NEW.chain_id::text IS DISTINCT FROM swap.settlement_context->'typed_data'->'domain'->>'chainId'
        OR NEW.sender_address IS DISTINCT FROM lower(party->>'address')
        OR NEW.owner_account_id::text IS DISTINCT FROM party->>'owner_account_uuid'
        OR NEW.wallet_id::text IS DISTINCT FROM party->>'wallet_uuid'
        OR NEW.token_address IS DISTINCT FROM lower(token)
        OR NEW.spender_address IS DISTINCT FROM
            lower(swap.settlement_context->'typed_data'->'domain'->>'verifyingContract')
        OR NEW.intent->>'to' IS DISTINCT FROM NEW.token_address
        OR NEW.intent->>'value' IS DISTINCT FROM '0'
        OR NEW.intent->>'data' IS DISTINCT FROM
            '0x095ea7b3' || repeat('0', 24) || substr(NEW.spender_address, 3) || repeat('f', 64)
        OR octet_length(NEW.raw_transaction) = 0 THEN
        RAISE EXCEPTION 'Participant approval must match its recorded settlement party';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER protect_swap_approval_submission
BEFORE INSERT OR UPDATE OR DELETE ON tokens_swapapprovalsubmission
FOR EACH ROW EXECUTE FUNCTION protect_swap_approval_submission();
"""

REVERSE = """
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM tokens_swapapprovalsubmission) THEN
        RAISE EXCEPTION 'Cannot remove recorded participant approval submissions';
    END IF;
END $$;
DROP TRIGGER protect_swap_approval_submission ON tokens_swapapprovalsubmission;
DROP FUNCTION protect_swap_approval_submission();
"""


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0058_swap_finality_completion"),
    ]

    operations = [
        migrations.CreateModel(
            name="SwapApprovalSubmission",
            fields=[
                (
                    "uuid",
                    models.UUIDField(
                        default=uuid.uuid4,
                        editable=False,
                        help_text="Unique identifier (primary key)",
                        primary_key=True,
                        serialize=False,
                    ),
                ),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("participant", models.CharField(editable=False, max_length=6)),
                ("owner_account_id", models.UUIDField(editable=False)),
                ("wallet_id", models.UUIDField(editable=False)),
                ("actor_id", models.PositiveBigIntegerField(editable=False)),
                ("settlement_digest", models.CharField(editable=False, max_length=66)),
                ("chain_id", models.PositiveBigIntegerField(editable=False)),
                ("sender_address", models.CharField(editable=False, max_length=42)),
                ("token_address", models.CharField(editable=False, max_length=42)),
                ("spender_address", models.CharField(editable=False, max_length=42)),
                ("nonce", models.PositiveBigIntegerField(editable=False)),
                ("tx_hash", models.CharField(editable=False, max_length=66)),
                ("raw_transaction", models.BinaryField()),
                ("intent", models.JSONField(editable=False)),
                ("last_attempt_at", models.DateTimeField(db_index=True, editable=False, null=True)),
                ("acknowledged_at", models.DateTimeField(editable=False, null=True)),
                ("last_error", models.CharField(blank=True, default="", editable=False, max_length=100)),
                (
                    "outcome",
                    models.CharField(
                        choices=[
                            ("pending", "Pending"),
                            ("confirmed", "Confirmed"),
                            ("reverted", "Reverted"),
                            ("superseded", "Superseded"),
                        ],
                        default="pending",
                        editable=False,
                        max_length=10,
                    ),
                ),
                ("block_number", models.PositiveBigIntegerField(editable=False, null=True)),
                ("block_hash", models.CharField(blank=True, default="", editable=False, max_length=66)),
                ("gas_used", models.PositiveBigIntegerField(editable=False, null=True)),
                ("confirmed_at", models.DateTimeField(editable=False, null=True)),
                (
                    "swap",
                    models.ForeignKey(
                        editable=False,
                        on_delete=django.db.models.deletion.PROTECT,
                        related_name="approval_submissions",
                        to="tokens.swaporder",
                    ),
                ),
            ],
            options={
                "constraints": [
                    models.UniqueConstraint(
                        fields=("chain_id", "tx_hash"), name="unique_swap_approval_submission_hash"
                    ),
                    models.UniqueConstraint(
                        fields=("chain_id", "sender_address", "nonce"), name="unique_swap_approval_submission_nonce"
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("chain_id__gt", 0)), name="swap_approval_submission_chain_id"
                    ),
                    models.CheckConstraint(
                        condition=models.Q(("participant__in", ("seller", "buyer"))),
                        name="swap_approval_submission_participant",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("settlement_digest__regex", "^0x[0-9a-f]{64}$"), ("tx_hash__regex", "^0x[0-9a-f]{64}$")
                        ),
                        name="swap_approval_submission_hashes",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            ("sender_address__regex", "^0x[0-9a-f]{40}$"),
                            ("spender_address__regex", "^0x[0-9a-f]{40}$"),
                            ("token_address__regex", "^0x[0-9a-f]{40}$"),
                        ),
                        name="swap_approval_submission_addresses",
                    ),
                    models.CheckConstraint(
                        condition=models.Q(
                            models.Q(
                                ("block_hash__regex", "^0x[0-9a-f]{64}$"),
                                ("block_number__isnull", False),
                                ("confirmed_at__isnull", False),
                                ("gas_used__isnull", False),
                                ("outcome__in", ("confirmed", "reverted")),
                            ),
                            models.Q(
                                ("block_hash", ""),
                                ("block_number__isnull", True),
                                ("confirmed_at__isnull", True),
                                ("gas_used__isnull", True),
                                ("outcome__in", ("pending", "superseded")),
                            ),
                            _connector="OR",
                        ),
                        name="swap_approval_submission_receipt_present",
                    ),
                ],
            },
        ),
        migrations.RunSQL(GUARD, REVERSE),
    ]
