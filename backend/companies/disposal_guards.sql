CREATE OR REPLACE FUNCTION companies_class_receipt_listed(manifest jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
    SELECT NOT EXISTS (SELECT 1 FROM jsonb_object_keys(manifest) AS listed(name) WHERE listed.name NOT IN (
        'tokens_sharetoken', 'tokens_classdetailsrevision', 'tokens_classrightsrevision',
        'tokens_importedformermember', 'tokens_registeracknowledgement', 'tokens_registerallotment',
        'tokens_registerallotmentdecision', 'tokens_registeraward', 'tokens_registerawardend',
        'tokens_registerawardvesting', 'tokens_registerawardvestingreversal', 'tokens_registercorrection',
        'tokens_registercorrectiondecision', 'tokens_registerentry', 'tokens_registerexport', 'tokens_registergrant',
        'tokens_registergrantdecision', 'tokens_registerimport', 'tokens_registerimportdecision',
        'tokens_registermembercessation', 'tokens_registermemberdocument', 'tokens_registeropening',
        'tokens_registeropeningdecision', 'tokens_registerposition', 'tokens_registerreconciliation',
        'tokens_registertransfer', 'tokens_registertransferdecision', 'tokens_shareregister', 'notifications',
        'django_admin_log', 'procrastinate_jobs', 'tokens_registermemberparticulars#detach'))
$$;
REVOKE ALL ON FUNCTION companies_class_receipt_listed(jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION companies_receipt_subject(scope text, manifest jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE subjects text[]; allowed text[]; listed text; subject text; listed_rows integer := 0;
BEGIN
    IF scope = 'proposal' THEN
        subjects := ARRAY['tokens_registerallotment', 'tokens_registertransfer', 'tokens_registergrant',
            'tokens_registerimport', 'tokens_registercorrection', 'tokens_registerparticularschange'];
        allowed := subjects || ARRAY['tokens_registerallotmentdecision', 'tokens_registeragreement',
            'tokens_registercontribution', 'tokens_registertransferdecision', 'tokens_registergrantdecision',
            'tokens_registerimportdecision', 'tokens_registercorrectiondecision',
            'tokens_registerparticularschangedecision'];
    ELSIF scope = 'invitation' THEN
        subjects := ARRAY['tokens_memberinvitation', 'companies_companyteaminvitation'];
        allowed := subjects;
    ELSIF scope = 'document' THEN
        subjects := ARRAY['tokens_registermemberdocument'];
        allowed := subjects || ARRAY['tokens_registerevidence'];
    ELSE
        RETURN NULL;
    END IF;
    allowed := allowed || ARRAY['notifications', 'django_admin_log', 'procrastinate_jobs'];
    FOR listed IN SELECT jsonb_object_keys(manifest) LOOP
        IF NOT listed = ANY(allowed) THEN RETURN NULL; END IF;
        IF listed = ANY(subjects) AND jsonb_array_length(manifest->listed) > 0 THEN
            listed_rows := listed_rows + jsonb_array_length(manifest->listed);
            subject := listed;
        END IF;
    END LOOP;
    RETURN CASE WHEN listed_rows = 1 THEN subject END;
END;
$$;
REVOKE ALL ON FUNCTION companies_receipt_subject(text, jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION companies_disposal_allows(disposal_table text, disposal_row uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE receipt record; selected text; principal bigint; operation text;
BEGIN
    IF current_user NOT IN (@OPERATOR_ROLE@, @MIGRATE_ROLE@) THEN RETURN false; END IF;
    selected := NULLIF(current_setting('app.company_disposal', true), '');
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    operation := current_setting('app.company_operation', true);
    IF selected IS NULL OR principal IS NULL OR to_regclass('public.companies_companydisposal') IS NULL THEN
        RETURN false;
    END IF;
    SELECT * INTO receipt FROM companies_companydisposal WHERE uuid = selected::uuid;
    IF NOT FOUND OR receipt.transaction_id IS DISTINCT FROM txid_current()
        OR receipt.database_disposed_at IS NOT NULL
        OR receipt.actor_id IS DISTINCT FROM principal
        OR current_setting('app.company_id', true) IS DISTINCT FROM receipt.company_id::text
        OR NOT (COALESCE(current_user = @MIGRATE_ROLE@ AND operation = 'schema_migration', false)
            OR COALESCE(operation = CASE receipt.scope
                WHEN 'company' THEN 'company_delete' WHEN 'share_class' THEN 'register_class_delete'
                WHEN 'proposal' THEN 'register_proposal_delete' WHEN 'invitation' THEN 'invitation_delete'
                WHEN 'document' THEN 'register_document_delete' END, false))
        OR receipt.scope NOT IN ('company', 'share_class', 'proposal', 'invitation', 'document')
        OR (receipt.scope IN ('proposal', 'invitation', 'document')
            AND companies_receipt_subject(receipt.scope, receipt.manifest) IS NULL)
        OR (receipt.scope = 'company'
            AND receipt.manifest->'companies_company' IS DISTINCT FROM jsonb_build_array(receipt.company_id::text))
        OR (receipt.scope = 'share_class' AND (NOT companies_class_receipt_listed(receipt.manifest)
            OR jsonb_array_length(COALESCE(receipt.manifest->'tokens_sharetoken', '[]'::jsonb)) <> 1))
    THEN RETURN false; END IF;
    RETURN COALESCE(receipt.manifest->disposal_table @> jsonb_build_array(disposal_row::text), false);
END;
$$;
REVOKE ALL ON FUNCTION companies_disposal_allows(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION companies_guard_disposal()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint; operation text; migrating boolean; subject text; owner uuid; state text;
    target uuid; link text; listed text; stray integer; agreement uuid; contribution uuid;
BEGIN
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    operation := current_setting('app.company_operation', true);
    migrating := COALESCE(current_user = @MIGRATE_ROLE@ AND operation = 'schema_migration', false);
    IF TG_OP = 'DELETE' OR current_user NOT IN (@OPERATOR_ROLE@, @MIGRATE_ROLE@) OR principal IS NULL
        OR NEW.actor_id IS DISTINCT FROM principal OR NEW.transaction_id IS DISTINCT FROM txid_current()
        OR NEW.scope IS NULL OR NEW.scope NOT IN ('company', 'share_class', 'proposal', 'invitation', 'document')
        OR NOT (migrating OR COALESCE(operation = CASE NEW.scope
            WHEN 'company' THEN 'company_delete' WHEN 'share_class' THEN 'register_class_delete'
            WHEN 'proposal' THEN 'register_proposal_delete' WHEN 'invitation' THEN 'invitation_delete'
            WHEN 'document' THEN 'register_document_delete' END, false))
        OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text THEN
        RAISE EXCEPTION 'Only the company''s own delete command records its deletion' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.database_disposed_at IS NOT NULL THEN
            RAISE EXCEPTION 'A deletion receipt starts before its delete' USING ERRCODE = '23514';
        END IF;
        IF NEW.scope = 'share_class' AND (NOT companies_class_receipt_listed(NEW.manifest)
            OR jsonb_array_length(COALESCE(NEW.manifest->'tokens_sharetoken', '[]'::jsonb)) <> 1
            OR NOT EXISTS (SELECT 1 FROM tokens_sharetoken token
                WHERE token.uuid = (NEW.manifest->'tokens_sharetoken'->>0)::uuid AND token.company_id = NEW.company_id))
        THEN
            RAISE EXCEPTION 'A share class deletion names exactly one class of its company' USING ERRCODE = '23514';
        END IF;
        IF NEW.scope IN ('proposal', 'invitation', 'document') THEN
            subject := companies_receipt_subject(NEW.scope, NEW.manifest);
            IF subject IS NULL THEN
                RAISE EXCEPTION 'A record deletion names exactly one record of its scope' USING ERRCODE = '23514';
            END IF;
            IF NEW.scope = 'document' THEN
                SELECT company_id, CASE WHEN COALESCE(NEW.manifest->'tokens_registerevidence', '[]'::jsonb)
                        IN ('[]'::jsonb, jsonb_build_array(evidence_id::text)) THEN 'submitted' END
                    INTO owner, state FROM tokens_registermemberdocument WHERE uuid = (NEW.manifest->subject->>0)::uuid;
            ELSIF NEW.scope = 'proposal' THEN
                target := (NEW.manifest->subject->>0)::uuid;
                EXECUTE format('SELECT company_id, status FROM %I WHERE uuid = $1', subject)
                    INTO owner, state USING target;
                link := CASE subject
                    WHEN 'tokens_registerallotment' THEN 'register_allotment_id'
                    WHEN 'tokens_registertransfer' THEN 'register_transfer_id'
                    WHEN 'tokens_registergrant' THEN 'register_grant_id'
                    WHEN 'tokens_registerimport' THEN 'register_import_id'
                    WHEN 'tokens_registercorrection' THEN 'register_correction_id'
                    WHEN 'tokens_registerparticularschange' THEN 'register_particulars_change_id' END;
                FOR listed IN SELECT jsonb_object_keys(NEW.manifest) LOOP
                    IF (listed LIKE '%decision' AND listed <> subject || 'decision')
                        OR (listed IN ('tokens_registeragreement', 'tokens_registercontribution')
                            AND subject <> 'tokens_registerallotment') THEN
                        RAISE EXCEPTION 'A proposal deletion lists only that proposal''s own records'
                            USING ERRCODE = '23514';
                    END IF;
                END LOOP;
                EXECUTE format('SELECT count(*) FROM jsonb_array_elements_text($1) AS listed(id) WHERE NOT EXISTS '
                    '(SELECT 1 FROM %I decision WHERE decision.uuid = listed.id::uuid AND decision.%I = $2)',
                    subject || 'decision', link)
                    INTO stray USING COALESCE(NEW.manifest->(subject || 'decision'), '[]'::jsonb), target;
                IF subject = 'tokens_registerallotment' THEN
                    SELECT allotment.agreement_id, allotment.contribution_id INTO agreement, contribution
                        FROM tokens_registerallotment allotment WHERE allotment.uuid = target;
                    IF COALESCE(NEW.manifest->'tokens_registeragreement', '[]'::jsonb)
                            NOT IN ('[]'::jsonb, jsonb_build_array(agreement::text))
                        OR COALESCE(NEW.manifest->'tokens_registercontribution', '[]'::jsonb)
                            NOT IN ('[]'::jsonb, jsonb_build_array(contribution::text)) THEN
                        stray := stray + 1;
                    END IF;
                END IF;
                IF stray > 0 THEN
                    RAISE EXCEPTION 'A proposal deletion lists only that proposal''s own records' USING ERRCODE = '23514';
                END IF;
            ELSE
                EXECUTE format('SELECT company_id FROM %I WHERE uuid = $1', subject)
                    INTO owner USING (NEW.manifest->subject->>0)::uuid;
                state := CASE WHEN EXISTS (SELECT 1 FROM tokens_memberassociation association
                        WHERE association.invitation_id = (NEW.manifest->subject->>0)::uuid)
                    OR EXISTS (SELECT 1 FROM companies_companyappointment appointment
                        WHERE appointment.invitation_id = (NEW.manifest->subject->>0)::uuid)
                    THEN 'accepted' ELSE 'submitted' END;
            END IF;
            IF owner IS DISTINCT FROM NEW.company_id OR state IS DISTINCT FROM 'submitted' THEN
                RAISE EXCEPTION 'Only a deletable record of this company can be deleted' USING ERRCODE = '23514';
            END IF;
        END IF;
        IF migrating THEN RETURN NEW; END IF;
        IF NEW.scope IN ('share_class', 'proposal', 'document') AND NOT (NEW.appointment_id IS NOT NULL
            AND tokens_register_appointment_current(NEW.appointment_id, NEW.company_id, principal, 'prepare',
                clock_timestamp())) THEN
            RAISE EXCEPTION 'Deleting this record requires current preparation authority' USING ERRCODE = '23514';
        END IF;
        IF NEW.scope = 'invitation' AND NOT (NEW.appointment_id IS NOT NULL
            AND tokens_register_appointment_current(NEW.appointment_id, NEW.company_id, principal, 'admin',
                clock_timestamp())) THEN
            RAISE EXCEPTION 'Deleting an invitation requires current administration' USING ERRCODE = '23514';
        END IF;
        IF NEW.scope = 'company' AND NOT (
            (NEW.appointment_id IS NOT NULL AND tokens_register_appointment_current(
                NEW.appointment_id, NEW.company_id, principal, 'admin', clock_timestamp()))
            OR (NEW.appointment_id IS NULL AND EXISTS (SELECT 1 FROM companies_company issuer
                JOIN authentication_customuser actor ON actor.id = principal
                WHERE issuer.uuid = NEW.company_id AND issuer.owner_id = actor.id AND issuer.status = 'draft'
                    AND actor.is_active AND actor.is_email_verified
                    AND NOT EXISTS (SELECT 1 FROM companies_companylegacyownersource source
                        WHERE source.company_id = issuer.uuid)
                    AND NOT EXISTS (SELECT 1 FROM companies_companyappointment root
                        WHERE root.company_id = issuer.uuid AND root.request_id IS NOT NULL))))
        THEN
            RAISE EXCEPTION 'Deleting a company requires its current administrator' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF OLD.database_disposed_at IS NOT NULL OR NEW.database_disposed_at IS NULL OR NEW.manifest <> '{}'::jsonb
        OR (to_jsonb(NEW) - ARRAY['database_disposed_at', 'manifest', 'updated_at'])
            IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['database_disposed_at', 'manifest', 'updated_at']) THEN
        RAISE EXCEPTION 'A deletion receipt records only when its delete committed' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION companies_guard_disposal() FROM PUBLIC;
