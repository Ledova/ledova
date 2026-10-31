CREATE OR REPLACE FUNCTION public.tokens_mirror_members_valid(members jsonb, as_at date)
RETURNS boolean LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE member jsonb; allotment jsonb; quantity numeric; paid numeric;
BEGIN
    IF jsonb_typeof(members) IS DISTINCT FROM 'array' OR jsonb_array_length(members) > 10000 THEN RETURN false; END IF;
    FOR member IN SELECT value FROM jsonb_array_elements(members) LOOP
        IF jsonb_typeof(member) IS DISTINCT FROM 'object'
            OR (SELECT array_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(member - 'documents') key)
                IS DISTINCT FROM ARRAY['allotments','amount_paid','entered_on','member','name','residential_address','shares']
            OR jsonb_typeof(member->'member') IS DISTINCT FROM 'string'
            OR member->>'member' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            OR jsonb_typeof(member->'name') IS DISTINCT FROM 'string' OR length(btrim(member->>'name')) NOT BETWEEN 1 AND 255
            OR jsonb_typeof(member->'residential_address') IS DISTINCT FROM 'string'
            OR length(btrim(member->>'residential_address')) NOT BETWEEN 1 AND 1000
            OR jsonb_typeof(member->'shares') IS DISTINCT FROM 'string' OR member->>'shares' !~ '^[1-9][0-9]{0,77}$'
            OR jsonb_typeof(member->'entered_on') IS DISTINCT FROM 'string'
            OR member->>'entered_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            OR (jsonb_typeof(member->'amount_paid') IS DISTINCT FROM 'null'
                AND (jsonb_typeof(member->'amount_paid') IS DISTINCT FROM 'string'
                    OR member->>'amount_paid' !~ '^(0|[1-9][0-9]{0,21})[.][0-9]{2}$'))
            OR jsonb_typeof(member->'allotments') IS DISTINCT FROM 'array'
            OR jsonb_array_length(member->'allotments') > 10000 THEN RETURN false; END IF;
        IF (member->>'entered_on')::date > as_at THEN RETURN false; END IF;
        quantity := 0; paid := 0;
        FOR allotment IN SELECT value FROM jsonb_array_elements(member->'allotments') LOOP
            IF jsonb_typeof(allotment) IS DISTINCT FROM 'object'
                OR (SELECT array_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(allotment) key)
                    IS DISTINCT FROM ARRAY['allotted_on','amount_paid','amount_unpaid','beneficially_held','certificate_reference','fully_paid','share_reference','shares']
                OR jsonb_typeof(allotment->'shares') IS DISTINCT FROM 'string'
                OR allotment->>'shares' !~ '^[1-9][0-9]{0,77}$'
                OR jsonb_typeof(allotment->'allotted_on') IS DISTINCT FROM 'string'
                OR allotment->>'allotted_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                OR jsonb_typeof(allotment->'amount_paid') IS DISTINCT FROM 'string'
                OR allotment->>'amount_paid' !~ '^(0|[1-9][0-9]{0,17})[.][0-9]{2}$'
                OR jsonb_typeof(allotment->'amount_unpaid') IS DISTINCT FROM 'string'
                OR allotment->>'amount_unpaid' !~ '^(0|[1-9][0-9]{0,17})[.][0-9]{2}$'
                OR jsonb_typeof(allotment->'fully_paid') IS DISTINCT FROM 'boolean'
                OR (jsonb_typeof(allotment->'beneficially_held') IS DISTINCT FROM 'boolean'
                    AND jsonb_typeof(allotment->'beneficially_held') IS DISTINCT FROM 'null')
                OR (jsonb_typeof(allotment->'share_reference') IS DISTINCT FROM 'null'
                    AND (jsonb_typeof(allotment->'share_reference') IS DISTINCT FROM 'string'
                        OR length(btrim(allotment->>'share_reference')) NOT BETWEEN 1 AND 255))
                OR (jsonb_typeof(allotment->'certificate_reference') IS DISTINCT FROM 'null'
                    AND (jsonb_typeof(allotment->'certificate_reference') IS DISTINCT FROM 'string'
                        OR length(btrim(allotment->>'certificate_reference')) NOT BETWEEN 1 AND 255))
                THEN RETURN false; END IF;
            IF (allotment->>'shares')::numeric > 115792089237316195423570985008687907853269984665640564039457584007913129639935
                OR (allotment->>'allotted_on')::date > as_at
                OR (allotment->>'fully_paid')::boolean IS DISTINCT FROM ((allotment->>'amount_unpaid')::numeric = 0)
                THEN RETURN false; END IF;
            quantity := quantity + (allotment->>'shares')::numeric;
            paid := paid + (allotment->>'amount_paid')::numeric;
        END LOOP;
        IF (member->>'shares')::numeric > 115792089237316195423570985008687907853269984665640564039457584007913129639935
            OR (jsonb_typeof(member->'amount_paid') = 'string'
                AND (quantity <> (member->>'shares')::numeric OR paid <> (member->>'amount_paid')::numeric))
            THEN RETURN false; END IF;
    END LOOP;
    RETURN (SELECT count(DISTINCT item->>'member') = jsonb_array_length(members)
        AND COALESCE(sum((item->>'shares')::numeric), 0) <= 115792089237316195423570985008687907853269984665640564039457584007913129639935
        FROM jsonb_array_elements(members) item);
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow OR invalid_text_representation THEN RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_mirror_award_identities_valid(issuer uuid, proposal_uuid uuid, members jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT NOT EXISTS (SELECT 1 FROM jsonb_array_elements(members) item
        JOIN tokens_registeraward award ON award.member::text = item->>'member'
        WHERE NOT EXISTS (SELECT 1 FROM tokens_registermember member
            JOIN tokens_shareregister register ON register.company_id = member.company_id
            JOIN tokens_registerentry entry ON entry.register_id = register.uuid
            WHERE member.uuid::text = item->>'member' AND member.company_id = issuer
                AND entry.operation_id IS DISTINCT FROM proposal_uuid
                AND EXISTS (SELECT 1 FROM jsonb_array_elements(entry.changes) change
                    WHERE change->>'member' = item->>'member'))
            AND (award.company_id IS DISTINCT FROM issuer OR NOT EXISTS (SELECT 1 FROM tokens_registermemberparticulars held
                WHERE held.member_id = award.member AND held.name = item->>'name'
                    AND held.residential_address = item->>'residential_address')));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_mirror_changes(proposal_uuid uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    WITH proposal AS (SELECT * FROM tokens_registerimport WHERE uuid = proposal_uuid),
    incoming AS (SELECT item->>'member' AS member, (item->>'shares')::numeric AS shares
        FROM proposal, jsonb_array_elements(proposal.members) item),
    held AS (SELECT position.member_id::text AS member, position.shares FROM tokens_registerposition position
        JOIN tokens_shareregister register ON register.uuid = position.register_id
        JOIN proposal ON proposal.token_id = register.token_id WHERE position.shares > 0),
    changes AS (SELECT COALESCE(incoming.member, held.member) AS member,
        COALESCE(incoming.shares, 0) - COALESCE(held.shares, 0) AS shares FROM incoming FULL JOIN held USING(member))
    SELECT COALESCE(jsonb_agg(jsonb_build_object('member', member, 'shares', shares::text)
        ORDER BY member COLLATE "C") FILTER (WHERE shares <> 0), '[]'::jsonb) FROM changes;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_mirror_correction_ready(proposal tokens_registerimport)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (SELECT 1 FROM tokens_registerimport previous
        JOIN tokens_sharetoken token ON token.uuid = previous.token_id
        JOIN tokens_shareregister register ON register.token_id = token.uuid
        JOIN tokens_registerentry opening ON opening.register_id = register.uuid AND opening.kind = 'opening'
        JOIN tokens_registerimport origin ON origin.uuid = opening.operation_id AND origin.status = 'applied'
            AND origin.token_id = token.uuid AND origin.company_id = token.company_id
        WHERE previous.uuid = proposal.correction_of_id AND previous.status = 'applied'
            AND previous.token_id = proposal.token_id AND previous.company_id = proposal.company_id
            AND proposal.as_at >= previous.as_at AND NULLIF(token.contract_address, '') IS NULL
            AND token.deployment_id IS NULL AND token.deployment_transaction_id IS NULL AND NULLIF(token.deployment_tx_hash, '') IS NULL
            AND register.sequence = proposal.base_sequence AND register.head_hash = proposal.base_hash
            AND NOT EXISTS (SELECT 1 FROM tokens_registerimport later WHERE later.correction_of_id = previous.uuid AND later.status = 'applied')
            AND NOT EXISTS (SELECT 1 FROM tokens_registerentry entry WHERE entry.register_id = register.uuid
                AND entry.kind NOT IN ('opening','mirror_correction'))
            AND NOT EXISTS (SELECT 1 FROM tokens_registerdeployment deployment WHERE deployment.token_id = token.uuid AND deployment.status = 'applied')
            AND NOT EXISTS (SELECT 1 FROM tokens_shareissuancerequest issue WHERE issue.token_id = token.uuid
                AND issue.status IN ('approved','executing','executed','failed'))
            AND NOT EXISTS (SELECT 1 FROM tokens_registerinstruction instruction WHERE instruction.token_id = token.uuid AND instruction.status = 'applied')
            AND NOT EXISTS (SELECT 1 FROM tokens_memberinvitation invitation WHERE invitation.company_id = token.company_id)
            AND NOT EXISTS (SELECT 1 FROM tokens_memberassociation association WHERE association.company_id = token.company_id)
            AND NOT EXISTS (SELECT 1 FROM tokens_registerparticularschange change JOIN tokens_registermember member ON member.uuid = change.member_id WHERE member.company_id = token.company_id));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_mirror_opening_clear(token_uuid uuid)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT NOT EXISTS (SELECT 1 FROM tokens_registerdeployment deployment WHERE deployment.token_id = token_uuid AND deployment.status = 'applied')
        AND NOT EXISTS (SELECT 1 FROM tokens_shareissuancerequest issue WHERE issue.token_id = token_uuid
            AND issue.status IN ('approved','executing','executed','failed'))
        AND NOT EXISTS (SELECT 1 FROM tokens_registerinstruction instruction WHERE instruction.token_id = token_uuid AND instruction.status = 'applied');
$function$;

CREATE OR REPLACE FUNCTION public.tokens_empty_mirror_opening_ready(proposal tokens_registerimport)
RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
    SELECT proposal.members <> '[]'::jsonb OR (proposal.correction_of_id IS NULL AND proposal.former_members = '[]'::jsonb
        AND EXISTS (SELECT 1 FROM tokens_sharetoken token WHERE token.uuid = proposal.token_id AND token.company_id = proposal.company_id
            AND token.status = 'draft' AND NULLIF(token.contract_address, '') IS NULL AND token.deployment_id IS NULL
            AND token.deployment_transaction_id IS NULL AND NULLIF(token.deployment_tx_hash, '') IS NULL
            AND token.deployed_at IS NULL AND NULLIF(token.chain, '') IS NULL)
        AND NOT EXISTS (SELECT 1 FROM tokens_shareregister register WHERE register.token_id = proposal.token_id AND register.sequence > 0)
        AND tokens_mirror_opening_clear(proposal.token_id));
$function$;

CREATE OR REPLACE FUNCTION public.tokens_validate_mirror_import(candidate tokens_registerimport, previous tokens_registerimport, operation text)
RETURNS tokens_registerimport LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE principal bigint; at_time timestamptz; copy tokens_registerevidence; head tokens_shareregister; entry tokens_registerentry; former_item jsonb;
BEGIN
    IF operation = 'DELETE' THEN RAISE EXCEPTION 'Retain mirror snapshots and their evidence' USING ERRCODE = '23514'; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint; at_time := clock_timestamp();
    PERFORM 1 FROM companies_company WHERE uuid = candidate.company_id FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = candidate.token_id AND company_id = candidate.company_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR NOT FOUND
        OR current_setting('app.company_id', true) IS DISTINCT FROM candidate.company_id::text THEN
        RAISE EXCEPTION 'Mirror snapshots require their exact company command' USING ERRCODE = '23514'; END IF;
    SELECT * INTO head FROM tokens_shareregister WHERE token_id = candidate.token_id FOR UPDATE;
    IF operation = 'INSERT' THEN
        IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_import_prepare'
            OR candidate.submitted_by_id IS DISTINCT FROM principal OR candidate.status <> 'submitted'
            OR candidate.reviewed_by_id IS NOT NULL OR candidate.reviewed_at IS NOT NULL OR candidate.register_sequence IS NOT NULL
            OR candidate.rejection_reason <> '' OR NOT candidate.source_confirmed
            OR length(btrim(candidate.source_reference)) = 0 OR candidate.authority <> 'company_records'
            OR candidate.authority_reference <> candidate.source_reference OR candidate.approving_director <> ''
            OR length(btrim(candidate.reason)) = 0 OR candidate.source_document IS NOT NULL OR candidate.asic_document IS NOT NULL
            OR candidate.as_at > current_date OR NOT tokens_mirror_members_valid(candidate.members, candidate.as_at)
            OR NOT tokens_mirror_award_identities_valid(candidate.company_id, candidate.uuid, candidate.members)
            OR NOT tokens_empty_mirror_opening_ready(candidate)
            OR NOT tokens_register_appointment_current(candidate.preparing_appointment_id, candidate.company_id, principal, 'prepare', at_time)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(candidate.members) item JOIN tokens_registermember member ON member.uuid::text = item->>'member'
                WHERE member.company_id <> candidate.company_id)
            OR (candidate.correction_of_id IS NOT NULL AND NOT tokens_mirror_correction_ready(candidate))
            OR (candidate.correction_of_id IS NULL AND (candidate.base_sequence IS NOT NULL OR candidate.base_hash <> ''
                OR EXISTS (SELECT 1 FROM tokens_registerimport confirmed WHERE confirmed.token_id = candidate.token_id AND confirmed.status = 'applied')))
            OR (candidate.correction_of_id IS NULL AND COALESCE(head.sequence, 0) = 0 AND NOT tokens_mirror_opening_clear(candidate.token_id))
            OR (candidate.asic_issued_total IS NOT NULL AND candidate.asic_issued_total IS DISTINCT FROM
                (SELECT COALESCE(sum((item->>'shares')::numeric), 0) FROM jsonb_array_elements(candidate.members) item))
            OR (candidate.asic_evidence_id IS NULL AND (candidate.asic_issued_total IS NOT NULL OR candidate.asic_member_count IS NOT NULL))
            OR jsonb_typeof(candidate.former_members) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'A mirror needs complete company records and its exact current opening snapshot' USING ERRCODE = '23514'; END IF;
        FOR former_item IN SELECT value FROM jsonb_array_elements(candidate.former_members) LOOP
            IF jsonb_typeof(former_item) IS DISTINCT FROM 'object'
                OR (SELECT array_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(former_item) key) IS DISTINCT FROM ARRAY['ceased_on','name','residential_address','shares']
                OR jsonb_typeof(former_item->'name') IS DISTINCT FROM 'string' OR length(btrim(former_item->>'name')) = 0
                OR jsonb_typeof(former_item->'residential_address') IS DISTINCT FROM 'string' OR length(btrim(former_item->>'residential_address')) = 0
                OR jsonb_typeof(former_item->'shares') IS DISTINCT FROM 'string' OR former_item->>'shares' !~ '^[1-9][0-9]{0,77}$'
                OR jsonb_typeof(former_item->'ceased_on') IS DISTINCT FROM 'string' OR former_item->>'ceased_on' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                OR (former_item->>'ceased_on')::date > candidate.as_at THEN
                RAISE EXCEPTION 'Mirrored former records need exact company particulars' USING ERRCODE = '23514'; END IF;
        END LOOP;
        IF candidate.register_evidence_id IS NULL THEN
            IF candidate.file <> '' OR candidate.evidence_snapshot IS NOT NULL OR candidate.evidence_fingerprint <> '' THEN
                RAISE EXCEPTION 'A manual mirror has no fabricated document evidence' USING ERRCODE = '23514'; END IF;
        ELSE
            SELECT * INTO copy FROM tokens_registerevidence WHERE uuid = candidate.register_evidence_id;
            IF copy.uuid IS NULL OR copy.company_id <> candidate.company_id OR copy.uploaded_by_id <> principal OR copy.kind <> 'share_register'
                OR candidate.evidence_fingerprint IS DISTINCT FROM copy.sha256 OR candidate.evidence_snapshot IS DISTINCT FROM tokens_register_evidence_snapshot(copy)
                OR candidate.file !~ ('^companies/' || candidate.company_id || '/register-imports/' || candidate.uuid || '/[0-9a-f-]{36}[.]bin$') THEN
                RAISE EXCEPTION 'Mirror document attribution must match its company-provided copy' USING ERRCODE = '23514'; END IF;
        END IF;
        IF candidate.asic_evidence_id IS NULL THEN
            IF candidate.asic_file <> '' OR candidate.asic_snapshot IS NOT NULL OR candidate.asic_fingerprint <> '' THEN
                RAISE EXCEPTION 'An optional ASIC cross-check has no fabricated evidence' USING ERRCODE = '23514'; END IF;
        ELSE
            SELECT * INTO copy FROM tokens_registerevidence WHERE uuid = candidate.asic_evidence_id;
            IF copy.uuid IS NULL OR copy.company_id <> candidate.company_id OR copy.uploaded_by_id <> principal OR copy.kind <> 'asic_extract'
                OR candidate.asic_fingerprint IS DISTINCT FROM copy.sha256 OR candidate.asic_snapshot IS DISTINCT FROM tokens_register_evidence_snapshot(copy)
                OR candidate.asic_file !~ ('^companies/' || candidate.company_id || '/register-imports/' || candidate.uuid || '/[0-9a-f-]{36}[.]bin$') THEN
                RAISE EXCEPTION 'ASIC cross-check attribution must match its company-provided copy' USING ERRCODE = '23514'; END IF;
        END IF;
        RETURN candidate;
    END IF;
    IF previous.status <> 'submitted' OR candidate.status NOT IN ('applied','rejected')
        OR (to_jsonb(candidate) - ARRAY['status','reviewed_by_id','reviewed_at','rejection_reason','register_sequence','updated_at'])
            IS DISTINCT FROM (to_jsonb(previous) - ARRAY['status','reviewed_by_id','reviewed_at','rejection_reason','register_sequence','updated_at'])
        OR candidate.reviewed_by_id IS DISTINCT FROM principal OR candidate.reviewed_at IS NULL
        OR current_setting('app.company_operation', true) IS DISTINCT FROM ('register_import_' || CASE candidate.status WHEN 'applied' THEN 'apply' ELSE 'reject' END)
        OR NOT EXISTS (SELECT 1 FROM tokens_registerimportdecision decision WHERE decision.register_import_id = candidate.uuid
            AND decision.decided_by_id = principal AND decision.decided_at = candidate.reviewed_at
            AND decision.kind = CASE candidate.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
            AND tokens_register_appointment_current(decision.appointment_id, candidate.company_id, principal,
                CASE candidate.status WHEN 'applied' THEN 'apply' ELSE 'approve' END, at_time)) THEN
        RAISE EXCEPTION 'Mirror snapshots are immutable except for their exact company decision' USING ERRCODE = '23514'; END IF;
    IF candidate.status = 'rejected' THEN
        IF length(btrim(candidate.rejection_reason)) = 0 OR candidate.register_sequence IS NOT NULL THEN
            RAISE EXCEPTION 'Mirror rejection requires a reason and changes no holdings' USING ERRCODE = '23514'; END IF;
        RETURN candidate;
    END IF;
    IF candidate.register_sequence IS DISTINCT FROM head.sequence OR candidate.rejection_reason <> ''
        OR NOT tokens_mirror_award_identities_valid(candidate.company_id, candidate.uuid, candidate.members)
        OR NOT tokens_register_import_approved(candidate.uuid, at_time)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(candidate.members) item WHERE NOT EXISTS (
            SELECT 1 FROM tokens_registerposition position JOIN tokens_registermemberparticulars particulars ON particulars.member_id = position.member_id
            WHERE position.register_id = head.uuid AND position.member_id::text = item->>'member'
                AND position.shares = (item->>'shares')::numeric
                AND (particulars.source_import_id = candidate.uuid OR particulars.as_at > candidate.as_at)))
        OR EXISTS (SELECT 1 FROM tokens_registerposition position WHERE position.register_id = head.uuid AND position.shares > 0
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(candidate.members) item WHERE item->>'member' = position.member_id::text)) THEN
        RAISE EXCEPTION 'A confirmed mirror must project exactly its reviewed holdings and particulars' USING ERRCODE = '23514'; END IF;
    IF candidate.correction_of_id IS NOT NULL THEN
        SELECT * INTO entry FROM tokens_registerentry WHERE register_id = head.uuid AND operation_id = candidate.uuid;
        IF (head.sequence = candidate.base_sequence AND head.head_hash = candidate.base_hash AND entry.uuid IS NULL) THEN
            IF NOT tokens_mirror_correction_ready(candidate) THEN
                RAISE EXCEPTION 'Metadata corrections bind the unchanged original mirror head' USING ERRCODE = '23514'; END IF;
        ELSIF entry.uuid IS NULL OR entry.kind <> 'mirror_correction' OR entry.sequence <> candidate.base_sequence + 1
            OR entry.previous_hash <> candidate.base_hash OR entry.sequence <> head.sequence OR entry.recorded_by_id <> principal THEN
            RAISE EXCEPTION 'A mirror correction must apply exactly once to its reviewed previous head' USING ERRCODE = '23514'; END IF;
    ELSE
        SELECT * INTO entry FROM tokens_registerentry WHERE register_id = head.uuid AND kind = 'opening';
        IF entry.uuid IS NULL OR (entry.operation_id = candidate.uuid AND (NOT tokens_mirror_opening_clear(candidate.token_id)
            OR head.sequence <> 1 OR entry.effective_on <> candidate.as_at
            OR entry.recorded_by_id <> principal)) THEN RAISE EXCEPTION 'A mirror opening requires its exact opening entry' USING ERRCODE = '23514'; END IF;
    END IF;
    RETURN candidate;
END;
$function$;

CREATE OR REPLACE FUNCTION public.tokens_guard_mirror_entry()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registerimport; head tokens_shareregister; principal bigint;
BEGIN
    SELECT * INTO proposal FROM tokens_registerimport WHERE uuid = NEW.operation_id;
    IF NEW.kind <> 'mirror_correction' AND (proposal.uuid IS NULL OR proposal.source_reference = '') THEN RETURN NEW; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO head FROM tokens_shareregister WHERE uuid = NEW.register_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR proposal.source_reference = '' OR proposal.status <> 'submitted' OR proposal.company_id <> head.company_id OR proposal.token_id <> head.token_id
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_import_apply'
        OR current_setting('app.company_id', true) IS DISTINCT FROM head.company_id::text
        OR NEW.recorded_by_id IS DISTINCT FROM principal OR NEW.corrects_id IS NOT NULL OR NEW.effective_on <> proposal.as_at
        OR NEW.changes IS DISTINCT FROM tokens_mirror_changes(proposal.uuid)
        OR NOT tokens_mirror_award_identities_valid(proposal.company_id, proposal.uuid, proposal.members)
        OR (NEW.kind = 'opening' AND NOT tokens_empty_mirror_opening_ready(proposal))
        OR NOT tokens_register_import_approved(proposal.uuid, clock_timestamp())
        OR NOT EXISTS (SELECT 1 FROM tokens_registerimportdecision decision WHERE decision.register_import_id = proposal.uuid
            AND decision.kind = 'apply' AND decision.decided_by_id = principal
            AND tokens_register_appointment_current(decision.appointment_id, head.company_id, principal, 'apply', clock_timestamp()))
        OR (proposal.correction_of_id IS NULL AND (NEW.kind <> 'opening' OR head.sequence <> 0 OR NOT tokens_mirror_opening_clear(proposal.token_id)))
        OR (proposal.correction_of_id IS NOT NULL AND (NEW.kind <> 'mirror_correction' OR NOT tokens_mirror_correction_ready(proposal))) THEN
        RAISE EXCEPTION 'A mirrored ownership delta needs its exact current company confirmation' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS tokens_mirror_entry_guard ON tokens_registerentry;
CREATE TRIGGER tokens_mirror_entry_guard BEFORE INSERT ON tokens_registerentry FOR EACH ROW EXECUTE FUNCTION tokens_guard_mirror_entry();

CREATE OR REPLACE FUNCTION public.tokens_check_mirror_award_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE proposal tokens_registerimport;
BEGIN
    SELECT * INTO proposal FROM tokens_registerimport WHERE uuid = NEW.uuid;
    IF proposal.source_reference <> '' AND proposal.status <> 'rejected'
        AND NOT tokens_mirror_award_identities_valid(proposal.company_id, proposal.uuid, proposal.members) THEN
        RAISE EXCEPTION 'Copied first holdings retain their exact award recipient identity at commit' USING ERRCODE = '23514'; END IF;
    RETURN NULL;
END;
$function$;
DROP TRIGGER IF EXISTS tokens_mirror_award_identity ON tokens_registerimport;
CREATE CONSTRAINT TRIGGER tokens_mirror_award_identity AFTER INSERT OR UPDATE ON tokens_registerimport
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_mirror_award_identity();
