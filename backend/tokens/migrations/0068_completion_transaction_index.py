import importlib

from django.db import migrations

KEYS = "ARRAY['block_number', 'block_hash', 'gas_used', 'policy']"
INDEXED_KEYS = "ARRAY['block_number', 'block_hash', 'gas_used', 'policy', 'transaction_index']"
INDEX_CHECK = """    IF evidence ? 'transaction_index' AND (
        jsonb_typeof(evidence->'transaction_index') IS DISTINCT FROM 'number'
        OR evidence->>'transaction_index' !~ '^(0|[1-9][0-9]{0,6})$') THEN
        RAISE EXCEPTION 'Finalized receipt evidence requires an exact transaction index';
    END IF;
    policy := evidence->'policy';"""
REFUSE_REVERSAL = """
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM tokens_swaporder WHERE finalized_receipt ? 'transaction_index')
        OR EXISTS (SELECT 1 FROM tokens_shareissuanceexecution WHERE finalized_receipt ? 'transaction_index') THEN
        RAISE EXCEPTION 'Cannot remove recorded transaction indexes';
    END IF;
END $$;
"""


def _function(module, constant):
    sql = getattr(importlib.import_module(f"tokens.migrations.{module}"), constant)
    return sql[: sql.index("CREATE TRIGGER")].replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1)


def _indexed(sql):
    key_check = f"evidence - {KEYS} <> '{{}}'::jsonb"
    policy = "    policy := evidence->'policy';"
    if sql.count(key_check) != 1 or sql.count(policy) != 1:
        raise RuntimeError("The finalized receipt guard no longer has the shape this migration extends.")
    return sql.replace(key_check, f"evidence - {INDEXED_KEYS} <> '{{}}'::jsonb").replace(policy, INDEX_CHECK)


SWAP = _function("0063_swap_finalized_receipt", "GUARD")
ISSUANCE = _function("0066_issuance_finality_and_boundary_history", "ISSUANCE_GUARD")


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0067_register_wallet_links"),
    ]

    operations = [
        migrations.RunSQL(_indexed(SWAP), REFUSE_REVERSAL + SWAP),
        migrations.RunSQL(_indexed(ISSUANCE), ISSUANCE),
    ]
