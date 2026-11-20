CREATE OR REPLACE FUNCTION tokens_guard_class_details_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE share_class public.tokens_sharetoken; principal bigint; last_revision integer; actor_name text;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF companies_disposal_allows(TG_TABLE_NAME, OLD.uuid) THEN RETURN OLD; END IF;
    END IF;
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain the append-only share class detail history' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT * INTO share_class FROM public.tokens_sharetoken WHERE uuid = NEW.token_id;
    IF pg_trigger_depth() <> 2 OR current_user NOT IN (__OPERATOR__, __MIGRATE__)
        OR principal IS NULL OR share_class.uuid IS NULL OR share_class.deleted_at IS NOT NULL
        OR current_setting('app.company_id', true) IS DISTINCT FROM share_class.company_id::text
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_class_edit'
        OR NEW.recorded_by_id IS DISTINCT FROM principal
        OR NOT tokens_register_appointment_current(NEW.appointment_id, share_class.company_id, principal, 'prepare', clock_timestamp()) THEN
        RAISE EXCEPTION 'Class detail history is generated only by the exact attributed class change'
            USING ERRCODE = '23514';
    END IF;
    SELECT coalesce(max(revision), 0) INTO last_revision FROM public.tokens_classdetailsrevision WHERE token_id = NEW.token_id;
    SELECT coalesce(profile.full_name, '') INTO actor_name FROM public.companies_companyappointment appointment
        JOIN public.users_userprofile profile ON profile.uuid = appointment.appointee_profile_id
        WHERE appointment.uuid = NEW.appointment_id AND profile.user_id = principal;
    IF NEW.revision IS DISTINCT FROM last_revision + 1
        OR NEW.before IS NOT DISTINCT FROM NEW.after
        OR NEW.before IS DISTINCT FROM jsonb_build_object('name', NEW.before->>'name', 'symbol', NEW.before->>'symbol', 'token_type', NEW.before->>'token_type')
        OR NEW.after IS DISTINCT FROM jsonb_build_object('name', share_class.name, 'symbol', share_class.symbol, 'token_type', share_class.token_type)
        OR NEW.recorded_by_name IS DISTINCT FROM actor_name
        OR NEW.created_at IS DISTINCT FROM share_class.updated_at OR NEW.updated_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'Retain the exact next class detail change and its actor' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION tokens_record_class_details_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint; appointment_uuid uuid; actor_name text; next_revision integer;
BEGIN
    IF TG_TABLE_SCHEMA IS DISTINCT FROM 'public' OR TG_TABLE_NAME IS DISTINCT FROM 'tokens_sharetoken'
        OR TG_OP IS DISTINCT FROM 'UPDATE' THEN
        RAISE EXCEPTION 'Class detail history must come from its share class' USING ERRCODE = '23514';
    END IF;
    IF (NEW.name, NEW.symbol, NEW.token_type) IS NOT DISTINCT FROM (OLD.name, OLD.symbol, OLD.token_type) THEN
        RETURN NULL;
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    SELECT appointment.uuid, coalesce(profile.full_name, '') INTO appointment_uuid, actor_name
        FROM public.companies_companyappointment appointment
        JOIN public.users_userprofile profile ON profile.uuid = appointment.appointee_profile_id
        WHERE tokens_register_appointment_current(appointment.uuid, OLD.company_id, principal, 'prepare', clock_timestamp())
            AND profile.user_id = principal ORDER BY appointment.uuid LIMIT 1;
    SELECT coalesce(max(revision), 0) + 1 INTO next_revision FROM public.tokens_classdetailsrevision WHERE token_id = OLD.uuid;
    INSERT INTO public.tokens_classdetailsrevision
        (uuid, created_at, updated_at, token_id, revision, before, after, recorded_by_id, recorded_by_name, appointment_id)
        VALUES (gen_random_uuid(), NEW.updated_at, NEW.updated_at, OLD.uuid, next_revision,
            jsonb_build_object('name', OLD.name, 'symbol', OLD.symbol, 'token_type', OLD.token_type),
            jsonb_build_object('name', NEW.name, 'symbol', NEW.symbol, 'token_type', NEW.token_type),
            principal, actor_name, appointment_uuid);
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION tokens_check_class_details_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE issuer uuid;
BEGIN
    SELECT company_id INTO issuer FROM public.tokens_sharetoken WHERE uuid = NEW.token_id;
    IF NOT tokens_register_appointment_current(NEW.appointment_id, issuer, NEW.recorded_by_id, 'prepare', clock_timestamp()) THEN
        RAISE EXCEPTION 'Class detail recording authority must remain current at commit' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION tokens_keep_class_details_company() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id
        AND EXISTS (SELECT 1 FROM public.tokens_classdetailsrevision WHERE token_id = OLD.uuid) THEN
        RAISE EXCEPTION 'Retain the company behind recorded class details' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tokens_class_details_identity ON public.tokens_classdetailsrevision;
CREATE TRIGGER tokens_class_details_identity BEFORE INSERT OR UPDATE OR DELETE ON public.tokens_classdetailsrevision
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_class_details_revision();
DROP TRIGGER IF EXISTS tokens_class_details_record ON public.tokens_sharetoken;
CREATE TRIGGER tokens_class_details_record AFTER UPDATE OF name, symbol, token_type ON public.tokens_sharetoken
    FOR EACH ROW EXECUTE FUNCTION tokens_record_class_details_revision();
DROP TRIGGER IF EXISTS tokens_class_details_commit_authority ON public.tokens_classdetailsrevision;
CREATE CONSTRAINT TRIGGER tokens_class_details_commit_authority AFTER INSERT ON public.tokens_classdetailsrevision
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_class_details_authority();
DROP TRIGGER IF EXISTS tokens_class_details_company ON public.tokens_sharetoken;
CREATE TRIGGER tokens_class_details_company BEFORE UPDATE OF company_id ON public.tokens_sharetoken
    FOR EACH ROW EXECUTE FUNCTION tokens_keep_class_details_company();
