from django.conf import settings
from django.db import migrations

FUNCTIONS = """
CREATE FUNCTION tokens_register_capital_approval(proposal_uuid uuid, at_time timestamptz) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT decision.uuid FROM tokens_registercapitalincreasedecision decision
    JOIN tokens_registercapitalincrease proposal ON proposal.uuid = decision.capital_increase_id
    WHERE proposal.uuid = proposal_uuid AND decision.kind = 'approve'
        AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id, decision.decided_by_id, 'approve', GREATEST(at_time, clock_timestamp()))
    ORDER BY decision.decided_at DESC, decision.uuid DESC LIMIT 1;
$$;
CREATE FUNCTION tokens_register_capital_approved(proposal_uuid uuid, at_time timestamptz) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT tokens_register_capital_approval(proposal_uuid, at_time) IS NOT NULL;
$$;
CREATE FUNCTION tokens_register_capital_ready(proposal tokens_registercapitalincrease) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT COALESCE((SELECT company.status = 'active' AND token.status IN ('deployed','paused') AND token.chain = 'base' AND token.decimals = 0
        AND token.total_supply ~ '^[0-9]+$' AND token.total_supply::numeric BETWEEN 0 AND 2147483647
        AND request.additional_shares BETWEEN 1 AND 2147483647 AND request.new_authorized_total BETWEEN 1 AND 2147483647
        AND request.new_authorized_total::numeric = token.total_supply::numeric + request.additional_shares
        AND request.company_id = company.uuid AND request.token_id = token.uuid
        AND request.submitted_by_id = proposal.submitted_by_id AND request.submitted_at IS NOT NULL AND request.executed_issuance_id IS NULL
        AND request.purpose ~ '[^[:space:]]' AND request.board_resolution_reference ~ '[^[:space:]]'
        AND proposal.snapshot->'company' = jsonb_build_object('uuid', company.uuid, 'name', company.name, 'acn', company.acn, 'status', company.status)
        AND proposal.snapshot->'token' = jsonb_build_object('uuid', token.uuid, 'name', token.name, 'symbol', token.symbol,
            'chain', token.chain, 'contract_address', lower(token.contract_address), 'authorised_shares', token.total_supply, 'decimals', token.decimals)
        AND proposal.snapshot->'capital' = jsonb_build_object('prior_authorized_total', token.total_supply,
            'additional_shares', request.additional_shares::text, 'new_authorized_total', request.new_authorized_total::text,
            'purpose', request.purpose, 'board_resolution_reference', request.board_resolution_reference,
            'shareholder_approval_reference', request.shareholder_approval_reference)
        AND proposal.intent->>'token_chain' = token.chain AND proposal.intent->>'to' = lower(token.contract_address)
        AND proposal.intent->>'prior_authorized_total' = token.total_supply
        AND proposal.intent->>'additional_shares' = request.additional_shares::text
        AND proposal.intent->>'new_authorized_total' = request.new_authorized_total::text
        AND proposal.intent->>'sender' ~ '^0x[0-9a-f]{40}$' AND proposal.intent->>'to' ~ '^0x[0-9a-f]{40}$'
        AND proposal.intent->>'value' = '0' AND (proposal.intent->>'chain_id')::bigint IN (31337,84532)
        AND proposal.intent->>'data' = '0xf778e828' || lpad(to_hex(request.new_authorized_total::bigint), 64, '0')
        AND proposal.snapshot->'transaction' = proposal.intent - ARRAY['token_chain','prior_authorized_total','new_authorized_total','additional_shares']
        AND proposal.intent_digest = encode(sha256(convert_to(proposal.intent::text, 'UTF8')), 'hex')
        AND evidence.company_id = company.uuid AND evidence.uploaded_by_id = proposal.submitted_by_id AND evidence.kind = 'authority'
        AND evidence.sha256 = proposal.evidence_fingerprint
        AND proposal.evidence_snapshot = jsonb_build_object('provided_by','company','evidence',evidence.uuid,'company',company.uuid,
            'document_type',evidence.kind,'name',evidence.original_filename,'file_size',evidence.file_size,'mime_type',evidence.mime_type,'sha256',evidence.sha256)
        AND proposal.file ~ ('^companies/' || company.uuid::text || '/register-capital-increases/' || proposal.uuid::text || '/[0-9a-f-]{36}[.]bin$')
        FROM tokens_sharetoken token JOIN companies_company company ON company.uuid = token.company_id
        JOIN tokens_capitalincreaserequest request ON request.uuid = proposal.request_id
        JOIN tokens_registerevidence evidence ON evidence.uuid = proposal.authority_evidence_id
        WHERE token.uuid = proposal.token_id AND company.uuid = proposal.company_id), false);
$$;
CREATE FUNCTION tokens_register_capital_source_current(proposal_uuid uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT COALESCE((SELECT proposal.status = 'applied' AND tokens_register_capital_ready(proposal)
        AND approval.capital_increase_id = proposal.uuid AND approval.kind = 'approve'
        AND application.decided_by_id = proposal.reviewed_by_id AND application.decided_at = proposal.reviewed_at
        AND tokens_register_appointment_current(approval.appointment_id, proposal.company_id, approval.decided_by_id, 'approve', clock_timestamp())
        AND tokens_register_appointment_current(application.appointment_id, proposal.company_id, application.decided_by_id, 'apply', clock_timestamp())
        FROM tokens_registercapitalincrease proposal JOIN tokens_registercapitalincreasedecision approval ON approval.uuid = proposal.approval_decision_id
        JOIN tokens_registercapitalincreasedecision application ON application.capital_increase_id = proposal.uuid AND application.kind = 'apply'
        WHERE proposal.uuid = proposal_uuid), false);
$$;
CREATE FUNCTION tokens_register_capital_decision_digest(proposal_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text) RETURNS text
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT encode(sha256(convert_to(jsonb_build_object('proposal',to_jsonb(proposal),'kind',decision_kind,'actor',actor,
        'appointment',appointment_uuid,'reason',decision_reason,'token',to_jsonb(token),'company',to_jsonb(company),
        'request',to_jsonb(request),'ready',tokens_register_capital_ready(proposal),
        'approval',tokens_register_capital_approval(proposal.uuid,clock_timestamp()))::text,'UTF8')),'hex')
    FROM tokens_registercapitalincrease proposal JOIN tokens_sharetoken token ON token.uuid = proposal.token_id
    JOIN companies_company company ON company.uuid = proposal.company_id JOIN tokens_capitalincreaserequest request ON request.uuid = proposal.request_id
    WHERE proposal.uuid = proposal_uuid;
$$;
CREATE FUNCTION tokens_guard_company_capital() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Retain company capital sources' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id',true),'')::bigint;
    IF current_user NOT IN (__OPERATOR__,__MIGRATE__) OR principal IS NULL OR current_setting('app.company_id',true) IS DISTINCT FROM NEW.company_id::text THEN
        RAISE EXCEPTION 'Capital sources require a bounded current personal company command' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF current_setting('app.company_operation',true) IS DISTINCT FROM 'register_capital_prepare'
            OR NEW.submitted_by_id IS DISTINCT FROM principal OR NEW.status <> 'submitted'
            OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.approval_decision_id IS NOT NULL OR NEW.rejection_reason <> ''
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id,NEW.company_id,principal,'prepare',clock_timestamp())
            OR NOT tokens_register_capital_ready(NEW)
            OR NOT EXISTS (SELECT 1 FROM tokens_capitalincreaserequest request WHERE request.uuid = NEW.request_id AND request.status = 'under_review' AND request.reviewed_by_id IS NULL AND request.reviewed_at IS NULL) THEN
            RAISE EXCEPTION 'Capital preparation binds its exact current terms and company evidence' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF OLD.status <> 'submitted' OR NEW.status NOT IN ('applied','rejected') OR NEW.reviewed_by_id IS DISTINCT FROM principal OR NEW.reviewed_at IS NULL
            OR current_setting('app.company_operation',true) IS DISTINCT FROM 'register_capital_' || (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
            OR (to_jsonb(NEW) - ARRAY['status','approval_decision_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','approval_decision_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at'])
            OR NOT EXISTS (SELECT 1 FROM tokens_registercapitalincreasedecision decision WHERE decision.capital_increase_id = NEW.uuid
                AND decision.decided_by_id = principal AND decision.decided_at = NEW.reviewed_at AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
            OR (NEW.status = 'applied' AND (NEW.rejection_reason <> '' OR NEW.approval_decision_id IS DISTINCT FROM tokens_register_capital_approval(NEW.uuid,clock_timestamp()) OR NOT tokens_register_capital_ready(NEW)))
            OR (NEW.status = 'rejected' AND (NEW.rejection_reason !~ '[^[:space:]]' OR NEW.approval_decision_id IS NOT NULL)) THEN
            RAISE EXCEPTION 'Capital source retains its exact immutable decision and outcome' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_company_capital_source BEFORE INSERT OR UPDATE OR DELETE ON tokens_registercapitalincrease FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_capital();
CREATE FUNCTION tokens_check_company_capital_preparation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NOT tokens_register_capital_ready(NEW) OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id,NEW.company_id,NEW.submitted_by_id,'prepare',clock_timestamp()) THEN
        RAISE EXCEPTION 'Capital preparation commits only with its current exact company source' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_company_capital_preparation AFTER INSERT ON tokens_registercapitalincrease DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_capital_preparation();
CREATE FUNCTION tokens_guard_company_capital_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE proposal tokens_registercapitalincrease; principal bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Retain append-only capital decisions' USING ERRCODE = '23514'; END IF;
    SELECT * INTO proposal FROM tokens_registercapitalincrease WHERE uuid = NEW.capital_increase_id FOR UPDATE;
    principal := NULLIF(current_setting('app.user_id',true),'')::bigint;
    IF current_user NOT IN (__OPERATOR__,__MIGRATE__) OR proposal.uuid IS NULL OR proposal.status <> 'submitted'
        OR NEW.decided_by_id IS DISTINCT FROM principal OR current_setting('app.company_id',true) IS DISTINCT FROM proposal.company_id::text
        OR current_setting('app.company_operation',true) IS DISTINCT FROM 'register_capital_' || NEW.kind
        OR NEW.kind NOT IN ('approve','apply','reject')
        OR NOT tokens_register_appointment_current(NEW.appointment_id,proposal.company_id,principal,CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END,clock_timestamp())
        OR NEW.digest IS DISTINCT FROM tokens_register_capital_decision_digest(proposal.uuid,NEW.kind,principal,NEW.appointment_id,NEW.reason)
        OR (NEW.kind = 'reject' AND NEW.reason !~ '[^[:space:]]')
        OR (NEW.kind <> 'reject' AND (NEW.reason <> '' OR NOT tokens_register_capital_ready(proposal)))
        OR (NEW.kind = 'approve' AND tokens_register_capital_approved(proposal.uuid,clock_timestamp()))
        OR (NEW.kind = 'apply' AND NOT tokens_register_capital_approved(proposal.uuid,clock_timestamp())) THEN
        RAISE EXCEPTION 'Capital decision requires its exact current personal mandate and terms' USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := clock_timestamp();
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_company_capital_decision BEFORE INSERT OR UPDATE OR DELETE ON tokens_registercapitalincreasedecision FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_capital_decision();
CREATE FUNCTION tokens_check_company_capital_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE proposal tokens_registercapitalincrease;
BEGIN
    SELECT * INTO proposal FROM tokens_registercapitalincrease WHERE uuid = NEW.capital_increase_id;
    IF NOT tokens_register_appointment_current(NEW.appointment_id,proposal.company_id,NEW.decided_by_id,CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END,clock_timestamp())
        OR (NEW.kind <> 'reject' AND NOT tokens_register_capital_ready(proposal))
        OR (NEW.kind = 'reject' AND (proposal.status <> 'rejected' OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR NOT EXISTS (SELECT 1 FROM tokens_capitalincreaserequest request WHERE request.uuid = proposal.request_id AND request.status = 'rejected' AND request.reviewed_by_id = NEW.decided_by_id AND request.reviewed_at = NEW.decided_at AND request.rejection_reason = NEW.reason)))
        OR (NEW.kind = 'apply' AND (NOT tokens_register_capital_source_current(proposal.uuid) OR NOT EXISTS (
            SELECT 1 FROM tokens_capitalincreaseexecution execution JOIN tokens_capitalincreaserequest request ON request.uuid = execution.request_id
            WHERE execution.source_increase_id = proposal.uuid AND execution.uuid = request.dispatch_id AND request.status = 'executing'
                AND execution.company_id = proposal.company_id AND execution.token_id = proposal.token_id AND execution.request_id = proposal.request_id
                AND execution.executed_by_id = NEW.decided_by_id AND execution.intent = proposal.intent))) THEN
        RAISE EXCEPTION 'Capital decisions commit with current authority and their exact atomic outcome' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_company_capital_decision_effect AFTER INSERT ON tokens_registercapitalincreasedecision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_capital_decision();
CREATE FUNCTION tokens_guard_company_capital_execution() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE proposal tokens_registercapitalincrease;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.source_increase_id IS DISTINCT FROM OLD.source_increase_id THEN
        RAISE EXCEPTION 'Retain the original capital source association' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' OR NEW.retry_of IS DISTINCT FROM OLD.retry_of THEN
        SELECT * INTO proposal FROM tokens_registercapitalincrease WHERE uuid = NEW.source_increase_id;
        IF proposal.uuid IS NULL OR NOT tokens_register_capital_source_current(proposal.uuid)
            OR proposal.request_id IS DISTINCT FROM NEW.request_id OR proposal.token_id IS DISTINCT FROM NEW.token_id OR proposal.company_id IS DISTINCT FROM NEW.company_id
            OR proposal.intent IS DISTINCT FROM NEW.intent OR proposal.reviewed_by_id IS DISTINCT FROM NEW.executed_by_id
            OR (TG_OP = 'INSERT' AND (current_setting('app.company_operation',true) IS DISTINCT FROM 'register_capital_apply'
                OR current_setting('app.company_id',true) IS DISTINCT FROM proposal.company_id::text OR current_setting('app.user_id',true) IS DISTINCT FROM proposal.reviewed_by_id::text)) THEN
            RAISE EXCEPTION 'Fresh capital admission and retries require the exact original company source' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_company_capital_execution BEFORE INSERT OR UPDATE ON tokens_capitalincreaseexecution FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_capital_execution();
CREATE FUNCTION tokens_check_company_capital_execution() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF (TG_OP = 'INSERT' OR NEW.retry_of IS DISTINCT FROM OLD.retry_of) AND NOT tokens_register_capital_source_current(NEW.source_increase_id) THEN
        RAISE EXCEPTION 'Fresh capital admission commits only with current original company source' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_company_capital_execution_effect AFTER INSERT OR UPDATE ON tokens_capitalincreaseexecution DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_capital_execution();
CREATE FUNCTION tokens_check_company_capital_signature() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE operation blockchain_outgoingoperation; execution tokens_capitalincreaseexecution;
BEGIN
    SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
    IF operation.operation_key NOT LIKE 'capital-increase:%' THEN RETURN NEW; END IF;
    SELECT * INTO execution FROM tokens_capitalincreaseexecution WHERE operation_id = NEW.operation_id;
    IF operation.operation_key LIKE 'capital-increase:%' AND execution.uuid IS NULL THEN
        RAISE EXCEPTION 'Fresh capital signatures require their original private journal' USING ERRCODE = '23514';
    END IF;
    IF execution.uuid IS NULL THEN RETURN NEW; END IF;
    IF NEW.claim_id IS DISTINCT FROM operation.claim_id OR NOT tokens_register_capital_source_current(execution.source_increase_id) THEN
        RAISE EXCEPTION 'Fresh capital signatures require the current consumed company source' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_company_capital_signature BEFORE INSERT ON blockchain_signedattempt FOR EACH ROW EXECUTE FUNCTION tokens_check_company_capital_signature();
CREATE CONSTRAINT TRIGGER tokens_company_capital_signature_effect AFTER INSERT ON blockchain_signedattempt DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_capital_signature();
CREATE FUNCTION tokens_guard_company_capital_request() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE proposal tokens_registercapitalincrease; principal bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF current_user NOT IN (__OPERATOR__,__MIGRATE__) THEN
        RAISE EXCEPTION 'Fresh customer capital writes require the bounded company command' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id',true),'')::bigint;
    SELECT * INTO proposal FROM tokens_registercapitalincrease WHERE request_id = NEW.uuid;
    IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN
        IF NEW.status <> 'under_review' OR current_user NOT IN (__OPERATOR__,__MIGRATE__) OR principal IS NULL
            OR current_setting('app.company_id',true) IS DISTINCT FROM NEW.company_id::text OR current_setting('app.company_operation',true) IS DISTINCT FROM 'register_capital_prepare'
            OR NEW.submitted_by_id IS DISTINCT FROM principal OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL THEN
            RAISE EXCEPTION 'Fresh capital preparation requires a current company instruction' USING ERRCODE = '23514';
        END IF;
    END IF;
    IF (proposal.uuid IS NOT NULL OR (TG_OP = 'INSERT' AND NEW.status = 'under_review')) AND NEW.executed_issuance_id IS NOT NULL THEN
        RAISE EXCEPTION 'Company capital raises only the authorised cap and retains no issue' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND proposal.uuid IS NOT NULL THEN
        IF ROW(NEW.submitted_by_id,NEW.submitted_at,NEW.dilution_percentage,NEW.review_notes) IS DISTINCT FROM ROW(OLD.submitted_by_id,OLD.submitted_at,OLD.dilution_percentage,OLD.review_notes) THEN
            RAISE EXCEPTION 'Retain the original company capital preparer and review terms' USING ERRCODE = '23514';
        END IF;
        IF ROW(NEW.reviewed_by_id,NEW.reviewed_at,NEW.rejection_reason) IS DISTINCT FROM ROW(OLD.reviewed_by_id,OLD.reviewed_at,OLD.rejection_reason)
            OR (OLD.status = 'under_review' AND NEW.status IS DISTINCT FROM OLD.status) THEN
            IF current_user NOT IN (__OPERATOR__,__MIGRATE__) OR NOT EXISTS (
                SELECT 1 FROM tokens_registercapitalincreasedecision decision WHERE decision.capital_increase_id = proposal.uuid
                AND decision.decided_by_id = NEW.reviewed_by_id AND decision.decided_at = NEW.reviewed_at
                AND decision.kind = CASE NEW.status WHEN 'approved' THEN 'apply' WHEN 'rejected' THEN 'reject' ELSE '' END
                AND current_setting('app.company_operation',true) = 'register_capital_' || decision.kind AND principal = decision.decided_by_id
                AND (NEW.status <> 'rejected' OR NEW.rejection_reason = decision.reason)
                AND tokens_register_appointment_current(decision.appointment_id,proposal.company_id,decision.decided_by_id,CASE decision.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END,clock_timestamp())) THEN
                RAISE EXCEPTION 'Capital review requires the exact current company decision' USING ERRCODE = '23514';
            END IF;
        END IF;
    ELSIF TG_OP = 'UPDATE' AND OLD.status IN ('draft','submitted','under_review') AND NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Fresh owner and staff capital decisions are retired' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_company_capital_request BEFORE INSERT OR UPDATE OR DELETE ON tokens_capitalincreaserequest FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_capital_request();
CREATE FUNCTION tokens_check_company_capital_request() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.status = 'under_review' AND NOT EXISTS (SELECT 1 FROM tokens_registercapitalincrease proposal
        WHERE proposal.request_id = NEW.uuid AND tokens_register_capital_ready(proposal)
        AND tokens_register_appointment_current(proposal.preparing_appointment_id,proposal.company_id,proposal.submitted_by_id,'prepare',clock_timestamp())) THEN
        RAISE EXCEPTION 'Capital preparation retains its exact company source at commit' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IN ('draft','submitted','under_review')) AND NOT EXISTS (
        SELECT 1 FROM tokens_registercapitalincrease proposal JOIN tokens_registercapitalincreasedecision decision ON decision.capital_increase_id = proposal.uuid AND decision.kind = 'apply'
        WHERE proposal.request_id = NEW.uuid AND proposal.status = 'applied' AND decision.decided_by_id = NEW.reviewed_by_id AND decision.decided_at = NEW.reviewed_at
            AND tokens_register_capital_source_current(proposal.uuid)) THEN
        RAISE EXCEPTION 'Fresh capital approval commits only with actual company application' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_company_capital_request_source AFTER INSERT OR UPDATE ON tokens_capitalincreaserequest DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_capital_request();
"""

REVERSE = """
LOCK TABLE tokens_registercapitalincrease, tokens_registercapitalincreasedecision, tokens_capitalincreaseexecution IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM tokens_registercapitalincrease) OR EXISTS (SELECT 1 FROM tokens_registercapitalincreasedecision)
        OR EXISTS (SELECT 1 FROM tokens_capitalincreaseexecution WHERE source_increase_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Retain company capital sources, decisions and original execution history';
    END IF;
END $$;
DROP TRIGGER tokens_company_capital_request_source ON tokens_capitalincreaserequest;
DROP TRIGGER tokens_company_capital_request ON tokens_capitalincreaserequest;
DROP TRIGGER tokens_company_capital_signature_effect ON blockchain_signedattempt;
DROP TRIGGER tokens_company_capital_signature ON blockchain_signedattempt;
DROP TRIGGER tokens_company_capital_execution_effect ON tokens_capitalincreaseexecution;
DROP TRIGGER tokens_company_capital_execution ON tokens_capitalincreaseexecution;
DROP TRIGGER tokens_company_capital_decision_effect ON tokens_registercapitalincreasedecision;
DROP TRIGGER tokens_company_capital_decision ON tokens_registercapitalincreasedecision;
DROP TRIGGER tokens_company_capital_preparation ON tokens_registercapitalincrease;
DROP TRIGGER tokens_company_capital_source ON tokens_registercapitalincrease;
DROP FUNCTION tokens_check_company_capital_request();
DROP FUNCTION tokens_guard_company_capital_request();
DROP FUNCTION tokens_check_company_capital_signature();
DROP FUNCTION tokens_check_company_capital_execution();
DROP FUNCTION tokens_guard_company_capital_execution();
DROP FUNCTION tokens_check_company_capital_decision();
DROP FUNCTION tokens_guard_company_capital_decision();
DROP FUNCTION tokens_check_company_capital_preparation();
DROP FUNCTION tokens_guard_company_capital();
DROP FUNCTION tokens_register_capital_decision_digest(uuid,text,bigint,uuid,text);
DROP FUNCTION tokens_register_capital_source_current(uuid);
DROP FUNCTION tokens_register_capital_ready(tokens_registercapitalincrease);
DROP FUNCTION tokens_register_capital_approved(uuid,timestamptz);
DROP FUNCTION tokens_register_capital_approval(uuid,timestamptz);
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
    dependencies = [("tokens", "0102_company_register_capital_increases")]
    operations = [migrations.RunPython(install_guards, remove_guards)]
