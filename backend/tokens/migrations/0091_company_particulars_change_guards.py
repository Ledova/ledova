from importlib import import_module

from django.db import migrations

OPENING_IMPORT = import_module("tokens.migrations.0077_import_opening")
COMPANY_IMPORTS = import_module("tokens.migrations.0084_company_register_import_guards")
COMPANY_CORRECTIONS = import_module("tokens.migrations.0086_company_register_correction_guards")
IMPORT_GUARD_AS_0084_INSTALLED_IT = COMPANY_IMPORTS.IMPORT_GUARD
EVIDENCE_GUARD_AS_0086_INSTALLED_IT = COMPANY_CORRECTIONS.EVIDENCE_GUARD

FUNCTIONS = """
CREATE FUNCTION tokens_register_particulars_approved(change_uuid uuid, at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_registerparticularschangedecision decision
        JOIN tokens_registerparticularschange proposal ON proposal.uuid = decision.register_particulars_change_id
        WHERE decision.register_particulars_change_id = change_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
                decision.decided_by_id, 'approve', at_time));
$$;
CREATE FUNCTION tokens_register_particulars_decision_digest(change_uuid uuid, decision_kind text, actor bigint,
    appointment_uuid uuid, decision_reason text) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT encode(sha256(convert_to(jsonb_build_object('version', '1', 'change', change_uuid::text,
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid::text, 'reason', decision_reason,
        'particulars', CASE WHEN decision_kind = 'apply' THEN (SELECT jsonb_build_object('name', held.name,
            'residential_address', held.residential_address, 'as_at', held.as_at,
            'source_import', held.source_import_id, 'source_change', held.source_change_id)
            FROM tokens_registermemberparticulars held
            JOIN tokens_registerparticularschange proposal ON proposal.member_id = held.member_id
            WHERE proposal.uuid = change_uuid) END)::text, 'UTF8')), 'hex');
$$;
CREATE FUNCTION tokens_guard_register_particulars_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    principal bigint;
    at_time timestamptz;
    proposal tokens_registerparticularschange;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Register particulars decisions are append-only' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    SELECT * INTO proposal FROM tokens_registerparticularschange WHERE uuid = NEW.register_particulars_change_id;
    PERFORM 1 FROM companies_company WHERE uuid = proposal.company_id FOR UPDATE;
    SELECT * INTO proposal FROM tokens_registerparticularschange WHERE uuid = NEW.register_particulars_change_id
        FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR NEW.decided_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_particulars_' || NEW.kind
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR proposal.status <> 'submitted' OR NEW.kind NOT IN ('approve', 'apply', 'reject')
        OR (NEW.kind = 'reject') <> (NEW.reason ~ '[^[:space:]]')
        OR NEW.digest IS DISTINCT FROM tokens_register_particulars_decision_digest(proposal.uuid, NEW.kind,
            principal, NEW.appointment_id, NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'approve' AND tokens_register_particulars_approved(proposal.uuid, at_time))
        OR (NEW.kind = 'apply' AND NOT tokens_register_particulars_approved(proposal.uuid, at_time))
    THEN
        RAISE EXCEPTION 'Register particulars decisions need the exact current company authority'
            USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := at_time;
    NEW.created_at := at_time;
    NEW.updated_at := at_time;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_particulars_decision_guard
    BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerparticularschangedecision
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_particulars_decision();
CREATE FUNCTION tokens_check_register_particulars_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    proposal tokens_registerparticularschange;
BEGIN
    SELECT * INTO proposal FROM tokens_registerparticularschange WHERE uuid = NEW.register_particulars_change_id;
    IF (NEW.kind = 'approve' AND proposal.status <> 'submitted')
        OR (NEW.kind <> 'approve' AND (proposal.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END
            OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id
            OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR (NEW.kind = 'reject' AND proposal.rejection_reason IS DISTINCT FROM NEW.reason)))
    THEN
        RAISE EXCEPTION 'A register particulars decision must carry exactly its own effect' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_register_particulars_decision_effect
    AFTER INSERT ON tokens_registerparticularschangedecision DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION tokens_check_register_particulars_decision();
CREATE FUNCTION tokens_guard_register_particulars_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    principal bigint;
    at_time timestamptz;
    supporting_copy tokens_registerevidence;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain particulars changes and their supporting evidence' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    IF TG_OP = 'INSERT' THEN
        PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
        SELECT * INTO supporting_copy FROM tokens_registerevidence WHERE uuid = NEW.supporting_evidence_id;
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
            OR NEW.submitted_by_id IS DISTINCT FROM principal
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_particulars_prepare'
            OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal,
                'prepare', at_time)
            OR NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.rejection_reason <> ''
            OR NOT EXISTS (SELECT 1 FROM tokens_registermember member WHERE member.uuid = NEW.member_id
                AND member.company_id = NEW.company_id)
            OR NEW.name !~ '[^[:space:]]' OR NEW.residential_address !~ '[^[:space:]]'
            OR NEW.reason !~ '[^[:space:]]' OR NEW.as_at > current_date
            OR supporting_copy.uuid IS NULL OR supporting_copy.company_id <> NEW.company_id
            OR supporting_copy.kind <> 'supporting' OR supporting_copy.uploaded_by_id <> principal
            OR NEW.evidence_fingerprint IS DISTINCT FROM supporting_copy.sha256
            OR NEW.evidence_snapshot IS DISTINCT FROM tokens_register_evidence_snapshot(supporting_copy)
            OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-particulars/' || NEW.uuid
                || '/[0-9a-f-]{36}[.]bin$')
        THEN
            RAISE EXCEPTION 'Particulars changes require exact current intent, company authority and evidence'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR OLD.status <> 'submitted'
        OR NEW.status NOT IN ('applied', 'rejected')
        OR (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
            IS DISTINCT FROM
            (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
        OR NEW.reviewed_at IS NULL OR NEW.reviewed_by_id IS DISTINCT FROM principal
        OR NOT EXISTS (SELECT 1 FROM tokens_registerparticularschangedecision decision
            WHERE decision.register_particulars_change_id = NEW.uuid AND decision.decided_by_id = NEW.reviewed_by_id
                AND decision.decided_at = NEW.reviewed_at
                AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
                AND (NEW.status = 'applied' OR decision.reason = NEW.rejection_reason))
    THEN
        RAISE EXCEPTION 'Only the exact company decision may decide an immutable particulars change'
            USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'applied' THEN
        IF NEW.rejection_reason <> '' OR NOT EXISTS (SELECT 1 FROM tokens_registermemberparticulars held
            WHERE held.member_id = NEW.member_id AND held.source_change_id = NEW.uuid AND held.name = NEW.name
                AND held.residential_address = NEW.residential_address AND held.as_at = NEW.as_at)
        THEN
            RAISE EXCEPTION 'Application must record the change''s particulars for its member'
                USING ERRCODE = '23514';
        END IF;
    ELSIF NEW.rejection_reason !~ '[^[:space:]]' THEN
        RAISE EXCEPTION 'Rejection requires a reason' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_particulars_change_identity
    BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerparticularschange
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_particulars_change();
CREATE FUNCTION tokens_guard_register_member_particulars() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    principal bigint;
    proposal tokens_registerparticularschange;
BEGIN
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) THEN
        RAISE EXCEPTION 'Only the register''s own commands write member particulars' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    IF NEW.source_change_id IS NULL THEN
        IF NEW.as_at IS DISTINCT FROM (SELECT source.as_at FROM tokens_registerimport source
            WHERE source.uuid = NEW.source_import_id)
        THEN
            RAISE EXCEPTION 'Imported particulars carry their import''s register date' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO proposal FROM tokens_registerparticularschange WHERE uuid = NEW.source_change_id;
    IF principal IS NULL OR proposal.uuid IS NULL
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_particulars_apply'
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR proposal.status <> 'submitted'
        OR NEW.member_id IS DISTINCT FROM proposal.member_id OR NEW.name IS DISTINCT FROM proposal.name
        OR NEW.residential_address IS DISTINCT FROM proposal.residential_address
        OR NEW.as_at IS DISTINCT FROM proposal.as_at
        OR (TG_OP = 'UPDATE' AND OLD.as_at > NEW.as_at)
        OR NOT EXISTS (SELECT 1 FROM tokens_registerparticularschangedecision decision
            WHERE decision.register_particulars_change_id = proposal.uuid AND decision.kind = 'apply'
                AND decision.decided_by_id = principal)
    THEN
        RAISE EXCEPTION 'Particulars from a change come only from the company''s application of that change'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_member_particulars_source
    BEFORE INSERT OR UPDATE OR DELETE ON tokens_registermemberparticulars
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_member_particulars();
"""

REMOVE_FUNCTIONS = """
DROP TRIGGER tokens_register_member_particulars_source ON tokens_registermemberparticulars;
DROP FUNCTION tokens_guard_register_member_particulars();
DROP TRIGGER tokens_register_particulars_change_identity ON tokens_registerparticularschange;
DROP FUNCTION tokens_guard_register_particulars_change();
DROP TRIGGER tokens_register_particulars_decision_effect ON tokens_registerparticularschangedecision;
DROP FUNCTION tokens_check_register_particulars_decision();
DROP TRIGGER tokens_register_particulars_decision_guard ON tokens_registerparticularschangedecision;
DROP FUNCTION tokens_guard_register_particulars_decision();
DROP FUNCTION tokens_register_particulars_decision_digest(uuid, text, bigint, uuid, text);
DROP FUNCTION tokens_register_particulars_approved(uuid, timestamptz);
"""

SUPPORTING_UPLOADS = (
    (
        """        OR NEW.kind NOT IN ('share_register', 'asic_extract', 'authority') OR NEW.sha256 !~ '^[0-9a-f]{64}$'
""",
        """        OR NEW.kind NOT IN ('share_register', 'asic_extract', 'authority', 'supporting')
        OR NEW.sha256 !~ '^[0-9a-f]{64}$'
""",
    ),
)

PARTICULARS_FROM_EITHER_SOURCE = (
    (
        """                WHERE NOT EXISTS (SELECT 1 FROM tokens_registermemberparticulars p
                    JOIN tokens_registerimport source ON source.uuid = p.source_import_id
                    WHERE p.member_id::text = item->>'member' AND (p.source_import_id = NEW.uuid
                        OR (source.status = 'applied' AND source.as_at > NEW.as_at))))
""",
        """                WHERE NOT EXISTS (SELECT 1 FROM tokens_registermemberparticulars p
                    LEFT JOIN tokens_registerimport source ON source.uuid = p.source_import_id
                    WHERE p.member_id::text = item->>'member' AND (p.source_import_id = NEW.uuid
                        OR (source.status = 'applied' AND source.as_at > NEW.as_at)
                        OR (p.source_change_id IS NOT NULL AND p.as_at > NEW.as_at))))
""",
    ),
)
EVIDENCE_GUARD = OPENING_IMPORT._replaced(EVIDENCE_GUARD_AS_0086_INSTALLED_IT, SUPPORTING_UPLOADS)
IMPORT_GUARD = OPENING_IMPORT._replaced(IMPORT_GUARD_AS_0084_INSTALLED_IT, PARTICULARS_FROM_EITHER_SOURCE)
PIN_IMPORT_GUARD = "ALTER FUNCTION tokens_guard_register_import() SET search_path = pg_catalog, public, pg_temp"
REFUSE_REVERSAL = """
DO $$ BEGIN
    LOCK TABLE tokens_registerparticularschange, tokens_registerparticularschangedecision, tokens_registerevidence
        IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM tokens_registerevidence WHERE kind = 'supporting')
        OR EXISTS (SELECT 1 FROM tokens_registerparticularschangedecision)
        OR EXISTS (SELECT 1 FROM tokens_registerparticularschange)
    THEN
        RAISE EXCEPTION 'Retain particulars changes, their decisions and supporting evidence';
    END IF;
END $$;
"""


def install_company_particulars(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(COMPANY_IMPORTS._with_roles(cursor, FUNCTIONS))
        cursor.execute(COMPANY_IMPORTS._with_roles(cursor, EVIDENCE_GUARD))
        cursor.execute(COMPANY_IMPORTS._with_roles(cursor, IMPORT_GUARD))
        cursor.execute(PIN_IMPORT_GUARD)


def remove_company_particulars(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(REFUSE_REVERSAL)
        cursor.execute(COMPANY_IMPORTS._with_roles(cursor, IMPORT_GUARD_AS_0084_INSTALLED_IT))
        cursor.execute(PIN_IMPORT_GUARD)
        cursor.execute(COMPANY_IMPORTS._with_roles(cursor, EVIDENCE_GUARD_AS_0086_INSTALLED_IT))
        cursor.execute(REMOVE_FUNCTIONS)


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0090_company_particulars_changes"),
    ]

    operations = [
        migrations.RunPython(install_company_particulars, remove_company_particulars),
    ]
