CREATE FUNCTION authentication_guard_terms_acceptance() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    actor authentication_customuser;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain immutable Terms acceptance' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO actor FROM authentication_customuser WHERE id = NEW.user_id FOR UPDATE;
    IF current_user NOT IN (@OPERATOR_ROLE@, @MIGRATE_ROLE@)
        OR NULLIF(current_setting('app.profile_save', true), '')::bigint IS DISTINCT FROM NEW.user_id
        OR actor.id IS NULL OR NOT actor.is_active OR NOT actor.is_email_verified
        OR NEW.version IS DISTINCT FROM '2026-11-09'
        OR NEW.statement IS DISTINCT FROM 'I accept the Ledova Terms of Service.'
    THEN
        RAISE EXCEPTION 'Terms acceptance requires the signed-in account and current Terms'
            USING ERRCODE = '23514';
    END IF;
    NEW.created_at := clock_timestamp();
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
END;
$$;
CREATE TRIGGER authentication_terms_immutable BEFORE INSERT OR UPDATE OR DELETE
    ON authentication_termsacceptance FOR EACH ROW EXECUTE FUNCTION authentication_guard_terms_acceptance();
