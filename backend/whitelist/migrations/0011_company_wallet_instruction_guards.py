from django.conf import settings
from django.db import migrations

SQL = """
CREATE FUNCTION whitelist_wallet_nomination_current(nomination whitelist_companywalletnomination) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    SELECT COALESCE((SELECT nomination.sharing_accepted
        AND nomination.company_id = request.company_id AND nomination.request_id = decision.request_id
        AND nomination.decision_id = decision.uuid AND nomination.proof_id = proof.uuid
        AND nomination.wallet_id = proof.wallet_id AND request.user_account_id = proof.account_id
        AND nomination.submitted_by_id = proof.verified_by_id
        AND nomination.snapshot->>'company' = nomination.company_id::text
        AND nomination.snapshot->>'request' = request.uuid::text AND nomination.snapshot->>'decision' = decision.uuid::text
        AND nomination.snapshot->>'wallet' = proof.wallet_id::text AND nomination.snapshot->>'proof' = proof.uuid::text
        AND nomination.snapshot->>'account' = proof.account_id::text AND nomination.snapshot->>'profile' = proof.profile_id::text
        AND nomination.snapshot->>'participant' = proof.verified_by_id::text AND nomination.snapshot->>'address' = lower(proof.address)
        AND nomination.snapshot->>'chain' = 'base' AND proof.chain = 'base'
        AND (nomination.snapshot->>'proof_completed_at')::timestamptz = proof.completed_at
        AND (nomination.snapshot->>'eligibility_expires_at')::timestamptz = decision.expires_at
        AND nomination.snapshot->>'proof_digest' = proof.digest AND nomination.snapshot->>'request_digest' = request.digest
        AND nomination.snapshot->>'decision_digest' = decision.digest
        AND nomination.digest = nomination.preview_digest
        AND nomination.digest = encode(sha256(convert_to(nomination.snapshot::text, 'UTF8')), 'hex')
        AND wallets_possession_proof_current(proof.uuid)
        AND users_company_eligibility_decision_facts_current(decision.uuid, request.user_account_id, nomination.company_id,
            'secondary', NULL, NULL, clock_timestamp())
        FROM users_companyeligibilityrequest request JOIN users_companyeligibilitydecision decision ON decision.uuid = nomination.decision_id
        JOIN wallets_walletpossessionproof proof ON proof.uuid = nomination.proof_id WHERE request.uuid = nomination.request_id), false);
$$;
CREATE FUNCTION whitelist_guard_wallet_nomination() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE principal bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Retain explicit wallet nominations' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
        OR current_setting('app.wallet_nomination_operation', true) IS DISTINCT FROM 'submit'
        OR NEW.submitted_by_id IS DISTINCT FROM principal OR NOT whitelist_wallet_nomination_current(NEW)
    THEN RAISE EXCEPTION 'Nominate only the participant owned wallet with genuine current proof and exact GENERAL eligibility' USING ERRCODE = '23514'; END IF;
    NEW.submitted_at := clock_timestamp(); NEW.created_at := NEW.submitted_at; NEW.updated_at := NEW.submitted_at;
    RETURN NEW;
END;
$$;
CREATE TRIGGER whitelist_wallet_nomination_source BEFORE INSERT OR UPDATE OR DELETE ON whitelist_companywalletnomination
FOR EACH ROW EXECUTE FUNCTION whitelist_guard_wallet_nomination();
CREATE FUNCTION whitelist_check_wallet_nomination() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NOT whitelist_wallet_nomination_current(NEW) THEN
        RAISE EXCEPTION 'Nomination commits only with its actual current participant source' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER whitelist_wallet_nomination_effect AFTER INSERT ON whitelist_companywalletnomination
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION whitelist_check_wallet_nomination();
CREATE FUNCTION whitelist_company_wallet_approval(instruction_uuid uuid, at_time timestamptz) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    SELECT decision.uuid FROM whitelist_companywalletinstructiondecision decision
        JOIN whitelist_companywalletinstruction instruction ON instruction.uuid = decision.instruction_id
        WHERE instruction.uuid = instruction_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, instruction.company_id, decision.decided_by_id,
                'approve', GREATEST(at_time, clock_timestamp()))
        ORDER BY decision.decided_at DESC, decision.uuid DESC LIMIT 1;
$$;
CREATE FUNCTION whitelist_company_wallet_approved(instruction_uuid uuid, at_time timestamptz) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    SELECT whitelist_company_wallet_approval(instruction_uuid, at_time) IS NOT NULL;
$$;
CREATE FUNCTION whitelist_company_wallet_ready(instruction whitelist_companywalletinstruction) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    SELECT EXISTS (SELECT 1 FROM companies_company company WHERE company.uuid = instruction.company_id
        AND company.status = 'active' AND instruction.snapshot->'company' = jsonb_build_object('uuid', company.uuid,
            'name', company.name, 'acn', company.acn, 'status', company.status)
        AND instruction.snapshot->'target'->>'chain' = 'base'
        AND instruction.snapshot->'target'->>'address' ~ '^0x[0-9a-f]{40}$'
        AND instruction.snapshot->'target'->>'registry_address' ~ '^0x[0-9a-f]{40}$'
        AND instruction.intent->'chain_id' = instruction.snapshot->'target'->'chain_id'
        AND (instruction.intent->>'chain_id')::bigint IN (84532, 31337)
        AND instruction.intent->>'sender' ~ '^0x[0-9a-f]{40}$' AND instruction.intent->>'value' = '0'
        AND instruction.intent->>'to' = instruction.snapshot->'target'->>'registry_address'
        AND instruction.snapshot->'transaction' = instruction.intent
        AND instruction.intent_digest = encode(sha256(convert_to(instruction.intent::text, 'UTF8')), 'hex')
        AND CASE instruction.action WHEN 'add' THEN instruction.target_change_id IS NULL
            AND instruction.expires_at > clock_timestamp() AND instruction.expires_at = date_trunc('second', instruction.expires_at)
            AND (instruction.snapshot->'target'->>'expires_at')::timestamptz = instruction.expires_at
            AND EXISTS (SELECT 1 FROM whitelist_companywalletnomination nomination
                JOIN users_companyeligibilitydecision decision ON decision.uuid = nomination.decision_id
                WHERE nomination.uuid = instruction.nomination_id AND nomination.company_id = instruction.company_id
                    AND instruction.snapshot->'associations' = nomination.snapshot
                    AND instruction.snapshot->'target'->>'address' = nomination.snapshot->>'address'
                    AND instruction.expires_at <= decision.expires_at
                    AND instruction.snapshot->'source' = jsonb_build_object('nomination', nomination.uuid,
                        'request', nomination.request_id, 'decision', nomination.decision_id,
                        'proof_completed_at', nomination.snapshot->'proof_completed_at',
                        'eligibility_expires_at', nomination.snapshot->'eligibility_expires_at', 'target_change', NULL)
                    AND whitelist_wallet_nomination_current(nomination))
            AND instruction.intent->>'data' = '0xe0468dcd' || repeat('0',24)
                || substring(instruction.snapshot->'target'->>'address' from 3)
                || lpad(to_hex(extract(epoch FROM instruction.expires_at)::bigint),64,'0')
        WHEN 'remove' THEN instruction.nomination_id IS NULL AND instruction.expires_at IS NULL
            AND instruction.snapshot->'target'->'expires_at' = 'null'::jsonb
            AND instruction.snapshot->'associations' = 'null'::jsonb
            AND EXISTS (SELECT 1 FROM whitelist_whitelistchange original WHERE original.uuid = instruction.target_change_id
                AND original.company_id = instruction.company_id AND original.action = 'add'
                AND original.status IN ('confirmed', 'unchanged') AND original.completed_at IS NOT NULL
                AND original.chain_id::text = instruction.snapshot->'target'->>'chain_id'
                AND original.registry_address = instruction.snapshot->'target'->>'registry_address'
                AND original.address = instruction.snapshot->'target'->>'address')
            AND instruction.snapshot->'source' = jsonb_build_object('nomination', NULL, 'request', NULL, 'decision', NULL,
                'proof_completed_at', NULL, 'eligibility_expires_at', NULL, 'target_change', instruction.target_change_id)
            AND instruction.intent->>'data' = '0xe0468dcd' || repeat('0',24)
                || substring(instruction.snapshot->'target'->>'address' from 3) || repeat('0',64)
        ELSE false END);
$$;
CREATE FUNCTION whitelist_company_wallet_source_current(instruction_uuid uuid, at_time timestamptz) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    SELECT EXISTS (SELECT 1 FROM whitelist_companywalletinstruction instruction
        JOIN whitelist_companywalletinstructiondecision approval ON approval.uuid = instruction.approval_decision_id
        JOIN whitelist_companywalletinstructiondecision application ON application.instruction_id = instruction.uuid AND application.kind = 'apply'
        WHERE instruction.uuid = instruction_uuid AND instruction.status = 'applied' AND instruction.change_id IS NOT NULL
            AND approval.instruction_id = instruction.uuid AND approval.kind = 'approve'
            AND application.decided_by_id = instruction.reviewed_by_id AND application.decided_at = instruction.reviewed_at
            AND tokens_register_appointment_current(approval.appointment_id, instruction.company_id, approval.decided_by_id,
                'approve', GREATEST(at_time,clock_timestamp()))
            AND tokens_register_appointment_current(application.appointment_id, instruction.company_id, application.decided_by_id,
                'apply', GREATEST(at_time,clock_timestamp())));
$$;
CREATE FUNCTION whitelist_company_wallet_decision_digest(instruction_uuid uuid, decision_kind text, actor bigint,
    appointment_uuid uuid, decision_reason text) RETURNS text
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
    SELECT encode(sha256(convert_to(jsonb_build_object('version','1','instruction',to_jsonb(instruction),
        'kind',decision_kind,'actor',actor,'appointment',appointment_uuid,'reason',decision_reason,
        'company',to_jsonb(company),'nomination',to_jsonb(nomination),'target',to_jsonb(original),
        'source_current', CASE WHEN nomination.uuid IS NOT NULL THEN whitelist_wallet_nomination_current(nomination) ELSE NULL END,
        'approval',whitelist_company_wallet_approval(instruction.uuid,clock_timestamp()))::text,'UTF8')),'hex')
    FROM whitelist_companywalletinstruction instruction JOIN companies_company company ON company.uuid = instruction.company_id
    LEFT JOIN whitelist_companywalletnomination nomination ON nomination.uuid = instruction.nomination_id
    LEFT JOIN whitelist_whitelistchange original ON original.uuid = instruction.target_change_id
    WHERE instruction.uuid = instruction_uuid;
$$;
CREATE FUNCTION whitelist_guard_company_wallet_instruction() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE principal bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Retain company wallet instructions' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id', true),'')::bigint;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
        OR current_setting('app.company_id',true) IS DISTINCT FROM NEW.company_id::text THEN
        RAISE EXCEPTION 'A wallet instruction requires its bounded company command' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF current_setting('app.company_operation',true) IS DISTINCT FROM 'company_wallet_instruction_prepare'
            OR NEW.submitted_by_id IS DISTINCT FROM principal OR NEW.status <> 'submitted'
            OR NEW.approval_decision_id IS NOT NULL OR NEW.change_id IS NOT NULL OR NEW.reviewed_by_id IS NOT NULL
            OR NEW.reviewed_at IS NOT NULL OR NEW.rejection_reason <> ''
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id,NEW.company_id,principal,'prepare',clock_timestamp())
            OR NOT whitelist_company_wallet_ready(NEW) THEN
            RAISE EXCEPTION 'Prepare only exact current company wallet source and terms' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF OLD.status <> 'submitted' OR NEW.status NOT IN ('applied','rejected') OR NEW.reviewed_by_id IS DISTINCT FROM principal
            OR current_setting('app.company_operation',true) IS DISTINCT FROM 'company_wallet_instruction_' || (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
            OR (to_jsonb(NEW) - ARRAY['status','approval_decision_id','change_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at'])
                IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','approval_decision_id','change_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at'])
            OR NOT EXISTS (SELECT 1 FROM whitelist_companywalletinstructiondecision decision WHERE decision.instruction_id = NEW.uuid
                AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
                AND decision.decided_by_id = principal AND decision.decided_at = NEW.reviewed_at
                AND (NEW.status = 'applied' OR decision.reason = NEW.rejection_reason))
            OR (NEW.status = 'applied' AND (NEW.change_id IS NULL OR NEW.rejection_reason <> ''
                OR NEW.approval_decision_id IS DISTINCT FROM whitelist_company_wallet_approval(NEW.uuid,clock_timestamp())
                OR NOT whitelist_company_wallet_ready(NEW)))
            OR (NEW.status = 'rejected' AND (NEW.change_id IS NOT NULL OR NEW.approval_decision_id IS NOT NULL OR NEW.rejection_reason !~ '[^[:space:]]')) THEN
            RAISE EXCEPTION 'Wallet instructions retain their exact immutable terms and decision outcome' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER whitelist_company_wallet_instruction_source BEFORE INSERT OR UPDATE OR DELETE ON whitelist_companywalletinstruction
FOR EACH ROW EXECUTE FUNCTION whitelist_guard_company_wallet_instruction();
CREATE FUNCTION whitelist_check_company_wallet_preparation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
BEGIN
    IF NOT tokens_register_appointment_current(NEW.preparing_appointment_id,NEW.company_id,NEW.submitted_by_id,'prepare',clock_timestamp())
        OR NOT whitelist_company_wallet_ready(NEW) THEN
        RAISE EXCEPTION 'Wallet preparation retains actual current authority/source at commit' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER whitelist_company_wallet_preparation AFTER INSERT ON whitelist_companywalletinstruction
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION whitelist_check_company_wallet_preparation();
CREATE FUNCTION whitelist_guard_company_wallet_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE principal bigint; instruction whitelist_companywalletinstruction; at_time timestamptz;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Wallet decisions are append only' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id',true),'')::bigint; at_time := clock_timestamp();
    SELECT * INTO instruction FROM whitelist_companywalletinstruction WHERE uuid = NEW.instruction_id;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR instruction.uuid IS NULL
        OR current_setting('app.company_id',true) IS DISTINCT FROM instruction.company_id::text
        OR current_setting('app.company_operation',true) IS DISTINCT FROM 'company_wallet_instruction_' || NEW.kind
        OR NEW.decided_by_id IS DISTINCT FROM principal OR instruction.status <> 'submitted'
        OR NEW.kind NOT IN ('approve','apply','reject') OR (NEW.kind = 'reject') <> (NEW.reason ~ '[^[:space:]]')
        OR NEW.digest IS DISTINCT FROM whitelist_company_wallet_decision_digest(instruction.uuid,NEW.kind,principal,NEW.appointment_id,NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id,instruction.company_id,principal,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END,at_time)
        OR (NEW.kind = 'approve' AND whitelist_company_wallet_approved(instruction.uuid,at_time))
        OR (NEW.kind = 'apply' AND NOT whitelist_company_wallet_approved(instruction.uuid,at_time))
        OR (NEW.kind <> 'reject' AND NOT whitelist_company_wallet_ready(instruction)) THEN
        RAISE EXCEPTION 'Wallet decision requires exact current personal company authority/source' USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := at_time; NEW.created_at := at_time; NEW.updated_at := at_time;
    RETURN NEW;
END;
$$;
CREATE TRIGGER whitelist_company_wallet_decision_source BEFORE INSERT OR UPDATE OR DELETE ON whitelist_companywalletinstructiondecision
FOR EACH ROW EXECUTE FUNCTION whitelist_guard_company_wallet_decision();
CREATE FUNCTION whitelist_check_company_wallet_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE instruction whitelist_companywalletinstruction; at_time timestamptz;
BEGIN
    SELECT * INTO instruction FROM whitelist_companywalletinstruction WHERE uuid = NEW.instruction_id;
    at_time := clock_timestamp();
    IF NOT tokens_register_appointment_current(NEW.appointment_id,instruction.company_id,NEW.decided_by_id,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END,at_time)
        OR (NEW.kind <> 'reject' AND NOT whitelist_company_wallet_ready(instruction))
        OR (NEW.kind = 'apply' AND (NOT whitelist_company_wallet_source_current(instruction.uuid,at_time)
            OR NOT EXISTS (SELECT 1 FROM whitelist_whitelistchange change WHERE change.uuid = instruction.change_id
                AND change.source_instruction_id = instruction.uuid AND change.intent = instruction.intent
                AND change.action = instruction.action AND change.company_id = instruction.company_id
                AND change.initiated_by_id = NEW.decided_by_id)))
        OR (NEW.kind = 'approve' AND instruction.status <> 'submitted')
        OR (NEW.kind <> 'approve' AND (instruction.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END
            OR instruction.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id OR instruction.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR (NEW.kind = 'reject' AND instruction.rejection_reason IS DISTINCT FROM NEW.reason))) THEN
        RAISE EXCEPTION 'Wallet decisions retain exact current authority and atomic journal admission at commit' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER whitelist_company_wallet_decision_effect AFTER INSERT ON whitelist_companywalletinstructiondecision
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION whitelist_check_company_wallet_decision();
CREATE FUNCTION whitelist_guard_company_change() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE instruction whitelist_companywalletinstruction; principal bigint;
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.source_instruction_id IS DISTINCT FROM OLD.source_instruction_id THEN
            RAISE EXCEPTION 'Retain the original whitelist company source association' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.authority = 'refresh' THEN
        IF NEW.source_instruction_id IS NOT NULL THEN RAISE EXCEPTION 'Automatic removal keeps its genuine cause' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    principal := NULLIF(current_setting('app.user_id',true),'')::bigint;
    SELECT * INTO instruction FROM whitelist_companywalletinstruction WHERE uuid = NEW.source_instruction_id;
    IF NEW.authority <> 'company' OR instruction.uuid IS NULL OR current_user NOT IN (__OPERATOR__,__MIGRATE__)
        OR current_setting('app.company_operation',true) IS DISTINCT FROM 'company_wallet_instruction_apply'
        OR current_setting('app.company_id',true) IS DISTINCT FROM instruction.company_id::text
        OR principal IS NULL OR NEW.initiated_by_id IS DISTINCT FROM principal OR instruction.reviewed_by_id IS DISTINCT FROM principal
        OR NEW.uuid IS DISTINCT FROM instruction.change_id OR NEW.company_id IS DISTINCT FROM instruction.company_id
        OR NEW.action IS DISTINCT FROM instruction.action OR NEW.expires_at IS DISTINCT FROM instruction.expires_at
        OR NEW.intent IS DISTINCT FROM instruction.intent OR NEW.address IS DISTINCT FROM instruction.snapshot->'target'->>'address'
        OR NEW.registry_address IS DISTINCT FROM instruction.snapshot->'target'->>'registry_address'
        OR NEW.chain_id::text IS DISTINCT FROM instruction.snapshot->'target'->>'chain_id'
        OR NEW.status <> 'pending' OR NEW.operation_id IS NOT NULL OR NEW.transaction_id IS NOT NULL
        OR NOT whitelist_company_wallet_source_current(instruction.uuid,clock_timestamp()) OR NOT whitelist_company_wallet_ready(instruction)
        OR (NEW.action = 'add' AND (NEW.requested_wallet_id::text IS DISTINCT FROM instruction.snapshot->'associations'->>'wallet'
            OR NOT EXISTS (SELECT 1 FROM whitelist_whitelistentry entry WHERE entry.uuid = NEW.entry_id AND entry.wallet_id = NEW.requested_wallet_id)))
        OR (NEW.action = 'remove' AND (NEW.requested_wallet_id IS NOT NULL OR NEW.entry_id IS DISTINCT FROM
            (SELECT entry.uuid FROM whitelist_whitelistentry entry JOIN whitelist_whitelistchange original ON original.entry_id = entry.uuid
                WHERE original.uuid = instruction.target_change_id))) THEN
        RAISE EXCEPTION 'Fresh whitelist admission requires its exact applied personal company instruction' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER whitelist_company_change_source BEFORE INSERT OR UPDATE ON whitelist_whitelistchange
FOR EACH ROW EXECUTE FUNCTION whitelist_guard_company_change();
CREATE FUNCTION whitelist_check_company_signature() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE change whitelist_whitelistchange; instruction whitelist_companywalletinstruction; operation blockchain_outgoingoperation;
BEGIN
    SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
    SELECT * INTO change FROM whitelist_whitelistchange WHERE operation_id = NEW.operation_id;
    IF operation.operation_key LIKE 'whitelist-change:%' AND change.uuid IS NULL THEN
        RAISE EXCEPTION 'A fresh whitelist signature requires its retained journal' USING ERRCODE = '23514';
    END IF;
    IF change.uuid IS NULL OR change.authority = 'refresh' THEN RETURN NEW; END IF;
    SELECT * INTO instruction FROM whitelist_companywalletinstruction WHERE uuid = change.source_instruction_id;
    IF instruction.uuid IS NULL OR change.authority <> 'company' OR instruction.change_id IS DISTINCT FROM change.uuid
        OR change.intent IS DISTINCT FROM instruction.intent OR operation.intent IS DISTINCT FROM instruction.intent
        OR NEW.claim_id IS DISTINCT FROM operation.claim_id
        OR NOT whitelist_company_wallet_source_current(instruction.uuid,clock_timestamp()) OR NOT whitelist_company_wallet_ready(instruction) THEN
        RAISE EXCEPTION 'Fresh whitelist signatures require their exact current original company source' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER whitelist_company_signature BEFORE INSERT ON blockchain_signedattempt
FOR EACH ROW EXECUTE FUNCTION whitelist_check_company_signature();
CREATE CONSTRAINT TRIGGER whitelist_company_signature_effect AFTER INSERT ON blockchain_signedattempt
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION whitelist_check_company_signature();
"""


def install(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT quote_literal(%s), quote_literal(current_user)", [settings.RLS_ROLES["operator"]])
        operator, migrate = cursor.fetchone()
        cursor.execute(SQL.replace("__OPERATOR__", operator).replace("__MIGRATE__", migrate))


def reverse(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "SELECT EXISTS (SELECT 1 FROM whitelist_companywalletnomination) OR EXISTS (SELECT 1 FROM whitelist_companywalletinstruction) OR EXISTS (SELECT 1 FROM whitelist_companywalletinstructiondecision) OR EXISTS (SELECT 1 FROM whitelist_whitelistchange WHERE source_instruction_id IS NOT NULL)"
        )
        if cursor.fetchone()[0]:
            raise RuntimeError("Retained company wallet sources prevent reversing their guards.")
        cursor.execute("""
            DROP TRIGGER whitelist_company_signature_effect ON blockchain_signedattempt;
            DROP TRIGGER whitelist_company_signature ON blockchain_signedattempt;
            DROP FUNCTION whitelist_check_company_signature();
            DROP TRIGGER whitelist_company_change_source ON whitelist_whitelistchange;
            DROP FUNCTION whitelist_guard_company_change();
            DROP TRIGGER whitelist_company_wallet_decision_effect ON whitelist_companywalletinstructiondecision;
            DROP TRIGGER whitelist_company_wallet_decision_source ON whitelist_companywalletinstructiondecision;
            DROP FUNCTION whitelist_check_company_wallet_decision();
            DROP FUNCTION whitelist_guard_company_wallet_decision();
            DROP TRIGGER whitelist_company_wallet_preparation ON whitelist_companywalletinstruction;
            DROP TRIGGER whitelist_company_wallet_instruction_source ON whitelist_companywalletinstruction;
            DROP FUNCTION whitelist_check_company_wallet_preparation();
            DROP FUNCTION whitelist_guard_company_wallet_instruction();
            DROP FUNCTION whitelist_company_wallet_decision_digest(uuid,text,bigint,uuid,text);
            DROP FUNCTION whitelist_company_wallet_source_current(uuid,timestamptz);
            DROP FUNCTION whitelist_company_wallet_ready(whitelist_companywalletinstruction);
            DROP FUNCTION whitelist_company_wallet_approved(uuid,timestamptz);
            DROP FUNCTION whitelist_company_wallet_approval(uuid,timestamptz);
            DROP TRIGGER whitelist_wallet_nomination_effect ON whitelist_companywalletnomination;
            DROP TRIGGER whitelist_wallet_nomination_source ON whitelist_companywalletnomination;
            DROP FUNCTION whitelist_check_wallet_nomination();
            DROP FUNCTION whitelist_guard_wallet_nomination();
            DROP FUNCTION whitelist_wallet_nomination_current(whitelist_companywalletnomination);
        """)


class Migration(migrations.Migration):
    dependencies = [("whitelist", "0010_company_wallet_instructions")]
    operations = [migrations.RunPython(install, reverse)]
