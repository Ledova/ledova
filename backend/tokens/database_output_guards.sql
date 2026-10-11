CREATE FUNCTION tokens_member_certificate_producer_current(appointment_uuid uuid, issuer uuid, actor bigint) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM unnest(ARRAY['read_register', 'prepare', 'approve', 'apply']) capability
        WHERE tokens_register_appointment_current(appointment_uuid, issuer, actor, capability, clock_timestamp()));
$$;
CREATE FUNCTION tokens_member_certificate_source(request_uuid uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT jsonb_build_object('version', '1', 'request', source.uuid, 'association', source.association_id,
        'company', source.company_id, 'token', source.token_id, 'member', source.member,
        'entry', entry.uuid, 'entry_hash', entry.entry_hash, 'sequence', entry.sequence,
        'register_sequence', register.sequence, 'register_head', register.head_hash,
        'particulars', tokens_register_particulars_snapshot(source.member),
        'holding', (SELECT sum((change->>'shares')::numeric)::text
            FROM tokens_registerentry history, jsonb_array_elements(history.changes) change
            WHERE history.register_id = register.uuid AND history.sequence <= entry.sequence
                AND change->>'member' = source.member::text))
    FROM tokens_membercertificaterequest source JOIN tokens_registerentry entry ON entry.uuid = source.entry_id
        JOIN tokens_shareregister register ON register.uuid = entry.register_id
    WHERE source.uuid = request_uuid AND register.company_id = source.company_id AND register.token_id = source.token_id;
$$;
CREATE FUNCTION tokens_member_certificate_source_digest(request_uuid uuid) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT encode(sha256(convert_to(tokens_member_certificate_source(request_uuid)::text, 'UTF8')), 'hex');
$$;
CREATE FUNCTION tokens_guard_member_certificate_fulfilment() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint; source tokens_membercertificaterequest; audit tokens_registerexport;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Retain immutable recipient-only certificate fulfilments and original exports'
        USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO source FROM tokens_membercertificaterequest WHERE uuid = NEW.request_id;
    PERFORM 1 FROM companies_company WHERE uuid = source.company_id FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = source.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_shareregister WHERE token_id = source.token_id FOR UPDATE;
    PERFORM 1 FROM tokens_memberassociation WHERE uuid = source.association_id FOR UPDATE;
    SELECT * INTO source FROM tokens_membercertificaterequest WHERE uuid = NEW.request_id FOR UPDATE;
    SELECT * INTO audit FROM tokens_registerexport WHERE uuid = NEW.export_id;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR source.uuid IS NULL
        OR NEW.produced_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'member_certificate_fulfil'
        OR current_setting('app.company_id', true) IS DISTINCT FROM source.company_id::text
        OR NOT tokens_member_certificate_producer_current(NEW.appointment_id, source.company_id, principal)
        OR NOT tokens_member_certificate_entry(source.association_id, source.entry_id)
        OR EXISTS (SELECT 1 FROM tokens_membercertificatewithdrawal WHERE request_id = source.uuid)
        OR NEW.source_snapshot IS DISTINCT FROM tokens_member_certificate_source(source.uuid)
        OR NEW.source_digest IS DISTINCT FROM tokens_member_certificate_source_digest(source.uuid)
        OR NEW.source_snapshot->'particulars' = 'null'::jsonb OR NEW.source_snapshot IS NULL
        OR NEW.instruction !~ '[^[:space:]]' OR NEW.digest !~ '^[0-9a-f]{64}$'
        OR NEW.file_size <= 0 OR NEW.file_size > 1048576
        OR NEW.file !~ ('^companies/' || source.company_id || '/member-certificates/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
        OR audit.uuid IS NULL OR audit.token_id IS DISTINCT FROM source.token_id OR audit.requested_by_id IS DISTINCT FROM principal
        OR audit.kind <> 'certificate' OR audit.register_sequence IS DISTINCT FROM (NEW.source_snapshot->>'sequence')::bigint
        OR audit.member_rows <> 1 OR audit.former_rows <> 0 OR audit.digest IS DISTINCT FROM NEW.digest
        OR audit.instruction IS DISTINCT FROM NEW.instruction
    THEN RAISE EXCEPTION 'Certificate fulfilment needs exact current company authority, own receiving effect, captured source and audited bytes'
        USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_member_certificate_fulfilment_identity BEFORE INSERT OR UPDATE OR DELETE ON tokens_membercertificatefulfilment
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_member_certificate_fulfilment();
CREATE FUNCTION tokens_check_member_certificate_fulfilment() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE source tokens_membercertificaterequest;
BEGIN
    SELECT * INTO source FROM tokens_membercertificaterequest WHERE uuid = NEW.request_id;
    IF NOT tokens_member_certificate_producer_current(NEW.appointment_id, source.company_id, NEW.produced_by_id)
        OR NOT tokens_member_certificate_entry(source.association_id, source.entry_id)
        OR EXISTS (SELECT 1 FROM tokens_membercertificatewithdrawal WHERE request_id = source.uuid)
        OR NEW.source_snapshot IS DISTINCT FROM tokens_member_certificate_source(source.uuid)
        OR NEW.source_digest IS DISTINCT FROM tokens_member_certificate_source_digest(source.uuid)
    THEN RAISE EXCEPTION 'Own certificate source and producing company authority must remain current at commit' USING ERRCODE = '23514'; END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_member_certificate_fulfilment_commit AFTER INSERT ON tokens_membercertificatefulfilment
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_member_certificate_fulfilment();
CREATE OR REPLACE FUNCTION tokens_guard_member_certificate_withdrawal() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint; source tokens_membercertificaterequest;
BEGIN
    IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'Retain append-only member certificate withdrawals' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO source FROM tokens_membercertificaterequest WHERE uuid = NEW.request_id;
    PERFORM 1 FROM companies_company WHERE uuid = source.company_id FOR UPDATE;
    SELECT * INTO source FROM tokens_membercertificaterequest WHERE uuid = NEW.request_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR NEW.withdrawn_by_id IS DISTINCT FROM principal
        OR source.uuid IS NULL OR source.requested_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'member_certificate_withdraw'
        OR current_setting('app.company_id', true) IS DISTINCT FROM source.company_id::text
        OR NOT tokens_member_association_current(source.association_id, principal)
        OR EXISTS (SELECT 1 FROM tokens_membercertificatefulfilment WHERE request_id = source.uuid)
    THEN RAISE EXCEPTION 'Only the own current associated requester may withdraw an unfulfilled certificate request' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
