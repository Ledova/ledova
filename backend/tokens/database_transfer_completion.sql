CREATE FUNCTION tokens_register_transfer_completion_digest(transfer_uuid uuid, actor bigint,
    approval_appointment uuid, application_appointment uuid) RETURNS text
LANGUAGE sql STABLE SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT encode(sha256(convert_to(jsonb_build_object('version', '1', 'complete_transfer', true,
        'preview', tokens_register_transfer_decision_digest(transfer_uuid, 'approve', actor, approval_appointment, ''),
        'apply_appointment', application_appointment)::text, 'UTF8')), 'hex');
$$;

CREATE OR REPLACE FUNCTION tokens_guard_register_transfer_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint; at_time timestamptz; proposal tokens_registertransfer;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Register transfer decisions are append-only' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
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
        OR NEW.digest IS DISTINCT FROM (CASE WHEN NEW.completion_approval_appointment_id IS NOT NULL
            THEN tokens_register_transfer_completion_digest(proposal.uuid, principal, NEW.completion_approval_appointment_id, NEW.appointment_id)
            ELSE tokens_register_transfer_decision_digest(proposal.uuid, NEW.kind, principal, NEW.appointment_id, NEW.reason) END)
        OR (NEW.completion_approval_appointment_id IS NOT NULL AND (NEW.kind <> 'apply'
            OR NOT tokens_register_appointment_current(NEW.completion_approval_appointment_id, proposal.company_id, principal, 'approve', at_time)))
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'approve' AND tokens_register_transfer_approved(proposal.uuid, at_time))
        OR (NEW.kind = 'apply' AND NOT tokens_register_transfer_approved(proposal.uuid, at_time))
        OR (NEW.kind <> 'reject' AND NOT tokens_register_transfer_ready(proposal, true))
    THEN
        RAISE EXCEPTION 'Register transfer decisions need exact current company authority and effect' USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := at_time; NEW.created_at := at_time; NEW.updated_at := at_time;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tokens_check_register_transfer_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registertransfer; at_time timestamptz;
BEGIN
    SELECT * INTO proposal FROM tokens_registertransfer WHERE uuid = NEW.register_transfer_id;
    at_time := clock_timestamp();
    IF (NEW.completion_approval_appointment_id IS NOT NULL AND (NEW.kind <> 'apply'
            OR NOT tokens_register_appointment_current(NEW.completion_approval_appointment_id, proposal.company_id, NEW.decided_by_id, 'approve', at_time)))
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, NEW.decided_by_id,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'apply' AND NOT tokens_register_transfer_approved(proposal.uuid, at_time))
        OR (NEW.kind <> 'reject' AND NOT EXISTS (SELECT 1 FROM tokens_sharetoken token
            WHERE token.uuid = proposal.token_id AND token.company_id = proposal.company_id AND token.is_transferable))
    THEN
        RAISE EXCEPTION 'Register transfer authority and approval must remain current at commit' USING ERRCODE = '23514';
    END IF;
    IF (NEW.kind = 'approve' AND proposal.status <> 'submitted' AND NOT (proposal.status = 'applied'
            AND EXISTS (SELECT 1 FROM tokens_registertransferdecision completion
                WHERE completion.register_transfer_id = proposal.uuid AND completion.kind = 'apply'
                    AND completion.completion_approval_appointment_id = NEW.appointment_id
                    AND completion.decided_by_id = NEW.decided_by_id AND completion.decided_at >= NEW.decided_at)))
        OR (NEW.kind <> 'approve' AND (proposal.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END
            OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR (NEW.kind = 'reject' AND proposal.rejection_reason IS DISTINCT FROM NEW.reason)))
    THEN
        RAISE EXCEPTION 'A register transfer decision must carry exactly its own effect' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$function$;
