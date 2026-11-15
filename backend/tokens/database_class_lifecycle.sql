CREATE OR REPLACE FUNCTION tokens_class_details_available(token_uuid uuid, editing boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE share_class public.tokens_sharetoken; reference record; referenced boolean; predicate text;
BEGIN
    SELECT * INTO share_class FROM public.tokens_sharetoken WHERE uuid = token_uuid;
    IF NOT FOUND OR share_class.status <> 'draft' OR NULLIF(share_class.contract_address, '') IS NOT NULL
        OR NULLIF(share_class.chain, '') IS NOT NULL OR share_class.deployment_id IS NOT NULL
        OR share_class.deployment_transaction_id IS NOT NULL OR NULLIF(share_class.deployment_tx_hash, '') IS NOT NULL
        OR share_class.deployed_at IS NOT NULL THEN
        RETURN false;
    END IF;
    FOR reference IN
        SELECT constraint_record.conrelid::regclass AS relation, attribute.attname AS column_name,
            cardinality(constraint_record.conkey) AS key_count
        FROM pg_constraint constraint_record
        JOIN pg_attribute attribute ON attribute.attrelid = constraint_record.conrelid
            AND attribute.attnum = constraint_record.conkey[1]
        WHERE constraint_record.contype = 'f' AND constraint_record.confrelid = 'public.tokens_sharetoken'::regclass
    LOOP
        IF reference.key_count <> 1 THEN RETURN false; END IF;
        predicate := '';
        IF editing AND reference.relation = 'public.tokens_registerimport'::regclass THEN
            predicate := ' AND status <> ''rejected''';
        ELSIF editing AND reference.relation = 'public.tokens_shareregister'::regclass THEN
            predicate := ' AND (sequence <> 0 OR issued_supply <> 0 OR EXISTS ('
                || 'SELECT 1 FROM public.tokens_registerentry entry WHERE entry.register_id = source.uuid))';
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
DECLARE principal bigint; operation text; editing boolean;
BEGIN
    editing := TG_OP = 'UPDATE';
    IF editing AND (NEW.name, NEW.symbol, NEW.token_type) IS NOT DISTINCT FROM
        (OLD.name, OLD.symbol, OLD.token_type) THEN RETURN NEW; END IF;
    IF TG_OP = 'DELETE' AND current_user = __MIGRATE__ THEN
        IF companies_disposal_allows(TG_TABLE_NAME, OLD.uuid) THEN RETURN OLD; END IF;
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    operation := CASE WHEN editing THEN 'register_class_edit' ELSE 'register_class_delete' END;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
        OR current_setting('app.company_operation', true) IS DISTINCT FROM operation
        OR current_setting('app.company_id', true) IS DISTINCT FROM OLD.company_id::text THEN
        RAISE EXCEPTION 'Use the exact actor-bound class change command' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.companies_company WHERE uuid = OLD.company_id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.companies_companyappointment appointment
            WHERE tokens_register_appointment_current(appointment.uuid, OLD.company_id, principal, 'prepare', clock_timestamp()))
        OR NOT tokens_class_details_available(OLD.uuid, editing) THEN
        RAISE EXCEPTION 'Only a current company preparer can change an unused share class'
            USING ERRCODE = '23514';
    END IF;
    IF editing THEN
        IF (to_jsonb(NEW) - ARRAY['name', 'symbol', 'token_type', 'updated_at']) IS DISTINCT FROM
            (to_jsonb(OLD) - ARRAY['name', 'symbol', 'token_type', 'updated_at'])
            OR length(btrim(NEW.name)) = 0 OR length(NEW.name) > 100 OR NEW.symbol !~ '^[A-Z]{1,5}$'
            OR NEW.token_type NOT IN ('ordinary', 'preference', 'redeemable') THEN
            RAISE EXCEPTION 'Only valid unused class details may change' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION tokens_check_class_lifecycle_authority()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint;
BEGIN
    IF TG_OP = 'UPDATE' AND (NEW.name, NEW.symbol, NEW.token_type) IS NOT DISTINCT FROM
        (OLD.name, OLD.symbol, OLD.token_type) THEN RETURN NULL; END IF;
    IF TG_OP = 'DELETE' AND current_user = __MIGRATE__ THEN
        IF companies_disposal_allows(TG_TABLE_NAME, OLD.uuid) THEN RETURN NULL; END IF;
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
