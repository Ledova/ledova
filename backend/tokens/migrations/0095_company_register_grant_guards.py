from importlib import import_module

from django.db import migrations

IMPORTS = import_module("tokens.migrations.0084_company_register_import_guards")
PARTICULARS = import_module("tokens.migrations.0091_company_particulars_change_guards")

FUNCTIONS = """
CREATE FUNCTION tokens_register_grant_approved(grant_uuid uuid, at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_registergrantdecision decision
        JOIN tokens_registergrant proposal ON proposal.uuid = decision.register_grant_id
        WHERE proposal.uuid = grant_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
                decision.decided_by_id, 'approve', at_time));
$$;
CREATE FUNCTION tokens_register_grant_decision_digest(grant_uuid uuid, decision_kind text, actor bigint,
    appointment_uuid uuid, decision_reason text) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT encode(sha256(convert_to(jsonb_build_object('version', '1', 'grant', to_jsonb(proposal),
        'effective_on', (clock_timestamp() AT TIME ZONE 'UTC')::date,
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid, 'reason', decision_reason,
        'register', to_jsonb(register), 'authorised_supply', token.total_supply,
        'token_status', token.status, 'deployment', token.deployment_id, 'contract', token.contract_address,
        'legacy_hash', token.deployment_tx_hash, 'deployed_at', token.deployed_at, 'chain', token.chain,
        'particulars', (SELECT to_jsonb(held) FROM tokens_registermemberparticulars held
            WHERE held.member_id = proposal.member))::text, 'UTF8')), 'hex')
    FROM tokens_registergrant proposal JOIN tokens_sharetoken token ON token.uuid = proposal.token_id
        LEFT JOIN tokens_shareregister register ON register.token_id = token.uuid WHERE proposal.uuid = grant_uuid;
$$;
CREATE FUNCTION tokens_register_grant_ready(proposal tokens_registergrant, before_effect boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_sharetoken token JOIN tokens_shareregister register ON register.token_id = token.uuid
        WHERE token.uuid = proposal.token_id AND token.company_id = proposal.company_id AND token.status = 'draft'
            AND NULLIF(token.contract_address, '') IS NULL AND token.deployment_id IS NULL
            AND token.deployment_transaction_id IS NULL AND NULLIF(token.deployment_tx_hash, '') IS NULL
            AND token.deployed_at IS NULL AND NULLIF(token.chain, '') IS NULL AND register.sequence > 0
            AND token.total_supply ~ '^[1-9][0-9]{0,77}$'
            AND register.issued_supply + proposal.shares <= token.total_supply::numeric
            AND register.issued_supply + proposal.shares < 2::numeric^256
            AND EXISTS (SELECT 1 FROM tokens_registerimport source WHERE source.token_id = token.uuid AND source.status = 'applied')
            AND NOT EXISTS (SELECT 1 FROM tokens_registerentry entry WHERE entry.register_id = register.uuid
                AND entry.sequence = register.sequence AND entry.effective_on > (clock_timestamp() AT TIME ZONE 'UTC')::date))
        AND lower(btrim(regexp_replace(proposal.approving_director, '[[:space:]]+', ' ', 'g')))
            <> lower(btrim(regexp_replace(proposal.name, '[[:space:]]+', ' ', 'g')))
        AND NOT EXISTS (SELECT 1 FROM tokens_registermemberwallet wallet WHERE wallet.company_id = proposal.company_id AND wallet.member_id = proposal.member)
        AND CASE WHEN proposal.new_member AND before_effect THEN
            NOT EXISTS (SELECT 1 FROM tokens_registermember member WHERE member.uuid = proposal.member)
        ELSE EXISTS (SELECT 1 FROM tokens_registermember member JOIN tokens_registermemberparticulars held ON held.member_id = member.uuid
            WHERE member.uuid = proposal.member AND member.company_id = proposal.company_id
                AND held.name = proposal.name AND held.residential_address = proposal.residential_address
                AND (NOT proposal.new_member OR (held.source_grant_id = proposal.uuid
                    AND held.as_at = (clock_timestamp() AT TIME ZONE 'UTC')::date))) END;
$$;
CREATE FUNCTION tokens_register_grant_evidence_matches(evidence_uuid uuid, issuer uuid, actor bigint, evidence_kind text,
    fingerprint text, snapshot jsonb, retained_file text, grant_uuid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_registerevidence evidence WHERE evidence.uuid = evidence_uuid
        AND evidence.company_id = issuer AND evidence.uploaded_by_id = actor AND evidence.kind = evidence_kind
        AND fingerprint = evidence.sha256 AND snapshot = tokens_register_evidence_snapshot(evidence)
        AND retained_file ~ ('^companies/' || issuer || '/register-grants/' || grant_uuid || '/[0-9a-f-]{36}[.]bin$'));
$$;
CREATE FUNCTION tokens_guard_register_grant() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain register grants and their evidence' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = NEW.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_shareregister WHERE token_id = NEW.token_id FOR UPDATE;
    IF TG_OP = 'INSERT' THEN
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
            OR NEW.submitted_by_id IS DISTINCT FROM principal
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_grant_prepare'
            OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal, 'prepare', clock_timestamp())
            OR NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.register_entry_id IS NOT NULL OR NEW.rejection_reason <> ''
            OR NEW.name !~ '[^[:space:]]' OR NEW.residential_address !~ '[^[:space:]]'
            OR length(NEW.residential_address) > 1000 OR NEW.terms !~ '[^[:space:]]'
            OR NEW.authority_reference !~ '[^[:space:]]' OR NEW.reason !~ '[^[:space:]]'
            OR NEW.approving_director !~ '[^[:space:]]' OR NEW.terms_on > (clock_timestamp() AT TIME ZONE 'UTC')::date OR NEW.shares <= 0 OR NEW.shares >= 2::numeric^256
            OR NOT tokens_register_grant_ready(NEW, true)
            OR NOT tokens_register_grant_evidence_matches(NEW.authority_evidence_id, NEW.company_id, principal,
                'authority', NEW.evidence_fingerprint, NEW.evidence_snapshot, NEW.file, NEW.uuid)
            OR NOT tokens_register_grant_evidence_matches(NEW.terms_evidence_id, NEW.company_id, principal,
                'supporting', NEW.terms_fingerprint, NEW.terms_snapshot, NEW.terms_file, NEW.uuid)
            OR (NEW.acceptance_required AND NOT tokens_register_grant_evidence_matches(NEW.acceptance_evidence_id,
                NEW.company_id, principal, 'supporting', NEW.acceptance_fingerprint, NEW.acceptance_snapshot, NEW.acceptance_file, NEW.uuid))
            OR (NOT NEW.acceptance_required AND (NEW.acceptance_evidence_id IS NOT NULL OR NEW.acceptance_fingerprint <> ''
                OR NEW.acceptance_snapshot IS NOT NULL OR NEW.acceptance_file <> ''))
        THEN
            RAISE EXCEPTION 'Register grants require exact current authority, non-paid terms, identity and evidence' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR OLD.status <> 'submitted' OR principal IS NULL
        OR NEW.status NOT IN ('applied', 'rejected')
        OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_grant_' || (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
        OR (to_jsonb(NEW) - ARRAY['status', 'register_entry_id', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
            IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'register_entry_id', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
        OR NEW.reviewed_at IS NULL OR NEW.reviewed_by_id IS DISTINCT FROM principal
        OR NOT EXISTS (SELECT 1 FROM tokens_registergrantdecision decision WHERE decision.register_grant_id = NEW.uuid
            AND decision.decided_by_id = principal AND decision.decided_at = NEW.reviewed_at
            AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
            AND (NEW.status = 'applied' OR decision.reason = NEW.rejection_reason))
        OR (NEW.status = 'applied' AND (NEW.rejection_reason <> '' OR NOT EXISTS (
            SELECT 1 FROM tokens_registerentry entry JOIN tokens_shareregister register ON register.uuid = entry.register_id
            WHERE entry.uuid = NEW.register_entry_id AND register.token_id = NEW.token_id AND entry.operation_id = NEW.uuid
                AND entry.kind = 'issue' AND entry.recorded_by_id = principal AND entry.effective_on = (clock_timestamp() AT TIME ZONE 'UTC')::date
                AND entry.changes = jsonb_build_array(jsonb_build_object('member', NEW.member::text, 'shares', NEW.shares::text)))))
        OR (NEW.status = 'rejected' AND (NEW.register_entry_id IS NOT NULL OR NEW.rejection_reason !~ '[^[:space:]]'))
    THEN
        RAISE EXCEPTION 'Only the exact company decision may decide an immutable register grant' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_grant_identity BEFORE INSERT OR UPDATE OR DELETE ON tokens_registergrant
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_grant();
CREATE FUNCTION tokens_guard_register_grant_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint; at_time timestamptz; proposal tokens_registergrant;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Register grant decisions are append-only' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    SELECT * INTO proposal FROM tokens_registergrant WHERE uuid = NEW.register_grant_id;
    PERFORM 1 FROM companies_company WHERE uuid = proposal.company_id FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = proposal.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_shareregister WHERE token_id = proposal.token_id FOR UPDATE;
    SELECT * INTO proposal FROM tokens_registergrant WHERE uuid = NEW.register_grant_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR NEW.decided_by_id IS DISTINCT FROM principal OR proposal.status <> 'submitted'
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_grant_' || NEW.kind
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR NEW.kind NOT IN ('approve', 'apply', 'reject') OR (NEW.kind = 'reject') <> (NEW.reason ~ '[^[:space:]]')
        OR NEW.digest IS DISTINCT FROM tokens_register_grant_decision_digest(proposal.uuid, NEW.kind, principal, NEW.appointment_id, NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'approve' AND tokens_register_grant_approved(proposal.uuid, at_time))
        OR (NEW.kind = 'apply' AND NOT tokens_register_grant_approved(proposal.uuid, at_time))
        OR (NEW.kind <> 'reject' AND NOT tokens_register_grant_ready(proposal, true))
    THEN
        RAISE EXCEPTION 'Register grant decisions need exact current company authority and effect' USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := at_time; NEW.created_at := at_time; NEW.updated_at := at_time;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_grant_decision_guard BEFORE INSERT OR UPDATE OR DELETE ON tokens_registergrantdecision
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_grant_decision();
CREATE FUNCTION tokens_check_register_grant_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE proposal tokens_registergrant; at_time timestamptz;
BEGIN
    SELECT * INTO proposal FROM tokens_registergrant WHERE uuid = NEW.register_grant_id;
    at_time := clock_timestamp();
    IF NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, NEW.decided_by_id,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'apply' AND NOT tokens_register_grant_approved(proposal.uuid, at_time))
    THEN
        RAISE EXCEPTION 'Register grant authority and approval must remain current at commit' USING ERRCODE = '23514';
    END IF;
    IF (NEW.kind = 'approve' AND proposal.status <> 'submitted')
        OR (NEW.kind <> 'approve' AND (proposal.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END
            OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR (NEW.kind = 'reject' AND proposal.rejection_reason IS DISTINCT FROM NEW.reason)))
    THEN
        RAISE EXCEPTION 'A register grant decision must carry exactly its own effect' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_register_grant_decision_effect AFTER INSERT ON tokens_registergrantdecision
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_register_grant_decision();
CREATE FUNCTION tokens_guard_grant_register_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE proposal tokens_registergrant; principal bigint; issuer uuid; token_uuid uuid;
BEGIN
    SELECT company_id, token_id INTO issuer, token_uuid FROM tokens_shareregister WHERE uuid = NEW.register_id;
    SELECT * INTO proposal FROM tokens_registergrant WHERE uuid = NEW.operation_id;
    IF proposal.uuid IS NULL AND current_setting('app.company_operation', true) IS DISTINCT FROM 'register_grant_apply'
        AND NOT (NEW.kind = 'issue' AND EXISTS (SELECT 1 FROM tokens_registerimport source JOIN tokens_sharetoken token ON token.uuid = source.token_id
            WHERE source.token_id = token_uuid AND source.status = 'applied' AND NULLIF(token.contract_address, '') IS NULL)) THEN
        RETURN NEW;
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_grant_apply'
        OR current_setting('app.company_id', true) IS DISTINCT FROM issuer::text
        OR proposal.company_id IS DISTINCT FROM issuer OR proposal.token_id IS DISTINCT FROM token_uuid OR proposal.status <> 'submitted'
        OR NEW.kind <> 'issue' OR NEW.recorded_by_id IS DISTINCT FROM principal OR NEW.effective_on IS DISTINCT FROM (clock_timestamp() AT TIME ZONE 'UTC')::date
        OR NEW.changes IS DISTINCT FROM jsonb_build_array(jsonb_build_object('member', proposal.member::text, 'shares', proposal.shares::text))
        OR NOT tokens_register_grant_ready(proposal, false) OR NOT tokens_register_grant_approved(proposal.uuid, clock_timestamp())
        OR NOT EXISTS (SELECT 1 FROM tokens_registergrantdecision decision WHERE decision.register_grant_id = proposal.uuid
            AND decision.kind = 'apply' AND decision.decided_by_id = principal
            AND tokens_register_appointment_current(decision.appointment_id, issuer, principal, 'apply', clock_timestamp()))
    THEN
        RAISE EXCEPTION 'A non-tokenised grant entry requires its exact current company application' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_grant_entry BEFORE INSERT ON tokens_registerentry
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_grant_register_entry();
CREATE FUNCTION tokens_guard_grant_member() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint;
BEGIN
    IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_grant_apply' THEN RETURN NEW; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF NOT EXISTS (SELECT 1 FROM tokens_registergrant proposal JOIN tokens_registergrantdecision decision ON decision.register_grant_id = proposal.uuid
        WHERE proposal.member = NEW.uuid AND proposal.new_member AND proposal.company_id = NEW.company_id
            AND proposal.status = 'submitted' AND decision.kind = 'apply' AND decision.decided_by_id = principal
            AND current_setting('app.company_id', true) = NEW.company_id::text
            AND tokens_register_grant_ready(proposal, true)
            AND tokens_register_grant_approved(proposal.uuid, clock_timestamp())
            AND tokens_register_appointment_current(decision.appointment_id, NEW.company_id, principal, 'apply', clock_timestamp()))
    THEN RAISE EXCEPTION 'A new grant member requires the exact company application' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_grant_member BEFORE INSERT ON tokens_registermember
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_grant_member();
"""

PARTICULARS_GUARD_AS_0091_INSTALLED_IT = PARTICULARS.FUNCTIONS.split(
    "CREATE FUNCTION tokens_guard_register_member_particulars()", 1
)[1].split("CREATE TRIGGER tokens_register_member_particulars_source", 1)[0]
PARTICULARS_GUARD_AS_0091_INSTALLED_IT = (
    "CREATE OR REPLACE FUNCTION tokens_guard_register_member_particulars()" + PARTICULARS_GUARD_AS_0091_INSTALLED_IT
)
GRANT_PARTICULARS = """    IF NEW.source_grant_id IS NOT NULL THEN
        IF TG_OP <> 'INSERT' OR principal IS NULL OR NOT EXISTS (
            SELECT 1 FROM tokens_registergrant grant_record JOIN tokens_registergrantdecision decision ON decision.register_grant_id = grant_record.uuid
            WHERE grant_record.uuid = NEW.source_grant_id AND grant_record.new_member AND grant_record.status = 'submitted'
                AND grant_record.member = NEW.member_id AND grant_record.name = NEW.name AND grant_record.residential_address = NEW.residential_address
                AND NEW.as_at = (clock_timestamp() AT TIME ZONE 'UTC')::date AND decision.kind = 'apply' AND decision.decided_by_id = principal
                AND current_setting('app.company_id', true) = grant_record.company_id::text
                AND current_setting('app.company_operation', true) = 'register_grant_apply'
                AND tokens_register_grant_approved(grant_record.uuid, clock_timestamp())
                AND tokens_register_appointment_current(decision.appointment_id, grant_record.company_id, principal, 'apply', clock_timestamp()))
        THEN RAISE EXCEPTION 'Grant particulars require the exact company application' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
"""
PARTICULARS_GUARD = PARTICULARS_GUARD_AS_0091_INSTALLED_IT.replace(
    "    IF NEW.source_change_id IS NULL THEN", GRANT_PARTICULARS + "    IF NEW.source_change_id IS NULL THEN"
)
IMPORT_GUARD_AS_0091_INSTALLED_IT = PARTICULARS.IMPORT_GUARD
IMPORT_GUARD = PARTICULARS.OPENING_IMPORT._replaced(
    IMPORT_GUARD_AS_0091_INSTALLED_IT,
    (
        (
            "OR (p.source_change_id IS NOT NULL AND p.as_at > NEW.as_at)",
            "OR ((p.source_change_id IS NOT NULL OR p.source_grant_id IS NOT NULL) AND p.as_at > NEW.as_at)",
        ),
    ),
)

REMOVE = """
DROP TRIGGER tokens_register_grant_member ON tokens_registermember;
DROP FUNCTION tokens_guard_grant_member();
DROP TRIGGER tokens_register_grant_entry ON tokens_registerentry;
DROP FUNCTION tokens_guard_grant_register_entry();
DROP TRIGGER tokens_register_grant_decision_effect ON tokens_registergrantdecision;
DROP FUNCTION tokens_check_register_grant_decision();
DROP TRIGGER tokens_register_grant_decision_guard ON tokens_registergrantdecision;
DROP FUNCTION tokens_guard_register_grant_decision();
DROP TRIGGER tokens_register_grant_identity ON tokens_registergrant;
DROP FUNCTION tokens_guard_register_grant();
DROP FUNCTION tokens_register_grant_evidence_matches(uuid, uuid, bigint, text, text, jsonb, text, uuid);
DROP FUNCTION tokens_register_grant_ready(tokens_registergrant, boolean);
DROP FUNCTION tokens_register_grant_decision_digest(uuid, text, bigint, uuid, text);
DROP FUNCTION tokens_register_grant_approved(uuid, timestamptz);
"""


def install_grant_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(IMPORTS._with_roles(cursor, FUNCTIONS))
        cursor.execute(IMPORTS._with_roles(cursor, PARTICULARS_GUARD))
        cursor.execute(IMPORTS._with_roles(cursor, IMPORT_GUARD))
        cursor.execute(PARTICULARS.PIN_IMPORT_GUARD)


def remove_grant_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("LOCK TABLE tokens_registergrant, tokens_registergrantdecision IN ACCESS EXCLUSIVE MODE")
        cursor.execute("SELECT EXISTS (SELECT 1 FROM tokens_registergrant)")
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain company register grants, decisions and evidence.")
        cursor.execute(IMPORTS._with_roles(cursor, PARTICULARS_GUARD_AS_0091_INSTALLED_IT))
        cursor.execute(IMPORTS._with_roles(cursor, IMPORT_GUARD_AS_0091_INSTALLED_IT))
        cursor.execute(PARTICULARS.PIN_IMPORT_GUARD)
        cursor.execute(REMOVE)


class Migration(migrations.Migration):
    dependencies = [("tokens", "0094_company_register_grants")]
    operations = [migrations.RunPython(install_grant_guards, remove_grant_guards)]
