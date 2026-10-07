from django.conf import settings
from django.db import migrations

FUNCTIONS = """
CREATE FUNCTION tokens_register_pause_approval(proposal_uuid uuid, at_time timestamptz) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT decision.uuid FROM tokens_registerpausechangedecision decision
    JOIN tokens_registerpausechange proposal ON proposal.uuid = decision.pause_change_id
    WHERE proposal.uuid = proposal_uuid AND decision.kind = 'approve'
        AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id, decision.decided_by_id, 'approve', GREATEST(at_time, clock_timestamp()))
    ORDER BY decision.decided_at DESC, decision.uuid DESC LIMIT 1;
$$;
CREATE FUNCTION tokens_register_pause_approved(proposal_uuid uuid, at_time timestamptz) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT tokens_register_pause_approval(proposal_uuid, at_time) IS NOT NULL;
$$;
CREATE FUNCTION tokens_register_pause_ready(proposal tokens_registerpausechange) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT COALESCE((SELECT company.status = 'active' AND token.status IN ('deployed','paused') AND token.chain = 'base'
        AND proposal.reason ~ '[^[:space:]]' AND length(proposal.reason) <= 1000
        AND proposal.authority_reference ~ '[^[:space:]]' AND length(proposal.authority_reference) <= 255
        AND proposal.snapshot->'company' = jsonb_build_object('uuid', company.uuid, 'name', company.name, 'acn', company.acn, 'status', company.status)
        AND proposal.snapshot->'token' = jsonb_build_object('uuid', token.uuid, 'name', token.name, 'symbol', token.symbol,
            'chain', token.chain, 'contract_address', lower(token.contract_address), 'authorised_shares', token.total_supply, 'decimals', token.decimals)
        AND proposal.intent->>'to' = lower(token.contract_address)
        AND proposal.intent->>'sender' ~ '^0x[0-9a-f]{40}$' AND proposal.intent->>'to' ~ '^0x[0-9a-f]{40}$'
        AND proposal.intent->>'to' <> '0x0000000000000000000000000000000000000000'
        AND proposal.intent->>'value' = '0' AND (proposal.intent->>'chain_id')::bigint IN (31337,84532)
        AND proposal.intent->>'data' = CASE WHEN proposal.paused THEN '0x8456cb59' ELSE '0x3f4ba83a' END
        AND proposal.intent = jsonb_build_object('chain_id',(proposal.intent->>'chain_id')::bigint,'sender',proposal.intent->>'sender',
            'to',lower(token.contract_address),'value','0','data',CASE WHEN proposal.paused THEN '0x8456cb59' ELSE '0x3f4ba83a' END)
        AND proposal.snapshot->'transaction' = proposal.intent
        AND proposal.intent_digest = encode(sha256(convert_to(proposal.intent::text, 'UTF8')), 'hex')
        AND evidence.company_id = company.uuid AND evidence.uploaded_by_id = proposal.submitted_by_id AND evidence.kind = 'authority'
        AND evidence.sha256 = proposal.evidence_fingerprint
        AND proposal.evidence_snapshot = jsonb_build_object('provided_by','company','evidence',evidence.uuid,'company',company.uuid,
            'document_type',evidence.kind,'name',evidence.original_filename,'file_size',evidence.file_size,'mime_type',evidence.mime_type,'sha256',evidence.sha256)
        AND proposal.file ~ ('^companies/' || company.uuid::text || '/register-pause-changes/' || proposal.uuid::text || '/[0-9a-f-]{36}[.]bin$')
        FROM tokens_sharetoken token JOIN companies_company company ON company.uuid = token.company_id
        JOIN tokens_registerevidence evidence ON evidence.uuid = proposal.authority_evidence_id
        WHERE token.uuid = proposal.token_id AND company.uuid = proposal.company_id), false);
$$;
CREATE FUNCTION tokens_register_pause_source_current(proposal_uuid uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT COALESCE((SELECT proposal.status = 'applied' AND tokens_register_pause_ready(proposal)
        AND approval.pause_change_id = proposal.uuid AND approval.kind = 'approve'
        AND application.decided_by_id = proposal.reviewed_by_id AND application.decided_at = proposal.reviewed_at
        AND tokens_register_appointment_current(approval.appointment_id, proposal.company_id, approval.decided_by_id, 'approve', clock_timestamp())
        AND tokens_register_appointment_current(application.appointment_id, proposal.company_id, application.decided_by_id, 'apply', clock_timestamp())
        FROM tokens_registerpausechange proposal JOIN tokens_registerpausechangedecision approval ON approval.uuid = proposal.approval_decision_id
        JOIN tokens_registerpausechangedecision application ON application.pause_change_id = proposal.uuid AND application.kind = 'apply'
        WHERE proposal.uuid = proposal_uuid), false);
$$;
CREATE FUNCTION tokens_register_pause_source_lapsed(proposal_uuid uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_registerpausechangedecision decision
        JOIN tokens_registerpausechange proposal ON proposal.uuid = decision.pause_change_id
        JOIN companies_companyappointment appointment ON appointment.uuid = decision.appointment_id
        LEFT JOIN companies_companyappointmentrevocation revocation ON revocation.appointment_id = appointment.uuid
        WHERE proposal.uuid = proposal_uuid AND (decision.uuid = proposal.approval_decision_id OR decision.kind = 'apply')
            AND (revocation.uuid IS NOT NULL OR appointment.expires_at <= clock_timestamp()));
$$;
CREATE FUNCTION tokens_register_pause_decision_digest(proposal_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text) RETURNS text
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT encode(sha256(convert_to(jsonb_build_object('proposal',to_jsonb(proposal),'kind',decision_kind,'actor',actor,
        'appointment',appointment_uuid,'reason',decision_reason,'token',to_jsonb(token),'company',to_jsonb(company),
        'ready',tokens_register_pause_ready(proposal),'approval',tokens_register_pause_approval(proposal.uuid,clock_timestamp()))::text,'UTF8')),'hex')
    FROM tokens_registerpausechange proposal JOIN tokens_sharetoken token ON token.uuid = proposal.token_id
    JOIN companies_company company ON company.uuid = proposal.company_id WHERE proposal.uuid = proposal_uuid;
$$;
CREATE FUNCTION tokens_guard_company_pause() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Retain company pause sources' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id',true),'')::bigint;
    IF current_user NOT IN (__OPERATOR__,__MIGRATE__) OR principal IS NULL OR current_setting('app.company_id',true) IS DISTINCT FROM NEW.company_id::text THEN
        RAISE EXCEPTION 'Pause sources require a bounded current personal company command' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF current_setting('app.company_operation',true) IS DISTINCT FROM 'register_pause_prepare'
            OR NEW.submitted_by_id IS DISTINCT FROM principal OR NEW.status <> 'submitted'
            OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.approval_decision_id IS NOT NULL OR NEW.rejection_reason <> ''
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id,NEW.company_id,principal,'prepare',clock_timestamp())
            OR NOT tokens_register_pause_ready(NEW)
            OR EXISTS (SELECT 1 FROM tokens_pausechange WHERE uuid = NEW.uuid) THEN
            RAISE EXCEPTION 'Pause preparation binds its exact current terms and company evidence' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF OLD.status <> 'submitted' OR NEW.status NOT IN ('applied','rejected') OR NEW.reviewed_by_id IS DISTINCT FROM principal OR NEW.reviewed_at IS NULL
            OR current_setting('app.company_operation',true) IS DISTINCT FROM 'register_pause_' || (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
            OR (to_jsonb(NEW) - ARRAY['status','approval_decision_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','approval_decision_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at'])
            OR NOT EXISTS (SELECT 1 FROM tokens_registerpausechangedecision decision WHERE decision.pause_change_id = NEW.uuid
                AND decision.decided_by_id = principal AND decision.decided_at = NEW.reviewed_at AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
            OR (NEW.status = 'applied' AND (NEW.rejection_reason <> '' OR NEW.approval_decision_id IS DISTINCT FROM tokens_register_pause_approval(NEW.uuid,clock_timestamp()) OR NOT tokens_register_pause_ready(NEW)))
            OR (NEW.status = 'rejected' AND (NEW.rejection_reason !~ '[^[:space:]]' OR NEW.approval_decision_id IS NOT NULL)) THEN
            RAISE EXCEPTION 'Pause source retains its exact immutable decision and outcome' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_company_pause_source BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerpausechange FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_pause();
CREATE FUNCTION tokens_check_company_pause_preparation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NOT tokens_register_pause_ready(NEW) OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id,NEW.company_id,NEW.submitted_by_id,'prepare',clock_timestamp()) THEN
        RAISE EXCEPTION 'Pause preparation commits only with its current exact company source' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_company_pause_preparation AFTER INSERT ON tokens_registerpausechange DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_pause_preparation();
CREATE FUNCTION tokens_guard_company_pause_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE proposal tokens_registerpausechange; principal bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Retain append-only pause decisions' USING ERRCODE = '23514'; END IF;
    SELECT * INTO proposal FROM tokens_registerpausechange WHERE uuid = NEW.pause_change_id FOR UPDATE;
    principal := NULLIF(current_setting('app.user_id',true),'')::bigint;
    IF current_user NOT IN (__OPERATOR__,__MIGRATE__) OR proposal.uuid IS NULL OR proposal.status <> 'submitted'
        OR NEW.decided_by_id IS DISTINCT FROM principal OR current_setting('app.company_id',true) IS DISTINCT FROM proposal.company_id::text
        OR current_setting('app.company_operation',true) IS DISTINCT FROM 'register_pause_' || NEW.kind
        OR NEW.digest IS DISTINCT FROM tokens_register_pause_decision_digest(proposal.uuid,NEW.kind,NEW.decided_by_id,NEW.appointment_id,NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id,proposal.company_id,principal,CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END,clock_timestamp())
        OR (NEW.kind = 'reject' AND NEW.reason !~ '[^[:space:]]')
        OR (NEW.kind <> 'reject' AND (NEW.reason <> '' OR NOT tokens_register_pause_ready(proposal)))
        OR (NEW.kind = 'approve' AND tokens_register_pause_approved(proposal.uuid,clock_timestamp()))
        OR (NEW.kind = 'apply' AND NOT tokens_register_pause_approved(proposal.uuid,clock_timestamp())) THEN
        RAISE EXCEPTION 'Pause decision requires its exact current personal mandate and terms' USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := clock_timestamp();
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_company_pause_decision BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerpausechangedecision FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_pause_decision();
CREATE FUNCTION tokens_check_company_pause_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE proposal tokens_registerpausechange;
BEGIN
    SELECT * INTO proposal FROM tokens_registerpausechange WHERE uuid = NEW.pause_change_id;
    IF NOT tokens_register_appointment_current(NEW.appointment_id,proposal.company_id,NEW.decided_by_id,CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END,clock_timestamp())
        OR (NEW.kind <> 'reject' AND NOT tokens_register_pause_ready(proposal))
        OR (NEW.kind = 'reject' AND (proposal.status <> 'rejected' OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at OR proposal.rejection_reason <> NEW.reason))
        OR (NEW.kind = 'apply' AND (NOT tokens_register_pause_source_current(proposal.uuid) OR NOT EXISTS (
            SELECT 1 FROM tokens_pausechange execution WHERE execution.source_pause_id = proposal.uuid AND execution.uuid = proposal.uuid
                AND execution.status = 'pending' AND execution.completed_at IS NULL AND execution.company_id = proposal.company_id
                AND execution.token_id = proposal.token_id AND execution.initiated_by_id = NEW.decided_by_id AND execution.intent = proposal.intent))) THEN
        RAISE EXCEPTION 'Pause decisions commit with current authority and their exact atomic outcome' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_company_pause_decision_effect AFTER INSERT ON tokens_registerpausechangedecision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_pause_decision();
CREATE FUNCTION tokens_guard_company_pause_execution() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE proposal tokens_registerpausechange;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.source_pause_id IS DISTINCT FROM OLD.source_pause_id THEN
        RAISE EXCEPTION 'Retain the original pause source association' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT * INTO proposal FROM tokens_registerpausechange WHERE uuid = NEW.source_pause_id;
        IF proposal.uuid IS NULL OR NOT tokens_register_pause_source_current(proposal.uuid)
            OR proposal.uuid IS DISTINCT FROM NEW.uuid OR proposal.token_id IS DISTINCT FROM NEW.token_id OR proposal.company_id IS DISTINCT FROM NEW.company_id
            OR NEW.authority <> 'company' OR proposal.paused IS DISTINCT FROM NEW.paused OR proposal.intent IS DISTINCT FROM NEW.intent
            OR proposal.reviewed_by_id IS DISTINCT FROM NEW.initiated_by_id OR NEW.status <> 'pending' OR NEW.completed_at IS NOT NULL
            OR current_setting('app.company_operation',true) IS DISTINCT FROM 'register_pause_apply'
            OR current_setting('app.company_id',true) IS DISTINCT FROM proposal.company_id::text OR current_setting('app.user_id',true) IS DISTINCT FROM proposal.reviewed_by_id::text THEN
            RAISE EXCEPTION 'Fresh pause admission requires the exact original company source' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF NEW.source_pause_id IS NOT NULL AND OLD.status = 'pending' AND NEW.status IN ('executing','observed') AND NOT tokens_register_pause_source_current(NEW.source_pause_id) THEN
            RAISE EXCEPTION 'Unsigned pause observation or execution requires current company authority' USING ERRCODE = '23514';
        END IF;
        IF NEW.source_pause_id IS NOT NULL AND NEW.status = 'failed' AND OLD.status <> 'failed' AND NEW.operation_id IS NULL
            AND NOT tokens_register_pause_source_lapsed(NEW.source_pause_id) THEN
            RAISE EXCEPTION 'Unsigned source retirement requires actual consumed appointment revocation or expiry' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_company_pause_execution BEFORE INSERT OR UPDATE ON tokens_pausechange FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_pause_execution();
CREATE FUNCTION tokens_check_company_pause_execution() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF (TG_OP = 'INSERT' OR (NEW.source_pause_id IS NOT NULL AND OLD.status = 'pending' AND NEW.status IN ('executing','observed')))
        AND NOT tokens_register_pause_source_current(NEW.source_pause_id) THEN
        RAISE EXCEPTION 'Fresh pause admission commits only with current original company source' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_company_pause_execution_effect AFTER INSERT OR UPDATE ON tokens_pausechange DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_pause_execution();
CREATE FUNCTION tokens_check_company_pause_signature() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE operation blockchain_outgoingoperation; execution tokens_pausechange;
BEGIN
    SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
    IF operation.operation_key NOT LIKE 'token-pause:%' THEN RETURN NEW; END IF;
    SELECT * INTO execution FROM tokens_pausechange WHERE operation_id = NEW.operation_id;
    IF execution.uuid IS NULL OR NEW.claim_id IS DISTINCT FROM operation.claim_id OR execution.status <> 'executing'
        OR execution.intent IS DISTINCT FROM operation.intent OR NOT tokens_register_pause_source_current(execution.source_pause_id) THEN
        RAISE EXCEPTION 'Fresh pause signatures require their original journal and current consumed company source' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_company_pause_signature BEFORE INSERT ON blockchain_signedattempt FOR EACH ROW EXECUTE FUNCTION tokens_check_company_pause_signature();
CREATE CONSTRAINT TRIGGER tokens_company_pause_signature_effect AFTER INSERT ON blockchain_signedattempt DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_pause_signature();
CREATE FUNCTION tokens_guard_pause_projection() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF current_user IN (__OPERATOR__,__MIGRATE__) AND current_setting('app.company_operation',true) = 'register_pause_project' THEN
        IF OLD.status IS DISTINCT FROM NEW.status AND NOT EXISTS (SELECT 1 FROM tokens_pausechange execution
            WHERE execution.token_id = NEW.uuid AND execution.company_id = NEW.company_id
                AND execution.company_id::text = current_setting('app.company_id',true)
                AND execution.initiated_by_id::text = current_setting('app.user_id',true)
                AND execution.source_pause_id IS NOT NULL AND execution.authority = 'company'
                AND execution.chain_id IN (31337,84532) AND execution.contract_address = lower(NEW.contract_address)
                AND execution.completed_at IS NULL AND execution.status IN ('observed','confirmed')
                AND execution.paused = (NEW.status = 'paused') AND NEW.status IN ('deployed','paused')) THEN
            RAISE EXCEPTION 'Company pause projection requires its original observed or confirmed outcome' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_pause_projection BEFORE UPDATE ON tokens_sharetoken FOR EACH ROW EXECUTE FUNCTION tokens_guard_pause_projection();
"""

REVERSE = """
LOCK TABLE tokens_registerpausechange, tokens_registerpausechangedecision, tokens_pausechange IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM tokens_registerpausechange) OR EXISTS (SELECT 1 FROM tokens_registerpausechangedecision)
        OR EXISTS (SELECT 1 FROM tokens_pausechange WHERE source_pause_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Retain company pause sources, decisions and original journal history';
    END IF;
END $$;
DROP TRIGGER tokens_pause_projection ON tokens_sharetoken;
DROP TRIGGER tokens_company_pause_signature_effect ON blockchain_signedattempt;
DROP TRIGGER tokens_company_pause_signature ON blockchain_signedattempt;
DROP TRIGGER tokens_company_pause_execution_effect ON tokens_pausechange;
DROP TRIGGER tokens_company_pause_execution ON tokens_pausechange;
DROP TRIGGER tokens_company_pause_decision_effect ON tokens_registerpausechangedecision;
DROP TRIGGER tokens_company_pause_decision ON tokens_registerpausechangedecision;
DROP TRIGGER tokens_company_pause_preparation ON tokens_registerpausechange;
DROP TRIGGER tokens_company_pause_source ON tokens_registerpausechange;
DROP FUNCTION tokens_guard_pause_projection();
DROP FUNCTION tokens_check_company_pause_signature();
DROP FUNCTION tokens_check_company_pause_execution();
DROP FUNCTION tokens_guard_company_pause_execution();
DROP FUNCTION tokens_check_company_pause_decision();
DROP FUNCTION tokens_guard_company_pause_decision();
DROP FUNCTION tokens_check_company_pause_preparation();
DROP FUNCTION tokens_guard_company_pause();
DROP FUNCTION tokens_register_pause_decision_digest(uuid,text,bigint,uuid,text);
DROP FUNCTION tokens_register_pause_source_current(uuid);
DROP FUNCTION tokens_register_pause_source_lapsed(uuid);
DROP FUNCTION tokens_register_pause_ready(tokens_registerpausechange);
DROP FUNCTION tokens_register_pause_approved(uuid,timestamptz);
DROP FUNCTION tokens_register_pause_approval(uuid,timestamptz);
"""


def install_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT quote_literal(%s), quote_literal(%s)",
            [settings.RLS_ROLES["operator"], settings.RLS_ROLES["migrate"]],
        )
        operator_role, migrate_role = cursor.fetchone()
        cursor.execute(FUNCTIONS.replace("__OPERATOR__", operator_role).replace("__MIGRATE__", migrate_role))


def remove_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(REVERSE)


class Migration(migrations.Migration):
    dependencies = [("tokens", "0104_company_register_pause_changes")]
    operations = [migrations.RunPython(install_guards, remove_guards)]
