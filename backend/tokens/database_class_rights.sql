CREATE OR REPLACE FUNCTION tokens_guard_class_rights_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE issuer uuid; principal bigint; last_revision integer; actor_name text;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain the append-only company class-rights descriptions' USING ERRCODE = '23514';
    END IF;
    SELECT company_id INTO issuer FROM tokens_sharetoken WHERE uuid = NEW.token_id;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL OR issuer IS NULL
        OR current_setting('app.company_id', true) IS DISTINCT FROM issuer::text
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'class_rights_record'
        OR NEW.recorded_by_id IS DISTINCT FROM principal
    THEN
        RAISE EXCEPTION 'Use the exact actor-bound company class-rights command' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM companies_company WHERE uuid = issuer FOR UPDATE;
    PERFORM 1 FROM tokens_sharetoken WHERE uuid = NEW.token_id AND company_id = issuer FOR UPDATE;
    IF NOT FOUND OR NOT tokens_register_appointment_current(NEW.appointment_id, issuer, principal, 'admin', clock_timestamp()) THEN
        RAISE EXCEPTION 'Current personal company administration is required for class-rights descriptions'
            USING ERRCODE = '23514';
    END IF;
    SELECT coalesce(max(revision), 0) INTO last_revision FROM tokens_classrightsrevision WHERE token_id = NEW.token_id;
    SELECT coalesce(profile.full_name, '') INTO actor_name FROM companies_companyappointment appointment
        JOIN users_userprofile profile ON profile.uuid = appointment.appointee_profile_id
        WHERE appointment.uuid = NEW.appointment_id AND profile.user_id = principal;
    IF NEW.revision IS DISTINCT FROM last_revision + 1 OR char_length(NEW.summary) > 4000
        OR char_length(NEW.document_reference) > 255 OR NEW.recorded_by_name IS DISTINCT FROM actor_name
    THEN
        RAISE EXCEPTION 'Retain the exact next class-rights description and its actor' USING ERRCODE = '23514';
    END IF;
    NEW.created_at := statement_timestamp();
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION tokens_keep_class_rights_company() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id
        AND EXISTS (SELECT 1 FROM tokens_classrightsrevision WHERE token_id = OLD.uuid)
    THEN
        RAISE EXCEPTION 'Retain the company behind recorded class-rights descriptions' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION tokens_check_class_rights_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE issuer uuid;
BEGIN
    SELECT company_id INTO issuer FROM tokens_sharetoken WHERE uuid = NEW.token_id;
    IF NOT tokens_register_appointment_current(NEW.appointment_id, issuer, NEW.recorded_by_id, 'admin', clock_timestamp()) THEN
        RAISE EXCEPTION 'Class-rights recording authority must remain current at commit' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE TRIGGER tokens_class_rights_identity BEFORE INSERT OR UPDATE OR DELETE ON tokens_classrightsrevision
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_class_rights_revision();
CREATE CONSTRAINT TRIGGER tokens_class_rights_commit_authority AFTER INSERT ON tokens_classrightsrevision
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_class_rights_authority();
CREATE TRIGGER tokens_class_rights_company BEFORE UPDATE OF company_id ON tokens_sharetoken
    FOR EACH ROW EXECUTE FUNCTION tokens_keep_class_rights_company();
