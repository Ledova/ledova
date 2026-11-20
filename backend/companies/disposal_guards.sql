CREATE OR REPLACE FUNCTION companies_disposal_allows(disposal_table text, disposal_row uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE receipt record; selected text; principal bigint;
BEGIN
    IF current_user NOT IN (@OPERATOR_ROLE@, @MIGRATE_ROLE@) THEN RETURN false; END IF;
    selected := NULLIF(current_setting('app.company_disposal', true), '');
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF selected IS NULL OR principal IS NULL
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'company_delete'
        OR to_regclass('public.companies_companydisposal') IS NULL THEN RETURN false; END IF;
    SELECT * INTO receipt FROM companies_companydisposal WHERE uuid = selected::uuid;
    IF NOT FOUND OR receipt.transaction_id IS DISTINCT FROM txid_current()
        OR receipt.database_disposed_at IS NOT NULL
        OR receipt.actor_id IS DISTINCT FROM principal
        OR current_setting('app.company_id', true) IS DISTINCT FROM receipt.company_id::text
        OR receipt.manifest->'companies_company' IS DISTINCT FROM jsonb_build_array(receipt.company_id::text)
    THEN RETURN false; END IF;
    RETURN COALESCE(receipt.manifest->disposal_table @> jsonb_build_array(disposal_row::text), false);
END;
$$;
REVOKE ALL ON FUNCTION companies_disposal_allows(text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION companies_guard_disposal()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE principal bigint;
BEGIN
    principal := NULLIF(current_setting('app.user_id', true), '')::bigint;
    IF TG_OP = 'DELETE' OR current_user NOT IN (@OPERATOR_ROLE@, @MIGRATE_ROLE@) OR principal IS NULL
        OR NEW.actor_id IS DISTINCT FROM principal OR NEW.transaction_id IS DISTINCT FROM txid_current()
        OR current_setting('app.company_operation', true) IS DISTINCT FROM 'company_delete'
        OR current_setting('app.company_id', true) IS DISTINCT FROM NEW.company_id::text THEN
        RAISE EXCEPTION 'Only the company''s own delete command records its deletion' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'INSERT' THEN
        IF NEW.database_disposed_at IS NOT NULL OR NOT (
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
