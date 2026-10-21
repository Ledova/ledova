CREATE OR REPLACE FUNCTION tokens_guard_class_rights_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE issuer uuid; principal bigint; last_revision integer; actor_name text; document jsonb; copy tokens_registerevidence;
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
    IF NEW.revision IS DISTINCT FROM last_revision + 1 OR char_length(NEW.summary) > 20000
        OR char_length(NEW.document_reference) > 255 OR NEW.recorded_by_name IS DISTINCT FROM actor_name
    THEN
        RAISE EXCEPTION 'Retain the exact next class-rights description and its actor' USING ERRCODE = '23514';
    END IF;
    IF jsonb_typeof(NEW.documents) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Class documents must be retained file snapshots' USING ERRCODE = '23514';
    END IF;
    IF jsonb_array_length(NEW.documents) > 100 OR (
        SELECT count(DISTINCT item->>'evidence') FROM jsonb_array_elements(NEW.documents) item
    ) <> jsonb_array_length(NEW.documents) THEN
        RAISE EXCEPTION 'Retain each class document once, with at most 100 documents' USING ERRCODE = '23514';
    END IF;
    FOR document IN SELECT value FROM jsonb_array_elements(NEW.documents) LOOP
        SELECT * INTO copy FROM tokens_registerevidence WHERE uuid::text = document->>'evidence';
        IF NOT FOUND OR copy.company_id IS DISTINCT FROM issuer OR copy.kind IS DISTINCT FROM 'class_rights'
            OR document IS DISTINCT FROM tokens_register_evidence_snapshot(copy)
            OR (copy.uploaded_by_id IS DISTINCT FROM principal AND NOT EXISTS (
                SELECT 1 FROM tokens_classrightsrevision retained WHERE retained.token_id = NEW.token_id
                    AND retained.documents @> jsonb_build_array(document)
            ))
        THEN
            RAISE EXCEPTION 'Retain only exact company class documents uploaded by the actor or already linked to this class'
                USING ERRCODE = '23514';
        END IF;
    END LOOP;
    NEW.created_at := statement_timestamp();
    NEW.updated_at := NEW.created_at;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tokens_guard_register_evidence()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $function$
DECLARE
    principal bigint;
    at_time timestamptz;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain company-provided register evidence' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    at_time := clock_timestamp();
    PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
        OR NEW.uploaded_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'register_evidence'
        OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
        OR NEW.kind NOT IN ('share_register', 'asic_extract', 'authority', 'supporting', 'class_rights')
        OR NEW.sha256 !~ '^[0-9a-f]{64}$'
        OR NEW.file_size <= 0 OR NEW.mime_type NOT IN ('application/pdf', 'image/png', 'image/jpeg')
        OR NEW.file !~ ('^companies/' || NEW.company_id || '/register-evidence/' || NEW.uuid || '/[0-9a-f-]{36}[.]bin$')
        OR NOT tokens_register_appointment_current(NEW.appointment_id, NEW.company_id, principal,
            CASE WHEN NEW.kind = 'class_rights' THEN 'admin' ELSE 'prepare' END, at_time)
    THEN
        RAISE EXCEPTION 'Register evidence needs its uploader''s current company authority'
            USING ERRCODE = '23514';
    END IF;
    NEW.created_at := at_time;
    NEW.updated_at := at_time;
    RETURN NEW;
END;
$function$;
