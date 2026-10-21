CREATE FUNCTION tokens_employee_award_class_ready(token_uuid uuid, issuer uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_sharetoken token
        JOIN tokens_shareregister register ON register.token_id = token.uuid
        WHERE token.uuid = token_uuid AND token.company_id = issuer AND token.status = 'draft'
            AND NULLIF(token.contract_address, '') IS NULL AND token.deployment_id IS NULL
            AND token.deployment_transaction_id IS NULL AND NULLIF(token.deployment_tx_hash, '') IS NULL
            AND token.deployed_at IS NULL AND NULLIF(token.chain, '') IS NULL AND register.sequence > 0
            AND EXISTS (SELECT 1 FROM tokens_registerimport source
                WHERE source.token_id = token_uuid AND source.status = 'applied'));
$$;
CREATE FUNCTION tokens_employee_award_evidence_matches(evidence_uuid uuid, issuer uuid, actor bigint,
    fingerprint text, snapshot jsonb, retained_file text, family text, operation_uuid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_registerevidence evidence WHERE evidence.uuid = evidence_uuid
        AND evidence.company_id = issuer AND evidence.uploaded_by_id = actor AND evidence.kind = 'supporting'
        AND fingerprint = evidence.sha256 AND snapshot = tokens_register_evidence_snapshot(evidence)
        AND retained_file ~ ('^companies/' || issuer || '/' || family || '/' || operation_uuid || '/[0-9a-f-]{36}[.]bin$'));
$$;
CREATE FUNCTION tokens_employee_award_reversed(award_uuid uuid, through_on date) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE quantity numeric;
BEGIN
    SELECT coalesce(sum(reversed_shares), 0) INTO quantity FROM tokens_registerawardvestingreversal
        WHERE award_id = award_uuid AND (through_on IS NULL OR company_event_on <= through_on);
    RETURN quantity;
END;
$$;
CREATE FUNCTION tokens_employee_award_ended(award_uuid uuid, vested boolean) RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE quantity numeric;
BEGIN
    SELECT coalesce(sum(CASE WHEN vested THEN vested_shares ELSE unvested_shares END), 0) INTO quantity
        FROM tokens_registerawardend WHERE award_id = award_uuid;
    RETURN quantity;
END;
$$;
CREATE FUNCTION tokens_employee_award_latest_on(award_uuid uuid) RETURNS date
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE latest date;
BEGIN
    SELECT greatest(promised.terms_on,
        (SELECT max(vested_on) FROM tokens_registerawardvesting WHERE award_id = award_uuid),
        (SELECT max(company_event_on) FROM tokens_registerawardend WHERE award_id = award_uuid),
        (SELECT max(company_event_on) FROM tokens_registerawardvestingreversal WHERE award_id = award_uuid),
        (SELECT max((to_jsonb(issued)->>'company_event_on')::date) FROM tokens_registergrant issued
            WHERE issued.award_id = award_uuid AND issued.status = 'applied')) INTO latest
        FROM tokens_registeraward promised WHERE promised.uuid = award_uuid;
    RETURN latest;
END;
$$;
CREATE FUNCTION tokens_employee_award_adjusted_at(award_uuid uuid) RETURNS timestamptz
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE latest timestamptz;
BEGIN
    SELECT greatest(
        (SELECT max(created_at) FROM tokens_registerawardend WHERE award_id = award_uuid),
        (SELECT max(created_at) FROM tokens_registerawardvestingreversal WHERE award_id = award_uuid)) INTO latest;
    RETURN latest;
END;
$$;
CREATE FUNCTION tokens_employee_award_adjustments(award_uuid uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE ended jsonb; reversed jsonb;
BEGIN
    SELECT jsonb_agg(to_jsonb(fact) ORDER BY fact.uuid) INTO ended
        FROM tokens_registerawardend fact WHERE fact.award_id = award_uuid;
    SELECT jsonb_agg(to_jsonb(fact) ORDER BY fact.uuid) INTO reversed
        FROM tokens_registerawardvestingreversal fact WHERE fact.award_id = award_uuid;
    RETURN (CASE WHEN ended IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('award_ends', ended) END)
        || (CASE WHEN reversed IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('vesting_reversals', reversed) END);
END;
$$;
CREATE FUNCTION tokens_employee_award_vested_on(award_uuid uuid, through_on date) RETURNS numeric
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT coalesce(sum(shares), 0) - tokens_employee_award_reversed(award_uuid, through_on)
        FROM tokens_registerawardvesting WHERE award_id = award_uuid AND vested_on <= through_on;
$$;
CREATE FUNCTION tokens_employee_award_vested(award_uuid uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT coalesce(sum(shares), 0) - tokens_employee_award_reversed(award_uuid, NULL)
        FROM tokens_registerawardvesting WHERE award_id = award_uuid;
$$;
CREATE FUNCTION tokens_employee_award_issued(award_uuid uuid, excluding_grant uuid) RETURNS numeric
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT coalesce(sum(shares), 0) FROM tokens_registergrant
        WHERE award_id = award_uuid AND status = 'applied' AND uuid IS DISTINCT FROM excluding_grant;
$$;
CREATE FUNCTION tokens_guard_employee_award() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain immutable promised employee awards and agreement evidence' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = NEW.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_shareregister WHERE token_id = NEW.token_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
        OR NEW.submitted_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_award_record'
        OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
        OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal, 'prepare', clock_timestamp())
        OR NOT tokens_employee_award_class_ready(NEW.token_id, NEW.company_id)
        OR NEW.shares <= 0 OR NEW.shares >= 2::numeric^256 OR NEW.shares <> trunc(NEW.shares)
        OR NEW.name !~ '[^[:space:]]' OR NEW.residential_address !~ '[^[:space:]]'
        OR length(NEW.residential_address) > 1000 OR NEW.terms !~ '[^[:space:]]' OR NEW.schedule !~ '[^[:space:]]'
        OR NEW.terms_on > (clock_timestamp() AT TIME ZONE 'UTC')::date
        OR EXISTS (SELECT 1 FROM tokens_registermemberwallet WHERE member_id = NEW.member)
        OR (CASE WHEN NEW.new_member THEN EXISTS (SELECT 1 FROM tokens_registermember WHERE uuid = NEW.member)
            ELSE NOT EXISTS (SELECT 1 FROM tokens_registermember member
                JOIN tokens_registermemberparticulars held ON held.member_id = member.uuid
                WHERE member.uuid = NEW.member AND member.company_id = NEW.company_id
                    AND held.name = NEW.name AND held.residential_address = NEW.residential_address) END)
        OR NOT tokens_employee_award_evidence_matches(NEW.agreement_evidence_id, NEW.company_id, principal,
            NEW.agreement_fingerprint, NEW.agreement_snapshot, NEW.file, 'register-awards', NEW.uuid)
    THEN
        RAISE EXCEPTION 'Employee awards need exact current company authority, recipient, class and agreement' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_employee_award_identity BEFORE INSERT OR UPDATE OR DELETE ON tokens_registeraward
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_employee_award();
CREATE FUNCTION tokens_guard_award_member() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint;
BEGIN
    IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_award_record' THEN RETURN NEW; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF principal IS NULL OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
        OR NOT EXISTS (SELECT 1 FROM tokens_registeraward award WHERE award.member = NEW.uuid AND award.new_member
            AND award.company_id = NEW.company_id AND award.submitted_by_id = principal)
    THEN RAISE EXCEPTION 'A new award recipient needs the exact company award' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_award_member BEFORE INSERT ON tokens_registermember
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_award_member();
CREATE FUNCTION tokens_check_award_person_record() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NEW.new_member AND NOT EXISTS (SELECT 1 FROM tokens_registermember member
            JOIN tokens_registermemberparticulars held ON held.member_id = member.uuid
            WHERE member.uuid = NEW.member AND member.company_id = NEW.company_id AND held.source_award_id = NEW.uuid) THEN
        RAISE EXCEPTION 'A new award recipient keeps the person record their award creates' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_award_person_record AFTER INSERT ON tokens_registeraward
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_award_person_record();
CREATE FUNCTION tokens_guard_employee_award_vesting() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint; promised tokens_registeraward;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain append-only company-recorded vesting facts and evidence' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO promised FROM tokens_registeraward WHERE uuid = NEW.award_id;
    PERFORM 1 FROM companies_company WHERE uuid = promised.company_id FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = promised.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_shareregister WHERE token_id = promised.token_id FOR UPDATE;
    SELECT * INTO promised FROM tokens_registeraward WHERE uuid = NEW.award_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR promised.uuid IS NULL
        OR NEW.company_id IS DISTINCT FROM promised.company_id OR NEW.submitted_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_award_vesting_record'
        OR current_setting('app.company_id', true) IS DISTINCT FROM promised.company_id::text
        OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal, 'prepare', clock_timestamp())
        OR NOT tokens_employee_award_class_ready(promised.token_id, promised.company_id)
        OR NEW.shares <= 0 OR NEW.shares >= 2::numeric^256 OR NEW.shares <> trunc(NEW.shares)
        OR NEW.vested_on < tokens_employee_award_latest_on(promised.uuid) OR NEW.vested_on > (clock_timestamp() AT TIME ZONE 'UTC')::date
        OR tokens_employee_award_vested(promised.uuid) + NEW.shares + tokens_employee_award_ended(promised.uuid, false) > promised.shares
        OR NOT tokens_employee_award_evidence_matches(NEW.evidence_id, NEW.company_id, principal,
            NEW.evidence_fingerprint, NEW.evidence_snapshot, NEW.file, 'register-award-vestings', NEW.uuid)
    THEN
        RAISE EXCEPTION 'Vesting facts need current company authority, exact award, quantity, date and evidence' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_employee_award_vesting_identity BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerawardvesting
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_employee_award_vesting();
CREATE FUNCTION tokens_check_employee_award_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE token_uuid uuid;
BEGIN
    IF TG_TABLE_NAME = 'tokens_registeraward' THEN token_uuid := NEW.token_id;
    ELSE SELECT token_id INTO token_uuid FROM tokens_registeraward WHERE uuid = NEW.award_id; END IF;
    IF NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id,
        NEW.submitted_by_id, 'prepare', clock_timestamp())
        OR NOT tokens_employee_award_class_ready(token_uuid, NEW.company_id) THEN
        RAISE EXCEPTION 'Employee award recording authority must remain current at commit' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_employee_award_commit_authority AFTER INSERT ON tokens_registeraward
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_employee_award_authority();
CREATE CONSTRAINT TRIGGER tokens_employee_award_vesting_commit_authority AFTER INSERT ON tokens_registerawardvesting
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_employee_award_authority();
CREATE FUNCTION tokens_employee_award_grant_matches(proposal tokens_registergrant) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT proposal.award_id IS NULL OR EXISTS (SELECT 1 FROM tokens_registeraward promised
        WHERE promised.uuid = proposal.award_id AND promised.company_id = proposal.company_id
            AND promised.token_id = proposal.token_id AND promised.member = proposal.member
            AND promised.terms_on = proposal.terms_on AND promised.terms = proposal.terms
            AND promised.agreement_fingerprint = proposal.terms_fingerprint
            AND tokens_employee_award_vested(promised.uuid) + tokens_employee_award_ended(promised.uuid, false) <= promised.shares
            AND (to_jsonb(proposal)->>'company_event_on')::date >= tokens_employee_award_latest_on(promised.uuid)
            AND tokens_employee_award_issued(promised.uuid, proposal.uuid) + proposal.shares + tokens_employee_award_ended(promised.uuid, true)
                <= tokens_employee_award_vested(promised.uuid)
            AND tokens_employee_award_issued(promised.uuid, proposal.uuid) + proposal.shares + tokens_employee_award_ended(promised.uuid, true)
                <= tokens_employee_award_vested_on(promised.uuid, (to_jsonb(proposal)->>'company_event_on')::date));
$$;
CREATE FUNCTION tokens_check_employee_award_allocation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE promised tokens_registeraward;
BEGIN
    IF NEW.award_id IS NULL OR NEW.status <> 'applied' THEN RETURN NULL; END IF;
    SELECT * INTO promised FROM tokens_registeraward WHERE uuid = NEW.award_id;
    IF NOT tokens_employee_award_grant_matches(NEW)
        OR tokens_employee_award_issued(promised.uuid, NULL) + tokens_employee_award_ended(promised.uuid, true) > tokens_employee_award_vested(promised.uuid)
        OR tokens_employee_award_vested(promised.uuid) + tokens_employee_award_ended(promised.uuid, false) > promised.shares THEN
        RAISE EXCEPTION 'Applied employee grants cannot exceed recorded vested entitlement' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_employee_award_grant_allocation AFTER INSERT OR UPDATE ON tokens_registergrant
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_employee_award_allocation();

CREATE OR REPLACE FUNCTION tokens_register_grant_ready(proposal tokens_registergrant, before_effect boolean) RETURNS boolean
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
            AND tokens_register_company_date_ready(to_jsonb(proposal)))
        AND lower(btrim(regexp_replace(proposal.approving_director, '[[:space:]]+', ' ', 'g')))
            <> lower(btrim(regexp_replace(proposal.name, '[[:space:]]+', ' ', 'g')))
        AND NOT EXISTS (SELECT 1 FROM tokens_registermemberwallet wallet WHERE wallet.company_id = proposal.company_id AND wallet.member_id = proposal.member)
        AND CASE WHEN proposal.new_member AND before_effect THEN
            NOT EXISTS (SELECT 1 FROM tokens_registermember member WHERE member.uuid = proposal.member)
        ELSE EXISTS (SELECT 1 FROM tokens_registermember member JOIN tokens_registermemberparticulars held ON held.member_id = member.uuid
            WHERE member.uuid = proposal.member AND member.company_id = proposal.company_id
                AND held.name = proposal.name AND held.residential_address = proposal.residential_address
                AND (NOT proposal.new_member OR (held.source_grant_id = proposal.uuid
                    AND held.as_at = (clock_timestamp() AT TIME ZONE 'UTC')::date))) END AND tokens_employee_award_grant_matches(proposal);
$$;

CREATE OR REPLACE FUNCTION tokens_register_grant_approved(grant_uuid uuid, at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_registergrantdecision decision
        JOIN tokens_registergrant proposal ON proposal.uuid = decision.register_grant_id
        WHERE proposal.uuid = grant_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
                decision.decided_by_id, 'approve', at_time)
            AND (proposal.award_id IS NULL OR coalesce(tokens_employee_award_adjusted_at(proposal.award_id) < decision.decided_at, true)));
$$;

CREATE OR REPLACE FUNCTION tokens_register_grant_decision_digest(grant_uuid uuid, decision_kind text, actor bigint,
    appointment_uuid uuid, decision_reason text) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT encode(sha256(convert_to((jsonb_build_object('version', '1', 'grant', CASE WHEN proposal.award_id IS NULL THEN (to_jsonb(proposal) - CASE WHEN to_jsonb(proposal)->>'company_event_on' IS NULL THEN 'company_event_on' ELSE '' END) - 'award_id' ELSE (to_jsonb(proposal) - CASE WHEN to_jsonb(proposal)->>'company_event_on' IS NULL THEN 'company_event_on' ELSE '' END) END,
        'effective_on', CASE WHEN to_jsonb(proposal)->>'company_event_on' IS NULL THEN (clock_timestamp() AT TIME ZONE 'UTC')::date ELSE (to_jsonb(proposal)->>'company_event_on')::date END,
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid, 'reason', decision_reason,
        'register', to_jsonb(register), 'authorised_supply', token.total_supply,
        'token_status', token.status, 'deployment', token.deployment_id, 'contract', token.contract_address,
        'legacy_hash', token.deployment_tx_hash, 'deployed_at', token.deployed_at, 'chain', token.chain,
        'particulars', (SELECT to_jsonb(held) FROM tokens_registermemberparticulars held
            WHERE held.member_id = proposal.member)) || CASE WHEN proposal.award_id IS NULL THEN '{}'::jsonb
        ELSE jsonb_build_object('award', (SELECT to_jsonb(promised) FROM tokens_registeraward promised WHERE promised.uuid = proposal.award_id),
            'vesting_events', (SELECT coalesce(jsonb_agg(to_jsonb(event) ORDER BY event.uuid), '[]'::jsonb)
                FROM tokens_registerawardvesting event WHERE event.award_id = proposal.award_id),
            'issued_grants', (SELECT coalesce(jsonb_agg((to_jsonb(issued) - CASE WHEN to_jsonb(issued)->>'company_event_on' IS NULL THEN 'company_event_on' ELSE '' END) ORDER BY issued.uuid), '[]'::jsonb)
                FROM tokens_registergrant issued WHERE issued.award_id = proposal.award_id AND issued.status = 'applied')) || tokens_employee_award_adjustments(proposal.award_id) END)::text, 'UTF8')), 'hex')
    FROM tokens_registergrant proposal JOIN tokens_sharetoken token ON token.uuid = proposal.token_id
        LEFT JOIN tokens_shareregister register ON register.token_id = token.uuid WHERE proposal.uuid = grant_uuid;
$$;

CREATE FUNCTION tokens_register_grant_terms_evidence_matches(proposal tokens_registergrant, actor bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT CASE WHEN proposal.award_id IS NOT NULL AND proposal.terms_evidence_id = (
        SELECT agreement_evidence_id FROM tokens_registeraward WHERE uuid = proposal.award_id)
    THEN EXISTS (SELECT 1 FROM tokens_registeraward promised WHERE promised.uuid = proposal.award_id
        AND promised.company_id = proposal.company_id AND promised.token_id = proposal.token_id
        AND promised.member = proposal.member AND promised.terms_on = proposal.terms_on AND promised.terms = proposal.terms
        AND proposal.terms_fingerprint = promised.agreement_fingerprint
        AND proposal.terms_snapshot = promised.agreement_snapshot
        AND proposal.terms_file ~ ('^companies/' || proposal.company_id || '/register-grants/' || proposal.uuid || '/[0-9a-f-]{36}[.]bin$')
        AND tokens_employee_award_evidence_matches(promised.agreement_evidence_id, promised.company_id,
            promised.submitted_by_id, promised.agreement_fingerprint, promised.agreement_snapshot, promised.file,
            'register-awards', promised.uuid))
    ELSE tokens_register_grant_evidence_matches(proposal.terms_evidence_id, proposal.company_id, actor,
        'supporting', proposal.terms_fingerprint, proposal.terms_snapshot, proposal.terms_file, proposal.uuid) END;
$$;

CREATE OR REPLACE FUNCTION tokens_guard_register_grant() RETURNS trigger
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
    PERFORM 1 FROM tokens_registeraward WHERE uuid = NEW.award_id FOR UPDATE;
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
            OR NOT tokens_register_grant_terms_evidence_matches(NEW, principal)
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
                AND entry.kind = 'issue' AND entry.recorded_by_id = principal AND entry.created_at >= NEW.reviewed_at
                AND entry.effective_on = (to_jsonb(NEW)->>'company_event_on')::date
                AND entry.changes = jsonb_build_array(jsonb_build_object('member', NEW.member::text, 'shares', NEW.shares::text)))))
        OR (NEW.status = 'rejected' AND (NEW.register_entry_id IS NOT NULL OR NEW.rejection_reason !~ '[^[:space:]]'))
    THEN
        RAISE EXCEPTION 'Only the exact company decision may decide an immutable register grant' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION tokens_guard_register_grant_decision() RETURNS trigger
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
    PERFORM 1 FROM tokens_registeraward WHERE uuid = proposal.award_id FOR UPDATE;
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

CREATE OR REPLACE FUNCTION tokens_guard_grant_register_entry() RETURNS trigger
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

CREATE FUNCTION tokens_guard_employee_award_adjustment() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint; promised tokens_registeraward; original tokens_registerawardvesting;
    ending boolean; unvested numeric; vested numeric; reversed numeric; facts jsonb; current_vested numeric; issued numeric;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain append-only entitlement endings and vesting reversals' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    ending := TG_TABLE_NAME = 'tokens_registerawardend';
    facts := to_jsonb(NEW);
    SELECT * INTO promised FROM tokens_registeraward WHERE uuid = NEW.award_id;
    PERFORM 1 FROM companies_company WHERE uuid = promised.company_id FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = promised.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_shareregister WHERE token_id = promised.token_id FOR UPDATE;
    SELECT * INTO promised FROM tokens_registeraward WHERE uuid = NEW.award_id FOR UPDATE;
    current_vested := tokens_employee_award_vested(promised.uuid);
    issued := tokens_employee_award_issued(promised.uuid, NULL);
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR promised.uuid IS NULL
        OR NEW.company_id IS DISTINCT FROM promised.company_id OR NEW.submitted_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM (CASE WHEN ending THEN 'register_award_end_record' ELSE 'register_award_vesting_reversal_record' END)
        OR current_setting('app.company_id', true) IS DISTINCT FROM promised.company_id::text
        OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal, 'prepare', clock_timestamp())
        OR NOT tokens_employee_award_class_ready(promised.token_id, promised.company_id)
        OR NEW.company_event_on < tokens_employee_award_latest_on(promised.uuid)
        OR NEW.company_event_on > (clock_timestamp() AT TIME ZONE 'UTC')::date
        OR NEW.reason !~ '[^[:space:]]' OR length(NEW.reason) > 1000
        OR NOT tokens_employee_award_evidence_matches(NEW.evidence_id, NEW.company_id, principal,
            NEW.evidence_fingerprint, NEW.evidence_snapshot, NEW.file,
            CASE WHEN ending THEN 'register-award-ends' ELSE 'register-award-vesting-reversals' END, NEW.uuid)
    THEN
        RAISE EXCEPTION 'Entitlement facts need current company authority, exact award, chronology, reason and evidence' USING ERRCODE = '23514';
    END IF;
    IF ending THEN
        unvested := (facts->>'unvested_shares')::numeric;
        vested := (facts->>'vested_shares')::numeric;
        IF unvested < 0 OR vested < 0 OR unvested + vested <= 0 OR unvested >= 2::numeric^256 OR vested >= 2::numeric^256
            OR unvested <> trunc(unvested) OR vested <> trunc(vested)
            OR unvested + current_vested + tokens_employee_award_ended(promised.uuid, false) > promised.shares
            OR vested + issued + tokens_employee_award_ended(promised.uuid, true) > current_vested THEN
            RAISE EXCEPTION 'End only remaining unvested or vested-but-unissued entitlement' USING ERRCODE = '23514';
        END IF;
    ELSE
        reversed := (facts->>'reversed_shares')::numeric;
        SELECT * INTO original FROM tokens_registerawardvesting WHERE uuid = (facts->>'vesting_id')::uuid;
        IF original.uuid IS NULL OR original.award_id IS DISTINCT FROM promised.uuid OR original.company_id IS DISTINCT FROM NEW.company_id
            OR reversed <= 0 OR reversed >= 2::numeric^256 OR reversed <> trunc(reversed)
            OR reversed + (SELECT coalesce(sum(reversed_shares), 0) FROM tokens_registerawardvestingreversal WHERE vesting_id = original.uuid) > original.shares
            OR reversed + issued + tokens_employee_award_ended(promised.uuid, true) > current_vested THEN
            RAISE EXCEPTION 'Reverse only an original vesting amount without removing issued or ended rights' USING ERRCODE = '23514';
        END IF;
    END IF;
    NEW.created_at := clock_timestamp(); NEW.updated_at := NEW.created_at;
    RETURN NEW;
END;
$$;
