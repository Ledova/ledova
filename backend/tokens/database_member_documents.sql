CREATE OR REPLACE FUNCTION tokens_guard_import_documents() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE person jsonb; document jsonb; evidence tokens_registerevidence; principal bigint;
BEGIN
    IF TG_OP <> 'INSERT' THEN RETURN NEW; END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    FOR person IN SELECT value FROM jsonb_array_elements(NEW.members) LOOP
        IF NOT person ? 'documents' THEN CONTINUE; END IF;
        IF jsonb_typeof(person->'documents') IS DISTINCT FROM 'array'
            OR jsonb_array_length(person->'documents') > 100 THEN
            RAISE EXCEPTION 'Shareholder documents require a bounded attachment list' USING ERRCODE = '23514';
        END IF;
        IF (SELECT count(DISTINCT value->>'evidence') FROM jsonb_array_elements(person->'documents'))
            <> jsonb_array_length(person->'documents') THEN
            RAISE EXCEPTION 'Attach each file once to a shareholder and class' USING ERRCODE = '23514';
        END IF;
        FOR document IN SELECT value FROM jsonb_array_elements(person->'documents') LOOP
            IF jsonb_typeof(document) IS DISTINCT FROM 'object'
                OR (SELECT array_agg(key ORDER BY key COLLATE "C") FROM jsonb_object_keys(document) key)
                    IS DISTINCT FROM ARRAY['category','evidence','snapshot']
                OR jsonb_typeof(document->'category') IS DISTINCT FROM 'string'
                OR jsonb_typeof(document->'evidence') IS DISTINCT FROM 'string'
                OR document->>'category' NOT IN ('share_certificate','shareholder_agreement','subscription_agreement','other')
                OR document->>'evidence' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                RAISE EXCEPTION 'Shareholder documents require their exact file and category' USING ERRCODE = '23514';
            END IF;
            SELECT * INTO evidence FROM tokens_registerevidence WHERE uuid::text = document->>'evidence';
            IF evidence.uuid IS NULL OR evidence.company_id IS DISTINCT FROM NEW.company_id OR evidence.kind <> 'supporting'
                OR document->'snapshot' IS DISTINCT FROM tokens_register_evidence_snapshot(evidence)
                OR (evidence.uploaded_by_id IS DISTINCT FROM principal AND NOT EXISTS (
                    SELECT 1 FROM tokens_registermemberdocument retained WHERE retained.company_id = NEW.company_id
                        AND retained.token_id = NEW.token_id AND retained.member_id::text = person->>'member'
                        AND retained.evidence_id = evidence.uuid AND retained.category = document->>'category')) THEN
                RAISE EXCEPTION 'Shareholder evidence must belong to its exact company and holding' USING ERRCODE = '23514';
            END IF;
        END LOOP;
    END LOOP;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION tokens_guard_member_document() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint; copy tokens_registerevidence; opening tokens_registerimport;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'Retain shareholder document links and categories' USING ERRCODE = '23514';
    END IF;
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    PERFORM 1 FROM companies_company WHERE uuid = NEW.company_id FOR UPDATE;
    SELECT * INTO copy FROM tokens_registerevidence WHERE uuid = NEW.evidence_id;
    IF current_user NOT IN (__OPERATOR__, __MIGRATE__) OR principal IS NULL
        OR NEW.recorded_by_id IS DISTINCT FROM principal
        OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text
        OR copy.uuid IS NULL OR copy.company_id IS DISTINCT FROM NEW.company_id OR copy.kind <> 'supporting'
        OR NEW.snapshot IS DISTINCT FROM tokens_register_evidence_snapshot(copy)
        OR NEW.category NOT IN ('share_certificate','shareholder_agreement','subscription_agreement','other')
        OR NOT EXISTS (SELECT 1 FROM tokens_registerposition position
            JOIN tokens_shareregister register ON register.uuid = position.register_id
            JOIN tokens_registermember member ON member.uuid = position.member_id
            JOIN tokens_sharetoken token ON token.uuid = register.token_id
            WHERE position.member_id = NEW.member_id AND member.company_id = NEW.company_id
                AND token.uuid = NEW.token_id AND token.company_id = NEW.company_id AND register.company_id = NEW.company_id) THEN
        RAISE EXCEPTION 'Use the exact company shareholder, class and private evidence' USING ERRCODE = '23514';
    END IF;
    IF NEW.source_import_id IS NULL THEN
        IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_member_document'
            OR copy.uploaded_by_id IS DISTINCT FROM principal
            OR NOT tokens_register_appointment_current(NEW.appointment_id, NEW.company_id, principal, 'prepare', clock_timestamp()) THEN
            RAISE EXCEPTION 'Attaching a document requires current company preparation authority' USING ERRCODE = '23514';
        END IF;
    ELSE
        SELECT * INTO opening FROM tokens_registerimport WHERE uuid = NEW.source_import_id;
        IF current_setting('app.company_operation', true) IS DISTINCT FROM 'register_import_apply'
            OR opening.company_id IS DISTINCT FROM NEW.company_id OR opening.token_id IS DISTINCT FROM NEW.token_id
            OR opening.status <> 'submitted'
            OR NOT tokens_register_appointment_current(NEW.appointment_id, NEW.company_id, principal, 'apply', clock_timestamp())
            OR NOT EXISTS (SELECT 1 FROM tokens_registerimportdecision decision WHERE decision.register_import_id = opening.uuid
                AND decision.kind = 'apply' AND decision.appointment_id = NEW.appointment_id AND decision.decided_by_id = principal)
            OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(opening.members) person,
                jsonb_array_elements(COALESCE(person->'documents', '[]'::jsonb)) document
                WHERE person->>'member' = NEW.member_id::text AND document->>'evidence' = NEW.evidence_id::text
                    AND document->>'category' = NEW.category AND document->'snapshot' = NEW.snapshot) THEN
            RAISE EXCEPTION 'Opening attachments require the exact approved company records' USING ERRCODE = '23514';
        END IF;
    END IF;
    NEW.created_at := clock_timestamp(); NEW.updated_at := NEW.created_at;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION tokens_check_member_document_authority() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NOT tokens_register_appointment_current(NEW.appointment_id, NEW.company_id, NEW.recorded_by_id,
        CASE WHEN NEW.source_import_id IS NULL THEN 'prepare' ELSE 'apply' END, clock_timestamp())
        OR (NEW.source_import_id IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM tokens_registerimport WHERE uuid = NEW.source_import_id AND status = 'applied')) THEN
        RAISE EXCEPTION 'Shareholder documents require current authority and a completed source at commit' USING ERRCODE = '23514';
    END IF;
    RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION tokens_keep_member_document_context() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NEW.company_id IS DISTINCT FROM OLD.company_id AND EXISTS (SELECT 1 FROM tokens_registermemberdocument document
        WHERE (TG_TABLE_NAME = 'tokens_sharetoken' AND document.token_id = OLD.uuid)
            OR (TG_TABLE_NAME = 'tokens_registermember' AND document.member_id = OLD.uuid)) THEN
        RAISE EXCEPTION 'Retain the company behind shareholder documents' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER tokens_import_documents BEFORE INSERT ON tokens_registerimport
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_import_documents();
CREATE TRIGGER tokens_member_document_identity BEFORE INSERT OR UPDATE OR DELETE ON tokens_registermemberdocument
    FOR EACH ROW EXECUTE FUNCTION tokens_guard_member_document();
CREATE CONSTRAINT TRIGGER tokens_member_document_commit_authority AFTER INSERT ON tokens_registermemberdocument
    DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION tokens_check_member_document_authority();
CREATE TRIGGER tokens_member_document_class_company BEFORE UPDATE OF company_id ON tokens_sharetoken
    FOR EACH ROW EXECUTE FUNCTION tokens_keep_member_document_context();
CREATE TRIGGER tokens_member_document_person_company BEFORE UPDATE OF company_id ON tokens_registermember
    FOR EACH ROW EXECUTE FUNCTION tokens_keep_member_document_context();
