from importlib import import_module

from django.conf import settings
from django.db import migrations

OPENING_IMPORT = import_module("tokens.migrations.0077_import_opening")
IMPORT_GUARD_AS_0077_INSTALLED_IT = OPENING_IMPORT.IMPORT_GUARD

FUNCTIONS = """
CREATE FUNCTION tokens_register_appointment_current(appointment_uuid uuid, issuer uuid, actor bigint,
    capability text, at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM companies_companyappointment appointment
        JOIN authentication_customuser person ON person.id = appointment.appointee_id
        JOIN users_userprofile profile ON profile.uuid = appointment.appointee_profile_id
            AND profile.user_id = person.id
        JOIN operators_operator configuration ON configuration.id = 1
        WHERE appointment.uuid = appointment_uuid AND appointment.company_id = issuer
            AND appointment.appointee_id = actor AND person.is_active AND person.is_email_verified
            AND (appointment.expires_at IS NULL OR appointment.expires_at > at_time)
            AND NOT EXISTS (SELECT 1 FROM companies_companyappointmentrevocation revocation
                WHERE revocation.appointment_id = appointment.uuid)
            AND (NOT configuration.issuer_kyc_required OR profile.is_id_verified)
            AND (appointment.capabilities @> jsonb_build_array('admin')
                OR appointment.capabilities @> jsonb_build_array(capability)));
$$;
CREATE FUNCTION tokens_register_evidence_snapshot(evidence tokens_registerevidence) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT jsonb_build_object('provided_by', 'company', 'evidence', evidence.uuid::text,
        'company', evidence.company_id::text, 'document_type', evidence.kind, 'name', evidence.original_filename,
        'file_size', evidence.file_size, 'mime_type', evidence.mime_type, 'sha256', evidence.sha256);
$$;
CREATE FUNCTION tokens_register_import_approved(import_uuid uuid, at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_registerimportdecision decision
        JOIN tokens_registerimport proposal ON proposal.uuid = decision.register_import_id
        WHERE decision.register_import_id = import_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
                decision.decided_by_id, 'approve', at_time));
$$;
CREATE FUNCTION tokens_register_import_decision_digest(import_uuid uuid, decision_kind text, actor bigint,
    appointment_uuid uuid, decision_reason text) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT encode(sha256(convert_to(jsonb_build_object('version', '1', 'import', import_uuid::text,
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid::text, 'reason', decision_reason,
        'register', CASE WHEN decision_kind = 'apply' THEN (SELECT jsonb_build_object('sequence', register.sequence,
            'head', register.head_hash) FROM tokens_shareregister register
            JOIN tokens_registerimport proposal ON proposal.token_id = register.token_id
            WHERE proposal.uuid = import_uuid) END)::text, 'UTF8')), 'hex');
$$;
CREATE FUNCTION tokens_guard_register_evidence() RETURNS trigger
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
CREATE TRIGGER tokens_register_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerevidence
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_evidence();
CREATE FUNCTION tokens_guard_register_import_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    principal bigint;
    at_time timestamptz;
    proposal tokens_registerimport;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Register import decisions are append-only' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    SELECT * INTO proposal FROM tokens_registerimport WHERE uuid = NEW.register_import_id;
    PERFORM 1 FROM companies_company WHERE uuid = proposal.company_id FOR UPDATE;
    SELECT * INTO proposal FROM tokens_registerimport WHERE uuid = NEW.register_import_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR NEW.decided_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_import_' || NEW.kind
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR proposal.status <> 'submitted' OR NEW.kind NOT IN ('approve', 'apply', 'reject')
        OR (NEW.kind = 'reject') <> (length(btrim(NEW.reason)) > 0)
        OR (NEW.kind <> 'reject' AND proposal.preparing_appointment_id IS NULL)
        OR NEW.digest IS DISTINCT FROM tokens_register_import_decision_digest(proposal.uuid, NEW.kind, principal,
            NEW.appointment_id, NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'approve' AND tokens_register_import_approved(proposal.uuid, at_time))
        OR (NEW.kind = 'apply' AND NOT tokens_register_import_approved(proposal.uuid, at_time))
    THEN
        RAISE EXCEPTION 'Register import decisions need the exact current company authority'
            USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := at_time;
    NEW.created_at := at_time;
    NEW.updated_at := at_time;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_import_decision_guard
    BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerimportdecision
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_import_decision();
CREATE FUNCTION tokens_check_register_import_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    proposal tokens_registerimport;
BEGIN
    SELECT * INTO proposal FROM tokens_registerimport WHERE uuid = NEW.register_import_id;
    IF (NEW.kind = 'approve' AND proposal.status <> 'submitted')
        OR (NEW.kind <> 'approve' AND (proposal.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END
            OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id
            OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR (NEW.kind = 'reject' AND proposal.rejection_reason IS DISTINCT FROM NEW.reason)))
    THEN
        RAISE EXCEPTION 'A register import decision must carry exactly its own effect' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_register_import_decision_effect
    AFTER INSERT ON tokens_registerimportdecision DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION tokens_check_register_import_decision();
"""

REMOVE_FUNCTIONS = """
DROP TRIGGER tokens_register_import_decision_effect ON tokens_registerimportdecision;
DROP FUNCTION tokens_check_register_import_decision();
DROP TRIGGER tokens_register_import_decision_guard ON tokens_registerimportdecision;
DROP FUNCTION tokens_guard_register_import_decision();
DROP TRIGGER tokens_register_evidence_guard ON tokens_registerevidence;
DROP FUNCTION tokens_guard_register_evidence();
DROP FUNCTION tokens_register_import_decision_digest(uuid, text, bigint, uuid, text);
DROP FUNCTION tokens_register_import_approved(uuid, timestamptz);
DROP FUNCTION tokens_register_evidence_snapshot(tokens_registerevidence);
DROP FUNCTION tokens_register_appointment_current(uuid, uuid, bigint, text, timestamptz);
"""

COMPANY_RUN = (
    (
        """DECLARE
    owner bigint;
    member_count bigint;
""",
        """DECLARE
    principal bigint;
    at_time timestamptz;
    register_copy tokens_registerevidence;
    asic_copy tokens_registerevidence;
    member_count bigint;
""",
    ),
    (
        """    IF TG_OP = 'INSERT' THEN
        SELECT owner_id INTO owner FROM companies_company WHERE uuid = NEW.company_id FOR KEY SHARE;
        IF NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.rejection_reason <> '' OR NEW.asic_issued_total IS NOT NULL OR NEW.asic_member_count IS NOT NULL
            OR NEW.register_sequence IS NOT NULL OR owner IS DISTINCT FROM NEW.submitted_by_id
""",
        """    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    IF TG_OP = 'INSERT' THEN
        PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
        SELECT * INTO register_copy FROM tokens_registerevidence WHERE uuid = NEW.register_evidence_id;
        SELECT * INTO asic_copy FROM tokens_registerevidence WHERE uuid = NEW.asic_evidence_id;
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
            OR NEW.submitted_by_id IS DISTINCT FROM principal
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_import_prepare'
            OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal,
                'prepare', at_time)
            OR NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.rejection_reason <> '' OR NEW.register_sequence IS NOT NULL
            OR NEW.source_document IS NOT NULL OR NEW.asic_document IS NOT NULL
            OR register_copy.uuid IS NULL OR register_copy.company_id <> NEW.company_id
            OR register_copy.kind <> 'share_register' OR register_copy.uploaded_by_id <> principal
            OR asic_copy.uuid IS NULL OR asic_copy.company_id <> NEW.company_id
            OR asic_copy.kind <> 'asic_extract' OR asic_copy.uploaded_by_id <> principal
            OR NEW.evidence_fingerprint IS DISTINCT FROM register_copy.sha256
            OR NEW.asic_fingerprint IS DISTINCT FROM asic_copy.sha256
            OR NEW.evidence_snapshot IS DISTINCT FROM tokens_register_evidence_snapshot(register_copy)
            OR NEW.asic_snapshot IS DISTINCT FROM tokens_register_evidence_snapshot(asic_copy)
            OR NEW.asic_file IS NOT DISTINCT FROM NEW.file
            OR NEW.asic_file !~ ('^companies/' || NEW.company_id || '/register-imports/' || NEW.uuid
                || '/[0-9a-f-]{36}[.]bin$')
""",
    ),
    (
        """            OR NOT EXISTS (SELECT 1 FROM companies_companydocument doc WHERE doc.uuid = NEW.source_document
                AND doc.company_id = NEW.company_id AND doc.document_type = 'share_register' AND doc.is_verified
                AND doc.verified_by_id IS NOT NULL AND doc.verified_fingerprint = NEW.evidence_fingerprint)
            OR NOT EXISTS (SELECT 1 FROM companies_companydocument doc WHERE doc.uuid = NEW.asic_document
                AND doc.company_id = NEW.company_id AND doc.document_type = 'asic' AND doc.is_verified
                AND doc.verified_by_id IS NOT NULL AND doc.verified_fingerprint = NEW.asic_fingerprint)
            OR NEW.evidence_snapshot->>'document' IS DISTINCT FROM NEW.source_document::text
            OR NEW.evidence_snapshot->>'company' IS DISTINCT FROM NEW.company_id::text
            OR COALESCE(NEW.evidence_snapshot->>'sha256', '') !~ '^[0-9a-f]{64}$'
""",
        "",
    ),
    (
        """        THEN
            RAISE EXCEPTION 'Register imports require exact current intent and verified company evidence'
""",
        """            OR NEW.asic_issued_total IS DISTINCT FROM (SELECT sum((item->>'shares')::numeric)
                FROM jsonb_array_elements(NEW.members) item)
            OR NEW.asic_member_count IS DISTINCT FROM jsonb_array_length(NEW.members)
        THEN
            RAISE EXCEPTION 'Register imports require exact current intent, company authority and evidence'
""",
    ),
    (
        """    IF current_user = %s OR OLD.status <> 'submitted' OR NEW.status NOT IN ('applied', 'rejected')
        OR (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'asic_issued_total',
            'asic_member_count', 'register_sequence', 'updated_at'])
            IS DISTINCT FROM
            (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'asic_issued_total',
            'asic_member_count', 'register_sequence', 'updated_at'])
        OR NEW.reviewed_at IS NULL OR NOT EXISTS (
            SELECT 1 FROM authentication_customuser WHERE id = NEW.reviewed_by_id AND is_active AND is_staff
        ) THEN
        RAISE EXCEPTION 'Only operator review may decide an immutable register import' USING ERRCODE = '23514';
""",
        """    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR OLD.status <> 'submitted'
        OR NEW.status NOT IN ('applied', 'rejected')
        OR (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason',
            'register_sequence', 'updated_at'])
            IS DISTINCT FROM
            (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason',
            'register_sequence', 'updated_at'])
        OR NEW.reviewed_at IS NULL OR NEW.reviewed_by_id IS DISTINCT FROM principal
        OR NOT EXISTS (SELECT 1 FROM tokens_registerimportdecision decision
            WHERE decision.register_import_id = NEW.uuid AND decision.decided_by_id = NEW.reviewed_by_id
                AND decision.decided_at = NEW.reviewed_at
                AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
                AND (NEW.status = 'applied' OR decision.reason = NEW.rejection_reason))
    THEN
        RAISE EXCEPTION 'Only the exact company decision may decide an immutable register import'
            USING ERRCODE = '23514';
""",
    ),
    (
        """    ELSIF length(btrim(NEW.rejection_reason)) = 0 OR NEW.asic_issued_total IS NOT NULL
        OR NEW.asic_member_count IS NOT NULL OR NEW.register_sequence IS NOT NULL THEN
        RAISE EXCEPTION 'Rejection requires a reason and records no figures' USING ERRCODE = '23514';
""",
        """    ELSIF length(btrim(NEW.rejection_reason)) = 0 OR NEW.register_sequence IS NOT NULL THEN
        RAISE EXCEPTION 'Rejection requires a reason and records no register entry' USING ERRCODE = '23514';
""",
    ),
)
IMPORT_GUARD = OPENING_IMPORT._replaced(IMPORT_GUARD_AS_0077_INSTALLED_IT, COMPANY_RUN)
REFUSE_REVERSAL = """
DO $$ BEGIN
    LOCK TABLE tokens_registerimport, tokens_registerimportdecision, tokens_registerevidence IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM tokens_registerevidence) OR EXISTS (SELECT 1 FROM tokens_registerimportdecision)
        OR EXISTS (SELECT 1 FROM tokens_registerimport WHERE preparing_appointment_id IS NOT NULL)
    THEN
        RAISE EXCEPTION 'Retain company register imports, their decisions and evidence';
    END IF;
END $$;
"""


def _with_roles(cursor, sql):
    cursor.execute(
        "SELECT quote_literal(%s), quote_literal(%s)", [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"]]
    )
    operator, migrate = cursor.fetchone()
    return sql.replace("__OPERATOR__", operator).replace("__MIGRATE__", migrate)


def install_company_imports(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(_with_roles(cursor, FUNCTIONS))
        cursor.execute(_with_roles(cursor, IMPORT_GUARD))


def remove_company_imports(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(REFUSE_REVERSAL)
        cursor.execute(IMPORT_GUARD_AS_0077_INSTALLED_IT, [settings.RLS_ROLES["app"]])
        cursor.execute(REMOVE_FUNCTIONS)


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0083_company_register_imports"),
    ]

    operations = [
        migrations.RunPython(install_company_imports, remove_company_imports),
    ]
