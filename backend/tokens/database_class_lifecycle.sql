CREATE OR REPLACE FUNCTION tokens_class_deletion_reason(token_uuid uuid)
RETURNS text LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE share_class public.tokens_sharetoken; reference record; referenced boolean;
BEGIN
    SELECT * INTO share_class FROM public.tokens_sharetoken WHERE uuid = token_uuid;
    IF NOT FOUND OR share_class.deleted_at IS NOT NULL THEN RETURN 'This share class is no longer available.'; END IF;
    IF share_class.status <> 'draft' OR NULLIF(share_class.contract_address, '') IS NOT NULL
        OR NULLIF(share_class.chain, '') IS NOT NULL OR share_class.deployment_id IS NOT NULL
        OR share_class.deployment_transaction_id IS NOT NULL OR NULLIF(share_class.deployment_tx_hash, '') IS NOT NULL
        OR share_class.deployed_at IS NOT NULL THEN
        RETURN 'This class has deployment or chain records and cannot be deleted.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.tokens_shareregister register WHERE register.token_id = token_uuid
        AND (register.sequence <> 0 OR register.issued_supply <> 0
            OR EXISTS (SELECT 1 FROM public.tokens_registerentry entry WHERE entry.register_id = register.uuid)
            OR EXISTS (SELECT 1 FROM public.tokens_registerposition position WHERE position.register_id = register.uuid))) THEN
        RETURN 'This class has confirmed ledger records and cannot be deleted.';
    END IF;
    IF EXISTS (SELECT 1 FROM public.tokens_registerimport proposal WHERE proposal.token_id = token_uuid
        AND proposal.status <> 'rejected') THEN
        RETURN 'Retire the saved setup review before deleting this class.';
    END IF;
    FOR reference IN
        SELECT constraint_record.conrelid::regclass AS relation, attribute.attname AS column_name,
            cardinality(constraint_record.conkey) AS key_count
        FROM pg_constraint constraint_record
        JOIN pg_attribute attribute ON attribute.attrelid = constraint_record.conrelid
            AND attribute.attnum = constraint_record.conkey[1]
        WHERE constraint_record.contype = 'f' AND constraint_record.confrelid = 'public.tokens_sharetoken'::regclass
    LOOP
        IF reference.key_count <> 1 THEN RETURN 'This class has retained records and cannot be deleted.'; END IF;
        IF reference.relation IN ('public.tokens_registerimport'::regclass, 'public.tokens_shareregister'::regclass) THEN
            CONTINUE;
        END IF;
        EXECUTE format('SELECT EXISTS (SELECT 1 FROM %s WHERE %I = $1)', reference.relation, reference.column_name)
            INTO referenced USING token_uuid;
        IF referenced THEN RETURN 'This class has retained documents, rights or other records and cannot be deleted.'; END IF;
    END LOOP;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION tokens_class_details_available(token_uuid uuid, editing boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE share_class public.tokens_sharetoken; reference record; referenced boolean; predicate text;
BEGIN
    IF NOT editing THEN RETURN tokens_class_deletion_reason(token_uuid) IS NULL; END IF;
    SELECT * INTO share_class FROM public.tokens_sharetoken WHERE uuid = token_uuid;
    IF NOT FOUND OR share_class.deleted_at IS NOT NULL OR share_class.status <> 'draft'
        OR NULLIF(share_class.contract_address, '') IS NOT NULL OR NULLIF(share_class.chain, '') IS NOT NULL
        OR share_class.deployment_id IS NOT NULL OR share_class.deployment_transaction_id IS NOT NULL
        OR NULLIF(share_class.deployment_tx_hash, '') IS NOT NULL OR share_class.deployed_at IS NOT NULL THEN
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
        IF reference.relation = 'public.tokens_registerimport'::regclass THEN
            predicate := ' AND status <> ''rejected''';
        ELSIF reference.relation = 'public.tokens_shareregister'::regclass THEN
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
DECLARE principal bigint; deleting boolean; operation text; reason text;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.deleted_at IS NOT NULL OR NEW.deleted_by_id IS NOT NULL THEN
            RAISE EXCEPTION 'New share classes cannot carry deletion history' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        IF current_user = __MIGRATE__ AND companies_disposal_allows(TG_TABLE_NAME, OLD.uuid) THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'Retain share classes and their audit history' USING ERRCODE = '23514';
    END IF;
    IF OLD.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Deleted share classes and their audit history are immutable' USING ERRCODE = '23514';
    END IF;
    deleting := (NEW.deleted_at, NEW.deleted_by_id) IS DISTINCT FROM (OLD.deleted_at, OLD.deleted_by_id);
    IF NOT deleting AND (NEW.name, NEW.symbol, NEW.token_type) IS NOT DISTINCT FROM
        (OLD.name, OLD.symbol, OLD.token_type) THEN RETURN NEW; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    operation := CASE WHEN deleting THEN 'register_class_delete' ELSE 'register_class_edit' END;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
        OR current_setting('app.company_operation', true) IS DISTINCT FROM operation
        OR current_setting('app.company_id', true) IS DISTINCT FROM OLD.company_id::text THEN
        RAISE EXCEPTION 'Use the exact actor-bound class change command' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.companies_company WHERE uuid = OLD.company_id FOR UPDATE;
    IF NOT EXISTS (SELECT 1 FROM public.companies_companyappointment appointment
            WHERE tokens_register_appointment_current(appointment.uuid, OLD.company_id, principal, 'prepare', clock_timestamp())) THEN
        RAISE EXCEPTION 'Class changes require current company preparation authority' USING ERRCODE = '23514';
    END IF;
    IF deleting THEN
        reason := tokens_class_deletion_reason(OLD.uuid);
        IF reason IS NOT NULL OR NEW.deleted_at IS NULL OR NEW.deleted_by_id IS DISTINCT FROM principal
            OR (to_jsonb(NEW) - ARRAY['deleted_at', 'deleted_by_id', 'updated_at']) IS DISTINCT FROM
                (to_jsonb(OLD) - ARRAY['deleted_at', 'deleted_by_id', 'updated_at']) THEN
            RAISE EXCEPTION '%', COALESCE(reason, 'Use the exact attributed class deletion') USING ERRCODE = '23514';
        END IF;
        NEW.deleted_at := clock_timestamp();
        NEW.updated_at := NEW.deleted_at;
    ELSE
        IF NOT tokens_class_details_available(OLD.uuid, true)
            OR (to_jsonb(NEW) - ARRAY['name', 'symbol', 'token_type', 'updated_at']) IS DISTINCT FROM
                (to_jsonb(OLD) - ARRAY['name', 'symbol', 'token_type', 'updated_at'])
            OR length(btrim(NEW.name)) = 0 OR length(NEW.name) > 100 OR NEW.symbol !~ '^[A-Z]{1,5}$'
            OR NEW.token_type NOT IN ('ordinary', 'preference', 'redeemable') THEN
            RAISE EXCEPTION 'Only valid unused class details may change' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION tokens_check_class_lifecycle_authority()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF current_user = __MIGRATE__ AND companies_disposal_allows(TG_TABLE_NAME, OLD.uuid) THEN RETURN NULL; END IF;
        RAISE EXCEPTION 'Retain share class audit history' USING ERRCODE = '23514';
    END IF;
    IF (NEW.name, NEW.symbol, NEW.token_type, NEW.deleted_at, NEW.deleted_by_id) IS NOT DISTINCT FROM
        (OLD.name, OLD.symbol, OLD.token_type, OLD.deleted_at, OLD.deleted_by_id) THEN RETURN NULL; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF NOT EXISTS (SELECT 1 FROM public.companies_companyappointment appointment
        WHERE tokens_register_appointment_current(appointment.uuid, OLD.company_id, principal, 'prepare', clock_timestamp())) THEN
        RAISE EXCEPTION 'Share class changes require current company preparation authority at commit'
            USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION tokens_guard_deleted_class_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE identifier uuid; token_uuid uuid; issuer uuid; share_class public.tokens_sharetoken; principal bigint; audit boolean;
BEGIN
    identifier := NULLIF(to_jsonb(NEW)->>TG_ARGV[0], '')::uuid;
    IF identifier IS NULL THEN RETURN NEW; END IF;
    IF TG_ARGV[1] = 'register' THEN
        SELECT token_id INTO token_uuid FROM public.tokens_shareregister WHERE uuid = identifier;
    ELSE
        token_uuid := identifier;
    END IF;
    SELECT company_id INTO issuer FROM public.tokens_sharetoken WHERE uuid = token_uuid;
    IF NOT FOUND THEN RETURN NEW; END IF;
    PERFORM 1 FROM public.companies_company WHERE uuid = issuer FOR UPDATE;
    SELECT * INTO share_class FROM public.tokens_sharetoken WHERE uuid = token_uuid FOR UPDATE;
    IF share_class.deleted_at IS NULL THEN RETURN NEW; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    audit := false;
    IF TG_TABLE_NAME = 'tokens_registerexport' AND TG_OP = 'INSERT'
        AND current_user IN (__OPERATOR__, __MIGRATE__) AND principal IS NOT NULL
        AND to_jsonb(NEW)->>'kind' = 'company_pack'
        AND (to_jsonb(NEW)->>'requested_by_id')::bigint = principal
        AND current_setting('app.company_id', true) = issuer::text
        AND current_setting('app.company_operation', true) IN ('company_pack', 'company_pack_admin') THEN
        audit := EXISTS (SELECT 1 FROM public.companies_companyappointment appointment
            WHERE tokens_register_appointment_current(appointment.uuid, issuer, principal, 'admin', clock_timestamp()));
        IF NOT audit AND current_setting('app.company_operation', true) = 'company_pack_admin'
            AND to_jsonb(NEW)->>'produced_through' = 'admin' THEN
            audit := EXISTS (SELECT 1 FROM public.authentication_customuser actor WHERE actor.id = principal
                AND actor.is_active AND actor.is_staff AND (actor.is_superuser OR EXISTS (
                    SELECT 1 FROM public.auth_permission permission JOIN public.django_content_type content_type
                        ON content_type.id = permission.content_type_id
                    WHERE content_type.app_label = 'companies' AND permission.codename = 'view_companypack'
                        AND (EXISTS (SELECT 1 FROM public.authentication_customuser_user_permissions grant_row
                            WHERE grant_row.customuser_id = principal AND grant_row.permission_id = permission.id)
                        OR EXISTS (SELECT 1 FROM public.authentication_customuser_groups membership
                            JOIN public.auth_group_permissions grant_row ON grant_row.group_id = membership.group_id
                            WHERE membership.customuser_id = principal AND grant_row.permission_id = permission.id)))));
        END IF;
    END IF;
    IF NOT audit THEN
        RAISE EXCEPTION 'Deleted share classes cannot acquire new records or effects' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tokens_class_lifecycle ON public.tokens_sharetoken;
CREATE TRIGGER tokens_class_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON public.tokens_sharetoken
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_class_lifecycle();
DROP TRIGGER IF EXISTS tokens_class_lifecycle_authority ON public.tokens_sharetoken;
CREATE CONSTRAINT TRIGGER tokens_class_lifecycle_authority AFTER UPDATE OR DELETE ON public.tokens_sharetoken
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_class_lifecycle_authority();

DO $$
DECLARE reference record; trigger_name text;
BEGIN
    FOR reference IN
        SELECT constraint_record.conrelid::regclass AS relation, attribute.attname AS column_name,
            CASE WHEN constraint_record.confrelid = 'public.tokens_sharetoken'::regclass THEN 'class' ELSE 'register' END AS kind
        FROM pg_constraint constraint_record
        JOIN pg_attribute attribute ON attribute.attrelid = constraint_record.conrelid
            AND attribute.attnum = constraint_record.conkey[1]
        WHERE constraint_record.contype = 'f' AND cardinality(constraint_record.conkey) = 1
            AND constraint_record.confrelid IN ('public.tokens_sharetoken'::regclass, 'public.tokens_shareregister'::regclass)
    LOOP
        trigger_name := 'tokens_deleted_class_reference_' || reference.column_name;
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %s', trigger_name, reference.relation);
        EXECUTE format('CREATE TRIGGER %I BEFORE INSERT OR UPDATE ON %s FOR EACH ROW '
            || 'EXECUTE FUNCTION tokens_guard_deleted_class_reference(%L, %L)',
            trigger_name, reference.relation, reference.column_name, reference.kind);
    END LOOP;
END;
$$;
