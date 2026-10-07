from importlib import import_module

from django.db import migrations

GRANTS = import_module("tokens.migrations.0095_company_register_grant_guards")
IMPORTS = import_module("tokens.migrations.0084_company_register_import_guards")

FUNCTIONS = """
CREATE FUNCTION tokens_register_particulars_snapshot(member_uuid uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT jsonb_build_object('uuid', held.uuid, 'name', held.name, 'residential_address', held.residential_address,
        'as_at', to_char(held.as_at, 'YYYY-MM-DD'), 'source_import', held.source_import_id,
        'source_change', held.source_change_id, 'source_grant', held.source_grant_id, 'source_transfer', held.source_transfer_id)
    FROM tokens_registermemberparticulars held WHERE held.member_id = member_uuid;
$$;
CREATE FUNCTION tokens_register_transfer_changes(proposal tokens_registertransfer) RETURNS jsonb
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT jsonb_agg(jsonb_build_object('member', member::text, 'shares', shares::text) ORDER BY member::text)
    FROM (VALUES (proposal.from_member, -proposal.shares), (proposal.to_member, proposal.shares)) AS effects(member, shares);
$$;
CREATE FUNCTION tokens_register_member_left_on(member_uuid uuid) RETURNS date
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT max(COALESCE(cessation.ceased_on, entry.effective_on)) FROM tokens_registerposition position
        JOIN tokens_registerentry entry ON entry.uuid = position.last_entry_id
        LEFT JOIN tokens_registermembercessation cessation ON cessation.entry_id = entry.uuid AND cessation.member_id = position.member_id
    WHERE position.member_id = member_uuid AND position.shares = 0;
$$;
CREATE FUNCTION tokens_register_transfer_approved(transfer_uuid uuid, at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_registertransferdecision decision JOIN tokens_registertransfer proposal ON proposal.uuid = decision.register_transfer_id
        WHERE proposal.uuid = transfer_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id, decision.decided_by_id, 'approve', at_time));
$$;
CREATE FUNCTION tokens_register_transfer_decision_digest(transfer_uuid uuid, decision_kind text, actor bigint,
    appointment_uuid uuid, decision_reason text) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT encode(sha256(convert_to(jsonb_build_object('version', '1', 'transfer', to_jsonb(proposal),
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid, 'reason', decision_reason,
        'register', to_jsonb(register), 'authorised_supply', token.total_supply, 'token_status', token.status,
        'deployment', token.deployment_id, 'transaction', token.deployment_transaction_id, 'contract', token.contract_address,
        'legacy_hash', token.deployment_tx_hash, 'deployed_at', token.deployed_at, 'chain', token.chain,
        'from_particulars', tokens_register_particulars_snapshot(proposal.from_member),
        'to_particulars', tokens_register_particulars_snapshot(proposal.to_member),
        'effective_on', (clock_timestamp() AT TIME ZONE 'UTC')::date)::text, 'UTF8')), 'hex')
    FROM tokens_registertransfer proposal JOIN tokens_sharetoken token ON token.uuid = proposal.token_id
        LEFT JOIN tokens_shareregister register ON register.token_id = token.uuid WHERE proposal.uuid = transfer_uuid;
$$;
CREATE FUNCTION tokens_register_transfer_ready(proposal tokens_registertransfer, before_effect boolean) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_sharetoken token JOIN tokens_shareregister register ON register.token_id = token.uuid
        WHERE token.uuid = proposal.token_id AND token.company_id = proposal.company_id AND token.status = 'draft'
            AND NULLIF(token.contract_address, '') IS NULL AND token.deployment_id IS NULL AND token.deployment_transaction_id IS NULL
            AND NULLIF(token.deployment_tx_hash, '') IS NULL AND token.deployed_at IS NULL AND NULLIF(token.chain, '') IS NULL
            AND register.sequence > 0 AND EXISTS (SELECT 1 FROM tokens_registerimport source WHERE source.token_id = token.uuid AND source.status = 'applied')
            AND COALESCE((SELECT shares FROM tokens_registerposition WHERE register_id = register.uuid AND member_id = proposal.from_member), 0) >= proposal.shares
            AND COALESCE((SELECT shares FROM tokens_registerposition WHERE register_id = register.uuid AND member_id = proposal.to_member), 0) + proposal.shares < 2::numeric^256
            AND NOT EXISTS (SELECT 1 FROM tokens_registerentry entry WHERE entry.register_id = register.uuid AND entry.sequence = register.sequence
                AND entry.effective_on > (clock_timestamp() AT TIME ZONE 'UTC')::date))
        AND EXISTS (SELECT 1 FROM tokens_registermember member WHERE member.uuid = proposal.from_member AND member.company_id = proposal.company_id)
        AND tokens_register_particulars_snapshot(proposal.from_member) IS NOT DISTINCT FROM proposal.from_particulars
        AND NOT EXISTS (SELECT 1 FROM tokens_registermemberwallet wallet WHERE wallet.company_id = proposal.company_id
            AND wallet.member_id IN (proposal.from_member, proposal.to_member))
        AND lower(btrim(regexp_replace(proposal.approving_director, '[[:space:]]+', ' ', 'g'))) NOT IN
            (lower(btrim(regexp_replace(proposal.from_name, '[[:space:]]+', ' ', 'g'))), lower(btrim(regexp_replace(proposal.name, '[[:space:]]+', ' ', 'g'))))
        AND CASE WHEN proposal.new_member AND before_effect THEN
            NOT EXISTS (SELECT 1 FROM tokens_registermember member WHERE member.uuid = proposal.to_member)
        ELSE EXISTS (SELECT 1 FROM tokens_registermember member WHERE member.uuid = proposal.to_member AND member.company_id = proposal.company_id) END
        AND CASE WHEN proposal.new_particulars AND NOT before_effect THEN
            EXISTS (SELECT 1 FROM tokens_registermemberparticulars held WHERE held.member_id = proposal.to_member
                AND held.source_transfer_id = proposal.uuid AND held.name = proposal.name AND held.residential_address = proposal.residential_address
                AND held.as_at = (clock_timestamp() AT TIME ZONE 'UTC')::date)
        ELSE tokens_register_particulars_snapshot(proposal.to_member) IS NOT DISTINCT FROM proposal.to_particulars END
        AND (NOT proposal.new_particulars OR NOT EXISTS (SELECT 1 FROM tokens_registerposition position WHERE position.member_id = proposal.to_member AND position.shares > 0));
$$;
CREATE FUNCTION tokens_register_transfer_evidence_matches(evidence_uuid uuid, issuer uuid, actor bigint, evidence_kind text,
    fingerprint text, snapshot jsonb, retained_file text, transfer_uuid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_registerevidence evidence WHERE evidence.uuid = evidence_uuid AND evidence.company_id = issuer
        AND evidence.uploaded_by_id = actor AND evidence.kind = evidence_kind AND fingerprint = evidence.sha256
        AND snapshot = tokens_register_evidence_snapshot(evidence)
        AND retained_file ~ ('^companies/' || issuer || '/register-transfers/' || transfer_uuid || '/[0-9a-f-]{36}[.]bin$'));
$$;
CREATE FUNCTION tokens_guard_register_transfer() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint;
BEGIN
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Register transfers retain authority, instruments and history' USING ERRCODE = '23514'; END IF;
    PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = NEW.token_id AND company_id = NEW.company_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR NOT FOUND
        OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text THEN
        RAISE EXCEPTION 'A register transfer requires its exact current company command' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_transfer_prepare'
            OR NEW.submitted_by_id IS DISTINCT FROM principal OR NEW.status <> 'submitted'
            OR NEW.register_entry_id IS NOT NULL OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL OR NEW.rejection_reason <> ''
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal, 'prepare', clock_timestamp())
            OR NEW.shares <= 0 OR NEW.shares <> trunc(NEW.shares) OR NEW.shares >= 2::numeric^256 OR NEW.from_member = NEW.to_member
            OR NEW.signed_on > NEW.lodged_on OR NEW.lodged_on > (clock_timestamp() AT TIME ZONE 'UTC')::date
            OR NEW.authority <> 'director_resolution' OR NEW.approving_director !~ '[^[:space:]]'
            OR NEW.name !~ '[^[:space:]]' OR NEW.from_name !~ '[^[:space:]]' OR NEW.residential_address !~ '[^[:space:]]'
            OR NEW.from_residential_address !~ '[^[:space:]]' OR length(NEW.residential_address) > 1000
            OR NEW.terms !~ '[^[:space:]]' OR NEW.authority_reference !~ '[^[:space:]]' OR NEW.reason !~ '[^[:space:]]'
            OR NEW.from_particulars IS NULL OR NEW.from_particulars->>'name' IS DISTINCT FROM NEW.from_name
            OR NEW.from_particulars->>'residential_address' IS DISTINCT FROM NEW.from_residential_address
            OR NEW.new_particulars IS DISTINCT FROM (NEW.to_particulars IS NULL) OR (NEW.new_member AND NOT NEW.new_particulars)
            OR (NOT NEW.new_particulars AND (NEW.to_particulars->>'name' IS DISTINCT FROM NEW.name OR NEW.to_particulars->>'residential_address' IS DISTINCT FROM NEW.residential_address))
            OR NOT tokens_register_transfer_ready(NEW, true)
            OR NOT tokens_register_transfer_evidence_matches(NEW.authority_evidence_id, NEW.company_id, principal, 'authority', NEW.evidence_fingerprint, NEW.evidence_snapshot, NEW.file, NEW.uuid)
            OR NOT tokens_register_transfer_evidence_matches(NEW.instrument_evidence_id, NEW.company_id, principal, 'supporting', NEW.instrument_fingerprint, NEW.instrument_snapshot, NEW.instrument_file, NEW.uuid)
        THEN RAISE EXCEPTION 'A direct transfer needs exact company identities, authority and signed instrument' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF OLD.status <> 'submitted' OR NEW.status NOT IN ('applied', 'rejected')
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_transfer_' || (CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
        OR (to_jsonb(NEW) - ARRAY['status', 'register_entry_id', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
            IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'register_entry_id', 'reviewed_by_id', 'reviewed_at', 'rejection_reason', 'updated_at'])
        OR NEW.reviewed_by_id IS DISTINCT FROM principal OR NEW.reviewed_at IS NULL
        OR NOT EXISTS (SELECT 1 FROM tokens_registertransferdecision decision WHERE decision.register_transfer_id = NEW.uuid
            AND decision.decided_by_id = principal AND decision.decided_at = NEW.reviewed_at
            AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
            AND tokens_register_appointment_current(decision.appointment_id, NEW.company_id, principal,
                CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'approve' END, clock_timestamp())
            AND (NEW.status = 'applied' OR decision.reason = NEW.rejection_reason))
        OR (NEW.status = 'applied' AND (NEW.rejection_reason <> '' OR NOT tokens_register_transfer_approved(NEW.uuid, clock_timestamp()) OR NOT EXISTS (
            SELECT 1 FROM tokens_registerentry entry JOIN tokens_shareregister register ON register.uuid = entry.register_id
            WHERE entry.uuid = NEW.register_entry_id AND register.token_id = NEW.token_id AND entry.operation_id = NEW.uuid
                AND entry.kind = 'transfer' AND entry.recorded_by_id = principal
                AND entry.effective_on = (entry.created_at AT TIME ZONE 'UTC')::date AND entry.changes = tokens_register_transfer_changes(NEW))))
        OR (NEW.status = 'rejected' AND (NEW.register_entry_id IS NOT NULL OR NEW.rejection_reason !~ '[^[:space:]]'))
    THEN RAISE EXCEPTION 'Only its exact company decision may decide an immutable register transfer' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_transfer_identity BEFORE INSERT OR UPDATE OR DELETE ON tokens_registertransfer FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_transfer();
CREATE FUNCTION tokens_guard_register_transfer_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint; at_time timestamptz; proposal tokens_registertransfer;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Register transfer decisions are append-only' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint; at_time := clock_timestamp();
    SELECT * INTO proposal FROM tokens_registertransfer WHERE uuid = NEW.register_transfer_id;
    PERFORM 1 FROM companies_company WHERE uuid = proposal.company_id FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = proposal.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_shareregister WHERE token_id = proposal.token_id FOR UPDATE;
    SELECT * INTO proposal FROM tokens_registertransfer WHERE uuid = NEW.register_transfer_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR NEW.decided_by_id IS DISTINCT FROM principal OR proposal.status <> 'submitted'
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_transfer_' || NEW.kind
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR NEW.kind NOT IN ('approve', 'apply', 'reject') OR (NEW.kind = 'reject') <> (NEW.reason ~ '[^[:space:]]')
        OR NEW.digest IS DISTINCT FROM tokens_register_transfer_decision_digest(proposal.uuid, NEW.kind, principal, NEW.appointment_id, NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal, CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'approve' AND tokens_register_transfer_approved(proposal.uuid, at_time))
        OR (NEW.kind = 'apply' AND NOT tokens_register_transfer_approved(proposal.uuid, at_time))
        OR (NEW.kind <> 'reject' AND NOT tokens_register_transfer_ready(proposal, true))
    THEN RAISE EXCEPTION 'Register transfer decisions need exact current company authority and effect' USING ERRCODE = '23514'; END IF;
    NEW.decided_at := at_time; NEW.created_at := at_time; NEW.updated_at := at_time;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_transfer_decision_guard BEFORE INSERT OR UPDATE OR DELETE ON tokens_registertransferdecision FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_transfer_decision();
CREATE FUNCTION tokens_check_register_transfer_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE proposal tokens_registertransfer; at_time timestamptz;
BEGIN
    SELECT * INTO proposal FROM tokens_registertransfer WHERE uuid = NEW.register_transfer_id; at_time := clock_timestamp();
    IF NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, NEW.decided_by_id,
        CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time) OR (NEW.kind = 'apply' AND NOT tokens_register_transfer_approved(proposal.uuid, at_time))
    THEN RAISE EXCEPTION 'Register transfer authority must remain current at its deferred check' USING ERRCODE = '23514'; END IF;
    IF (NEW.kind = 'approve' AND proposal.status <> 'submitted') OR (NEW.kind <> 'approve' AND
        (proposal.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id
        OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at OR (NEW.kind = 'reject' AND proposal.rejection_reason IS DISTINCT FROM NEW.reason)))
    THEN RAISE EXCEPTION 'A register transfer decision must carry exactly its own effect' USING ERRCODE = '23514'; END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_register_transfer_decision_effect AFTER INSERT ON tokens_registertransferdecision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_register_transfer_decision();
CREATE FUNCTION tokens_guard_transfer_register_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE proposal tokens_registertransfer; principal bigint; issuer uuid; token_uuid uuid;
BEGIN
    SELECT company_id, token_id INTO issuer, token_uuid FROM tokens_shareregister WHERE uuid = NEW.register_id;
    SELECT * INTO proposal FROM tokens_registertransfer WHERE uuid = NEW.operation_id;
    IF proposal.uuid IS NULL AND current_setting('app.company_operation', true) IS DISTINCT FROM 'register_transfer_apply'
        AND NOT (NEW.kind IN ('transfer', 'cessation') AND EXISTS (SELECT 1 FROM tokens_registerimport source JOIN tokens_sharetoken token ON token.uuid = source.token_id
            WHERE source.token_id = token_uuid AND source.status = 'applied' AND NULLIF(token.contract_address, '') IS NULL)) THEN RETURN NEW; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_transfer_apply'
        OR current_setting('app.company_id', true) IS DISTINCT FROM issuer::text OR proposal.company_id IS DISTINCT FROM issuer
        OR proposal.token_id IS DISTINCT FROM token_uuid OR proposal.status <> 'submitted' OR NEW.kind <> 'transfer' OR NEW.recorded_by_id IS DISTINCT FROM principal
        OR NEW.effective_on IS DISTINCT FROM (NEW.created_at AT TIME ZONE 'UTC')::date
        OR NEW.effective_on IS DISTINCT FROM (clock_timestamp() AT TIME ZONE 'UTC')::date
        OR NEW.changes IS DISTINCT FROM tokens_register_transfer_changes(proposal)
        OR NOT tokens_register_transfer_ready(proposal, false) OR NOT tokens_register_transfer_approved(proposal.uuid, clock_timestamp())
        OR NOT EXISTS (SELECT 1 FROM tokens_registertransferdecision decision WHERE decision.register_transfer_id = proposal.uuid AND decision.kind = 'apply'
            AND decision.decided_by_id = principal AND tokens_register_appointment_current(decision.appointment_id, issuer, principal, 'apply', clock_timestamp()))
    THEN RAISE EXCEPTION 'A direct transfer entry needs its exact current company application' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_transfer_entry BEFORE INSERT ON tokens_registerentry FOR EACH ROW EXECUTE FUNCTION tokens_guard_transfer_register_entry();
CREATE FUNCTION tokens_guard_correction_register_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE proposal tokens_registercorrection; principal bigint; issuer uuid; token_uuid uuid;
BEGIN
    IF NEW.kind <> 'correction' THEN RETURN NEW; END IF;
    SELECT company_id, token_id INTO issuer, token_uuid FROM tokens_shareregister WHERE uuid = NEW.register_id;
    IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_correction_apply'
        AND NOT EXISTS (SELECT 1 FROM tokens_registerimport source JOIN tokens_sharetoken token ON token.uuid = source.token_id
            WHERE source.token_id = token_uuid AND source.status = 'applied' AND NULLIF(token.contract_address, '') IS NULL) THEN RETURN NEW; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO proposal FROM tokens_registercorrection WHERE uuid = NEW.operation_id;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_correction_apply'
        OR current_setting('app.company_id', true) IS DISTINCT FROM issuer::text
        OR proposal.company_id IS DISTINCT FROM issuer OR proposal.register_id IS DISTINCT FROM NEW.register_id
        OR proposal.status <> 'submitted' OR proposal.preparing_appointment_id IS NULL OR NEW.recorded_by_id IS DISTINCT FROM principal
        OR NEW.corrects_id IS DISTINCT FROM proposal.corrects_id OR NEW.changes IS DISTINCT FROM proposal.changes
        OR NEW.effective_on IS DISTINCT FROM proposal.effective_on
        OR NOT EXISTS (SELECT 1 FROM tokens_shareregister register WHERE register.uuid = NEW.register_id
            AND register.sequence = proposal.base_sequence AND register.head_hash = proposal.base_hash)
        OR NOT tokens_register_correction_approved(proposal.uuid, clock_timestamp())
        OR NOT EXISTS (SELECT 1 FROM tokens_registercorrectiondecision decision WHERE decision.register_correction_id = proposal.uuid
            AND decision.kind = 'apply' AND decision.decided_by_id = principal
            AND tokens_register_appointment_current(decision.appointment_id, issuer, principal, 'apply', clock_timestamp()))
    THEN RAISE EXCEPTION 'A non-tokenised correction entry needs its exact current company application' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_correction_entry BEFORE INSERT ON tokens_registerentry FOR EACH ROW EXECUTE FUNCTION tokens_guard_correction_register_entry();
CREATE FUNCTION tokens_check_correction_register_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE proposal tokens_registercorrection; decision tokens_registercorrectiondecision; token_uuid uuid; at_time timestamptz;
BEGIN
    IF NEW.kind <> 'correction' THEN RETURN NULL; END IF;
    SELECT token_id INTO token_uuid FROM tokens_shareregister WHERE uuid = NEW.register_id;
    IF NOT EXISTS (SELECT 1 FROM tokens_registerimport source JOIN tokens_sharetoken token ON token.uuid = source.token_id
        WHERE source.token_id = token_uuid AND source.status = 'applied' AND NULLIF(token.contract_address, '') IS NULL) THEN RETURN NULL; END IF;
    SELECT * INTO proposal FROM tokens_registercorrection WHERE uuid = NEW.operation_id;
    SELECT * INTO decision FROM tokens_registercorrectiondecision WHERE register_correction_id = proposal.uuid AND kind = 'apply';
    at_time := clock_timestamp();
    IF proposal.uuid IS NULL OR proposal.preparing_appointment_id IS NULL OR proposal.status <> 'applied'
        OR proposal.applied_entry_id IS DISTINCT FROM NEW.uuid OR proposal.register_id IS DISTINCT FROM NEW.register_id
        OR proposal.reviewed_by_id IS DISTINCT FROM NEW.recorded_by_id OR decision.decided_by_id IS DISTINCT FROM NEW.recorded_by_id
        OR decision.uuid IS NULL OR NOT tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
            decision.decided_by_id, 'apply', at_time) OR NOT tokens_register_correction_approved(proposal.uuid, at_time)
    THEN RAISE EXCEPTION 'A non-tokenised correction must retain current authority through its bounded command' USING ERRCODE = '23514'; END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_register_correction_entry_effect AFTER INSERT ON tokens_registerentry
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_correction_register_entry();
CREATE FUNCTION tokens_guard_transfer_member() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint;
BEGIN
    IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_transfer_apply' THEN RETURN NEW; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF NOT EXISTS (SELECT 1 FROM tokens_registertransfer proposal JOIN tokens_registertransferdecision decision ON decision.register_transfer_id = proposal.uuid
        WHERE proposal.to_member = NEW.uuid AND proposal.new_member AND proposal.company_id = NEW.company_id AND proposal.status = 'submitted'
            AND decision.kind = 'apply' AND decision.decided_by_id = principal AND current_setting('app.company_id', true) = NEW.company_id::text
            AND tokens_register_transfer_ready(proposal, true) AND tokens_register_transfer_approved(proposal.uuid, clock_timestamp())
            AND tokens_register_appointment_current(decision.appointment_id, NEW.company_id, principal, 'apply', clock_timestamp()))
    THEN RAISE EXCEPTION 'A new transfer member needs its exact company application' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_transfer_member BEFORE INSERT ON tokens_registermember FOR EACH ROW EXECUTE FUNCTION tokens_guard_transfer_member();
CREATE FUNCTION tokens_guard_member_cessation() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE held numeric; delta numeric;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR OLD.ceased_on >= (clock_timestamp() AT TIME ZONE 'UTC')::date - 2557
            OR COALESCE(current_setting('app.company_operation', true), '') <> ''
            OR EXISTS (SELECT 1 FROM tokens_registerposition position WHERE position.member_id = OLD.member_id AND position.shares > 0)
        THEN RAISE EXCEPTION 'A member cessation must remain through its retention floor and continued membership' USING ERRCODE = '23514'; END IF;
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' THEN
        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR pg_trigger_depth() < 2
            OR OLD.returned_entry_id IS NOT NULL OR OLD.returned_on IS NOT NULL OR OLD.returned_at IS NOT NULL
            OR NEW.returned_entry_id IS NULL OR NEW.returned_at IS NULL
            OR NEW.returned_on IS DISTINCT FROM (NEW.returned_at AT TIME ZONE 'UTC')::date
            OR NEW.returned_at < statement_timestamp() OR NEW.returned_at > clock_timestamp()
            OR (to_jsonb(NEW) - ARRAY['returned_entry_id', 'returned_on', 'returned_at', 'updated_at'])
                IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['returned_entry_id', 'returned_on', 'returned_at', 'updated_at'])
            OR COALESCE((SELECT shares FROM tokens_registerposition WHERE register_id = OLD.register_id AND member_id = OLD.member_id), 0) <> 0
            OR NOT EXISTS (SELECT 1 FROM tokens_registerentry entry, jsonb_array_elements(entry.changes) effect
                WHERE entry.uuid = NEW.returned_entry_id AND entry.register_id = OLD.register_id
                    AND entry.sequence > (SELECT sequence FROM tokens_registerentry WHERE uuid = OLD.entry_id)
                    AND effect->>'member' = OLD.member_id::text AND (effect->>'shares')::numeric > 0)
        THEN RAISE EXCEPTION 'A cessation return is filled once by its exact zero-to-positive entry' USING ERRCODE = '23514'; END IF;
        RETURN NEW;
    END IF;
    IF TG_OP <> 'INSERT' OR current_user NOT IN (__OPERATOR__, __MIGRATE__) OR pg_trigger_depth() < 2 THEN
        RAISE EXCEPTION 'Only a genuine register entry records an immutable member cessation' USING ERRCODE = '23514';
    END IF;
    SELECT shares INTO held FROM tokens_registerposition WHERE register_id = NEW.register_id AND member_id = NEW.member_id;
    SELECT (effect->>'shares')::numeric INTO delta FROM tokens_registerentry entry, jsonb_array_elements(entry.changes) effect
        WHERE entry.uuid = NEW.entry_id AND effect->>'member' = NEW.member_id::text;
    IF held IS NULL OR held <= 0 OR held + delta IS DISTINCT FROM 0 OR NEW.shares_at_cessation IS DISTINCT FROM held
        OR NEW.particulars_snapshot IS DISTINCT FROM tokens_register_particulars_snapshot(NEW.member_id)
        OR NEW.name IS DISTINCT FROM NEW.particulars_snapshot->>'name' OR NEW.residential_address IS DISTINCT FROM NEW.particulars_snapshot->>'residential_address'
        OR NEW.created_at < statement_timestamp() OR NEW.created_at > clock_timestamp() OR NEW.updated_at IS DISTINCT FROM NEW.created_at
        OR NEW.ceased_on IS DISTINCT FROM (NEW.created_at AT TIME ZONE 'UTC')::date
        OR NEW.returned_entry_id IS NOT NULL OR NEW.returned_on IS NOT NULL OR NEW.returned_at IS NOT NULL
        OR NEW.identity_source <> 'particulars' OR NOT EXISTS (SELECT 1 FROM tokens_registerentry entry JOIN tokens_shareregister register ON register.uuid = entry.register_id
            JOIN tokens_registermember member ON member.uuid = NEW.member_id WHERE entry.uuid = NEW.entry_id AND register.uuid = NEW.register_id
                AND register.company_id = NEW.company_id AND member.company_id = NEW.company_id)
    THEN RAISE EXCEPTION 'A cessation must freeze the exact positive-to-zero entry and particulars' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_member_cessation_guard BEFORE INSERT OR UPDATE OR DELETE ON tokens_registermembercessation FOR EACH ROW EXECUTE FUNCTION tokens_guard_member_cessation();
CREATE FUNCTION tokens_record_member_cessations() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE effect jsonb; held numeric; snapshot jsonb; issuer uuid; member_uuid uuid; at_time timestamptz;
BEGIN
    SELECT company_id INTO issuer FROM tokens_shareregister WHERE uuid = NEW.register_id;
    IF NOT EXISTS (SELECT 1 FROM tokens_shareregister register JOIN tokens_sharetoken token ON token.uuid = register.token_id
        WHERE register.uuid = NEW.register_id AND token.status = 'draft' AND NULLIF(token.contract_address, '') IS NULL
            AND token.deployment_id IS NULL AND token.deployment_transaction_id IS NULL AND NULLIF(token.deployment_tx_hash, '') IS NULL
            AND token.deployed_at IS NULL AND NULLIF(token.chain, '') IS NULL
            AND EXISTS (SELECT 1 FROM tokens_registerimport source WHERE source.token_id = token.uuid AND source.status = 'applied')) THEN RETURN NEW; END IF;
    at_time := clock_timestamp();
    FOR effect IN SELECT value FROM jsonb_array_elements(NEW.changes) LOOP
        member_uuid := (effect->>'member')::uuid;
        SELECT shares INTO held FROM tokens_registerposition WHERE register_id = NEW.register_id AND member_id = member_uuid;
        snapshot := tokens_register_particulars_snapshot(member_uuid);
        IF COALESCE(held, 0) = 0 AND (effect->>'shares')::numeric > 0 THEN
            UPDATE tokens_registermembercessation SET returned_entry_id = NEW.uuid, returned_on = (at_time AT TIME ZONE 'UTC')::date,
                returned_at = at_time, updated_at = at_time WHERE register_id = NEW.register_id AND member_id = member_uuid AND returned_entry_id IS NULL;
        END IF;
        IF held > 0 AND held + (effect->>'shares')::numeric = 0 AND snapshot IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM tokens_registermemberwallet wallet WHERE wallet.company_id = issuer AND wallet.member_id = member_uuid) THEN
            INSERT INTO tokens_registermembercessation(uuid, created_at, updated_at, company_id, register_id, member_id, entry_id,
                ceased_on, shares_at_cessation, name, residential_address, identity_source, particulars_snapshot)
            VALUES(gen_random_uuid(), at_time, at_time, issuer, NEW.register_id, member_uuid, NEW.uuid,
                (at_time AT TIME ZONE 'UTC')::date, held, snapshot->>'name', snapshot->>'residential_address', 'particulars', snapshot);
        END IF;
    END LOOP;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_entry_cessation AFTER INSERT ON tokens_registerentry FOR EACH ROW EXECUTE FUNCTION tokens_record_member_cessations();
"""

TRANSFER_PARTICULARS = """    IF NEW.source_transfer_id IS NOT NULL THEN
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
"""
PARTICULARS_GUARD = GRANTS.PARTICULARS_GUARD.replace(
    "    IF NEW.source_grant_id IS NOT NULL THEN", TRANSFER_PARTICULARS + "    IF NEW.source_grant_id IS NOT NULL THEN"
)
PARTICULARS_GUARD = GRANTS.PARTICULARS.OPENING_IMPORT._replaced(
    PARTICULARS_GUARD,
    (
        (
            """        RETURN OLD;
    END IF;
""",
            """        IF EXISTS (SELECT 1 FROM tokens_registerposition position WHERE position.member_id = OLD.member_id AND position.shares > 0)
            OR tokens_register_member_left_on(OLD.member_id) IS NULL
            OR tokens_register_member_left_on(OLD.member_id) >= (clock_timestamp() AT TIME ZONE 'UTC')::date - 2557 THEN
            RAISE EXCEPTION 'Member particulars retain the actual exit clock and continued membership' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;
""",
        ),
    ),
)
IMPORT_GUARD = GRANTS.PARTICULARS.OPENING_IMPORT._replaced(
    GRANTS.IMPORT_GUARD,
    (("p.source_grant_id IS NOT NULL)", "p.source_grant_id IS NOT NULL OR p.source_transfer_id IS NOT NULL)"),),
)

REMOVE = """
DROP TRIGGER IF EXISTS tokens_register_correction_entry_effect ON tokens_registerentry;
DROP FUNCTION IF EXISTS tokens_check_correction_register_entry();
DROP TRIGGER IF EXISTS tokens_register_correction_entry ON tokens_registerentry;
DROP FUNCTION IF EXISTS tokens_guard_correction_register_entry();
DROP TRIGGER tokens_register_entry_cessation ON tokens_registerentry;
DROP FUNCTION tokens_record_member_cessations();
DROP TRIGGER tokens_register_member_cessation_guard ON tokens_registermembercessation;
DROP FUNCTION tokens_guard_member_cessation();
DROP TRIGGER tokens_register_transfer_member ON tokens_registermember;
DROP FUNCTION tokens_guard_transfer_member();
DROP TRIGGER tokens_register_transfer_entry ON tokens_registerentry;
DROP FUNCTION tokens_guard_transfer_register_entry();
DROP TRIGGER tokens_register_transfer_decision_effect ON tokens_registertransferdecision;
DROP FUNCTION tokens_check_register_transfer_decision();
DROP TRIGGER tokens_register_transfer_decision_guard ON tokens_registertransferdecision;
DROP FUNCTION tokens_guard_register_transfer_decision();
DROP TRIGGER tokens_register_transfer_identity ON tokens_registertransfer;
DROP FUNCTION tokens_guard_register_transfer();
DROP FUNCTION tokens_register_transfer_evidence_matches(uuid, uuid, bigint, text, text, jsonb, text, uuid);
DROP FUNCTION tokens_register_transfer_ready(tokens_registertransfer, boolean);
DROP FUNCTION tokens_register_transfer_decision_digest(uuid, text, bigint, uuid, text);
DROP FUNCTION tokens_register_transfer_approved(uuid, timestamptz);
DROP FUNCTION tokens_register_transfer_changes(tokens_registertransfer);
DROP FUNCTION tokens_register_particulars_snapshot(uuid);
DROP FUNCTION IF EXISTS tokens_register_member_left_on(uuid);
"""


def install_transfer_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(IMPORTS._with_roles(cursor, FUNCTIONS))
        cursor.execute(IMPORTS._with_roles(cursor, PARTICULARS_GUARD))
        cursor.execute(IMPORTS._with_roles(cursor, IMPORT_GUARD))
        cursor.execute(GRANTS.PARTICULARS.PIN_IMPORT_GUARD)


def remove_transfer_guards(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(
            "LOCK TABLE tokens_registertransfer, tokens_registertransferdecision, tokens_registermembercessation IN ACCESS EXCLUSIVE MODE"
        )
        cursor.execute(
            "SELECT EXISTS (SELECT 1 FROM tokens_registertransfer) OR EXISTS (SELECT 1 FROM tokens_registermembercessation)"
        )
        if cursor.fetchone()[0]:
            raise RuntimeError("Retain company register transfers, cessations, decisions and evidence.")
        cursor.execute(IMPORTS._with_roles(cursor, GRANTS.PARTICULARS_GUARD))
        cursor.execute(IMPORTS._with_roles(cursor, GRANTS.IMPORT_GUARD))
        cursor.execute(GRANTS.PARTICULARS.PIN_IMPORT_GUARD)
        cursor.execute(REMOVE)


class Migration(migrations.Migration):
    dependencies = [("tokens", "0096_company_register_transfers")]
    operations = [migrations.RunPython(install_transfer_guards, remove_transfer_guards)]
