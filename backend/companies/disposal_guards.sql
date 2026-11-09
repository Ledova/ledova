CREATE OR REPLACE FUNCTION companies_disposal_allows(disposal_table text, disposal_row uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE receipt record; selected text;
BEGIN
    IF current_user <> @MIGRATE_ROLE@ THEN RETURN false; END IF;
    selected := NULLIF(current_setting('app.company_disposal', true), '');
    IF selected IS NULL OR to_regclass('public.companies_companydisposal') IS NULL THEN RETURN false; END IF;
    SELECT * INTO receipt FROM companies_companydisposal WHERE uuid = selected::uuid;
    IF NOT FOUND OR receipt.transaction_id IS DISTINCT FROM txid_current()
        OR receipt.database_disposed_at IS NOT NULL
        OR current_setting('app.company_id', true) IS DISTINCT FROM receipt.company_id::text
        OR receipt.manifest->'companies_company' IS DISTINCT FROM jsonb_build_array(receipt.company_id::text)
    THEN RETURN false; END IF;
    RETURN COALESCE(receipt.manifest->disposal_table @> jsonb_build_array(disposal_row::text), false);
END;
$$;
REVOKE ALL ON FUNCTION companies_disposal_allows(text, uuid) FROM PUBLIC;
