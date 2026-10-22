CREATE FUNCTION tokens_guard_person_registration() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint; at_time timestamptz;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain immutable company person registration records' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
        OR NEW.submitted_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_person_add'
        OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
        OR NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id, principal, 'prepare', at_time)
        OR NEW.name !~ '[^[:space:]]' OR NEW.residential_address !~ '[^[:space:]]'
        OR length(NEW.residential_address) > 1000
        OR EXISTS (SELECT 1 FROM tokens_registermember WHERE uuid = NEW.member_id)
    THEN RAISE EXCEPTION 'A new company person requires current personal authority and unused identity' USING ERRCODE = '23514'; END IF;
    NEW.created_at := at_time; NEW.updated_at := at_time;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_person_registration BEFORE INSERT OR UPDATE OR DELETE ON tokens_registerpersonregistration
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_person_registration();

CREATE FUNCTION tokens_guard_registered_person() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint;
BEGIN
    IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_person_add' THEN RETURN NEW; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF NOT EXISTS (SELECT 1 FROM tokens_registerpersonregistration source
        WHERE source.member_id = NEW.uuid AND source.company_id = NEW.company_id AND source.submitted_by_id = principal
            AND current_setting('app.company_id', true) = NEW.company_id::text
            AND tokens_register_appointment_current(source.preparing_appointment_id, NEW.company_id, principal, 'prepare', clock_timestamp()))
    THEN RAISE EXCEPTION 'A new person must retain their exact company registration' USING ERRCODE = '23514'; END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER tokens_registered_person BEFORE INSERT ON tokens_registermember
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_registered_person();

CREATE FUNCTION tokens_check_person_registration() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NOT tokens_register_appointment_current(NEW.preparing_appointment_id, NEW.company_id,
            NEW.submitted_by_id, 'prepare', clock_timestamp())
        OR NOT EXISTS (SELECT 1 FROM tokens_registermember member
            JOIN tokens_registermemberparticulars held ON held.member_id = member.uuid
            WHERE member.uuid = NEW.member_id AND member.company_id = NEW.company_id
                AND held.source_registration_id = NEW.uuid AND held.name = NEW.name
                AND held.residential_address = NEW.residential_address)
    THEN RAISE EXCEPTION 'Person registration retains exact particulars and current authority at commit' USING ERRCODE = '23514'; END IF;
    RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER tokens_person_registration_commit AFTER INSERT ON tokens_registerpersonregistration
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_person_registration();
