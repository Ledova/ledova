CREATE OR REPLACE FUNCTION tokens_class_history_empty(token_uuid uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE register public.tokens_shareregister;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM public.tokens_sharetoken WHERE uuid = token_uuid) THEN RETURN false; END IF;
    SELECT * INTO register FROM public.tokens_shareregister WHERE token_id = token_uuid;
    IF NOT FOUND THEN
        RETURN NOT EXISTS (SELECT 1 FROM public.tokens_registerimport WHERE token_id = token_uuid AND status = 'applied');
    END IF;
    IF register.company_id IS DISTINCT FROM (SELECT company_id FROM public.tokens_sharetoken WHERE uuid = token_uuid)
        OR register.issued_supply <> 0
        OR EXISTS (SELECT 1 FROM public.tokens_registerposition WHERE register_id = register.uuid) THEN RETURN false; END IF;
    IF register.sequence = 0 THEN
        RETURN register.head_hash = repeat('0', 64)
            AND NOT EXISTS (SELECT 1 FROM public.tokens_registerentry WHERE register_id = register.uuid)
            AND NOT EXISTS (SELECT 1 FROM public.tokens_registerimport WHERE token_id = token_uuid AND status = 'applied');
    END IF;
    RETURN register.sequence = 1
        AND (SELECT count(*) FROM public.tokens_registerentry WHERE register_id = register.uuid) = 1
        AND (SELECT count(*) FROM public.tokens_registerimport WHERE token_id = token_uuid AND status = 'applied') = 1
        AND EXISTS (SELECT 1 FROM public.tokens_registerentry entry JOIN public.tokens_registerimport proposal
            ON proposal.uuid = entry.operation_id AND proposal.token_id = token_uuid
                AND proposal.company_id = register.company_id AND proposal.status = 'applied'
            WHERE entry.register_id = register.uuid AND entry.sequence = 1 AND entry.kind = 'opening'
                AND entry.changes = '[]'::jsonb AND entry.corrects_id IS NULL
                AND entry.previous_hash = repeat('0', 64) AND entry.entry_hash = register.head_hash
                AND entry.entry_hash = tokens_register_entry_hash(entry)
                AND proposal.register_sequence = 1 AND proposal.members = '[]'::jsonb
                AND proposal.former_members = '[]'::jsonb AND proposal.correction_of_id IS NULL
                AND proposal.base_sequence IS NULL AND proposal.base_hash = '');
END;
$$;

CREATE OR REPLACE FUNCTION tokens_class_deletion_reason(token_uuid uuid)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE share_class public.tokens_sharetoken;
BEGIN
    SELECT * INTO share_class FROM public.tokens_sharetoken WHERE uuid = token_uuid;
    IF NOT FOUND THEN RETURN 'This share class is no longer available.'; END IF;
    IF share_class.status <> 'draft' OR NULLIF(share_class.contract_address, '') IS NOT NULL
        OR NULLIF(share_class.chain, '') IS NOT NULL OR share_class.deployment_id IS NOT NULL
        OR share_class.deployment_transaction_id IS NOT NULL OR NULLIF(share_class.deployment_tx_hash, '') IS NOT NULL
        OR share_class.deployed_at IS NOT NULL THEN
        RETURN 'This class has on-chain records, which Ledova keeps, so it can''t be deleted here.';
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION tokens_class_details_available(token_uuid uuid, editing boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE share_class public.tokens_sharetoken; reference record; referenced boolean; predicate text;
BEGIN
    IF NOT editing THEN RETURN tokens_class_deletion_reason(token_uuid) IS NULL; END IF;
    SELECT * INTO share_class FROM public.tokens_sharetoken WHERE uuid = token_uuid;
    IF NOT FOUND OR share_class.status <> 'draft'
        OR NULLIF(share_class.contract_address, '') IS NOT NULL OR NULLIF(share_class.chain, '') IS NOT NULL
        OR share_class.deployment_id IS NOT NULL OR share_class.deployment_transaction_id IS NOT NULL
        OR NULLIF(share_class.deployment_tx_hash, '') IS NOT NULL OR share_class.deployed_at IS NOT NULL THEN
        RETURN false;
    END IF;
    IF NOT tokens_class_history_empty(token_uuid) THEN RETURN false; END IF;
    FOR reference IN
        SELECT constraint_record.conrelid::regclass AS relation, attribute.attname AS column_name,
            cardinality(constraint_record.conkey) AS key_count
        FROM pg_constraint constraint_record
        JOIN pg_attribute attribute ON attribute.attrelid = constraint_record.conrelid
            AND attribute.attnum = constraint_record.conkey[1]
        WHERE constraint_record.contype = 'f' AND constraint_record.confrelid = 'public.tokens_sharetoken'::regclass
    LOOP
        IF reference.key_count <> 1 THEN RETURN false; END IF;
        IF reference.relation IN (to_regclass('public.tokens_classdetailsrevision'),
            'public.tokens_classrightsrevision'::regclass) THEN CONTINUE; END IF;
        predicate := '';
        IF reference.relation = 'public.tokens_registerimport'::regclass THEN
            predicate := ' AND status NOT IN (''rejected'', ''applied'')';
        ELSIF reference.relation = 'public.tokens_shareregister'::regclass THEN
            CONTINUE;
        END IF;
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s source WHERE %I = $1%s)',
            reference.relation, reference.column_name, predicate) INTO referenced USING token_uuid;
        IF referenced THEN RETURN false; END IF;
    END LOOP;
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION tokens_guard_class_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF companies_disposal_allows(TG_TABLE_NAME, OLD.uuid) THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'Delete a share class through its delete command' USING ERRCODE = '23514';
    END IF;
    IF (NEW.name, NEW.symbol, NEW.token_type) IS NOT DISTINCT FROM (OLD.name, OLD.symbol, OLD.token_type) THEN
        RETURN NEW;
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_class_edit'
        OR current_setting('app.company_id', true) IS DISTINCT FROM OLD.company_id::text THEN
        RAISE EXCEPTION 'Use the exact actor-bound class change command' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.companies_company WHERE uuid = OLD.company_id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.companies_companyappointment appointment
            WHERE tokens_register_appointment_current(appointment.uuid, OLD.company_id, principal, 'prepare', clock_timestamp())) THEN
        RAISE EXCEPTION 'Class changes require current company preparation authority' USING ERRCODE = '23514';
    END IF;
    IF NOT tokens_class_details_available(OLD.uuid, true)
        OR (to_jsonb(NEW) - ARRAY['name', 'symbol', 'token_type', 'updated_at']) IS DISTINCT FROM
            (to_jsonb(OLD) - ARRAY['name', 'symbol', 'token_type', 'updated_at'])
        OR length(btrim(NEW.name)) = 0 OR length(NEW.name) > 100 OR NEW.symbol !~ '^[A-Z]{1,5}$'
        OR NEW.token_type NOT IN ('ordinary', 'preference', 'redeemable') THEN
        RAISE EXCEPTION 'Only valid unused class details may change' USING ERRCODE = '23514';
    END IF;
    NEW.updated_at := clock_timestamp();
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION tokens_check_class_lifecycle_authority()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF companies_disposal_allows(TG_TABLE_NAME, OLD.uuid) THEN RETURN NULL; END IF;
        RAISE EXCEPTION 'Delete a share class through its delete command' USING ERRCODE = '23514';
    END IF;
    IF (NEW.name, NEW.symbol, NEW.token_type) IS NOT DISTINCT FROM (OLD.name, OLD.symbol, OLD.token_type) THEN
        RETURN NULL;
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF NOT EXISTS (SELECT 1 FROM public.companies_companyappointment appointment
        WHERE tokens_register_appointment_current(appointment.uuid, OLD.company_id, principal, 'prepare', clock_timestamp())) THEN
        RAISE EXCEPTION 'Share class changes require current company preparation authority at commit'
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS tokens_class_lifecycle ON public.tokens_sharetoken;
CREATE TRIGGER tokens_class_lifecycle BEFORE UPDATE OR DELETE ON public.tokens_sharetoken
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_class_lifecycle();
DROP TRIGGER IF EXISTS tokens_class_lifecycle_authority ON public.tokens_sharetoken;
CREATE CONSTRAINT TRIGGER tokens_class_lifecycle_authority AFTER UPDATE OR DELETE ON public.tokens_sharetoken
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_class_lifecycle_authority();

DO $$
DECLARE retired record;
BEGIN
    FOR retired IN
        SELECT trigger_record.tgname AS name, trigger_record.tgrelid::regclass AS relation
        FROM pg_trigger trigger_record
        WHERE NOT trigger_record.tgisinternal AND trigger_record.tgname LIKE 'tokens\_deleted\_class\_reference\_%'
    LOOP
        EXECUTE format('DROP TRIGGER %I ON %s', retired.name, retired.relation);
    END LOOP;
END;
$$;
DROP FUNCTION IF EXISTS tokens_guard_deleted_class_reference();
DROP FUNCTION IF EXISTS tokens_class_review_retirement(uuid, bigint, uuid, uuid, uuid, text);
