from importlib import import_module

from django.conf import settings
from django.db import migrations

REGISTER_IMPORT = import_module("tokens.migrations.0072_register_import")
UUID, DATE, WHOLE, MONEY = REGISTER_IMPORT.UUID, REGISTER_IMPORT.DATE, REGISTER_IMPORT.WHOLE, REGISTER_IMPORT.MONEY
MEMBER_KEYS, FORMER_KEYS = REGISTER_IMPORT.MEMBER_KEYS, REGISTER_IMPORT.FORMER_KEYS
APPROVED_OR_INSTRUCTED = """(EXISTS (SELECT 1 FROM tokens_shareissuancerequest r
                WHERE r.token_id = NEW.token_id AND r.status IN ('approved', 'executing', 'executed', 'failed'))
                OR EXISTS (SELECT 1 FROM tokens_registerinstruction i
                    WHERE i.token_id = NEW.token_id AND i.status = 'applied'))"""
OPENED_BY_IMPORT = """EXISTS (SELECT 1 FROM tokens_registerimport i
        JOIN tokens_shareregister r ON r.token_id = i.token_id
        JOIN tokens_registerentry e ON e.register_id = r.uuid AND e.operation_id = i.uuid AND e.kind = 'opening'
        WHERE i.status = 'applied'{scope})"""

IMPORT_GUARD_AS_0072_INSTALLED_IT = f"""
CREATE OR REPLACE FUNCTION tokens_guard_register_import() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    owner bigint;
    member_count bigint;
    imported_total numeric;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain register imports and their evidence' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT owner_id INTO owner FROM companies_company WHERE uuid = NEW.company_id FOR KEY SHARE;
        IF NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.rejection_reason <> '' OR NEW.asic_issued_total IS NOT NULL OR NEW.asic_member_count IS NOT NULL
            OR NEW.register_sequence IS NOT NULL OR owner IS DISTINCT FROM NEW.submitted_by_id
            OR NOT EXISTS (SELECT 1 FROM tokens_sharetoken t WHERE t.uuid = NEW.token_id
                AND t.company_id = NEW.company_id)
            OR NOT EXISTS (SELECT 1 FROM tokens_shareregister r JOIN tokens_registerentry e ON e.register_id = r.uuid
                WHERE r.token_id = NEW.token_id)
            OR NEW.as_at > current_date
            OR NEW.authority NOT IN ('director_resolution', 'court_order')
            OR (NEW.authority = 'director_resolution') <> (length(btrim(NEW.approving_director)) > 0)
            OR length(btrim(NEW.authority_reference)) = 0 OR length(btrim(NEW.reason)) = 0
            OR NEW.evidence_fingerprint !~ '^[0-9a-f]{{64}}$' OR NEW.asic_fingerprint !~ '^[0-9a-f]{{64}}$'
            OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-imports/' || NEW.uuid || '/[0-9a-f-]{{36}}[.]bin$')
            OR NOT EXISTS (SELECT 1 FROM companies_companydocument doc WHERE doc.uuid = NEW.source_document
                AND doc.company_id = NEW.company_id AND doc.document_type = 'share_register' AND doc.is_verified
                AND doc.verified_by_id IS NOT NULL AND doc.verified_fingerprint = NEW.evidence_fingerprint)
            OR NOT EXISTS (SELECT 1 FROM companies_companydocument doc WHERE doc.uuid = NEW.asic_document
                AND doc.company_id = NEW.company_id AND doc.document_type = 'asic' AND doc.is_verified
                AND doc.verified_by_id IS NOT NULL AND doc.verified_fingerprint = NEW.asic_fingerprint)
            OR NEW.evidence_snapshot->>'document' IS DISTINCT FROM NEW.source_document::text
            OR NEW.evidence_snapshot->>'company' IS DISTINCT FROM NEW.company_id::text
            OR COALESCE(NEW.evidence_snapshot->>'sha256', '') !~ '^[0-9a-f]{{64}}$'
            OR jsonb_typeof(NEW.members) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.members) = 0
            OR jsonb_typeof(NEW.former_members) IS DISTINCT FROM 'array'
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.members) item
                WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
                OR (SELECT array_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(item) key)
                    IS DISTINCT FROM {MEMBER_KEYS}
                OR jsonb_typeof(item->'member') IS DISTINCT FROM 'string' OR item->>'member' !~ '{UUID}'
                OR jsonb_typeof(item->'name') IS DISTINCT FROM 'string' OR length(btrim(item->>'name')) = 0
                OR jsonb_typeof(item->'residential_address') IS DISTINCT FROM 'string'
                OR length(btrim(item->>'residential_address')) = 0
                OR jsonb_typeof(item->'shares') IS DISTINCT FROM 'string' OR item->>'shares' !~ '{WHOLE}'
                OR jsonb_typeof(item->'entered_on') IS DISTINCT FROM 'string' OR item->>'entered_on' !~ '{DATE}'
                OR (item->>'entered_on')::date > NEW.as_at
                OR (jsonb_typeof(item->'amount_paid') IS DISTINCT FROM 'string'
                    AND jsonb_typeof(item->'amount_paid') IS DISTINCT FROM 'null')
                OR (jsonb_typeof(item->'amount_paid') = 'string' AND item->>'amount_paid' !~ '{MONEY}')
                OR NOT EXISTS (SELECT 1 FROM tokens_registermember m WHERE m.uuid::text = item->>'member'
                    AND m.company_id = NEW.company_id))
            OR (SELECT count(DISTINCT item->>'member') FROM jsonb_array_elements(NEW.members) item)
                <> jsonb_array_length(NEW.members)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.former_members) item
                WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
                OR (SELECT array_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(item) key)
                    IS DISTINCT FROM {FORMER_KEYS}
                OR jsonb_typeof(item->'name') IS DISTINCT FROM 'string' OR length(btrim(item->>'name')) = 0
                OR jsonb_typeof(item->'residential_address') IS DISTINCT FROM 'string'
                OR length(btrim(item->>'residential_address')) = 0
                OR jsonb_typeof(item->'shares') IS DISTINCT FROM 'string' OR item->>'shares' !~ '{WHOLE}'
                OR jsonb_typeof(item->'ceased_on') IS DISTINCT FROM 'string' OR item->>'ceased_on' !~ '{DATE}'
                OR (item->>'ceased_on')::date > NEW.as_at
                OR ((item->>'ceased_on')::date < (SELECT e.effective_on FROM tokens_shareregister r
                    JOIN tokens_registerentry e ON e.register_id = r.uuid
                    WHERE r.token_id = NEW.token_id AND e.kind = 'opening')) IS NOT TRUE)
        THEN
            RAISE EXCEPTION 'Register imports require exact current intent and verified company evidence'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF current_user = %s OR OLD.status <> 'submitted' OR NEW.status NOT IN ('applied', 'rejected')
        OR (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'asic_issued_total',
            'asic_member_count', 'register_sequence', 'updated_at'])
            IS DISTINCT FROM
            (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'asic_issued_total',
            'asic_member_count', 'register_sequence', 'updated_at'])
        OR NEW.reviewed_at IS NULL OR NOT EXISTS (
            SELECT 1 FROM authentication_customuser WHERE id = NEW.reviewed_by_id AND is_active AND is_staff
        ) THEN
        RAISE EXCEPTION 'Only operator review may decide an immutable register import' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'applied' THEN
        SELECT count(*), sum((item->>'shares')::numeric) INTO member_count, imported_total
            FROM jsonb_array_elements(NEW.members) item;
        IF NEW.rejection_reason <> '' OR NEW.register_sequence IS NULL
            OR NEW.asic_issued_total IS DISTINCT FROM imported_total
            OR NEW.asic_member_count IS DISTINCT FROM member_count
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.members) item
                WHERE NOT EXISTS (SELECT 1 FROM tokens_registermemberparticulars p
                    JOIN tokens_registerimport source ON source.uuid = p.source_import_id
                    WHERE p.member_id::text = item->>'member' AND (p.source_import_id = NEW.uuid
                        OR (source.status = 'applied' AND source.as_at > NEW.as_at))))
        THEN
            RAISE EXCEPTION 'Application must match the ASIC figures and record every member''s particulars'
                USING ERRCODE = '23514';
        END IF;
    ELSIF length(btrim(NEW.rejection_reason)) = 0 OR NEW.asic_issued_total IS NOT NULL
        OR NEW.asic_member_count IS NOT NULL OR NEW.register_sequence IS NOT NULL THEN
        RAISE EXCEPTION 'Rejection requires a reason and records no figures' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
"""

OPENING_IMPORTS = (
    (
        """    imported_total numeric;
BEGIN
""",
        """    imported_total numeric;
    opening tokens_registerentry;
    expected_changes jsonb;
BEGIN
""",
    ),
    (
        """    IF TG_OP = 'INSERT' THEN
""",
        """    SELECT e.* INTO opening FROM tokens_shareregister r JOIN tokens_registerentry e ON e.register_id = r.uuid
        WHERE r.token_id = NEW.token_id AND e.kind = 'opening';
    IF TG_OP = 'INSERT' THEN
""",
    ),
    (
        """            OR NOT EXISTS (SELECT 1 FROM tokens_shareregister r JOIN tokens_registerentry e ON e.register_id = r.uuid
                WHERE r.token_id = NEW.token_id)
""",
        f"""            OR (opening.uuid IS NULL AND {APPROVED_OR_INSTRUCTED})
""",
    ),
    (
        """                OR NOT EXISTS (SELECT 1 FROM tokens_registermember m WHERE m.uuid::text = item->>'member'
                    AND m.company_id = NEW.company_id))
""",
        """                OR EXISTS (SELECT 1 FROM tokens_registermember m WHERE m.uuid::text = item->>'member'
                    AND m.company_id <> NEW.company_id)
                OR (opening.uuid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tokens_registermember m
                    WHERE m.uuid::text = item->>'member' AND m.company_id = NEW.company_id)))
""",
    ),
    (
        """                OR ((item->>'ceased_on')::date < (SELECT e.effective_on FROM tokens_shareregister r
                    JOIN tokens_registerentry e ON e.register_id = r.uuid
                    WHERE r.token_id = NEW.token_id AND e.kind = 'opening')) IS NOT TRUE)
""",
        """                OR (opening.uuid IS NOT NULL
                    AND ((item->>'ceased_on')::date < opening.effective_on) IS NOT TRUE))
""",
    ),
    (
        """            FROM jsonb_array_elements(NEW.members) item;
""",
        f"""            FROM jsonb_array_elements(NEW.members) item;
        SELECT COALESCE(jsonb_agg(jsonb_build_object('member', item->>'member', 'shares', item->>'shares')
                ORDER BY item->>'member' COLLATE "C"), '[]'::jsonb)
            INTO expected_changes FROM jsonb_array_elements(NEW.members) item;
        IF opening.uuid IS NULL OR (opening.operation_id = NEW.uuid AND (opening.sequence <> 1
            OR opening.corrects_id IS NOT NULL OR opening.previous_hash <> repeat('0', 64)
            OR opening.changes IS DISTINCT FROM expected_changes OR opening.effective_on <> NEW.as_at
            OR opening.recorded_by_id IS DISTINCT FROM NEW.reviewed_by_id
            OR NEW.register_sequence IS DISTINCT FROM 1
            OR EXISTS (SELECT 1 FROM tokens_registerentry e WHERE e.register_id = opening.register_id
                AND e.uuid <> opening.uuid)
            OR {APPROVED_OR_INSTRUCTED}))
        THEN
            RAISE EXCEPTION 'An opening import must record exactly the register''s only entry, with nothing approved'
                USING ERRCODE = '23514';
        END IF;
        IF opening.operation_id <> NEW.uuid AND EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.former_members) item
            WHERE (item->>'ceased_on')::date >= opening.effective_on)
        THEN
            RAISE EXCEPTION 'Imported former members must have ceased before the register''s opening'
                USING ERRCODE = '23514';
        END IF;
""",
    ),
)
OFF_CHAIN_INSTRUCTIONS = (
    (
        """    IF NEW.status = 'applied' THEN
""",
        f"""    IF NEW.status = 'applied' AND {OPENED_BY_IMPORT.format(scope=" AND i.token_id = NEW.token_id")} THEN
        RAISE EXCEPTION 'A share class opened by an import takes no register instruction until it is on chain'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'applied' THEN
""",
    ),
)
REFUSE_REVERSAL = f"""
DO $$ BEGIN
    LOCK TABLE tokens_registerimport IN ACCESS EXCLUSIVE MODE;
    IF {OPENED_BY_IMPORT.format(scope="")} THEN
        RAISE EXCEPTION 'Cannot restore guards that would admit register instructions for a register opened by an import';
    END IF;
END $$;
"""


def _replaced(sql, replacements):
    for old, new in replacements:
        if sql.count(old) != 1:
            raise RuntimeError("A guard no longer has the shape this migration extends.")
        sql = sql.replace(old, new)
    return sql


INSTRUCTION_GUARD_AS_0076_INSTALLED_IT = import_module("tokens.migrations.0076_transfer_instructions").TRANSFERS
IMPORT_GUARD = _replaced(IMPORT_GUARD_AS_0072_INSTALLED_IT, OPENING_IMPORTS)
INSTRUCTION_GUARD = _replaced(INSTRUCTION_GUARD_AS_0076_INSTALLED_IT, OFF_CHAIN_INSTRUCTIONS)


def _install(schema_editor, import_guard, instruction_guard):
    app = settings.RLS_ROLES["app"]
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(import_guard, [app])
        cursor.execute(instruction_guard, {"app": app})


def open_imports(apps, schema_editor):
    _install(schema_editor, IMPORT_GUARD, INSTRUCTION_GUARD)


def close_imports(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(REFUSE_REVERSAL)
    _install(schema_editor, IMPORT_GUARD_AS_0072_INSTALLED_IT, INSTRUCTION_GUARD_AS_0076_INSTALLED_IT)


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0076_transfer_instructions"),
    ]

    operations = [
        migrations.RunPython(open_imports, close_imports),
    ]
