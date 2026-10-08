from importlib import import_module

from django.conf import settings
from django.db import migrations

PREVIOUS = import_module("tokens.migrations.0099_company_register_deployment_guards")
INSTRUCTIONS = import_module("tokens.migrations.0073_register_instructions")
IMPORT_OPENING = import_module("tokens.migrations.0077_import_opening")

FUNCTIONS = """
CREATE FUNCTION tokens_register_issue_approval(proposal_uuid uuid, at_time timestamptz) RETURNS uuid
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT decision.uuid FROM tokens_registerinstructiondecision decision
        JOIN tokens_registerinstruction proposal ON proposal.uuid = decision.instruction_id
        WHERE proposal.uuid = proposal_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
                decision.decided_by_id, 'approve', GREATEST(at_time, clock_timestamp()))
        ORDER BY decision.decided_at DESC, decision.uuid DESC LIMIT 1;
$$;
CREATE FUNCTION tokens_register_issue_approved(proposal_uuid uuid, at_time timestamptz) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT tokens_register_issue_approval(proposal_uuid, at_time) IS NOT NULL;
$$;
CREATE FUNCTION tokens_register_issue_reserved(token_uuid uuid, excluded_request uuid) RETURNS numeric
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT COALESCE(sum(request.amount), 0) FROM tokens_shareissuancerequest request
    WHERE request.token_id = token_uuid AND request.uuid <> excluded_request AND (
        request.status IN ('approved', 'executing')
        OR (request.status = 'failed' AND request.dispatch_id IS NULL AND EXISTS (
            SELECT 1 FROM tokens_shareissuance issuance WHERE issuance.idempotency_key = 'issuance-request:' || request.uuid::text
                AND issuance.tx_hash IS NOT NULL AND issuance.tx_hash <> '' AND issuance.status <> 'completed'))
        OR EXISTS (SELECT 1 FROM tokens_shareissuanceexecution execution
            WHERE execution.request_id = request.uuid AND execution.status = 'executed'
                AND EXISTS (SELECT 1 FROM tokens_registeropening opening WHERE opening.token_id = token_uuid AND opening.status = 'applied'
                    AND (opening.boundary->'block'->>'number')::bigint < (execution.finalized_receipt->>'block_number')::bigint)
                AND NOT EXISTS (
                    SELECT 1 FROM tokens_registerentry entry JOIN tokens_shareregister register ON register.uuid = entry.register_id
                    WHERE entry.operation_id = execution.issuance_id AND entry.kind = 'issue' AND register.token_id = token_uuid)));
$$;
CREATE FUNCTION tokens_register_issue_ready(proposal tokens_registerinstruction) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT COALESCE((SELECT proposal.kind = 'issue' AND proposal.preparing_appointment_id IS NOT NULL
        AND company.status = 'active' AND token.status = 'deployed' AND token.chain = 'base' AND token.decimals = 0
        AND proposal.snapshot->'company' = jsonb_build_object('uuid', company.uuid, 'name', company.name, 'acn', company.acn, 'status', company.status)
        AND proposal.snapshot->'token' = jsonb_build_object('uuid', token.uuid, 'name', token.name, 'symbol', token.symbol,
            'chain', token.chain, 'contract_address', lower(token.contract_address), 'authorised_shares', token.total_supply::text)
        AND register.sequence > 0 AND register.uuid::text = proposal.snapshot->'register'->>'uuid'
        AND opening.status = 'applied' AND opening.token_id = token.uuid AND opening.company_id = company.uuid
        AND opening.uuid::text = proposal.snapshot->'register'->>'opening' AND opening.applied_entry_id IN (
            SELECT uuid FROM tokens_registerentry WHERE register_id = register.uuid AND kind = 'opening')
        AND NOT EXISTS (SELECT 1 FROM tokens_registerimport imported JOIN tokens_registerentry entry
            ON entry.operation_id = imported.uuid WHERE imported.token_id = token.uuid AND imported.status = 'applied'
                AND entry.kind = 'opening' AND entry.register_id = register.uuid)
        AND nomination.company_id = company.uuid AND whitelist_wallet_nomination_current(nomination)
        AND nomination.snapshot = proposal.snapshot->'private'
        AND approval.company_id = company.uuid AND approval.action = 'add' AND approval.status IN ('confirmed', 'unchanged')
        AND approval.expires_at IS NOT NULL AND approval.expires_at > clock_timestamp()
        AND wallet_source.status = 'applied' AND wallet_source.action = 'add' AND wallet_source.company_id = company.uuid
        AND wallet_source.nomination_id = nomination.uuid AND wallet_source.change_id = approval.uuid
        AND ((proposal.snapshot->'wallet') - 'expires_at') = jsonb_build_object('nomination', nomination.uuid, 'approval', approval.uuid,
            'address', approval.address, 'registry_address', approval.registry_address, 'chain_id', approval.chain_id,
            'proof_completed_at', nomination.snapshot->>'proof_completed_at', 'eligibility_expires_at', nomination.snapshot->>'eligibility_expires_at')
        AND EXISTS (SELECT 1 FROM whitelist_whitelistapproval listed JOIN whitelist_whitelistentry entry ON entry.uuid = listed.entry_id
            WHERE listed.company_id = company.uuid AND entry.wallet_id = nomination.wallet_id
                AND listed.registry_address = approval.registry_address AND listed.status = 'active' AND listed.expires_at = approval.expires_at)
        AND (proposal.snapshot->'wallet'->>'expires_at')::timestamptz = approval.expires_at
        AND approval.address = nomination.snapshot->>'address'
        AND member.company_id = company.uuid AND member.uuid::text = proposal.snapshot->'member'->>'uuid'
        AND EXISTS (SELECT 1 FROM tokens_registermemberwallet linked WHERE linked.company_id = company.uuid
            AND linked.member_id = member.uuid AND lower(linked.address) = approval.address)
        AND proposal.snapshot->'member'->>'address' = approval.address
        AND proposal.snapshot->'member'->>'identity_source' = 'profile'
        AND proposal.snapshot->'member'->>'name' = COALESCE(NULLIF(regexp_replace(profile.full_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), actor.email)
        AND proposal.snapshot->'member'->>'residential_address' = regexp_replace(COALESCE(profile.residential_address, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g')
        AND regexp_replace(COALESCE(profile.residential_address, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g') <> ''
        AND NOT EXISTS (SELECT 1 FROM tokens_registermemberwallet linked WHERE linked.company_id = company.uuid
            AND linked.member_id = member.uuid AND (SELECT count(*) FROM whitelist_whitelistentry entry
                LEFT JOIN wallets registry_wallet ON registry_wallet.uuid = entry.wallet_id
                WHERE (entry.wallet_id IS NULL OR registry_wallet.chain = 'base')
                    AND lower(COALESCE(registry_wallet.address, entry.address)) = lower(linked.address)) > 1)
        AND NOT EXISTS (SELECT 1 FROM tokens_registermemberwallet linked JOIN whitelist_whitelistentry entry ON lower(COALESCE((SELECT address FROM wallets WHERE uuid = entry.wallet_id), entry.address)) = lower(linked.address)
            LEFT JOIN wallets wallet ON wallet.uuid = entry.wallet_id LEFT JOIN customer_accounts_account account ON account.uuid = wallet.user_account_id
            LEFT JOIN users_userprofile other_profile ON other_profile.uuid = account.user_profile_id
            LEFT JOIN authentication_customuser other_actor ON other_actor.id = other_profile.user_id
            WHERE linked.company_id = company.uuid AND linked.member_id = member.uuid
                AND (entry.wallet_id IS NULL OR wallet.chain = 'base') AND (
                    wallet.uuid IS NULL OR (account.user_profile_id IS NOT NULL AND (
                        COALESCE(NULLIF(regexp_replace(other_profile.full_name, '^[[:space:]]+|[[:space:]]+$', '', 'g'), ''), other_actor.email) IS DISTINCT FROM proposal.snapshot->'member'->>'name'
                        OR regexp_replace(COALESCE(other_profile.residential_address, ''), '^[[:space:]]+|[[:space:]]+$', '', 'g') IS DISTINCT FROM proposal.snapshot->'member'->>'residential_address'))))
        AND request.token_id = token.uuid AND request.company_id = company.uuid AND request.amount BETWEEN 1 AND 2147483647
        AND lower(request.recipient_address) = approval.address AND request.recipient_name = proposal.snapshot->'member'->>'name'
        AND proposal.items = jsonb_build_array(jsonb_build_object('request', request.uuid, 'recipient', approval.address, 'amount', request.amount::text))
        AND NOT EXISTS (SELECT 1 FROM offerings_subscription WHERE issuance_request_id = request.uuid)
        AND proposal.terms_on <= (clock_timestamp() AT TIME ZONE 'UTC')::date AND proposal.terms ~ '[^[:space:]]'
        AND proposal.approving_director ~ '[^[:space:]]' AND proposal.reason ~ '[^[:space:]]' AND proposal.authority_reference ~ '[^[:space:]]'
        AND lower(btrim(regexp_replace(proposal.approving_director, '[[:space:]]+', ' ', 'g')))
            <> lower(btrim(regexp_replace(proposal.snapshot->'member'->>'name', '[[:space:]]+', ' ', 'g')))
        AND proposal.acceptance_required IS NOT NULL
        AND (proposal.acceptance_required = (proposal.acceptance_evidence_id IS NOT NULL))
        AND authority.company_id = company.uuid AND authority.uploaded_by_id = proposal.submitted_by_id AND authority.kind = 'authority'
        AND authority.sha256 = proposal.evidence_fingerprint AND proposal.evidence_snapshot->>'sha256' = authority.sha256
        AND terms.company_id = company.uuid AND terms.uploaded_by_id = proposal.submitted_by_id AND terms.kind = 'supporting'
        AND terms.sha256 = proposal.terms_fingerprint AND proposal.terms_snapshot->>'sha256' = terms.sha256
        AND (proposal.acceptance_required OR (proposal.acceptance_fingerprint IS NULL AND proposal.acceptance_snapshot IS NULL
            AND NULLIF(proposal.acceptance_file, '') IS NULL))
        AND (NOT proposal.acceptance_required OR (acceptance.company_id = company.uuid AND acceptance.uploaded_by_id = proposal.submitted_by_id
            AND acceptance.kind = 'supporting' AND acceptance.sha256 = proposal.acceptance_fingerprint
            AND proposal.acceptance_snapshot->>'sha256' = acceptance.sha256))
        AND proposal.file ~ ('^companies/' || company.uuid::text || '/register-instructions/' || proposal.uuid::text || '/[0-9a-f-]{36}[.]bin$')
        AND proposal.terms_file ~ ('^companies/' || company.uuid::text || '/register-instructions/' || proposal.uuid::text || '/[0-9a-f-]{36}[.]bin$')
        AND (NOT proposal.acceptance_required OR proposal.acceptance_file ~ ('^companies/' || company.uuid::text || '/register-instructions/' || proposal.uuid::text || '/[0-9a-f-]{36}[.]bin$'))
        AND proposal.intent->>'amount' = request.amount::text AND proposal.intent->>'recipient' = approval.address
        AND proposal.intent->>'to' = lower(token.contract_address) AND proposal.intent->>'token_chain' = token.chain
        AND proposal.intent->>'value' = '0' AND proposal.intent->>'sender' ~ '^0x[0-9a-f]{40}$'
        AND (proposal.intent->>'chain_id')::bigint = approval.chain_id AND approval.chain_id IN (31337, 84532)
        AND proposal.intent->>'data' = '0x40c10f19' || lpad(substring(approval.address FROM 3), 64, '0') || lpad(to_hex(request.amount::bigint), 64, '0')
        AND proposal.intent_digest = encode(sha256(convert_to(proposal.intent::text, 'UTF8')), 'hex')
        AND proposal.snapshot->'transaction' = proposal.intent - ARRAY['token_chain', 'recipient', 'amount']
        AND request.amount <= token.total_supply::numeric - register.issued_supply - tokens_register_issue_reserved(token.uuid, request.uuid)
      FROM tokens_sharetoken token JOIN companies_company company ON company.uuid = token.company_id
      JOIN tokens_shareregister register ON register.token_id = token.uuid
      JOIN tokens_registeropening opening ON opening.uuid::text = proposal.snapshot->'register'->>'opening'
      JOIN tokens_shareissuancerequest request ON request.uuid = proposal.request_id
      JOIN tokens_registermember member ON member.uuid = proposal.member_id
      JOIN whitelist_companywalletnomination nomination ON nomination.uuid = proposal.nomination_id
      JOIN users_userprofile profile ON profile.uuid::text = nomination.snapshot->>'profile'
      JOIN authentication_customuser actor ON actor.id = profile.user_id
      JOIN whitelist_whitelistchange approval ON approval.uuid = proposal.wallet_approval_id
      JOIN whitelist_companywalletinstruction wallet_source ON wallet_source.uuid = approval.source_instruction_id
      JOIN tokens_registerevidence authority ON authority.uuid = proposal.authority_evidence_id
      JOIN tokens_registerevidence terms ON terms.uuid = proposal.terms_evidence_id
      LEFT JOIN tokens_registerevidence acceptance ON acceptance.uuid = proposal.acceptance_evidence_id
      WHERE token.uuid = proposal.token_id AND company.uuid = proposal.company_id), false);
$$;
CREATE FUNCTION tokens_register_issue_source_current(proposal_uuid uuid) RETURNS boolean
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT COALESCE((SELECT proposal.status = 'applied' AND tokens_register_issue_ready(proposal)
        AND tokens_register_appointment_current(approval.appointment_id, proposal.company_id, approval.decided_by_id, 'approve', clock_timestamp())
        AND tokens_register_appointment_current(application.appointment_id, proposal.company_id, application.decided_by_id, 'apply', clock_timestamp())
        FROM tokens_registerinstruction proposal JOIN tokens_registerinstructiondecision approval ON approval.uuid = proposal.approval_decision_id
        JOIN tokens_registerinstructiondecision application ON application.instruction_id = proposal.uuid AND application.kind = 'apply'
        WHERE proposal.uuid = proposal_uuid AND approval.kind = 'approve' AND approval.instruction_id = proposal.uuid), false);
$$;
CREATE FUNCTION tokens_register_issue_decision_digest(proposal_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text) RETURNS text
LANGUAGE sql VOLATILE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT encode(sha256(convert_to(jsonb_build_object('proposal', to_jsonb(proposal), 'kind', decision_kind, 'actor', actor,
        'appointment', appointment_uuid, 'reason', decision_reason, 'head', to_jsonb(register),
        'ready', tokens_register_issue_ready(proposal), 'reserved', tokens_register_issue_reserved(proposal.token_id, proposal.request_id),
        'approval', tokens_register_issue_approval(proposal.uuid, clock_timestamp()))::text, 'UTF8')), 'hex')
    FROM tokens_registerinstruction proposal LEFT JOIN tokens_shareregister register ON register.token_id = proposal.token_id WHERE proposal.uuid = proposal_uuid;
$$;
CREATE FUNCTION tokens_guard_company_issue() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.preparing_appointment_id IS NOT NULL THEN RAISE EXCEPTION 'Retain company grant sources' USING ERRCODE = '23514'; END IF;
        RETURN OLD;
    END IF;
    IF NEW.preparing_appointment_id IS NULL THEN
        IF NEW.member_id IS NOT NULL OR NEW.nomination_id IS NOT NULL OR NEW.wallet_approval_id IS NOT NULL OR NEW.request_id IS NOT NULL
            OR NEW.snapshot IS NOT NULL OR NEW.intent IS NOT NULL OR NEW.approval_decision_id IS NOT NULL
            OR NEW.terms_on IS NOT NULL OR NEW.terms IS NOT NULL OR NEW.acceptance_required IS NOT NULL
            OR NEW.authority_evidence_id IS NOT NULL OR NEW.terms_evidence_id IS NOT NULL OR NEW.terms_fingerprint IS NOT NULL
            OR NEW.terms_snapshot IS NOT NULL OR NULLIF(NEW.terms_file, '') IS NOT NULL OR NEW.acceptance_evidence_id IS NOT NULL
            OR NEW.acceptance_fingerprint IS NOT NULL OR NEW.acceptance_snapshot IS NOT NULL OR NULLIF(NEW.acceptance_file, '') IS NOT NULL
            OR NEW.intent_digest IS NOT NULL THEN
            RAISE EXCEPTION 'Company issue provenance cannot be partial' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text THEN
        RAISE EXCEPTION 'Company issues require a bounded current personal company command' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_issue_prepare' OR NEW.submitted_by_id IS DISTINCT FROM principal
            OR NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.approval_decision_id IS NOT NULL
            OR NEW.source_document IS NOT NULL OR NEW.rejection_reason <> ''
            OR NOT EXISTS (SELECT 1 FROM tokens_shareissuancerequest request WHERE request.uuid = NEW.request_id
                AND request.status = 'under_review' AND request.reviewed_by_id IS NULL AND request.reviewed_at IS NULL)
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal, 'prepare', clock_timestamp())
            OR NOT tokens_register_issue_ready(NEW) THEN
            RAISE EXCEPTION 'Company preparation binds exact current grant terms and sources' USING ERRCODE = '23514';
        END IF;
    ELSE
        IF OLD.preparing_appointment_id IS NULL OR OLD.status <> 'submitted' OR NEW.status NOT IN ('applied', 'rejected')
            OR NEW.reviewed_by_id IS DISTINCT FROM principal OR NEW.reviewed_at IS NULL
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_issue_' || (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
            OR (to_jsonb(NEW) - ARRAY['status','approval_decision_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at'])
                IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','approval_decision_id','reviewed_by_id','reviewed_at','rejection_reason','updated_at'])
            OR NOT EXISTS (SELECT 1 FROM tokens_registerinstructiondecision decision WHERE decision.instruction_id = NEW.uuid
                AND decision.decided_by_id = principal AND decision.decided_at = NEW.reviewed_at
                AND decision.kind = (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END))
            OR (NEW.status = 'applied' AND (NEW.rejection_reason <> '' OR NEW.approval_decision_id IS DISTINCT FROM tokens_register_issue_approval(NEW.uuid, clock_timestamp())
                OR NOT tokens_register_issue_ready(NEW)))
            OR (NEW.status = 'rejected' AND (NEW.rejection_reason !~ '[^[:space:]]' OR NEW.approval_decision_id IS NOT NULL)) THEN
            RAISE EXCEPTION 'Company grant retains its exact immutable decision and outcome' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_company_issue_source BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerinstruction FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_issue();
CREATE FUNCTION tokens_check_company_issue_preparation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NEW.preparing_appointment_id IS NOT NULL AND (NOT tokens_register_issue_ready(NEW)
        OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, NEW.submitted_by_id, 'prepare', clock_timestamp())) THEN
        RAISE EXCEPTION 'Grant preparation commits only with its current exact company source' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_company_issue_preparation AFTER INSERT ON tokens_registerinstruction DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_issue_preparation();
CREATE FUNCTION tokens_guard_company_issue_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE proposal tokens_registerinstruction; principal bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Company grant decisions are append-only' USING ERRCODE = '23514'; END IF;
    SELECT * INTO proposal FROM tokens_registerinstruction WHERE uuid = NEW.instruction_id;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.preparing_appointment_id IS NULL OR proposal.status <> 'submitted'
        OR NEW.decided_by_id IS DISTINCT FROM principal OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_issue_' || NEW.kind
        OR NEW.kind NOT IN ('approve','apply','reject') OR (NEW.kind = 'reject') <> (NEW.reason ~ '[^[:space:]]')
        OR NEW.digest IS DISTINCT FROM tokens_register_issue_decision_digest(proposal.uuid, NEW.kind, principal, NEW.appointment_id, NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal, CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, clock_timestamp())
        OR (NEW.kind <> 'reject' AND NOT tokens_register_issue_ready(proposal))
        OR (NEW.kind = 'approve' AND tokens_register_issue_approved(proposal.uuid, clock_timestamp()))
        OR (NEW.kind = 'apply' AND NOT tokens_register_issue_approved(proposal.uuid, clock_timestamp())) THEN
        RAISE EXCEPTION 'Grant decisions bind exact current personal authority and source' USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := clock_timestamp();
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_company_issue_decision BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerinstructiondecision FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_issue_decision();
CREATE FUNCTION tokens_check_company_issue_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE proposal tokens_registerinstruction;
BEGIN
    SELECT * INTO proposal FROM tokens_registerinstruction WHERE uuid = NEW.instruction_id;
    IF NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, NEW.decided_by_id, CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, clock_timestamp())
        OR (NEW.kind = 'approve' AND (proposal.status <> 'submitted' OR NOT tokens_register_issue_ready(proposal)))
        OR (NEW.kind = 'reject' AND (proposal.status <> 'rejected' OR proposal.reviewed_by_id <> NEW.decided_by_id OR proposal.reviewed_at <> NEW.decided_at OR proposal.rejection_reason <> NEW.reason))
        OR (NEW.kind = 'apply' AND (NOT tokens_register_issue_source_current(proposal.uuid)
            OR proposal.reviewed_by_id <> NEW.decided_by_id OR proposal.reviewed_at <> NEW.decided_at OR NOT EXISTS (
                SELECT 1 FROM tokens_shareissuanceexecution execution WHERE execution.source_instruction_id = proposal.uuid AND execution.uuid = (
                    SELECT dispatch_id FROM tokens_shareissuancerequest WHERE uuid = proposal.request_id)
                    AND execution.request_id = proposal.request_id AND execution.company_id = proposal.company_id AND execution.token_id = proposal.token_id
                    AND execution.executed_by_id = NEW.decided_by_id AND execution.authority = 'company' AND execution.intent = proposal.intent))) THEN
        RAISE EXCEPTION 'Grant decisions retain current authority and their atomic original outcome at commit' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_company_issue_decision_effect AFTER INSERT ON tokens_registerinstructiondecision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_issue_decision();
CREATE FUNCTION tokens_guard_company_issue_execution() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE proposal tokens_registerinstruction;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.source_instruction_id IS DISTINCT FROM OLD.source_instruction_id THEN
        RAISE EXCEPTION 'Retain the original company issue execution source' USING ERRCODE = '23514';
    END IF;
    IF NEW.subscription_id IS NOT NULL THEN
        IF NEW.source_instruction_id IS NOT NULL THEN RAISE EXCEPTION 'Paid allotment has its genuine separate source' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.status = 'failed' AND NEW.status = 'queued') THEN
        PERFORM 1 FROM tokens_sharetoken WHERE uuid = NEW.token_id FOR UPDATE;
        PERFORM 1 FROM tokens_shareregister WHERE token_id = NEW.token_id FOR UPDATE;
        SELECT * INTO proposal FROM tokens_registerinstruction WHERE uuid = NEW.source_instruction_id;
        IF proposal.uuid IS NULL OR NEW.authority <> 'company' OR NOT tokens_register_issue_source_current(proposal.uuid)
            OR proposal.request_id IS DISTINCT FROM NEW.request_id OR proposal.company_id IS DISTINCT FROM NEW.company_id
            OR proposal.token_id IS DISTINCT FROM NEW.token_id OR proposal.intent IS DISTINCT FROM NEW.intent OR proposal.reviewed_by_id IS DISTINCT FROM NEW.executed_by_id
            OR (TG_OP = 'INSERT' AND (current_setting('app.company_operation', true) IS DISTINCT FROM 'register_issue_apply'
                OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
                OR current_setting('app.user_id', true) IS DISTINCT FROM proposal.reviewed_by_id::text)) THEN
            RAISE EXCEPTION 'Fresh corporate issuance requires its exact current original company admission' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_company_issue_execution BEFORE INSERT OR UPDATE ON tokens_shareissuanceexecution FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_issue_execution();
CREATE FUNCTION tokens_check_company_issue_execution() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NEW.subscription_id IS NULL AND (TG_OP = 'INSERT' OR (OLD.status = 'failed' AND NEW.status = 'queued'))
        AND NOT tokens_register_issue_source_current(NEW.source_instruction_id) THEN
        RAISE EXCEPTION 'Fresh issue admission and retry commit only with the original current company source' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_company_issue_execution_effect AFTER INSERT OR UPDATE ON tokens_shareissuanceexecution
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_issue_execution();
CREATE FUNCTION tokens_check_company_issue_signature() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE operation blockchain_outgoingoperation; execution tokens_shareissuanceexecution;
BEGIN
    SELECT * INTO operation FROM blockchain_outgoingoperation WHERE uuid = NEW.operation_id;
    SELECT * INTO execution FROM tokens_shareissuanceexecution WHERE operation_id = NEW.operation_id;
    IF operation.operation_key LIKE 'share-issuance:%' AND execution.uuid IS NULL THEN RAISE EXCEPTION 'A fresh issuance signature requires its genuine retained journal' USING ERRCODE = '23514'; END IF;
    IF execution.uuid IS NULL OR execution.subscription_id IS NOT NULL THEN RETURN NEW; END IF;
    IF execution.source_instruction_id IS NULL OR execution.authority <> 'company' OR NEW.claim_id IS DISTINCT FROM operation.claim_id
        OR NOT tokens_register_issue_source_current(execution.source_instruction_id) THEN
        RAISE EXCEPTION 'Fresh issuance signatures require the current original company source' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_company_issue_signature BEFORE INSERT ON blockchain_signedattempt FOR EACH ROW EXECUTE FUNCTION tokens_check_company_issue_signature();
CREATE CONSTRAINT TRIGGER tokens_company_issue_signature_effect AFTER INSERT ON blockchain_signedattempt DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_issue_signature();
CREATE FUNCTION tokens_check_company_issue_request() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IN ('draft','submitted','under_review'))
        AND NOT EXISTS (SELECT 1 FROM tokens_registerinstruction proposal JOIN tokens_registerinstructiondecision application
            ON application.instruction_id = proposal.uuid AND application.kind = 'apply'
            WHERE proposal.request_id = NEW.uuid AND proposal.preparing_appointment_id IS NOT NULL AND proposal.status = 'applied'
                AND application.decided_by_id = NEW.reviewed_by_id AND application.decided_at = NEW.reviewed_at
                AND tokens_register_issue_source_current(proposal.uuid))
        AND NOT EXISTS (SELECT 1 FROM offerings_subscription subscription JOIN offerings_offering offering ON offering.uuid = subscription.offering_id
            JOIN wallets wallet ON wallet.uuid = subscription.wallet_id WHERE subscription.issuance_request_id = NEW.uuid
                AND subscription.company_id = NEW.company_id AND offering.token_id = NEW.token_id
                AND lower(wallet.address) = lower(NEW.recipient_address) AND COALESCE(subscription.allotted_quantity, subscription.quantity) = NEW.amount) THEN
        RAISE EXCEPTION 'Fresh approval commits only with its genuine original paid or company source' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_company_issue_request_source AFTER INSERT OR UPDATE ON tokens_shareissuancerequest
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_company_issue_request();
CREATE FUNCTION tokens_guard_company_issue_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE execution tokens_shareissuanceexecution; proposal tokens_registerinstruction;
BEGIN
    IF NEW.kind <> 'issue' THEN RETURN NEW; END IF;
    SELECT * INTO execution FROM tokens_shareissuanceexecution WHERE issuance_id = NEW.operation_id AND source_instruction_id IS NOT NULL;
    IF execution.uuid IS NULL THEN RETURN NEW; END IF;
    SELECT * INTO proposal FROM tokens_registerinstruction WHERE uuid = execution.source_instruction_id;
    IF execution.status <> 'executed' OR proposal.status <> 'applied' OR execution.finalized_receipt IS NULL
        OR NEW.recorded_by_id IS DISTINCT FROM proposal.reviewed_by_id OR NEW.corrects_id IS NOT NULL
        OR NEW.effective_on IS DISTINCT FROM (clock_timestamp() AT TIME ZONE 'UTC')::date
        OR NEW.changes IS DISTINCT FROM jsonb_build_array(jsonb_build_object('member', proposal.member_id, 'shares', execution.intent->>'amount'))
        OR NOT EXISTS (SELECT 1 FROM tokens_shareregister register WHERE register.uuid = NEW.register_id AND register.token_id = execution.token_id
            AND register.company_id = execution.company_id AND register.uuid::text = proposal.snapshot->'register'->>'uuid') THEN
        RAISE EXCEPTION 'Finalised company issue retains its original member, journal and actual entry day' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_company_issue_entry BEFORE INSERT ON tokens_registerentry FOR EACH ROW EXECUTE FUNCTION tokens_guard_company_issue_entry();
"""

OLD_INSTRUCTION = IMPORT_OPENING.INSTRUCTION_GUARD
INSTRUCTION = OLD_INSTRUCTION.replace(
    "    IF TG_OP = 'INSERT' THEN",
    """    IF NEW.preparing_appointment_id IS NOT NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'INSERT' AND NEW.kind = 'issue' AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(NEW.items) item JOIN tokens_shareissuancerequest request
            ON request.uuid::text = item->>'request' WHERE request.status IN ('draft','submitted','under_review')) THEN
        RAISE EXCEPTION 'New non-paid grants require their retained company decision' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN""",
    1,
)
OLD_REVIEW = PREVIOUS._function(INSTRUCTIONS.GUARDS, "tokens_guard_issuance_review")
REVIEW = OLD_REVIEW.replace(
    "    IF current_user =",
    """    IF EXISTS (SELECT 1 FROM tokens_registerinstruction proposal WHERE proposal.request_id = NEW.uuid AND proposal.preparing_appointment_id IS NOT NULL) THEN
        IF TG_OP = 'UPDATE' AND ROW(NEW.uuid, NEW.created_at, NEW.dispatch_id, NEW.company_id, NEW.token_id, NEW.amount,
            NEW.recipient_address, NEW.recipient_name, NEW.issuance_type, NEW.reason, NEW.submitted_by_id, NEW.submitted_at,
            NEW.dilution_percentage, NEW.review_notes) IS DISTINCT FROM ROW(OLD.uuid, OLD.created_at, OLD.dispatch_id,
            OLD.company_id, OLD.token_id, OLD.amount, OLD.recipient_address, OLD.recipient_name, OLD.issuance_type, OLD.reason,
            OLD.submitted_by_id, OLD.submitted_at, OLD.dilution_percentage, OLD.review_notes) THEN
            RAISE EXCEPTION 'Prepared company grant request terms and original actor are immutable' USING ERRCODE = '23514';
        END IF;
        IF TG_OP = 'UPDATE' AND (ROW(NEW.reviewed_by_id, NEW.reviewed_at, NEW.rejection_reason)
            IS DISTINCT FROM ROW(OLD.reviewed_by_id, OLD.reviewed_at, OLD.rejection_reason)
            OR (OLD.status = 'under_review' AND NEW.status IS DISTINCT FROM OLD.status)) AND NOT EXISTS (
            SELECT 1 FROM tokens_registerinstruction proposal JOIN tokens_registerinstructiondecision decision ON decision.instruction_id = proposal.uuid
            WHERE proposal.request_id = NEW.uuid AND decision.decided_by_id = NEW.reviewed_by_id AND decision.decided_at = NEW.reviewed_at
                AND decision.kind = (CASE NEW.status WHEN 'approved' THEN 'apply' WHEN 'rejected' THEN 'reject' ELSE '' END)
                AND current_setting('app.company_operation', true) = 'register_issue_' || decision.kind
                AND current_setting('app.user_id', true) = decision.decided_by_id::text
                AND (NEW.status <> 'rejected' OR NEW.rejection_reason = decision.reason)
                AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id, decision.decided_by_id,
                    CASE decision.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, clock_timestamp())) THEN
            RAISE EXCEPTION 'Request review requires its exact company grant decision' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF NEW.status = 'approved' AND (TG_OP = 'INSERT' OR OLD.status IN ('draft','submitted','under_review'))
        AND NOT EXISTS (SELECT 1 FROM offerings_subscription subscription JOIN offerings_offering offering ON offering.uuid = subscription.offering_id
            JOIN wallets wallet ON wallet.uuid = subscription.wallet_id
            WHERE subscription.issuance_request_id = NEW.uuid OR (subscription.issuance_request_id IS NULL
                AND subscription.status = 'paid' AND subscription.company_id = NEW.company_id AND offering.token_id = NEW.token_id
                AND lower(wallet.address) = lower(NEW.recipient_address) AND COALESCE(subscription.allotted_quantity, subscription.quantity) = NEW.amount)) THEN
        RAISE EXCEPTION 'New non-paid issue approval requires its genuine company source' USING ERRCODE = '23514';
    END IF;
    IF current_user =""",
    1,
)
OLD_EXECUTION = PREVIOUS.ISSUANCE_GUARD
EXECUTION = OLD_EXECUTION.replace(
    "    ELSIF NEW.authority <> 'tokens.change_shareissuancerequest' THEN",
    "    ELSIF NEW.authority <> 'tokens.change_shareissuancerequest' AND NOT (NEW.authority = 'company' AND NEW.source_instruction_id IS NOT NULL) THEN",
)


def install(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute("SELECT quote_literal(%s)", [settings.RLS_ROLES["app"]])
        app_role = cursor.fetchone()[0]
        cursor.execute(
            PREVIOUS.IMPORTS._with_roles(
                cursor, (FUNCTIONS + INSTRUCTION + REVIEW + EXECUTION).replace("%(app)s", app_role)
            )
        )


def reverse(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "LOCK TABLE tokens_registerinstruction, tokens_registerinstructiondecision, tokens_shareissuanceexecution IN ACCESS EXCLUSIVE MODE"
        )
        cursor.execute(
            "SELECT EXISTS (SELECT 1 FROM tokens_registerinstruction WHERE preparing_appointment_id IS NOT NULL) OR EXISTS (SELECT 1 FROM tokens_registerinstructiondecision) OR EXISTS (SELECT 1 FROM tokens_shareissuanceexecution WHERE source_instruction_id IS NOT NULL)"
        )
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain company issue sources, decisions and original execution history.")
        for trigger, table in (
            ("tokens_company_issue_entry", "tokens_registerentry"),
            ("tokens_company_issue_request_source", "tokens_shareissuancerequest"),
            ("tokens_company_issue_signature_effect", "blockchain_signedattempt"),
            ("tokens_company_issue_signature", "blockchain_signedattempt"),
            ("tokens_company_issue_execution_effect", "tokens_shareissuanceexecution"),
            ("tokens_company_issue_execution", "tokens_shareissuanceexecution"),
            ("tokens_company_issue_decision_effect", "tokens_registerinstructiondecision"),
            ("tokens_company_issue_decision", "tokens_registerinstructiondecision"),
            ("tokens_company_issue_preparation", "tokens_registerinstruction"),
            ("tokens_company_issue_source", "tokens_registerinstruction"),
        ):
            cursor.execute(f"DROP TRIGGER {trigger} ON {table}")
        for name in (
            "tokens_guard_company_issue_entry",
            "tokens_check_company_issue_request",
            "tokens_check_company_issue_signature",
            "tokens_check_company_issue_execution",
            "tokens_guard_company_issue_execution",
            "tokens_check_company_issue_decision",
            "tokens_guard_company_issue_decision",
            "tokens_check_company_issue_preparation",
            "tokens_guard_company_issue",
        ):
            cursor.execute(f"DROP FUNCTION {name}()")
        cursor.execute("DROP FUNCTION tokens_register_issue_decision_digest(uuid,text,bigint,uuid,text)")
        cursor.execute("DROP FUNCTION tokens_register_issue_source_current(uuid)")
        cursor.execute("DROP FUNCTION tokens_register_issue_ready(tokens_registerinstruction)")
        cursor.execute("DROP FUNCTION tokens_register_issue_reserved(uuid,uuid)")
        cursor.execute("DROP FUNCTION tokens_register_issue_approved(uuid,timestamptz)")
        cursor.execute("DROP FUNCTION tokens_register_issue_approval(uuid,timestamptz)")
        cursor.execute("SELECT quote_literal(%s)", [settings.RLS_ROLES["app"]])
        app_role = cursor.fetchone()[0]
        cursor.execute(
            PREVIOUS.IMPORTS._with_roles(
                cursor, (OLD_INSTRUCTION + OLD_REVIEW + OLD_EXECUTION).replace("%(app)s", app_role)
            )
        )


class Migration(migrations.Migration):
    dependencies = [("tokens", "0100_company_register_issue_instructions")]
    operations = [migrations.RunPython(install, reverse)]
