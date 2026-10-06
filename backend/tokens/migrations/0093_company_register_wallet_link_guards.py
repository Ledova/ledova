from importlib import import_module

from django.conf import settings
from django.db import migrations

OPENING_IMPORT = import_module("tokens.migrations.0077_import_opening")
IMPORT_GUARDS = import_module("tokens.migrations.0084_company_register_import_guards")

LINK_GUARD_AS_0067_INSTALLED_IT = """
CREATE OR REPLACE FUNCTION tokens_guard_register_wallet_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    owner bigint;
    mapping_count bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain wallet link requests and their authority evidence' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF jsonb_typeof(NEW.mapping) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'Wallet link requests require exact current intent and verified company evidence'
                USING ERRCODE = '23514';
        END IF;
        SELECT owner_id INTO owner FROM companies_company WHERE uuid = NEW.company_id FOR KEY SHARE;
        SELECT count(*) INTO mapping_count FROM jsonb_array_elements(NEW.mapping);
        IF NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.rejection_reason <> '' OR owner IS DISTINCT FROM NEW.submitted_by_id
            OR NEW.authority NOT IN ('director_resolution', 'court_order')
            OR (NEW.authority = 'director_resolution') <> (length(btrim(NEW.approving_director)) > 0)
            OR length(btrim(NEW.authority_reference)) = 0 OR length(btrim(NEW.reason)) = 0
            OR NEW.evidence_fingerprint !~ '^[0-9a-f]{64}$'
            OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-links/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
            OR NOT EXISTS (SELECT 1 FROM companies_companydocument doc WHERE doc.uuid = NEW.source_document
                AND doc.company_id = NEW.company_id AND doc.is_verified AND doc.verified_by_id IS NOT NULL
                AND doc.verified_fingerprint = NEW.evidence_fingerprint)
            OR NEW.evidence_snapshot->>'document' IS DISTINCT FROM NEW.source_document::text
            OR NEW.evidence_snapshot->>'company' IS DISTINCT FROM NEW.company_id::text
            OR COALESCE(NEW.evidence_snapshot->>'sha256', '') !~ '^[0-9a-f]{64}$'
            OR mapping_count = 0
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                WHERE jsonb_typeof(item) <> 'object'
                OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 2
                OR NOT (item ? 'address' AND item ? 'member')
                OR jsonb_typeof(item->'address') IS DISTINCT FROM 'string'
                OR jsonb_typeof(item->'member') IS DISTINCT FROM 'string'
                OR item->>'address' !~ '^0x[0-9a-fA-F]{40}$'
                OR item->>'member' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
            OR mapping_count <>
               (SELECT count(DISTINCT lower(item->>'address')) FROM jsonb_array_elements(NEW.mapping) item)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                JOIN tokens_registermember m ON m.uuid::text = item->>'member'
                WHERE m.company_id IS DISTINCT FROM NEW.company_id)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                JOIN tokens_registermemberwallet w ON w.company_id = NEW.company_id
                    AND lower(w.address) = lower(item->>'address'))
        THEN
            RAISE EXCEPTION 'Wallet link requests require exact current intent and verified company evidence'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF current_user = %s OR OLD.status <> 'submitted'
        OR NEW.status NOT IN ('applied', 'rejected')
        OR (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
            IS DISTINCT FROM
            (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
        OR NEW.reviewed_at IS NULL OR NOT EXISTS (
            SELECT 1 FROM authentication_customuser WHERE id = NEW.reviewed_by_id AND is_active AND is_staff
        ) THEN
        RAISE EXCEPTION 'Only operator review may decide an immutable wallet link request' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'applied' THEN
        IF NEW.rejection_reason <> '' OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
            WHERE NOT EXISTS (SELECT 1 FROM tokens_registermemberwallet w
                WHERE w.company_id = NEW.company_id AND lower(w.address) = lower(item->>'address')
                AND w.member_id::text = item->>'member')
            OR NOT EXISTS (SELECT 1 FROM tokens_registermember m
                WHERE m.uuid::text = item->>'member' AND m.company_id = NEW.company_id))
        THEN
            RAISE EXCEPTION 'Approval must link every mapped wallet to its member' USING ERRCODE = '23514';
        END IF;
    ELSIF length(btrim(NEW.rejection_reason)) = 0 THEN
        RAISE EXCEPTION 'Rejection requires a reason' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
"""

FUNCTIONS = """
CREATE FUNCTION tokens_register_link_approved(link_uuid uuid, at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_registerwalletlinkdecision decision
        JOIN tokens_registerwalletlink proposal ON proposal.uuid = decision.register_wallet_link_id
        WHERE decision.register_wallet_link_id = link_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
                decision.decided_by_id, 'approve', at_time));
$$;
CREATE FUNCTION tokens_register_link_decision_digest(link_uuid uuid, decision_kind text, actor bigint,
    appointment_uuid uuid, decision_reason text) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT encode(sha256(convert_to(jsonb_build_object('version', '1', 'link', link_uuid::text,
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid::text, 'reason', decision_reason,
        'links', CASE WHEN decision_kind = 'apply' THEN (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'address', lower(wallet.address), 'member', wallet.member_id::text) ORDER BY lower(wallet.address)),
                '[]'::jsonb)
            FROM tokens_registerwalletlink proposal
            CROSS JOIN LATERAL jsonb_array_elements(proposal.mapping) item
            JOIN tokens_registermemberwallet wallet ON wallet.company_id = proposal.company_id
                AND lower(wallet.address) = lower(item->>'address')
            WHERE proposal.uuid = link_uuid) END)::text, 'UTF8')), 'hex');
$$;
CREATE FUNCTION tokens_guard_register_link_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    principal bigint;
    at_time timestamptz;
    proposal tokens_registerwalletlink;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Register wallet link decisions are append-only' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    SELECT * INTO proposal FROM tokens_registerwalletlink WHERE uuid = NEW.register_wallet_link_id;
    PERFORM 1 FROM companies_company WHERE uuid = proposal.company_id FOR UPDATE;
    SELECT * INTO proposal FROM tokens_registerwalletlink WHERE uuid = NEW.register_wallet_link_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR NEW.decided_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_link_' || NEW.kind
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR proposal.status <> 'submitted' OR NEW.kind NOT IN ('approve', 'apply', 'reject')
        OR (NEW.kind = 'reject') <> (NEW.reason ~ '[^[:space:]]')
        OR (NEW.kind <> 'reject' AND proposal.preparing_appointment_id IS NULL)
        OR NEW.digest IS DISTINCT FROM tokens_register_link_decision_digest(proposal.uuid, NEW.kind, principal,
            NEW.appointment_id, NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'approve' AND tokens_register_link_approved(proposal.uuid, at_time))
        OR (NEW.kind = 'apply' AND NOT tokens_register_link_approved(proposal.uuid, at_time))
    THEN
        RAISE EXCEPTION 'Register wallet link decisions need the exact current company authority'
            USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := at_time;
    NEW.created_at := at_time;
    NEW.updated_at := at_time;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_link_decision_guard
    BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerwalletlinkdecision
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_link_decision();
CREATE FUNCTION tokens_check_register_link_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    proposal tokens_registerwalletlink;
BEGIN
    SELECT * INTO proposal FROM tokens_registerwalletlink WHERE uuid = NEW.register_wallet_link_id;
    IF (NEW.kind = 'approve' AND proposal.status <> 'submitted')
        OR (NEW.kind <> 'approve' AND (proposal.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END
            OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id
            OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR (NEW.kind = 'reject' AND proposal.rejection_reason IS DISTINCT FROM NEW.reason)))
    THEN
        RAISE EXCEPTION 'A register wallet link decision must carry exactly its own effect' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_register_link_decision_effect
    AFTER INSERT ON tokens_registerwalletlinkdecision DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION tokens_check_register_link_decision();
"""

REMOVE_FUNCTIONS = """
DROP TRIGGER tokens_register_link_decision_effect ON tokens_registerwalletlinkdecision;
DROP FUNCTION tokens_check_register_link_decision();
DROP TRIGGER tokens_register_link_decision_guard ON tokens_registerwalletlinkdecision;
DROP FUNCTION tokens_guard_register_link_decision();
DROP FUNCTION tokens_register_link_decision_digest(uuid, text, bigint, uuid, text);
DROP FUNCTION tokens_register_link_approved(uuid, timestamptz);
"""

COMPANY_RUN = (
    (
        """    owner bigint;
""",
        """    principal bigint;
    at_time timestamptz;
    authority_copy tokens_registerevidence;
""",
    ),
    (
        """    IF TG_OP = 'INSERT' THEN
        IF jsonb_typeof(NEW.mapping) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'Wallet link requests require exact current intent and verified company evidence'
                USING ERRCODE = '23514';
        END IF;
        SELECT owner_id INTO owner FROM companies_company WHERE uuid = NEW.company_id FOR KEY SHARE;
""",
        """    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    IF TG_OP = 'INSERT' THEN
        IF jsonb_typeof(NEW.mapping) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'Wallet link preparations require exact current intent, company authority and evidence'
                USING ERRCODE = '23514';
        END IF;
        PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
        SELECT * INTO authority_copy FROM tokens_registerevidence WHERE uuid = NEW.authority_evidence_id;
""",
    ),
    (
        """        IF NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.rejection_reason <> '' OR owner IS DISTINCT FROM NEW.submitted_by_id
""",
        """        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
            OR NEW.submitted_by_id IS DISTINCT FROM principal
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_link_prepare'
            OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal,
                'prepare', at_time)
            OR NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.rejection_reason <> ''
""",
    ),
    (
        """            OR NEW.evidence_fingerprint !~ '^[0-9a-f]{64}$'
""",
        "",
    ),
    (
        """            OR NOT EXISTS (SELECT 1 FROM companies_companydocument doc WHERE doc.uuid = NEW.source_document
                AND doc.company_id = NEW.company_id AND doc.is_verified AND doc.verified_by_id IS NOT NULL
                AND doc.verified_fingerprint = NEW.evidence_fingerprint)
            OR NEW.evidence_snapshot->>'document' IS DISTINCT FROM NEW.source_document::text
            OR NEW.evidence_snapshot->>'company' IS DISTINCT FROM NEW.company_id::text
            OR COALESCE(NEW.evidence_snapshot->>'sha256', '') !~ '^[0-9a-f]{64}$'
""",
        """            OR authority_copy.uuid IS NULL OR authority_copy.company_id <> NEW.company_id
            OR authority_copy.kind <> 'authority' OR authority_copy.uploaded_by_id <> principal
            OR NEW.evidence_fingerprint IS DISTINCT FROM authority_copy.sha256
            OR NEW.evidence_snapshot IS DISTINCT FROM tokens_register_evidence_snapshot(authority_copy)
""",
    ),
    (
        """        THEN
            RAISE EXCEPTION 'Wallet link requests require exact current intent and verified company evidence'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
""",
        """        THEN
            RAISE EXCEPTION 'Wallet link preparations require exact current intent, company authority and evidence'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
""",
    ),
    (
        """    IF current_user = %s OR OLD.status <> 'submitted'
""",
        """    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR OLD.status <> 'submitted'
""",
    ),
    (
        """        OR NEW.reviewed_at IS NULL OR NOT EXISTS (
            SELECT 1 FROM authentication_customuser WHERE id = NEW.reviewed_by_id AND is_active AND is_staff
        ) THEN
        RAISE EXCEPTION 'Only operator review may decide an immutable wallet link request' USING ERRCODE = '23514';
""",
        """        OR NEW.reviewed_at IS NULL OR NEW.reviewed_by_id IS DISTINCT FROM principal
        OR NOT EXISTS (SELECT 1 FROM tokens_registerwalletlinkdecision decision
            WHERE decision.register_wallet_link_id = NEW.uuid AND decision.decided_by_id = NEW.reviewed_by_id
                AND decision.decided_at = NEW.reviewed_at
                AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
                AND (NEW.status = 'applied' OR decision.reason = NEW.rejection_reason))
    THEN
        RAISE EXCEPTION 'Only the exact company decision may decide an immutable wallet link'
            USING ERRCODE = '23514';
""",
    ),
    (
        """            RAISE EXCEPTION 'Approval must link every mapped wallet to its member' USING ERRCODE = '23514';
""",
        """            RAISE EXCEPTION 'Application must link every mapped wallet to its member' USING ERRCODE = '23514';
""",
    ),
)
LINK_GUARD = OPENING_IMPORT._replaced(LINK_GUARD_AS_0067_INSTALLED_IT, COMPANY_RUN)
REFUSE_REVERSAL = """
DO $$ BEGIN
    LOCK TABLE tokens_registerwalletlink, tokens_registerwalletlinkdecision IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM tokens_registerwalletlinkdecision)
        OR EXISTS (SELECT 1 FROM tokens_registerwalletlink WHERE preparing_appointment_id IS NOT NULL)
    THEN
        RAISE EXCEPTION 'Retain company wallet links, their decisions and authority evidence';
    END IF;
END $$;
"""


def install_company_links(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(IMPORT_GUARDS._with_roles(cursor, FUNCTIONS))
        cursor.execute(IMPORT_GUARDS._with_roles(cursor, LINK_GUARD))
        cursor.execute(
            "ALTER FUNCTION tokens_guard_register_wallet_link() SET search_path = pg_catalog, public, pg_temp"
        )


def remove_company_links(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(REFUSE_REVERSAL)
        cursor.execute(LINK_GUARD_AS_0067_INSTALLED_IT, [settings.RLS_ROLES["app"]])
        cursor.execute(REMOVE_FUNCTIONS)


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0092_company_register_wallet_links"),
    ]

    operations = [
        migrations.RunPython(install_company_links, remove_company_links),
    ]
