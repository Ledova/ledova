import importlib

from django.conf import settings
from django.db import migrations, models

ITEMS = """            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.items) item
                WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
                OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 3"""
KIND_ITEMS = """            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.items) item
                WHERE NEW.kind = 'transfer' AND (jsonb_typeof(item) IS DISTINCT FROM 'object'
                OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 4
                OR jsonb_typeof(item->'settlement') IS DISTINCT FROM 'string'
                OR item->>'settlement' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                OR jsonb_typeof(item->'seller') IS DISTINCT FROM 'string'
                OR item->>'seller' !~ '^0x[0-9a-fA-F]{40}$'
                OR jsonb_typeof(item->'buyer') IS DISTINCT FROM 'string'
                OR item->>'buyer' !~ '^0x[0-9a-fA-F]{40}$'
                OR jsonb_typeof(item->'amount') IS DISTINCT FROM 'string'
                OR item->>'amount' !~ '^[1-9][0-9]{0,77}$'))
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.items) item
                WHERE NEW.kind = 'issue' AND (jsonb_typeof(item) IS DISTINCT FROM 'object'
                OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 3"""
DISTINCT = """                    AND s.company_id = NEW.company_id)))
            OR item_count <> (SELECT count(DISTINCT COALESCE(item->>'request', item->>'subscription'))"""
KIND_DISTINCT = """                    AND s.company_id = NEW.company_id))))
            OR item_count <> (SELECT count(DISTINCT
                COALESCE(item->>'request', item->>'subscription', item->>'settlement'))"""
REJECTION = """    ELSIF length(btrim(NEW.rejection_reason)) = 0 THEN"""
SETTLEMENTS = """        IF EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.items) item
            WHERE item ? 'settlement' AND (NOT EXISTS (SELECT 1 FROM tokens_swaporder s
                WHERE s.uuid = (item->>'settlement')::uuid AND s.share_token_id = NEW.token_id
                AND s.status = 'completed' AND lower(s.seller_address) = lower(item->>'seller')
                AND lower(s.buyer_address) = lower(item->>'buyer') AND s.share_amount = (item->>'amount')::numeric)
            OR EXISTS (SELECT 1 FROM tokens_registerinstruction other WHERE other.uuid <> NEW.uuid
                AND other.status = 'applied'
                AND other.items @> jsonb_build_array(jsonb_build_object('settlement', item->>'settlement')))))
        THEN
            RAISE EXCEPTION 'Application must cover completed settlements of the class on their terms, once'
                USING ERRCODE = '23514';
        END IF;
""" + REJECTION
REPLACEMENTS = (
    ("OR NEW.kind <> 'issue'", "OR NEW.kind NOT IN ('issue', 'transfer')"),
    (ITEMS, KIND_ITEMS),
    (DISTINCT, KIND_DISTINCT),
    (REJECTION, SETTLEMENTS),
)


def _guard(replacements=()):
    sql = importlib.import_module("tokens.migrations.0073_register_instructions").GUARDS
    sql = sql[: sql.index("CREATE TRIGGER")].replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1)
    for old, new in replacements:
        if sql.count(old) != 1:
            raise RuntimeError("The register instruction guard no longer has the shape this migration extends.")
        sql = sql.replace(old, new)
    return sql


PREVIOUS = _guard()
TRANSFERS = _guard(REPLACEMENTS)


def install_guard(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(TRANSFERS, {"app": settings.RLS_ROLES["app"]})


def restore_guard(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE tokens_registerinstruction IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM tokens_registerinstruction WHERE kind = 'transfer')")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain transfer instructions; downgrade would unbind them from their settlements.")
        cursor.execute(PREVIOUS, {"app": settings.RLS_ROLES["app"]})


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0074_register_inspection_copies"),
    ]

    operations = [
        migrations.AlterField(
            model_name="registerinstruction",
            name="kind",
            field=models.CharField(choices=[("issue", "Issue"), ("transfer", "Transfer")], max_length=16),
        ),
        migrations.RunPython(install_guard, restore_guard),
    ]
