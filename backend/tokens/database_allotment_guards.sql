CREATE FUNCTION tokens_allotment_evidence_matches(evidence_uuid uuid, issuer uuid, actor bigint,
    evidence_kind text, fingerprint text, snapshot jsonb, retained_file text, source_uuid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_registerevidence evidence WHERE evidence.uuid = evidence_uuid
        AND evidence.company_id = issuer AND evidence.uploaded_by_id = actor AND evidence.kind = evidence_kind
        AND fingerprint = evidence.sha256 AND snapshot = tokens_register_evidence_snapshot(evidence)
        AND retained_file ~ ('^companies/' || issuer || '/register-allotments/' || source_uuid || '/[0-9a-f-]{36}[.]bin$'));
$$;
CREATE FUNCTION tokens_allotment_sources_match(proposal tokens_registerallotment) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_registeragreement agreement
        JOIN tokens_registercontribution receipt ON receipt.agreement_id = agreement.uuid
        WHERE agreement.uuid = proposal.agreement_id AND receipt.uuid = proposal.contribution_id
            AND agreement.company_id = proposal.company_id AND receipt.company_id = proposal.company_id
            AND agreement.recorded_by_id = proposal.submitted_by_id AND receipt.recorded_by_id = proposal.submitted_by_id
            AND agreement.preparing_appointment_id = proposal.preparing_appointment_id
            AND receipt.preparing_appointment_id = proposal.preparing_appointment_id
            AND agreement.created_at <= proposal.created_at AND receipt.created_at <= proposal.created_at
            AND receipt.amount = proposal.consideration AND receipt.currency = proposal.currency AND receipt.currency = 'AUD'
            AND tokens_allotment_evidence_matches(agreement.evidence_id, agreement.company_id, agreement.recorded_by_id,
                'supporting', agreement.evidence_fingerprint, agreement.evidence_snapshot, agreement.file, agreement.uuid)
            AND tokens_allotment_evidence_matches(receipt.evidence_id, receipt.company_id, receipt.recorded_by_id,
                'supporting', receipt.evidence_fingerprint, receipt.evidence_snapshot, receipt.file, receipt.uuid));
$$;
CREATE FUNCTION tokens_guard_allotment_source() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint; agreement tokens_registeragreement; at_time timestamptz;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'External agreements and company receipt attestations are immutable retained sources' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
        OR NEW.recorded_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_allotment_prepare'
        OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
        OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal, 'prepare', at_time)
        OR NOT tokens_allotment_evidence_matches(NEW.evidence_id, NEW.company_id, principal, 'supporting',
            NEW.evidence_fingerprint, NEW.evidence_snapshot, NEW.file, NEW.uuid) THEN
        RAISE EXCEPTION 'External capital sources require exact current personal company authority and evidence' USING ERRCODE = '23514';
    END IF;
    IF TG_TABLE_NAME = 'tokens_registeragreement' THEN
        IF NEW.reference !~ '[^[:space:]]' OR NEW.terms !~ '[^[:space:]]'
            OR NEW.agreed_on > (at_time AT TIME ZONE 'UTC')::date THEN
            RAISE EXCEPTION 'Retain the external agreement reference, date and terms' USING ERRCODE = '23514';
        END IF;
    ELSE
        SELECT * INTO agreement FROM tokens_registeragreement WHERE uuid = NEW.agreement_id FOR UPDATE;
        IF agreement.uuid IS NULL OR agreement.company_id IS DISTINCT FROM NEW.company_id
            OR agreement.recorded_by_id IS DISTINCT FROM principal
            OR agreement.preparing_appointment_id IS DISTINCT FROM NEW.preparing_appointment_id
            OR NEW.currency <> 'AUD' OR NEW.amount <= 0 OR NEW.amount > 999999999999999999.99
            OR NEW.amount <> trunc(NEW.amount, 2) OR NEW.received_on > (at_time AT TIME ZONE 'UTC')::date THEN
            RAISE EXCEPTION 'Record an exact positive AUD receipt allocated to the retained agreement' USING ERRCODE = '23514';
        END IF;
    END IF;
    NEW.created_at := at_time; NEW.updated_at := at_time;
    RETURN NEW;
END;
$$;
CREATE FUNCTION tokens_check_allotment_source() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id,
        NEW.recorded_by_id, 'prepare', clock_timestamp()) OR NOT EXISTS (
            SELECT 1 FROM tokens_registerallotment proposal WHERE proposal.company_id = NEW.company_id
                AND CASE WHEN TG_TABLE_NAME = 'tokens_registeragreement' THEN proposal.agreement_id = NEW.uuid
                    ELSE proposal.contribution_id = NEW.uuid END AND tokens_allotment_sources_match(proposal)) THEN
        RAISE EXCEPTION 'Capital sources retain their exact allotment and current recording authority at commit' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER tokens_allotment_agreement_identity BEFORE INSERT OR UPDATE OR DELETE ON tokens_registeragreement
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_allotment_source();
CREATE TRIGGER tokens_allotment_receipt_identity BEFORE INSERT OR UPDATE OR DELETE ON tokens_registercontribution
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_allotment_source();
CREATE CONSTRAINT TRIGGER tokens_allotment_agreement_commit AFTER INSERT ON tokens_registeragreement
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_allotment_source();
CREATE CONSTRAINT TRIGGER tokens_allotment_receipt_commit AFTER INSERT ON tokens_registercontribution
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_allotment_source();


CREATE OR REPLACE FUNCTION public.tokens_register_allotment_approved(allotment_uuid uuid, at_time timestamp with time zone)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM tokens_registerallotmentdecision decision
        JOIN tokens_registerallotment proposal ON proposal.uuid = decision.register_allotment_id
        WHERE proposal.uuid = allotment_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
                decision.decided_by_id, 'approve', at_time));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_allotment_ready(proposal tokens_registerallotment, before_effect boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM tokens_sharetoken token JOIN tokens_shareregister register ON register.token_id = token.uuid
        WHERE token.uuid = proposal.token_id AND token.company_id = proposal.company_id AND token.status = 'draft'
            AND NULLIF(token.contract_address, '') IS NULL AND token.deployment_id IS NULL
            AND token.deployment_transaction_id IS NULL AND NULLIF(token.deployment_tx_hash, '') IS NULL
            AND token.deployed_at IS NULL AND NULLIF(token.chain, '') IS NULL AND register.sequence > 0
            AND token.total_supply ~ '^[1-9][0-9]{0,77}$'
            AND register.issued_supply + proposal.shares <= token.total_supply::numeric
            AND register.issued_supply + proposal.shares < 2::numeric^256
            AND EXISTS (SELECT 1 FROM tokens_registerimport source WHERE source.token_id = token.uuid AND source.status = 'applied')
            AND tokens_register_company_date_ready(to_jsonb(proposal)))
        AND lower(btrim(regexp_replace(proposal.approving_director, '[[:space:]]+', ' ', 'g')))
            <> lower(btrim(regexp_replace(proposal.name, '[[:space:]]+', ' ', 'g')))
        AND NOT EXISTS (SELECT 1 FROM tokens_registermemberwallet wallet WHERE wallet.company_id = proposal.company_id AND wallet.member_id = proposal.member)
        AND CASE WHEN proposal.new_member AND before_effect THEN
            NOT EXISTS (SELECT 1 FROM tokens_registermember member WHERE member.uuid = proposal.member)
        ELSE EXISTS (SELECT 1 FROM tokens_registermember member JOIN tokens_registermemberparticulars held ON held.member_id = member.uuid
            WHERE member.uuid = proposal.member AND member.company_id = proposal.company_id
                AND held.name = proposal.name AND held.residential_address = proposal.residential_address
                AND (NOT proposal.new_member OR (held.source_allotment_id = proposal.uuid
                    AND held.as_at = (clock_timestamp() AT TIME ZONE 'UTC')::date))) END AND tokens_allotment_sources_match(proposal);
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_allotment_decision_digest(allotment_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT encode(sha256(convert_to(jsonb_build_object('version', '1', 'allotment', (to_jsonb(proposal) - CASE WHEN to_jsonb(proposal)->>'company_event_on' IS NULL THEN 'company_event_on' ELSE '' END), 'agreement', to_jsonb(agreement), 'contribution', to_jsonb(receipt),
        'effective_on', CASE WHEN to_jsonb(proposal)->>'company_event_on' IS NULL THEN (clock_timestamp() AT TIME ZONE 'UTC')::date ELSE (to_jsonb(proposal)->>'company_event_on')::date END,
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid, 'reason', decision_reason,
        'register', to_jsonb(register), 'authorised_supply', token.total_supply,
        'token_status', token.status, 'deployment', token.deployment_id, 'contract', token.contract_address,
        'legacy_hash', token.deployment_tx_hash, 'deployed_at', token.deployed_at, 'chain', token.chain,
        'particulars', (SELECT to_jsonb(held) - CASE WHEN to_jsonb(held)->>'source_award_id' IS NULL THEN 'source_award_id' ELSE '' END
            FROM tokens_registermemberparticulars held
            WHERE held.member_id = proposal.member))::text, 'UTF8')), 'hex')
    FROM tokens_registerallotment proposal JOIN tokens_sharetoken token ON token.uuid = proposal.token_id
        LEFT JOIN tokens_shareregister register ON register.token_id = token.uuid
        JOIN tokens_registeragreement agreement ON agreement.uuid = proposal.agreement_id
        JOIN tokens_registercontribution receipt ON receipt.uuid = proposal.contribution_id WHERE proposal.uuid = allotment_uuid;
$function$;

CREATE OR REPLACE FUNCTION tokens_guard_register_allotment() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain register allotments and their evidence' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = NEW.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_shareregister WHERE token_id = NEW.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_registeragreement WHERE uuid = NEW.agreement_id FOR UPDATE;
    PERFORM 1 FROM tokens_registercontribution WHERE uuid = NEW.contribution_id FOR UPDATE;
    IF TG_OP = 'INSERT' THEN
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
            OR NEW.submitted_by_id IS DISTINCT FROM principal
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_allotment_prepare'
            OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal, 'prepare', clock_timestamp())
            OR NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.register_entry_id IS NOT NULL OR NEW.rejection_reason <> ''
            OR NEW.name !~ '[^[:space:]]' OR NEW.residential_address !~ '[^[:space:]]'
            OR length(NEW.residential_address) > 1000
            OR NEW.authority_reference !~ '[^[:space:]]' OR NEW.reason !~ '[^[:space:]]'
            OR NEW.approving_director !~ '[^[:space:]]' OR NEW.shares <= 0 OR NEW.shares >= 2::numeric^256
            OR NEW.shares <> trunc(NEW.shares) OR NEW.currency <> 'AUD' OR NEW.consideration <= 0
            OR NEW.consideration > 999999999999999999.99 OR NEW.consideration <> trunc(NEW.consideration, 2)
            OR NOT tokens_register_allotment_ready(NEW, true)
            OR NOT tokens_allotment_evidence_matches(NEW.authority_evidence_id, NEW.company_id, principal,
                'authority', NEW.evidence_fingerprint, NEW.evidence_snapshot, NEW.file, NEW.uuid)
        THEN
            RAISE EXCEPTION 'Register allotments require exact current authority, fully paid sources, identity and evidence' USING ERRCODE = '23514';
        END IF;
        NEW.created_at := clock_timestamp(); NEW.updated_at := NEW.created_at;
        RETURN NEW;
    END IF;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR OLD.status <> 'submitted' OR principal IS NULL
        OR NEW.status NOT IN ('applied', 'rejected')
        OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_allotment_' || (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
        OR (to_jsonb(NEW) - ARRAY['status', 'register_entry_id', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
            IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'register_entry_id', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
        OR NEW.reviewed_at IS NULL OR NEW.reviewed_by_id IS DISTINCT FROM principal
        OR NOT EXISTS (SELECT 1 FROM tokens_registerallotmentdecision decision WHERE decision.register_allotment_id = NEW.uuid
            AND decision.decided_by_id = principal AND decision.decided_at = NEW.reviewed_at
            AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
            AND (NEW.status = 'applied' OR decision.reason = NEW.rejection_reason))
        OR (NEW.status = 'applied' AND (NEW.rejection_reason <> '' OR NOT EXISTS (
            SELECT 1 FROM tokens_registerentry entry JOIN tokens_shareregister register ON register.uuid = entry.register_id
            WHERE entry.uuid = NEW.register_entry_id AND register.token_id = NEW.token_id AND entry.operation_id = NEW.uuid
                AND entry.kind = 'issue' AND entry.recorded_by_id = principal AND entry.created_at >= NEW.reviewed_at AND entry.effective_on = (to_jsonb(NEW)->>'company_event_on')::date
                AND entry.changes = jsonb_build_array(jsonb_build_object('member', NEW.member::text, 'shares', NEW.shares::text)))))
        OR (NEW.status = 'rejected' AND (NEW.register_entry_id IS NOT NULL OR NEW.rejection_reason !~ '[^[:space:]]'))
    THEN
        RAISE EXCEPTION 'Only the exact company decision may decide an immutable register allotment' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION tokens_guard_register_allotment_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint; at_time timestamptz; proposal tokens_registerallotment;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Register allotment decisions are append-only' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    SELECT * INTO proposal FROM tokens_registerallotment WHERE uuid = NEW.register_allotment_id;
    PERFORM 1 FROM companies_company WHERE uuid = proposal.company_id FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = proposal.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_shareregister WHERE token_id = proposal.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_registeragreement WHERE uuid = proposal.agreement_id FOR UPDATE;
    PERFORM 1 FROM tokens_registercontribution WHERE uuid = proposal.contribution_id FOR UPDATE;
    SELECT * INTO proposal FROM tokens_registerallotment WHERE uuid = NEW.register_allotment_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR NEW.decided_by_id IS DISTINCT FROM principal OR proposal.status <> 'submitted'
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_allotment_' || NEW.kind
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR NEW.kind NOT IN ('approve', 'apply', 'reject') OR (NEW.kind = 'reject') <> (NEW.reason ~ '[^[:space:]]')
        OR NEW.digest IS DISTINCT FROM tokens_register_allotment_decision_digest(proposal.uuid, NEW.kind, principal, NEW.appointment_id, NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'approve' AND tokens_register_allotment_approved(proposal.uuid, at_time))
        OR (NEW.kind = 'apply' AND NOT tokens_register_allotment_approved(proposal.uuid, at_time))
        OR (NEW.kind <> 'reject' AND NOT tokens_register_allotment_ready(proposal, true))
    THEN
        RAISE EXCEPTION 'Register allotment decisions need exact current company authority and effect' USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := at_time; NEW.created_at := at_time; NEW.updated_at := at_time;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tokens_check_register_allotment_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registerallotment; at_time timestamptz;
BEGIN
    SELECT * INTO proposal FROM tokens_registerallotment WHERE uuid = NEW.register_allotment_id;
    at_time := clock_timestamp();
    IF NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, NEW.decided_by_id,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'apply' AND NOT tokens_register_allotment_approved(proposal.uuid, at_time))
        OR (NEW.kind <> 'reject' AND NOT tokens_allotment_sources_match(proposal))
        OR (NEW.kind = 'approve' AND (proposal.created_at >= NEW.decided_at OR
            (SELECT created_at FROM tokens_registercontribution WHERE uuid = proposal.contribution_id) >= NEW.decided_at))
    THEN
        RAISE EXCEPTION 'Register allotment authority and approval must remain current at commit' USING ERRCODE = '23514';
    END IF;
    IF (NEW.kind = 'approve' AND proposal.status <> 'submitted')
        OR (NEW.kind <> 'approve' AND (proposal.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END
            OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR (NEW.kind = 'reject' AND proposal.rejection_reason IS DISTINCT FROM NEW.reason)))
    THEN
        RAISE EXCEPTION 'A register allotment decision must carry exactly its own effect' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;

CREATE FUNCTION tokens_check_allotment_preparation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id,
        NEW.submitted_by_id, 'prepare', clock_timestamp()) OR NOT tokens_register_allotment_ready(NEW, true) THEN
        RAISE EXCEPTION 'Allotment preparation requires current authority and exact fully paid sources at commit' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER tokens_allotment_identity BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerallotment
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_allotment();
CREATE TRIGGER tokens_allotment_decision_guard BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerallotmentdecision
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_allotment_decision();
CREATE CONSTRAINT TRIGGER tokens_allotment_preparation_commit AFTER INSERT ON tokens_registerallotment
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_allotment_preparation();
CREATE CONSTRAINT TRIGGER tokens_allotment_decision_commit AFTER INSERT ON tokens_registerallotmentdecision
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_register_allotment_decision();


CREATE OR REPLACE FUNCTION tokens_guard_allotment_register_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE proposal tokens_registerallotment; principal bigint; issuer uuid; token_uuid uuid;
BEGIN
    SELECT company_id, token_id INTO issuer, token_uuid FROM tokens_shareregister WHERE uuid = NEW.register_id;
    SELECT * INTO proposal FROM tokens_registerallotment WHERE uuid = NEW.operation_id;
    IF proposal.uuid IS NULL AND current_setting('app.company_operation', true) IS DISTINCT FROM 'register_allotment_apply'
 THEN
        RETURN NEW;
    END IF;
    PERFORM 1 FROM companies_company WHERE uuid = proposal.company_id FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = proposal.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_shareregister WHERE token_id = proposal.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_registeragreement WHERE uuid = proposal.agreement_id FOR UPDATE;
    PERFORM 1 FROM tokens_registercontribution WHERE uuid = proposal.contribution_id FOR UPDATE;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_allotment_apply'
        OR current_setting('app.company_id', true) IS DISTINCT FROM issuer::text
        OR proposal.company_id IS DISTINCT FROM issuer OR proposal.token_id IS DISTINCT FROM token_uuid OR proposal.status <> 'submitted'
        OR NEW.kind <> 'issue' OR NEW.recorded_by_id IS DISTINCT FROM principal OR NEW.effective_on IS DISTINCT FROM (to_jsonb(proposal)->>'company_event_on')::date
        OR NEW.changes IS DISTINCT FROM jsonb_build_array(jsonb_build_object('member', proposal.member::text, 'shares', proposal.shares::text))
        OR NOT tokens_register_allotment_ready(proposal, false) OR NOT tokens_register_allotment_approved(proposal.uuid, clock_timestamp())
        OR NOT EXISTS (SELECT 1 FROM tokens_registerallotmentdecision decision WHERE decision.register_allotment_id = proposal.uuid
            AND decision.kind = 'apply' AND decision.decided_by_id = principal
            AND tokens_register_appointment_current(decision.appointment_id, issuer, principal, 'apply', clock_timestamp()))
    THEN
        RAISE EXCEPTION 'A non-tokenised allotment entry requires its exact current company application' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tokens_allotment_register_entry BEFORE INSERT ON tokens_registerentry
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_allotment_register_entry();

CREATE OR REPLACE FUNCTION tokens_guard_grant_register_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE proposal tokens_registergrant; principal bigint; issuer uuid; token_uuid uuid;
BEGIN
    IF current_setting('app.company_operation', true) = 'register_allotment_apply'
        OR EXISTS (SELECT 1 FROM tokens_registerallotment WHERE uuid = NEW.operation_id) THEN RETURN NEW; END IF;
    SELECT company_id, token_id INTO issuer, token_uuid FROM tokens_shareregister WHERE uuid = NEW.register_id;
    SELECT * INTO proposal FROM tokens_registergrant WHERE uuid = NEW.operation_id;
    IF proposal.uuid IS NULL AND current_setting('app.company_operation', true) IS DISTINCT FROM 'register_grant_apply'
        AND NOT (NEW.kind = 'issue' AND EXISTS (SELECT 1 FROM tokens_registerimport source JOIN tokens_sharetoken token ON token.uuid = source.token_id
            WHERE source.token_id = token_uuid AND source.status = 'applied' AND NULLIF(token.contract_address, '') IS NULL)) THEN
        RETURN NEW;
    END IF;
    PERFORM 1 FROM companies_company WHERE uuid = proposal.company_id FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = proposal.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_shareregister WHERE token_id = proposal.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_registeraward WHERE uuid = proposal.award_id FOR UPDATE;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_grant_apply'
        OR current_setting('app.company_id', true) IS DISTINCT FROM issuer::text
        OR proposal.company_id IS DISTINCT FROM issuer OR proposal.token_id IS DISTINCT FROM token_uuid OR proposal.status <> 'submitted'
        OR NEW.kind <> 'issue' OR NEW.recorded_by_id IS DISTINCT FROM principal OR NEW.effective_on IS DISTINCT FROM (to_jsonb(proposal)->>'company_event_on')::date
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

CREATE OR REPLACE FUNCTION public.tokens_guard_allotment_member()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE principal bigint;
BEGIN
    IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_allotment_apply' THEN RETURN NEW; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF NOT EXISTS (SELECT 1 FROM tokens_registerallotment proposal JOIN tokens_registerallotmentdecision decision ON decision.register_allotment_id = proposal.uuid
        WHERE proposal.member = NEW.uuid AND proposal.new_member AND proposal.company_id = NEW.company_id
            AND proposal.status = 'submitted' AND decision.kind = 'apply' AND decision.decided_by_id = principal
            AND current_setting('app.company_id', true) = NEW.company_id::text
            AND tokens_register_allotment_ready(proposal, true)
            AND tokens_register_allotment_approved(proposal.uuid, clock_timestamp())
            AND tokens_register_appointment_current(decision.appointment_id, NEW.company_id, principal, 'apply', clock_timestamp()))
    THEN RAISE EXCEPTION 'A new allotment member requires the exact company application' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$function$;

CREATE TRIGGER tokens_allotment_member BEFORE INSERT ON tokens_registermember
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_allotment_member();

CREATE OR REPLACE FUNCTION public.tokens_guard_register_member_particulars()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    principal bigint;
    proposal tokens_registerparticularschange;
    source tokens_registerimport;
BEGIN
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) THEN
        RAISE EXCEPTION 'Only the register''s own commands write member particulars' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF COALESCE(current_setting('app.company_operation', true), '') <> '' THEN
            RAISE EXCEPTION 'Only the retention purge removes member particulars' USING ERRCODE = '23514';
        END IF;
        IF EXISTS (SELECT 1 FROM tokens_registerposition position WHERE position.member_id = OLD.member_id AND position.shares > 0)
            OR EXISTS (SELECT 1 FROM tokens_registeraward award WHERE award.member = OLD.member_id)
            OR tokens_register_member_left_on(OLD.member_id) IS NULL
            OR tokens_register_member_left_on(OLD.member_id) >= (clock_timestamp() AT TIME ZONE 'UTC')::date - 2557 THEN
            RAISE EXCEPTION 'Member particulars retain the actual exit clock and continued membership' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND (OLD.member_id IS DISTINCT FROM NEW.member_id OR OLD.as_at > NEW.as_at) THEN
        RAISE EXCEPTION 'Member particulars stay with their member and never move to an earlier date'
            USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF NEW.source_award_id IS NOT NULL THEN
        IF TG_OP <> 'INSERT' OR NOT EXISTS (
            SELECT 1 FROM tokens_registeraward award JOIN tokens_registermember member ON member.uuid = award.member
            WHERE award.uuid = NEW.source_award_id AND award.new_member AND award.member = NEW.member_id
                AND member.company_id = award.company_id
                AND award.name = NEW.name AND award.residential_address = NEW.residential_address
                AND ((principal IS NOT NULL AND award.submitted_by_id = principal
                        AND current_setting('app.company_operation', true) = 'register_award_record'
                        AND current_setting('app.company_id', true) = award.company_id::text
                        AND NEW.as_at = (clock_timestamp() AT TIME ZONE 'UTC')::date)
                    OR (current_user = __MIGRATE__ AND COALESCE(current_setting('app.company_operation', true), '') = ''
                        AND NEW.as_at = (award.created_at AT TIME ZONE 'UTC')::date)))
        THEN RAISE EXCEPTION 'Award particulars come only from the company''s award to a new recipient' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF NEW.source_transfer_id IS NOT NULL THEN
        IF TG_OP <> 'INSERT' OR principal IS NULL OR NOT EXISTS (
            SELECT 1 FROM tokens_registertransfer transfer_record JOIN tokens_registertransferdecision decision ON decision.register_transfer_id = transfer_record.uuid
            WHERE transfer_record.uuid = NEW.source_transfer_id AND transfer_record.new_particulars AND transfer_record.status = 'submitted'
                AND transfer_record.to_member = NEW.member_id AND transfer_record.name = NEW.name AND transfer_record.residential_address = NEW.residential_address
                AND transfer_record.to_particulars IS NULL AND NEW.as_at = (clock_timestamp() AT TIME ZONE 'UTC')::date
                AND decision.kind = 'apply' AND decision.decided_by_id = principal
                AND current_setting('app.company_id', true) = transfer_record.company_id::text
                AND current_setting('app.company_operation', true) = 'register_transfer_apply'
                AND tokens_register_transfer_approved(transfer_record.uuid, clock_timestamp())
                AND tokens_register_appointment_current(decision.appointment_id, transfer_record.company_id, principal, 'apply', clock_timestamp()))
        THEN RAISE EXCEPTION 'Transfer particulars require the exact company application and original absence' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF NEW.source_grant_id IS NOT NULL THEN
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
    IF NEW.source_allotment_id IS NOT NULL THEN
        IF TG_OP <> 'INSERT' OR principal IS NULL OR NOT EXISTS (
            SELECT 1 FROM tokens_registerallotment allotment_record JOIN tokens_registerallotmentdecision decision ON decision.register_allotment_id = allotment_record.uuid
            WHERE allotment_record.uuid = NEW.source_allotment_id AND allotment_record.new_member AND allotment_record.status = 'submitted'
                AND allotment_record.member = NEW.member_id AND allotment_record.name = NEW.name AND allotment_record.residential_address = NEW.residential_address
                AND NEW.as_at = (clock_timestamp() AT TIME ZONE 'UTC')::date AND decision.kind = 'apply' AND decision.decided_by_id = principal
                AND current_setting('app.company_id', true) = allotment_record.company_id::text
                AND current_setting('app.company_operation', true) = 'register_allotment_apply'
                AND tokens_register_allotment_approved(allotment_record.uuid, clock_timestamp())
                AND tokens_register_appointment_current(decision.appointment_id, allotment_record.company_id, principal, 'apply', clock_timestamp()))
        THEN RAISE EXCEPTION 'Allotment particulars require the exact company application' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF NEW.source_change_id IS NULL THEN
        SELECT * INTO source FROM tokens_registerimport WHERE uuid = NEW.source_import_id;
        IF principal IS NULL OR source.uuid IS NULL
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_import_apply'
            OR current_setting('app.company_id', true) IS DISTINCT FROM source.company_id::text
            OR source.status <> 'submitted' OR NEW.as_at IS DISTINCT FROM source.as_at
            OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(source.members) item
                WHERE item->>'member' = NEW.member_id::text AND item->>'name' = NEW.name
                    AND item->>'residential_address' = NEW.residential_address)
            OR NOT EXISTS (SELECT 1 FROM tokens_registerimportdecision decision
                WHERE decision.register_import_id = source.uuid AND decision.kind = 'apply'
                    AND decision.decided_by_id = principal)
        THEN
            RAISE EXCEPTION 'Imported particulars come only from the company''s application of that import'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    SELECT * INTO proposal FROM tokens_registerparticularschange WHERE uuid = NEW.source_change_id;
    IF principal IS NULL OR proposal.uuid IS NULL
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_particulars_apply'
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR proposal.status <> 'submitted'
        OR NEW.member_id IS DISTINCT FROM proposal.member_id OR NEW.name IS DISTINCT FROM proposal.name
        OR NEW.residential_address IS DISTINCT FROM proposal.residential_address
        OR NEW.as_at IS DISTINCT FROM proposal.as_at
        OR NOT EXISTS (SELECT 1 FROM tokens_registerparticularschangedecision decision
            WHERE decision.register_particulars_change_id = proposal.uuid AND decision.kind = 'apply'
                AND decision.decided_by_id = principal)
    THEN
        RAISE EXCEPTION 'Particulars from a change come only from the company''s application of that change'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION tokens_register_grant_decision_digest(grant_uuid uuid, decision_kind text, actor bigint,
    appointment_uuid uuid, decision_reason text) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT encode(sha256(convert_to((jsonb_build_object('version', '1', 'grant', CASE WHEN proposal.award_id IS NULL THEN (to_jsonb(proposal) - CASE WHEN to_jsonb(proposal)->>'company_event_on' IS NULL THEN 'company_event_on' ELSE '' END) - 'award_id' ELSE (to_jsonb(proposal) - CASE WHEN to_jsonb(proposal)->>'company_event_on' IS NULL THEN 'company_event_on' ELSE '' END) END,
        'effective_on', CASE WHEN to_jsonb(proposal)->>'company_event_on' IS NULL THEN (clock_timestamp() AT TIME ZONE 'UTC')::date ELSE (to_jsonb(proposal)->>'company_event_on')::date END,
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid, 'reason', decision_reason,
        'register', to_jsonb(register), 'authorised_supply', token.total_supply,
        'token_status', token.status, 'deployment', token.deployment_id, 'contract', token.contract_address,
        'legacy_hash', token.deployment_tx_hash, 'deployed_at', token.deployed_at, 'chain', token.chain,
        'particulars', (SELECT CASE WHEN held.source_allotment_id IS NULL THEN to_jsonb(held) - 'source_allotment_id' ELSE to_jsonb(held) END
                - CASE WHEN to_jsonb(held)->>'source_award_id' IS NULL THEN 'source_award_id' ELSE '' END
            FROM tokens_registermemberparticulars held
            WHERE held.member_id = proposal.member)) || CASE WHEN proposal.award_id IS NULL THEN '{}'::jsonb
        ELSE jsonb_build_object('award', (SELECT to_jsonb(promised) FROM tokens_registeraward promised WHERE promised.uuid = proposal.award_id),
            'vesting_events', (SELECT coalesce(jsonb_agg(to_jsonb(event) ORDER BY event.uuid), '[]'::jsonb)
                FROM tokens_registerawardvesting event WHERE event.award_id = proposal.award_id),
            'issued_grants', (SELECT coalesce(jsonb_agg((to_jsonb(issued) - CASE WHEN to_jsonb(issued)->>'company_event_on' IS NULL THEN 'company_event_on' ELSE '' END) ORDER BY issued.uuid), '[]'::jsonb)
                FROM tokens_registergrant issued WHERE issued.award_id = proposal.award_id AND issued.status = 'applied')) || tokens_employee_award_adjustments(proposal.award_id) END)::text, 'UTF8')), 'hex')
    FROM tokens_registergrant proposal JOIN tokens_sharetoken token ON token.uuid = proposal.token_id
        LEFT JOIN tokens_shareregister register ON register.token_id = token.uuid WHERE proposal.uuid = grant_uuid;
$$;


CREATE OR REPLACE FUNCTION public.tokens_guard_register_import()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    principal bigint;
    at_time timestamptz;
    register_copy tokens_registerevidence;
    asic_copy tokens_registerevidence;
    member_count bigint;
    imported_total numeric;
    opening tokens_registerentry;
    expected_changes jsonb;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain register imports and their evidence' USING ERRCODE = '23514';
    END IF;
    SELECT e.* INTO opening FROM tokens_shareregister r JOIN tokens_registerentry e ON e.register_id = r.uuid
        WHERE r.token_id = NEW.token_id AND e.kind = 'opening';
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
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
            OR NOT EXISTS (SELECT 1 FROM tokens_sharetoken t WHERE t.uuid = NEW.token_id
                AND t.company_id = NEW.company_id)
            OR (opening.uuid IS NULL AND (EXISTS (SELECT 1 FROM tokens_shareissuancerequest r
                WHERE r.token_id = NEW.token_id AND r.status IN ('approved', 'executing', 'executed', 'failed'))
                OR EXISTS (SELECT 1 FROM tokens_registerinstruction i
                    WHERE i.token_id = NEW.token_id AND i.status = 'applied')))
            OR NEW.as_at > current_date
            OR NEW.authority NOT IN ('director_resolution', 'court_order')
            OR (NEW.authority = 'director_resolution') <> (length(btrim(NEW.approving_director)) > 0)
            OR length(btrim(NEW.authority_reference)) = 0 OR length(btrim(NEW.reason)) = 0
            OR NEW.evidence_fingerprint !~ '^[0-9a-f]{64}$' OR NEW.asic_fingerprint !~ '^[0-9a-f]{64}$'
            OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-imports/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
            OR jsonb_typeof(NEW.members) IS DISTINCT FROM 'array' OR jsonb_array_length(NEW.members) = 0
            OR jsonb_typeof(NEW.former_members) IS DISTINCT FROM 'array'
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.members) item
                WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
                OR (SELECT array_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(item) key)
                    IS DISTINCT FROM ARRAY['amount_paid', 'entered_on', 'member', 'name', 'residential_address', 'shares']
                OR jsonb_typeof(item->'member') IS DISTINCT FROM 'string' OR item->>'member' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                OR jsonb_typeof(item->'name') IS DISTINCT FROM 'string' OR length(btrim(item->>'name')) = 0
                OR jsonb_typeof(item->'residential_address') IS DISTINCT FROM 'string'
                OR length(btrim(item->>'residential_address')) = 0
                OR jsonb_typeof(item->'shares') IS DISTINCT FROM 'string' OR item->>'shares' !~ '^[1-9][0-9]{0,77}$'
                OR jsonb_typeof(item->'entered_on') IS DISTINCT FROM 'string' OR item->>'entered_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                OR (item->>'entered_on')::date > NEW.as_at
                OR (jsonb_typeof(item->'amount_paid') IS DISTINCT FROM 'string'
                    AND jsonb_typeof(item->'amount_paid') IS DISTINCT FROM 'null')
                OR (jsonb_typeof(item->'amount_paid') = 'string' AND item->>'amount_paid' !~ '^(0|[1-9][0-9]{0,17})([.][0-9]{1,2})?$')
                OR EXISTS (SELECT 1 FROM tokens_registermember m WHERE m.uuid::text = item->>'member'
                    AND m.company_id <> NEW.company_id)
                OR (opening.uuid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tokens_registermember m
                    WHERE m.uuid::text = item->>'member' AND m.company_id = NEW.company_id)))
            OR (SELECT count(DISTINCT item->>'member') FROM jsonb_array_elements(NEW.members) item)
                <> jsonb_array_length(NEW.members)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.former_members) item
                WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
                OR (SELECT array_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(item) key)
                    IS DISTINCT FROM ARRAY['ceased_on', 'name', 'residential_address', 'shares']
                OR jsonb_typeof(item->'name') IS DISTINCT FROM 'string' OR length(btrim(item->>'name')) = 0
                OR jsonb_typeof(item->'residential_address') IS DISTINCT FROM 'string'
                OR length(btrim(item->>'residential_address')) = 0
                OR jsonb_typeof(item->'shares') IS DISTINCT FROM 'string' OR item->>'shares' !~ '^[1-9][0-9]{0,77}$'
                OR jsonb_typeof(item->'ceased_on') IS DISTINCT FROM 'string' OR item->>'ceased_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                OR (item->>'ceased_on')::date > NEW.as_at
                OR (opening.uuid IS NOT NULL
                    AND ((item->>'ceased_on')::date < opening.effective_on) IS NOT TRUE))
            OR NEW.asic_issued_total IS DISTINCT FROM (SELECT sum((item->>'shares')::numeric)
                FROM jsonb_array_elements(NEW.members) item)
            OR NEW.asic_member_count IS DISTINCT FROM jsonb_array_length(NEW.members)
        THEN
            RAISE EXCEPTION 'Register imports require exact current intent, company authority and evidence'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR OLD.status <> 'submitted'
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
    END IF;
    IF NEW.status = 'applied' THEN
        SELECT count(*), sum((item->>'shares')::numeric) INTO member_count, imported_total
            FROM jsonb_array_elements(NEW.members) item;
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
            OR (EXISTS (SELECT 1 FROM tokens_shareissuancerequest r
                WHERE r.token_id = NEW.token_id AND r.status IN ('approved', 'executing', 'executed', 'failed'))
                OR EXISTS (SELECT 1 FROM tokens_registerinstruction i
                    WHERE i.token_id = NEW.token_id AND i.status = 'applied'))))
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
        IF NEW.rejection_reason <> '' OR NEW.register_sequence IS NULL
            OR NEW.asic_issued_total IS DISTINCT FROM imported_total
            OR NEW.asic_member_count IS DISTINCT FROM member_count
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.members) item
                WHERE NOT EXISTS (SELECT 1 FROM tokens_registermemberparticulars p
                    LEFT JOIN tokens_registerimport source ON source.uuid = p.source_import_id
                    WHERE p.member_id::text = item->>'member' AND (p.source_import_id = NEW.uuid
                        OR (source.status = 'applied' AND source.as_at > NEW.as_at)
                        OR ((p.source_change_id IS NOT NULL OR p.source_grant_id IS NOT NULL OR p.source_transfer_id IS NOT NULL OR p.source_allotment_id IS NOT NULL) AND p.as_at > NEW.as_at))))
        THEN
            RAISE EXCEPTION 'Application must match the ASIC figures and record every member''s particulars'
                USING ERRCODE = '23514';
        END IF;
    ELSIF length(btrim(NEW.rejection_reason)) = 0 OR NEW.register_sequence IS NOT NULL THEN
        RAISE EXCEPTION 'Rejection requires a reason and records no register entry' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_particulars_snapshot(member_uuid uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT jsonb_build_object('uuid', held.uuid, 'name', held.name, 'residential_address', held.residential_address,
        'as_at', to_char(held.as_at, 'YYYY-MM-DD'), 'source_import', held.source_import_id,
        'source_change', held.source_change_id, 'source_grant', held.source_grant_id, 'source_transfer', held.source_transfer_id)
        || CASE WHEN held.source_allotment_id IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('source_allotment', held.source_allotment_id) END
        || CASE WHEN to_jsonb(held)->>'source_award_id' IS NULL THEN '{}'::jsonb
            ELSE jsonb_build_object('source_award', to_jsonb(held)->'source_award_id') END
    FROM tokens_registermemberparticulars held WHERE held.member_id = member_uuid;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_register_particulars_decision_digest(change_uuid uuid, decision_kind text, actor bigint, appointment_uuid uuid, decision_reason text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT encode(sha256(convert_to(jsonb_build_object('version', '1', 'change', change_uuid::text,
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid::text, 'reason', decision_reason,
        'particulars', CASE WHEN decision_kind = 'apply' THEN (SELECT jsonb_build_object('name', held.name,
            'residential_address', held.residential_address, 'as_at', held.as_at,
            'source_import', held.source_import_id, 'source_change', held.source_change_id)
            || CASE WHEN held.source_allotment_id IS NULL THEN '{}'::jsonb
                ELSE jsonb_build_object('source_allotment', held.source_allotment_id) END
            FROM tokens_registermemberparticulars held
            JOIN tokens_registerparticularschange proposal ON proposal.member_id = held.member_id
            WHERE proposal.uuid = change_uuid) END)::text, 'UTF8')), 'hex');
$function$;
