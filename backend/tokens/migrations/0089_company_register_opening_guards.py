from importlib import import_module

from django.conf import settings
from django.db import migrations

OPENING_IMPORT = import_module("tokens.migrations.0077_import_opening")
IMPORT_GUARDS = import_module("tokens.migrations.0084_company_register_import_guards")

OPENING_GUARD_AS_0065_INSTALLED_IT = """
CREATE OR REPLACE FUNCTION tokens_guard_register_opening() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    share_class tokens_sharetoken;
    head tokens_shareregister;
    applied tokens_registerentry;
    owner bigint;
    expected_changes jsonb;
    mapping_count bigint;
    holdings_count bigint;
    pair_count bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'Retain opening proposals and their authority evidence' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        SELECT owner_id INTO owner FROM companies_company WHERE uuid = NEW.company_id FOR KEY SHARE;
        SELECT * INTO share_class FROM tokens_sharetoken WHERE uuid = NEW.token_id;
        SELECT count(*) INTO mapping_count FROM jsonb_array_elements(NEW.mapping);
        IF NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.applied_entry_id IS NOT NULL OR NEW.rejection_reason <> '' OR NEW.boundary IS NOT NULL
            OR owner IS DISTINCT FROM NEW.submitted_by_id
            OR share_class.uuid IS NULL OR share_class.company_id IS DISTINCT FROM NEW.company_id
            OR share_class.status NOT IN ('deployed', 'paused')
            OR EXISTS (SELECT 1 FROM tokens_shareregister r WHERE r.token_id = NEW.token_id
                AND EXISTS (SELECT 1 FROM tokens_registerentry e WHERE e.register_id = r.uuid))
            OR NEW.authority NOT IN ('director_resolution', 'court_order')
            OR (NEW.authority = 'director_resolution') <> (length(btrim(NEW.approving_director)) > 0)
            OR length(btrim(NEW.authority_reference)) = 0 OR length(btrim(NEW.reason)) = 0
            OR NEW.evidence_fingerprint !~ '^[0-9a-f]{64}$'
            OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-openings/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
            OR NOT EXISTS (SELECT 1 FROM companies_companydocument doc WHERE doc.uuid = NEW.source_document
                AND doc.company_id = NEW.company_id AND doc.is_verified AND doc.verified_by_id IS NOT NULL
                AND doc.verified_fingerprint = NEW.evidence_fingerprint)
            OR NEW.evidence_snapshot->>'document' IS DISTINCT FROM NEW.source_document::text
            OR NEW.evidence_snapshot->>'company' IS DISTINCT FROM NEW.company_id::text
            OR COALESCE(NEW.evidence_snapshot->>'sha256', '') !~ '^[0-9a-f]{64}$'
            OR jsonb_typeof(NEW.mapping) <> 'array'
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                WHERE jsonb_typeof(item) <> 'object'
                OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 2
                OR NOT (item ? 'address' AND item ? 'member')
                OR item->>'address' !~ '^0x[0-9a-fA-F]{40}$'
                OR item->>'member' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
            OR mapping_count <>
               (SELECT count(DISTINCT lower(item->>'address')) FROM jsonb_array_elements(NEW.mapping) item)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                JOIN tokens_registermember m ON m.uuid::text = item->>'member'
                WHERE m.company_id IS DISTINCT FROM NEW.company_id)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                JOIN tokens_registermemberwallet w ON w.company_id = NEW.company_id
                    AND lower(w.address) = lower(item->>'address')
                WHERE w.member_id::text IS DISTINCT FROM item->>'member')
        THEN
            RAISE EXCEPTION 'Opening submissions require exact current intent and verified company evidence'
                USING ERRCODE = '23514';
        END IF;
    ELSIF OLD.boundary IS NULL AND NEW.boundary IS NOT NULL THEN
        IF jsonb_typeof(NEW.boundary) IS DISTINCT FROM 'object'
            OR EXISTS (SELECT 1 FROM (VALUES
                (ARRAY['version'], 'number'),
                (ARRAY['token'], 'string'),
                (ARRAY['company'], 'string'),
                (ARRAY['deployment'], 'string'),
                (ARRAY['chain_id'], 'number'),
                (ARRAY['contract_address'], 'string'),
                (ARRAY['deployment_transaction'], 'string'),
                (ARRAY['deployment_block'], 'number'),
                (ARRAY['deployment_hash'], 'string'),
                (ARRAY['block'], 'object'),
                (ARRAY['block', 'number'], 'number'),
                (ARRAY['block', 'hash'], 'string'),
                (ARRAY['block', 'timestamp'], 'number'),
                (ARRAY['block', 'date'], 'string'),
                (ARRAY['policy'], 'object'),
                (ARRAY['policy', 'version'], 'number'),
                (ARRAY['policy', 'mode'], 'string'),
                (ARRAY['authorized_supply'], 'string'),
                (ARRAY['issued_supply'], 'string'),
                (ARRAY['holdings'], 'array')
            ) AS required(path, kind)
                WHERE jsonb_typeof(NEW.boundary #> required.path) IS DISTINCT FROM required.kind)
        THEN
            RAISE EXCEPTION 'The captured boundary requires complete typed snapshot provenance'
                USING ERRCODE = '23514';
        END IF;
        SELECT count(*) INTO mapping_count FROM jsonb_array_elements(NEW.mapping);
        SELECT count(*) INTO holdings_count FROM jsonb_array_elements(NEW.boundary->'holdings');
        SELECT count(*) INTO pair_count FROM jsonb_array_elements(NEW.mapping) m(item)
            JOIN jsonb_array_elements(NEW.boundary->'holdings') h(item)
            ON lower(h.item->>'address') = lower(m.item->>'address');
        IF current_user = %s OR OLD.status <> 'submitted' OR NEW.status <> 'submitted'
            OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.applied_entry_id IS NOT NULL OR NEW.rejection_reason <> ''
            OR (to_jsonb(NEW) - ARRAY['boundary', 'updated_at'])
                IS DISTINCT FROM
                (to_jsonb(OLD) - ARRAY['boundary', 'updated_at'])
            OR COALESCE(NEW.boundary->>'version', '') <> '1'
            OR NEW.boundary->>'token' IS DISTINCT FROM NEW.token_id::text
            OR NEW.boundary->>'company' IS DISTINCT FROM NEW.company_id::text
            OR NEW.boundary->>'deployment' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            OR NEW.boundary->>'contract_address' !~ '^0x[0-9a-fA-F]{40}$'
            OR NEW.boundary->>'deployment_transaction' !~ '^0x[0-9a-f]{64}$'
            OR NEW.boundary->>'deployment_hash' !~ '^0x[0-9a-f]{64}$'
            OR NEW.boundary->>'deployment_block' !~ '^[0-9]+$'
            OR COALESCE(NEW.boundary->>'chain_id', '') !~ '^[0-9]+$'
            OR COALESCE(NEW.boundary->'block'->>'number', '') !~ '^[0-9]+$'
            OR COALESCE(NEW.boundary->'block'->>'hash', '') !~ '^0x[0-9a-f]{64}$'
            OR COALESCE(NEW.boundary->'block'->>'timestamp', '') !~ '^[0-9]+$'
            OR COALESCE(NEW.boundary->'block'->>'date', '') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
            OR NEW.boundary->'policy'->>'version' <> '1'
            OR COALESCE(NEW.boundary->'policy'->>'mode', '') NOT IN ('finalized', 'depth')
            OR (NEW.boundary->'policy'->>'mode' = 'depth') <> (NEW.boundary->'policy' ? 'depth')
            OR (NEW.boundary->'policy'->>'mode' = 'depth' AND (
                jsonb_typeof(NEW.boundary->'policy'->'depth') IS DISTINCT FROM 'number'
                OR COALESCE(NEW.boundary->'policy'->>'depth', '') !~ '^[1-9][0-9]*$'))
            OR COALESCE(NEW.boundary->>'authorized_supply', '') !~ '^[0-9]+$'
            OR COALESCE(NEW.boundary->>'issued_supply', 'x') !~ '^[0-9]+$'
            OR (CASE WHEN COALESCE(NEW.boundary->>'issued_supply', '') ~ '^[0-9]+$'
                     AND COALESCE(NEW.boundary->>'authorized_supply', '') ~ '^[0-9]+$'
                THEN (NEW.boundary->>'issued_supply')::numeric > (NEW.boundary->>'authorized_supply')::numeric
                ELSE FALSE END)
            OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.boundary->'holdings') item
                WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
                OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 2
                OR jsonb_typeof(item->'address') IS DISTINCT FROM 'string'
                OR jsonb_typeof(item->'shares') IS DISTINCT FROM 'string'
                OR COALESCE(item->>'address', '') !~ '^0x[0-9a-fA-F]{40}$'
                OR COALESCE(item->>'shares', '') !~ '^[1-9][0-9]*$')
            OR (CASE WHEN COALESCE(NEW.boundary->>'issued_supply', '') ~ '^[0-9]+$'
                THEN (SELECT COALESCE(sum((item->>'shares')::numeric), 0)
                    FROM jsonb_array_elements(NEW.boundary->'holdings') item)
                    IS DISTINCT FROM (NEW.boundary->>'issued_supply')::numeric
                ELSE FALSE END)
            OR holdings_count <>
               (SELECT count(DISTINCT lower(item->>'address')) FROM jsonb_array_elements(NEW.boundary->'holdings') item)
            OR pair_count <> mapping_count OR pair_count <> holdings_count
        THEN
            RAISE EXCEPTION 'The captured boundary must bind this share class and its mapped holders exactly'
                USING ERRCODE = '23514';
        END IF;
        IF (NEW.boundary->>'chain_id')::numeric > 9223372036854775807
            OR (NEW.boundary->>'deployment_block')::numeric > (NEW.boundary->'block'->>'number')::numeric
            OR (NEW.boundary->'block'->>'number')::numeric > 9223372036854775807
            OR (NEW.boundary->'block'->>'timestamp')::numeric > 9223372036854775807
            OR (NEW.boundary->'policy'->>'depth')::numeric > 9223372036854775807
            OR (NEW.boundary->>'authorized_supply')::numeric >
                115792089237316195423570985008687907853269984665640564039457584007913129639935
            OR (NEW.boundary->'block'->>'date')::date IS DISTINCT FROM
                (to_timestamp((NEW.boundary->'block'->>'timestamp')::double precision) AT TIME ZONE 'UTC')::date
        THEN
            RAISE EXCEPTION 'The captured boundary must preserve valid chain quantities and its UTC date'
                USING ERRCODE = '23514';
        END IF;
    ELSE
        IF current_user = %s OR OLD.status <> 'submitted'
            OR NEW.status NOT IN ('applied', 'rejected')
            OR NEW.boundary IS DISTINCT FROM OLD.boundary
            OR (to_jsonb(NEW) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason',
                'applied_entry_id', 'updated_at'])
                IS DISTINCT FROM
                (to_jsonb(OLD) - ARRAY['status', 'reviewed_by_id', 'reviewed_at', 'rejection_reason',
                'applied_entry_id', 'updated_at'])
            OR NEW.reviewed_at IS NULL OR NOT EXISTS (
                SELECT 1 FROM authentication_customuser WHERE id = NEW.reviewed_by_id AND is_active AND is_staff
            ) THEN
            RAISE EXCEPTION 'Only operator review may decide an immutable opening submission' USING ERRCODE = '23514';
        END IF;
        IF NEW.status = 'applied' THEN
            SELECT * INTO head FROM tokens_shareregister WHERE token_id = NEW.token_id;
            SELECT * INTO applied FROM tokens_registerentry WHERE uuid = NEW.applied_entry_id;
            SELECT COALESCE(
                       jsonb_agg(jsonb_build_object('member', agg.member, 'shares', agg.total::text) ORDER BY agg.member),
                       '[]'::jsonb)
                INTO expected_changes
                FROM (SELECT m.item->>'member' AS member, sum((h.item->>'shares')::numeric) AS total
                    FROM jsonb_array_elements(NEW.mapping) m(item)
                    JOIN jsonb_array_elements(NEW.boundary->'holdings') h(item)
                    ON lower(h.item->>'address') = lower(m.item->>'address')
                    GROUP BY m.item->>'member') agg;
            IF NEW.boundary IS NULL OR head.uuid IS NULL OR applied.uuid IS NULL
                OR applied.register_id <> head.uuid OR head.company_id IS DISTINCT FROM NEW.company_id
                OR head.sequence <> 1 OR applied.sequence <> 1
                OR applied.kind <> 'opening' OR applied.operation_id <> NEW.uuid
                OR applied.corrects_id IS NOT NULL
                OR applied.changes IS DISTINCT FROM expected_changes
                OR applied.effective_on <> (NEW.boundary->'block'->>'date')::date
                OR applied.recorded_by_id <> NEW.reviewed_by_id
                OR applied.previous_hash <> repeat('0', 64)
                OR NEW.rejection_reason <> ''
                OR EXISTS (SELECT 1 FROM tokens_registerentry e WHERE e.register_id = head.uuid
                    AND e.uuid <> applied.uuid)
                OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                    WHERE NOT EXISTS (SELECT 1 FROM tokens_registermemberwallet w
                        WHERE w.company_id = NEW.company_id AND lower(w.address) = lower(item->>'address')
                        AND w.member_id::text = item->>'member'))
                OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.mapping) item
                    WHERE NOT EXISTS (SELECT 1 FROM tokens_registermember m2
                        WHERE m2.uuid::text = item->>'member' AND m2.company_id = NEW.company_id))
            THEN
                RAISE EXCEPTION 'Approval must initialise the register from its captured boundary'
                    USING ERRCODE = '23514';
            END IF;
        ELSIF NEW.applied_entry_id IS NOT NULL OR length(btrim(NEW.rejection_reason)) = 0 THEN
            RAISE EXCEPTION 'Rejection requires a reason and no applied entry' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
"""

HISTORY_GUARD_AS_0066_INSTALLED_IT = """
CREATE OR REPLACE FUNCTION tokens_guard_register_opening_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    history jsonb;
    entries bigint;
BEGIN
    IF TG_OP <> 'UPDATE' OR NEW.boundary IS NULL
        OR (OLD.boundary IS NOT NULL AND (OLD.status <> 'submitted' OR NEW.status <> 'applied')) THEN
        RETURN NEW;
    END IF;
    history := NEW.boundary->'history';
    IF jsonb_typeof(history) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'The captured boundary requires its canonical transfer history' USING ERRCODE = '23514';
    END IF;
    SELECT count(*) INTO entries FROM jsonb_array_elements(history);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(history) item
            WHERE jsonb_typeof(item) IS DISTINCT FROM 'object'
            OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 3
            OR jsonb_typeof(item->'block') IS DISTINCT FROM 'number'
            OR item->>'block' !~ '^(0|[1-9][0-9]*)$'
            OR jsonb_typeof(item->'block_hash') IS DISTINCT FROM 'string'
            OR item->>'block_hash' !~ '^0x[0-9a-f]{64}$'
            OR jsonb_typeof(item->'transaction') IS DISTINCT FROM 'string'
            OR item->>'transaction' !~ '^0x[0-9a-f]{64}$'
            OR (item->>'block')::numeric < (NEW.boundary->>'deployment_block')::numeric
            OR (item->>'block')::numeric > (NEW.boundary->'block'->>'number')::numeric
            OR ((item->>'block')::numeric = (NEW.boundary->>'deployment_block')::numeric
                AND item->>'block_hash' IS DISTINCT FROM NEW.boundary->>'deployment_hash')
            OR ((item->>'block')::numeric = (NEW.boundary->'block'->>'number')::numeric
                AND item->>'block_hash' IS DISTINCT FROM NEW.boundary->'block'->>'hash'))
        OR entries <> (SELECT count(DISTINCT (item->>'block') || ':' || (item->>'transaction'))
            FROM jsonb_array_elements(history) item)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(history) item
            GROUP BY item->>'block' HAVING count(DISTINCT item->>'block_hash') > 1)
    THEN
        RAISE EXCEPTION 'The captured boundary history requires exact canonical blocks and transactions'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
"""

FUNCTIONS = """
CREATE FUNCTION tokens_register_opening_approved(opening_uuid uuid, at_time timestamptz) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT EXISTS (SELECT 1 FROM tokens_registeropeningdecision decision
        JOIN tokens_registeropening proposal ON proposal.uuid = decision.register_opening_id
        WHERE decision.register_opening_id = opening_uuid AND decision.kind = 'approve'
            AND tokens_register_appointment_current(decision.appointment_id, proposal.company_id,
                decision.decided_by_id, 'approve', at_time));
$$;
CREATE FUNCTION tokens_register_opening_decision_digest(opening_uuid uuid, decision_kind text, actor bigint,
    appointment_uuid uuid, decision_reason text) RETURNS text
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT encode(sha256(convert_to(jsonb_build_object('version', '1', 'opening', opening_uuid::text,
        'kind', decision_kind, 'actor', actor, 'appointment', appointment_uuid::text, 'reason', decision_reason,
        'boundary', (SELECT proposal.boundary->'block'->>'hash' FROM tokens_registeropening proposal
            WHERE proposal.uuid = opening_uuid),
        'register', CASE WHEN decision_kind = 'apply' THEN (SELECT jsonb_build_object('sequence', register.sequence,
            'head', register.head_hash) FROM tokens_shareregister register
            JOIN tokens_registeropening proposal ON proposal.token_id = register.token_id
            WHERE proposal.uuid = opening_uuid) END)::text, 'UTF8')), 'hex');
$$;
CREATE FUNCTION tokens_guard_register_opening_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    principal bigint;
    at_time timestamptz;
    proposal tokens_registeropening;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Register opening decisions are append-only' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    SELECT * INTO proposal FROM tokens_registeropening WHERE uuid = NEW.register_opening_id;
    PERFORM 1 FROM companies_company WHERE uuid = proposal.company_id FOR UPDATE;
    SELECT * INTO proposal FROM tokens_registeropening WHERE uuid = NEW.register_opening_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR proposal.uuid IS NULL
        OR NEW.decided_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_opening_' || NEW.kind
        OR current_setting('app.company_id', true) IS DISTINCT FROM proposal.company_id::text
        OR proposal.status <> 'submitted' OR NEW.kind NOT IN ('approve', 'apply', 'reject')
        OR (NEW.kind = 'reject') <> (length(btrim(NEW.reason)) > 0)
        OR (NEW.kind <> 'reject' AND proposal.preparing_appointment_id IS NULL)
        OR NEW.digest IS DISTINCT FROM tokens_register_opening_decision_digest(proposal.uuid, NEW.kind, principal,
            NEW.appointment_id, NEW.reason)
        OR NOT tokens_register_appointment_current(NEW.appointment_id, proposal.company_id, principal,
            CASE NEW.kind WHEN 'apply' THEN 'apply' ELSE 'approve' END, at_time)
        OR (NEW.kind = 'approve' AND tokens_register_opening_approved(proposal.uuid, at_time))
        OR (NEW.kind = 'apply' AND NOT tokens_register_opening_approved(proposal.uuid, at_time))
    THEN
        RAISE EXCEPTION 'Register opening decisions need the exact current company authority'
            USING ERRCODE = '23514';
    END IF;
    NEW.decided_at := at_time;
    NEW.created_at := at_time;
    NEW.updated_at := at_time;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_register_opening_decision_guard
    BEFORE INSERT OR UPDATE OR DELETE ON tokens_registeropeningdecision
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_register_opening_decision();
CREATE FUNCTION tokens_check_register_opening_decision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    proposal tokens_registeropening;
BEGIN
    SELECT * INTO proposal FROM tokens_registeropening WHERE uuid = NEW.register_opening_id;
    IF (NEW.kind = 'approve' AND proposal.status <> 'submitted')
        OR (NEW.kind <> 'approve' AND (proposal.status <> CASE NEW.kind WHEN 'apply' THEN 'applied' ELSE 'rejected' END
            OR proposal.reviewed_by_id IS DISTINCT FROM NEW.decided_by_id
            OR proposal.reviewed_at IS DISTINCT FROM NEW.decided_at
            OR (NEW.kind = 'reject' AND proposal.rejection_reason IS DISTINCT FROM NEW.reason)))
    THEN
        RAISE EXCEPTION 'A register opening decision must carry exactly its own effect' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_register_opening_decision_effect
    AFTER INSERT ON tokens_registeropeningdecision DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION tokens_check_register_opening_decision();
"""

REMOVE_FUNCTIONS = """
DROP TRIGGER tokens_register_opening_decision_effect ON tokens_registeropeningdecision;
DROP FUNCTION tokens_check_register_opening_decision();
DROP TRIGGER tokens_register_opening_decision_guard ON tokens_registeropeningdecision;
DROP FUNCTION tokens_guard_register_opening_decision();
DROP FUNCTION tokens_register_opening_decision_digest(uuid, text, bigint, uuid, text);
DROP FUNCTION tokens_register_opening_approved(uuid, timestamptz);
"""

COMPANY_RUN = (
    (
        """    owner bigint;
""",
        """    principal bigint;
    at_time timestamptz;
    authority_copy tokens_registerevidence;
""",
    ),
    (
        """    IF TG_OP = 'INSERT' THEN
        SELECT owner_id INTO owner FROM companies_company WHERE uuid = NEW.company_id FOR KEY SHARE;
""",
        """    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    IF TG_OP = 'INSERT' THEN
        PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
        SELECT * INTO authority_copy FROM tokens_registerevidence WHERE uuid = NEW.authority_evidence_id;
""",
    ),
    (
        """        IF NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.applied_entry_id IS NOT NULL OR NEW.rejection_reason <> '' OR NEW.boundary IS NOT NULL
            OR owner IS DISTINCT FROM NEW.submitted_by_id
""",
        """        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
            OR NEW.submitted_by_id IS DISTINCT FROM principal
            OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_opening_prepare'
            OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
            OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal,
                'prepare', at_time)
            OR NEW.status <> 'submitted' OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.applied_entry_id IS NOT NULL OR NEW.rejection_reason <> '' OR NEW.boundary IS NULL
""",
    ),
    (
        """            OR NEW.evidence_fingerprint !~ '^[0-9a-f]{64}$'
""",
        "",
    ),
    (
        """            OR NOT EXISTS (SELECT 1 FROM companies_companydocument doc WHERE doc.uuid = NEW.source_document
                AND doc.company_id = NEW.company_id AND doc.is_verified AND doc.verified_by_id IS NOT NULL
                AND doc.verified_fingerprint = NEW.evidence_fingerprint)
            OR NEW.evidence_snapshot->>'document' IS DISTINCT FROM NEW.source_document::text
            OR NEW.evidence_snapshot->>'company' IS DISTINCT FROM NEW.company_id::text
            OR COALESCE(NEW.evidence_snapshot->>'sha256', '') !~ '^[0-9a-f]{64}$'
""",
        """            OR authority_copy.uuid IS NULL OR authority_copy.company_id <> NEW.company_id
            OR authority_copy.kind <> 'authority' OR authority_copy.uploaded_by_id <> principal
            OR NEW.evidence_fingerprint IS DISTINCT FROM authority_copy.sha256
            OR NEW.evidence_snapshot IS DISTINCT FROM tokens_register_evidence_snapshot(authority_copy)
""",
    ),
    (
        """        THEN
            RAISE EXCEPTION 'Opening submissions require exact current intent and verified company evidence'
                USING ERRCODE = '23514';
        END IF;
    ELSIF OLD.boundary IS NULL AND NEW.boundary IS NOT NULL THEN
""",
        """        THEN
            RAISE EXCEPTION 'Opening preparations require exact current intent, company authority and evidence'
                USING ERRCODE = '23514';
        END IF;
    END IF;
    IF TG_OP = 'INSERT' THEN
""",
    ),
    (
        """        IF current_user = %s OR OLD.status <> 'submitted' OR NEW.status <> 'submitted'
            OR NEW.reviewed_by_id IS NOT NULL OR NEW.reviewed_at IS NOT NULL
            OR NEW.applied_entry_id IS NOT NULL OR NEW.rejection_reason <> ''
            OR (to_jsonb(NEW) - ARRAY['boundary', 'updated_at'])
                IS DISTINCT FROM
                (to_jsonb(OLD) - ARRAY['boundary', 'updated_at'])
            OR COALESCE(NEW.boundary->>'version', '') <> '1'
""",
        """        IF COALESCE(NEW.boundary->>'version', '') <> '1'
""",
    ),
    (
        """        IF current_user = %s OR OLD.status <> 'submitted'
            OR NEW.status NOT IN ('applied', 'rejected')
""",
        """        IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR OLD.status <> 'submitted'
            OR NEW.status NOT IN ('applied', 'rejected')
""",
    ),
    (
        """            OR NEW.reviewed_at IS NULL OR NOT EXISTS (
                SELECT 1 FROM authentication_customuser WHERE id = NEW.reviewed_by_id AND is_active AND is_staff
            ) THEN
            RAISE EXCEPTION 'Only operator review may decide an immutable opening submission' USING ERRCODE = '23514';
""",
        """            OR NEW.reviewed_at IS NULL OR NEW.reviewed_by_id IS DISTINCT FROM principal
            OR NOT EXISTS (SELECT 1 FROM tokens_registeropeningdecision decision
                WHERE decision.register_opening_id = NEW.uuid AND decision.decided_by_id = NEW.reviewed_by_id
                    AND decision.decided_at = NEW.reviewed_at
                    AND decision.kind = CASE NEW.status WHEN 'applied' THEN 'apply' ELSE 'reject' END
                    AND (NEW.status = 'applied' OR decision.reason = NEW.rejection_reason))
        THEN
            RAISE EXCEPTION 'Only the exact company decision may decide an immutable opening'
                USING ERRCODE = '23514';
""",
    ),
    (
        """                RAISE EXCEPTION 'Approval must initialise the register from its captured boundary'
""",
        """                RAISE EXCEPTION 'Application must initialise the register from its captured boundary'
""",
    ),
)
HISTORY_AT_PREPARATION = (
    (
        """    IF TG_OP <> 'UPDATE' OR NEW.boundary IS NULL
""",
        """    IF NEW.boundary IS NULL
""",
    ),
)
OPENING_GUARD = OPENING_IMPORT._replaced(OPENING_GUARD_AS_0065_INSTALLED_IT, COMPANY_RUN)
HISTORY_GUARD = OPENING_IMPORT._replaced(HISTORY_GUARD_AS_0066_INSTALLED_IT, HISTORY_AT_PREPARATION)
REFUSE_REVERSAL = """
DO $$ BEGIN
    LOCK TABLE tokens_registeropening, tokens_registeropeningdecision IN ACCESS EXCLUSIVE MODE;
    IF EXISTS (SELECT 1 FROM tokens_registeropeningdecision)
        OR EXISTS (SELECT 1 FROM tokens_registeropening WHERE preparing_appointment_id IS NOT NULL)
    THEN
        RAISE EXCEPTION 'Retain company register openings, their decisions and authority evidence';
    END IF;
END $$;
"""


def install_company_openings(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(IMPORT_GUARDS._with_roles(cursor, FUNCTIONS))
        cursor.execute(IMPORT_GUARDS._with_roles(cursor, OPENING_GUARD))
        cursor.execute(HISTORY_GUARD)
        cursor.execute("ALTER FUNCTION tokens_guard_register_opening() SET search_path = pg_catalog, public, pg_temp")
        cursor.execute(
            "ALTER FUNCTION tokens_guard_register_opening_history() SET search_path = pg_catalog, public, pg_temp"
        )


def remove_company_openings(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(REFUSE_REVERSAL)
        cursor.execute(OPENING_GUARD_AS_0065_INSTALLED_IT, [settings.RLS_ROLES["app"], settings.RLS_ROLES["app"]])
        cursor.execute(HISTORY_GUARD_AS_0066_INSTALLED_IT)
        cursor.execute(REMOVE_FUNCTIONS)


class Migration(migrations.Migration):

    dependencies = [
        ("tokens", "0088_company_register_openings"),
    ]

    operations = [
        migrations.RunPython(install_company_openings, remove_company_openings),
    ]
