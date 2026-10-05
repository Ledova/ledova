from importlib import import_module

from django.conf import settings
from django.db import migrations

OPENING_IMPORT = import_module("tokens.migrations.0077_import_opening")
IMPORT_GUARDS = import_module("tokens.migrations.0084_company_register_import_guards")

CORRECTION_GUARD_AS_0064_INSTALLED_IT = """
CREATE OR REPLACE FUNCTION tokens_guard_register_correction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    original tokens_registerentry;
    applied tokens_registerentry;
    head tokens_shareregister;
    owner bigint;
    inverse jsonb;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain correction proposals and their authority evidence' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT owner_id INTO owner FROM companies_company WHERE uuid = NEW.company_id FOR KEY SHARE;
        SELECT * INTO head FROM tokens_shareregister WHERE uuid = NEW.register_id FOR UPDATE;
        SELECT * INTO original FROM tokens_registerentry WHERE uuid = NEW.corrects_id;
        SELECT jsonb_agg(jsonb_build_object('member', value->>'member',
            'shares', (-(value->>'shares')::numeric)::text) ORDER BY value->>'member')
            INTO inverse FROM jsonb_array_elements(original.changes);
        IF NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.applied_entry_id IS NOT NULL OR NEW.rejection_reason <> ''
            OR owner IS DISTINCT FROM NEW.submitted_by_id
            OR head.company_id IS DISTINCT FROM NEW.company_id
            OR original.register_id IS DISTINCT FROM NEW.register_id
            OR NEW.base_sequence IS DISTINCT FROM head.sequence OR NEW.base_hash IS DISTINCT FROM head.head_hash
            OR inverse IS NULL OR NEW.changes IS DISTINCT FROM inverse
            OR EXISTS (SELECT 1 FROM tokens_registerentry WHERE corrects_id = NEW.corrects_id)
            OR NEW.authority NOT IN ('director_resolution', 'court_order')
            OR (NEW.authority = 'director_resolution') <> (length(btrim(NEW.approving_director)) > 0)
            OR length(btrim(NEW.authority_reference)) = 0 OR length(btrim(NEW.reason)) = 0
            OR NEW.evidence_fingerprint !~ '^[0-9a-f]{64}$'
            OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-corrections/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
            OR NOT EXISTS (SELECT 1 FROM companies_companydocument doc WHERE doc.uuid = NEW.source_document
                AND doc.company_id = NEW.company_id AND doc.is_verified AND doc.verified_by_id IS NOT NULL
                AND doc.verified_fingerprint = NEW.evidence_fingerprint)
            OR NEW.evidence_snapshot->>'document' IS DISTINCT FROM NEW.source_document::text
            OR NEW.evidence_snapshot->>'company' IS DISTINCT FROM NEW.company_id::text
            OR COALESCE(NEW.evidence_snapshot->>'sha256', '') !~ '^[0-9a-f]{64}$'
        THEN
            RAISE EXCEPTION 'Correction submissions require exact current intent and verified company evidence'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF current_user = %s OR OLD.status <> 'submitted'
            OR NEW.status NOT IN ('applied', 'rejected')
            OR (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'applied_entry_id', 'updated_at'])
                IS DISTINCT FROM
                (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'applied_entry_id', 'updated_at'])
            OR NEW.reviewed_at IS NULL OR NOT EXISTS (
                SELECT 1 FROM authentication_customuser WHERE id = NEW.reviewed_by_id AND is_active AND is_staff
            ) THEN
            RAISE EXCEPTION 'Only operator review may decide an immutable correction submission' USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'applied' THEN
            SELECT * INTO applied FROM tokens_registerentry WHERE uuid = NEW.applied_entry_id;
            IF applied.uuid IS NULL OR applied.register_id <> NEW.register_id OR applied.kind <> 'correction'
                OR applied.operation_id <> NEW.uuid OR applied.corrects_id IS DISTINCT FROM NEW.corrects_id
                OR applied.changes IS DISTINCT FROM NEW.changes OR applied.effective_on <> NEW.effective_on
                OR applied.recorded_by_id <> NEW.reviewed_by_id
                OR applied.previous_hash <> NEW.base_hash OR applied.sequence <> NEW.base_sequence + 1
                OR NEW.rejection_reason <> '' THEN
                RAISE EXCEPTION 'Approval must record the matching compensating entry' USING ERRCODE = '23514';
            END IF;
        ELSIF NEW.applied_entry_id IS NOT NULL OR length(btrim(NEW.rejection_reason)) = 0 THEN
            RAISE EXCEPTION 'Rejection requires a reason and no applied entry' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
"""

EVIDENCE_GUARD_AS_0084_INSTALLED_IT = """
CREATE OR REPLACE FUNCTION tokens_guard_register_evidence() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    principal bigint;
    at_time timestamptz;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain company-provided register evidence' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
        OR NEW.uploaded_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_evidence'
        OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
        OR NEW.kind NOT IN ('share_register', 'asic_extract') OR NEW.sha256 !~ '^[0-9a-f]{64}$'
        OR NEW.file_size <= 0 OR NEW.mime_type NOT IN ('application/pdf', 'image/png', 'image/jpeg')
        OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-evidence/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
        OR NOT tokens_register_appointment_current(NEW.appointment_id, NEW.company_id, principal, 'prepare', at_time)
    THEN
        RAISE EXCEPTION 'Register evidence needs its uploader''s current preparation authority'
            USING ERRCODE = '23514';
    END IF;
    NEW.created_at := at_time;
    NEW.updated_at := at_time;
    RETURN NEW;
END;
$$;
"""

FUNCTIONS = """
CREATE FUNCTION tokens_register_correction_approved(correction_uuid uuid, at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_registercorrectiondecision decision
        JOIN tokens_registercorrection proposal ON proposal.uuid = decision.register_correction_id
        WHERE decision.register_correction_id = correction_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
                decision.decided_by_id, 'approve', at_time));
$$;
CREATE FUNCTION tokens_register_correction_decision_digest(correction_uuid uuid, decision_kind text, actor bigint,
    appointment_uuid uuid, decision_reason text) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT encode(sha256(convert_to(jsonb_build_object('version', '1', 'correction', correction_uuid::text,
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid::text, 'reason', decision_reason,
        'register', CASE WHEN decision_kind = 'apply' THEN (SELECT jsonb_build_object('sequence', register.sequence,
            'head', register.head_hash) FROM tokens_shareregister register
            JOIN tokens_registercorrection proposal ON proposal.register_id = register.uuid
            WHERE proposal.uuid = correction_uuid) END)::text, 'UTF8')), 'hex');
$$;
CREATE FUNCTION tokens_guard_register_correction_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    principal bigint;
    at_time timestamptz;
    proposal tokens_registercorrection;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Register correction decisions are append-only' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    SELECT * INTO proposal FROM tokens_registercorrection WHERE uuid = NEW.register_correction_id;
    PERFORM 1 FROM companies_company WHERE uuid = proposal.company_id FOR UPDATE;
    SELECT * INTO proposal FROM tokens_registercorrection WHERE uuid = NEW.register_correction_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR NEW.decided_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_correction_' || NEW.kind
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR proposal.status <> 'submitted' OR NEW.kind NOT IN ('approve', 'apply', 'reject')
        OR (NEW.kind = 'reject') <> (length(btrim(NEW.reason)) > 0)
        OR (NEW.kind <> 'reject' AND proposal.preparing_appointment_id IS NULL)
        OR NEW.digest IS DISTINCT FROM tokens_register_correction_decision_digest(proposal.uuid, NEW.kind,
            principal, NEW.appointment_id, NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'approve' AND tokens_register_correction_approved(proposal.uuid, at_time))
        OR (NEW.kind = 'apply' AND NOT tokens_register_correction_approved(proposal.uuid, at_time))
    THEN
        RAISE EXCEPTION 'Register correction decisions need the exact current company authority'
            USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := at_time;
    NEW.created_at := at_time;
    NEW.updated_at := at_time;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_correction_decision_guard
    BEFORE INSERT OR UPDATE OR DELETE ON tokens_registercorrectiondecision
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_correction_decision();
CREATE FUNCTION tokens_check_register_correction_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    proposal tokens_registercorrection;
BEGIN
    SELECT * INTO proposal FROM tokens_registercorrection WHERE uuid = NEW.register_correction_id;
    IF (NEW.kind = 'approve' AND proposal.status <> 'submitted')
        OR (NEW.kind <> 'approve' AND (proposal.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END
            OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id
            OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR (NEW.kind = 'reject' AND proposal.rejection_reason IS DISTINCT FROM NEW.reason)))
    THEN
        RAISE EXCEPTION 'A register correction decision must carry exactly its own effect' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_register_correction_decision_effect
    AFTER INSERT ON tokens_registercorrectiondecision DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION tokens_check_register_correction_decision();
"""

REMOVE_FUNCTIONS = """
DROP TRIGGER tokens_register_correction_decision_effect ON tokens_registercorrectiondecision;
DROP FUNCTION tokens_check_register_correction_decision();
DROP TRIGGER tokens_register_correction_decision_guard ON tokens_registercorrectiondecision;
DROP FUNCTION tokens_guard_register_correction_decision();
DROP FUNCTION tokens_register_correction_decision_digest(uuid, text, bigint, uuid, text);
DROP FUNCTION tokens_register_correction_approved(uuid, timestamptz);
"""

AUTHORITY_UPLOADS = (
    (
        """        OR NEW.kind NOT IN ('share_register', 'asic_extract') OR NEW.sha256 !~ '^[0-9a-f]{64}$'
""",
        """        OR NEW.kind NOT IN ('share_register', 'asic_extract', 'authority') OR NEW.sha256 !~ '^[0-9a-f]{64}$'
""",
    ),
)

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
        SELECT owner_id INTO owner FROM companies_company WHERE uuid = NEW.company_id FOR KEY SHARE;
""",
        """    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    IF TG_OP = 'INSERT' THEN
        PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
        SELECT * INTO authority_copy FROM tokens_registerevidence WHERE uuid = NEW.authority_evidence_id;
""",
    ),
    (
        """        IF NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.applied_entry_id IS NOT NULL OR NEW.rejection_reason <> ''
            OR owner IS DISTINCT FROM NEW.submitted_by_id
""",
        """        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
            OR NEW.submitted_by_id IS DISTINCT FROM principal
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_correction_prepare'
            OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal,
                'prepare', at_time)
            OR NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.applied_entry_id IS NOT NULL OR NEW.rejection_reason <> ''
""",
    ),
    (
        """            OR length(btrim(NEW.authority_reference)) = 0 OR length(btrim(NEW.reason)) = 0
""",
        """            OR length(btrim(NEW.authority_reference)) = 0 OR length(btrim(NEW.reason)) = 0
            OR NEW.effective_on > current_date
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
        THEN
            RAISE EXCEPTION 'Correction submissions require exact current intent and verified company evidence'
""",
        """            OR authority_copy.uuid IS NULL OR authority_copy.company_id <> NEW.company_id
            OR authority_copy.kind <> 'authority' OR authority_copy.uploaded_by_id <> principal
            OR NEW.evidence_fingerprint IS DISTINCT FROM authority_copy.sha256
            OR NEW.evidence_snapshot IS DISTINCT FROM tokens_register_evidence_snapshot(authority_copy)
        THEN
            RAISE EXCEPTION 'Correction preparations require exact current intent, company authority and evidence'
""",
    ),
    (
        """        IF current_user = %s OR OLD.status <> 'submitted'
""",
        """        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR OLD.status <> 'submitted'
""",
    ),
    (
        """            OR NEW.reviewed_at IS NULL OR NOT EXISTS (
                SELECT 1 FROM authentication_customuser WHERE id = NEW.reviewed_by_id AND is_active AND is_staff
            ) THEN
            RAISE EXCEPTION 'Only operator review may decide an immutable correction submission' USING ERRCODE = '23514';
""",
        """            OR NEW.reviewed_at IS NULL OR NEW.reviewed_by_id IS DISTINCT FROM principal
            OR NOT EXISTS (SELECT 1 FROM tokens_registercorrectiondecision decision
                WHERE decision.register_correction_id = NEW.uuid AND decision.decided_by_id = NEW.reviewed_by_id
                    AND decision.decided_at = NEW.reviewed_at
                    AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
                    AND (NEW.status = 'applied' OR decision.reason = NEW.rejection_reason))
        THEN
            RAISE EXCEPTION 'Only the exact company decision may decide an immutable correction'
                USING ERRCODE = '23514';
""",
    ),
    (
        """                RAISE EXCEPTION 'Approval must record the matching compensating entry' USING ERRCODE = '23514';
""",
        """                RAISE EXCEPTION 'Application must record the matching compensating entry' USING ERRCODE = '23514';
""",
    ),
)
CORRECTION_GUARD = OPENING_IMPORT._replaced(CORRECTION_GUARD_AS_0064_INSTALLED_IT, COMPANY_RUN)
EVIDENCE_GUARD = OPENING_IMPORT._replaced(EVIDENCE_GUARD_AS_0084_INSTALLED_IT, AUTHORITY_UPLOADS)
REFUSE_REVERSAL = """
DO $$ BEGIN
    LOCK TABLE tokens_registercorrection, tokens_registercorrectiondecision, tokens_registerevidence
        IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM tokens_registerevidence WHERE kind = 'authority')
        OR EXISTS (SELECT 1 FROM tokens_registercorrectiondecision)
        OR EXISTS (SELECT 1 FROM tokens_registercorrection WHERE preparing_appointment_id IS NOT NULL)
    THEN
        RAISE EXCEPTION 'Retain company register corrections, their decisions and authority evidence';
    END IF;
END $$;
"""


def install_company_corrections(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(IMPORT_GUARDS._with_roles(cursor, FUNCTIONS))
        cursor.execute(IMPORT_GUARDS._with_roles(cursor, EVIDENCE_GUARD))
        cursor.execute(IMPORT_GUARDS._with_roles(cursor, CORRECTION_GUARD))


def remove_company_corrections(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(REFUSE_REVERSAL)
        cursor.execute(CORRECTION_GUARD_AS_0064_INSTALLED_IT, [settings.RLS_ROLES["app"]])
        cursor.execute(IMPORT_GUARDS._with_roles(cursor, EVIDENCE_GUARD_AS_0084_INSTALLED_IT))
        cursor.execute(REMOVE_FUNCTIONS)


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0085_company_register_corrections"),
    ]

    operations = [
        migrations.RunPython(install_company_corrections, remove_company_corrections),
    ]
